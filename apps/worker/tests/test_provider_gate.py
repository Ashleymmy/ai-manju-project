import os
import sys
import time
import unittest
from pathlib import Path
from uuid import uuid4


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker.provider_gate import MAX_EXPIRED_WAITER_HEADS_PER_ACQUIRE, ProviderGate, provider_gate_from_payload


class ProviderGateTest(unittest.TestCase):
    def test_redis_namespace_never_contains_original_gate_key(self) -> None:
        gate = ProviderGate("redis://localhost:6379/15", "provider_gate_super-secret-fingerprint", client=object())
        self.assertNotIn("super-secret", gate.prefix)
        self.assertEqual(len(gate.prefix.rsplit(":", 1)[-1]), 64)

    def test_payload_defaults_max_concurrency_to_three(self) -> None:
        gate_config = provider_gate_from_payload({"provider": {"gate_key": "gate"}}, "redis://localhost:6379/15", 30)
        self.assertIsNotNone(gate_config)
        self.assertEqual(gate_config[1], 3)

    def test_payload_preserves_explicit_max_concurrency_one(self) -> None:
        gate_config = provider_gate_from_payload(
            {"provider": {"gate_key": "gate", "max_concurrency": 1}},
            "redis://localhost:6379/15",
            30,
        )
        self.assertIsNotNone(gate_config)
        self.assertEqual(gate_config[1], 1)

    @unittest.skipUnless(os.getenv("REDIS_TEST_URL"), "REDIS_TEST_URL is required for Redis gate integration")
    def test_global_limit_and_workspace_round_robin(self) -> None:
        gate = ProviderGate(os.environ["REDIS_TEST_URL"], f"test-{uuid4().hex}", lease_seconds=30)
        client = gate.client
        try:
            first = gate.acquire("workspace-a", "job-a1", 1)
            self.assertTrue(first.acquired)
            self.assertFalse(gate.acquire("workspace-a", "job-a2", 1).acquired)
            self.assertFalse(gate.acquire("workspace-b", "job-b1", 1).acquired)
            gate.release("job-a1")

            # A ran last and B is also waiting, so B owns the next fair turn.
            self.assertFalse(gate.acquire("workspace-a", "job-a2", 1).acquired)
            self.assertTrue(gate.acquire("workspace-b", "job-b1", 1).acquired)
            gate.release("job-b1")
            self.assertTrue(gate.acquire("workspace-a", "job-a2", 1).acquired)
            gate.release("job-a2")
        finally:
            keys = list(client.scan_iter(f"{gate.prefix}*"))
            if keys:
                client.delete(*keys)


@unittest.skipUnless(os.getenv("REDIS_TEST_URL"), "REDIS_TEST_URL is required for Redis gate integration")
class ProviderGateExpiredWaiterTest(unittest.TestCase):
    def setUp(self) -> None:
        self.gate = ProviderGate(os.environ["REDIS_TEST_URL"], f"test-{uuid4().hex}", lease_seconds=30)
        self.client = self.gate.client

    def tearDown(self) -> None:
        keys = list(self.client.scan_iter(f"{self.gate.prefix}*"))
        if keys:
            self.client.delete(*keys)

    def expire_ticket(self, job_id: str) -> None:
        self.client.pexpire(self.gate._ticket_key(job_id), 1)
        time.sleep(0.01)
        self.assertFalse(self.client.exists(self.gate._ticket_key(job_id)))

    def test_expired_head_does_not_block_same_workspace(self) -> None:
        self.assertTrue(self.gate.acquire("holder", "running", 1).acquired)
        self.assertFalse(self.gate.acquire("waiting", "dead", 1).acquired)
        self.assertFalse(self.gate.acquire("waiting", "live", 1).acquired)
        self.expire_ticket("dead")
        self.gate.release("running")
        self.assertTrue(self.gate.acquire("waiting", "live", 1).acquired)
        self.assertEqual(self.client.llen(self.gate.ring_key), 0)

    def test_expired_workspace_does_not_block_other_workspaces(self) -> None:
        self.assertTrue(self.gate.acquire("holder", "running", 1).acquired)
        self.assertFalse(self.gate.acquire("expired-workspace", "dead", 1).acquired)
        self.assertFalse(self.gate.acquire("live-workspace", "live", 1).acquired)
        self.expire_ticket("dead")
        self.gate.release("running")
        self.assertTrue(self.gate.acquire("live-workspace", "live", 1).acquired)
        self.assertFalse(self.client.exists(self.gate._workspace_key("expired-workspace")))

    def test_retry_renews_live_ticket_and_preserves_fair_turn(self) -> None:
        self.assertTrue(self.gate.acquire("holder", "running", 1).acquired)
        self.assertFalse(self.gate.acquire("first", "first-job", 1).acquired)
        self.client.pexpire(self.gate._ticket_key("first-job"), 1000)
        self.assertFalse(self.gate.acquire("first", "first-job", 1).acquired)
        self.assertGreater(self.client.pttl(self.gate._ticket_key("first-job")), 1000)
        self.assertFalse(self.gate.acquire("second", "second-job", 1).acquired)
        self.gate.release("running")
        self.assertFalse(self.gate.acquire("second", "second-job", 1).acquired)
        self.assertTrue(self.gate.acquire("first", "first-job", 1).acquired)

    def test_expired_reentry_behind_live_head_is_not_duplicated(self) -> None:
        self.assertTrue(self.gate.acquire("holder", "running", 1).acquired)
        self.assertFalse(self.gate.acquire("first", "first-job", 1).acquired)
        self.assertFalse(self.gate.acquire("second", "second-job", 1).acquired)
        self.expire_ticket("second-job")
        self.assertFalse(self.gate.acquire("second", "second-job", 1).acquired)
        self.assertEqual(self.client.lrange(self.gate._workspace_key("second"), 0, -1), ["second-job"])
        self.assertEqual(self.client.lrange(self.gate.ring_key, 0, -1), ["first", "second"])
        self.gate.release("running")
        self.assertTrue(self.gate.acquire("first", "first-job", 1).acquired)
        self.gate.release("first-job")
        self.assertTrue(self.gate.acquire("second", "second-job", 1).acquired)
        self.assertEqual(self.client.llen(self.gate.ring_key), 0)

    def test_cleanup_does_not_remove_ticket_renewed_after_snapshot(self) -> None:
        self.client.rpush(self.gate.ring_key, "waiting")
        self.client.rpush(self.gate._workspace_key("waiting"), "renewed")
        # Simulate renewal after Python observed the expired queue head.
        self.client.set(self.gate._ticket_key("renewed"), "waiting", px=60000)
        removed = self.client.eval(
            self.gate._PRUNE_EXPIRED_HEAD_SCRIPT, 3, self.gate.ring_key,
            self.gate._workspace_key("waiting"), self.gate._ticket_key("renewed"), "waiting", "renewed",
        )
        self.assertEqual(removed, 0)
        self.assertEqual(self.client.lindex(self.gate._workspace_key("waiting"), 0), "renewed")

    def test_cleanup_does_not_remove_head_changed_after_snapshot(self) -> None:
        self.client.rpush(self.gate.ring_key, "waiting")
        self.client.rpush(self.gate._workspace_key("waiting"), "replacement")
        removed = self.client.eval(
            self.gate._PRUNE_EXPIRED_HEAD_SCRIPT, 3, self.gate.ring_key,
            self.gate._workspace_key("waiting"), self.gate._ticket_key("old-head"), "waiting", "old-head",
        )
        self.assertEqual(removed, 0)
        self.assertEqual(self.client.lindex(self.gate._workspace_key("waiting"), 0), "replacement")

    def test_cleanup_is_bounded_and_continues_next_acquisition(self) -> None:
        self.client.rpush(self.gate.ring_key, "waiting")
        stale_jobs = [f"dead-{index}" for index in range(MAX_EXPIRED_WAITER_HEADS_PER_ACQUIRE + 2)]
        self.client.rpush(self.gate._workspace_key("waiting"), *stale_jobs)
        self.assertFalse(self.gate.acquire("waiting", "live", 1).acquired)
        self.assertEqual(self.client.llen(self.gate._workspace_key("waiting")), 3)
        self.assertTrue(self.gate.acquire("waiting", "live", 1).acquired)
        self.assertEqual(self.client.llen(self.gate.ring_key), 0)


@unittest.skipUnless(os.getenv("REDIS_TEST_URL"), "REDIS_TEST_URL is required for Redis gate integration")
class ProviderGateProcessRecoveryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.gate_key = f"test-{uuid4().hex}"
        self.gate = self.new_worker_gate()
        self.client = self.gate.client

    def new_worker_gate(self) -> ProviderGate:
        return ProviderGate(os.environ["REDIS_TEST_URL"], self.gate_key, lease_seconds=30)

    def tearDown(self) -> None:
        keys = list(self.client.scan_iter(f"{self.gate.prefix}*"))
        if keys:
            self.client.delete(*keys)

    def test_replacement_worker_resumes_own_slot_at_capacity_one(self) -> None:
        self.assertTrue(self.gate.acquire("owner", "original", 1).acquired)
        self.assertFalse(self.gate.acquire("other", "waiting", 1).acquired)
        # The process died without release(). Its replacement already holds
        # the original Job execution lock, but is a fresh ProviderGate instance.
        old_expiry = int(time.time() * 1000) + 5000
        self.client.zadd(self.gate.active_key, {"original": old_expiry})
        replacement = self.new_worker_gate()
        self.assertTrue(replacement.acquire("owner", "original", 1).acquired)
        self.assertEqual(self.client.zcard(self.gate.active_key), 1)
        self.assertGreater(self.client.zscore(self.gate.active_key, "original"), old_expiry)
        self.assertFalse(self.client.exists(self.gate._ticket_key("original")))
        self.assertFalse(self.client.exists(self.gate._workspace_key("owner")))
        self.assertEqual(self.client.lrange(self.gate.ring_key, 0, -1), ["other"])
        self.assertEqual(self.client.lrange(self.gate._workspace_key("other"), 0, -1), ["waiting"])
        self.assertFalse(replacement.acquire("other", "waiting", 1).acquired)
        replacement.release("original")
        self.assertTrue(replacement.acquire("other", "waiting", 1).acquired)

    def test_resume_removes_only_its_legacy_waiter_and_preserves_other_lease(self) -> None:
        self.assertTrue(self.gate.acquire("owner", "original", 2).acquired)
        self.assertTrue(self.gate.acquire("other", "active-other", 2).acquired)
        self.assertFalse(self.gate.acquire("owner", "waiting", 2).acquired)
        other_expiry = self.client.zscore(self.gate.active_key, "active-other")
        self.client.rpush(self.gate._workspace_key("owner"), "original")
        self.client.set(self.gate._ticket_key("original"), "owner", px=60000)
        replacement = self.new_worker_gate()
        self.assertTrue(replacement.acquire("owner", "original", 2).acquired)
        self.assertEqual(self.client.zcard(self.gate.active_key), 2)
        self.assertEqual(self.client.zscore(self.gate.active_key, "active-other"), other_expiry)
        self.assertEqual(self.client.lrange(self.gate._workspace_key("owner"), 0, -1), ["waiting"])
        self.assertEqual(self.client.lrange(self.gate.ring_key, 0, -1), ["owner"])
        self.assertTrue(self.client.exists(self.gate._ticket_key("waiting")))
        self.assertFalse(self.client.exists(self.gate._ticket_key("original")))

    def test_resume_respects_cooldown_without_adding_another_waiter(self) -> None:
        self.assertTrue(self.gate.acquire("owner", "original", 1).acquired)
        old_expiry = self.client.zscore(self.gate.active_key, "original")
        self.gate.set_cooldown(60)
        replacement = self.new_worker_gate()
        decision = replacement.acquire("owner", "original", 1)
        self.assertFalse(decision.acquired)
        self.assertGreaterEqual(decision.retry_after_seconds, 59)
        self.assertEqual(self.client.zscore(self.gate.active_key, "original"), old_expiry)
        self.assertFalse(self.client.exists(self.gate._ticket_key("original")))
        self.assertFalse(self.client.exists(self.gate._workspace_key("owner")))
        self.assertEqual(self.client.llen(self.gate.ring_key), 0)
        self.client.delete(self.gate.cooldown_key)
        self.assertTrue(replacement.acquire("owner", "original", 1).acquired)

    def test_expired_original_lease_does_not_skip_other_waiters(self) -> None:
        self.assertTrue(self.gate.acquire("owner", "original", 1).acquired)
        self.assertFalse(self.gate.acquire("other", "waiting", 1).acquired)
        self.client.zadd(self.gate.active_key, {"original": int(time.time() * 1000) - 1})
        replacement = self.new_worker_gate()
        self.assertFalse(replacement.acquire("owner", "original", 1).acquired)
        self.assertTrue(replacement.acquire("other", "waiting", 1).acquired)
        self.assertEqual(self.client.lrange(self.gate._workspace_key("owner"), 0, -1), ["original"])
        replacement.release("waiting")
        self.assertTrue(replacement.acquire("owner", "original", 1).acquired)


if __name__ == "__main__":
    unittest.main()
