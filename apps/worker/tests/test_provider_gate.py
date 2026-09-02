import os
import sys
import unittest
from pathlib import Path
from uuid import uuid4


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker.provider_gate import ProviderGate, provider_gate_from_payload


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


if __name__ == "__main__":
    unittest.main()
