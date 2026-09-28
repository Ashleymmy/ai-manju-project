"""Verify generated envelopes using installed Kombu, without broker/network IO.

Pass the synthetic JSON fixture written by CELERY_DELIVERY_FIXTURE_PATH when
running TestRepeatedCeleryPublishKeepsTaskIdentityWithDistinctDeliveryTags.
"""
import base64
import copy
import json
import sys
from contextlib import contextmanager
from pathlib import Path

import kombu
from kombu.transport.redis import QoS
from kombu.transport.virtual import Message


class MemoryRedis:
    """Only Redis primitive storage; all acknowledgement logic is real Kombu."""
    def __init__(self):
        self.hashes, self.sorted_sets = {}, {}

    def pipeline(self):
        return Pipeline(self)

    def transaction(self, action, *_):
        pipe = self.pipeline()
        action(pipe)
        pipe.execute()


class Pipeline:
    def __init__(self, client):
        self.client, self.operations = client, []

    def zadd(self, key, entries):
        self.operations.append(lambda: self.client.sorted_sets.setdefault(key, {}).update(entries))
        return self

    def hset(self, key, field, value):
        self.operations.append(lambda: self.client.hashes.setdefault(key, {}).__setitem__(field, value))
        return self

    def zrem(self, key, field):
        self.operations.append(lambda: self.client.sorted_sets.setdefault(key, {}).pop(field, None))
        return self

    def hdel(self, key, field):
        self.operations.append(lambda: self.client.hashes.setdefault(key, {}).pop(field, None))
        return self

    def hget(self, key, field):
        return self.client.hashes.get(key, {}).get(field)

    def multi(self):
        pass

    def execute(self):
        result = [operation() for operation in self.operations]
        self.operations = []
        return result


class Channel:
    unacked_key = "unacked"
    unacked_index_key = "unacked_index"
    do_restore = False

    def __init__(self, client):
        self.client, self.restored = client, []

    @contextmanager
    def conn_or_acquire(self, client=None):
        yield client or self.client

    def decode_body(self, body, encoding):
        assert encoding == "base64"
        return base64.b64decode(body)

    def _do_restore_message(self, payload, *_):
        self.restored.append(payload)


def duplicate_consumer_ack(envelopes):
    redis = MemoryRedis()
    channels = [Channel(redis), Channel(redis)]
    consumers = [QoS(channel) for channel in channels]
    messages = [Message(raw, channel=channel) for raw, channel in zip(envelopes, channels)]
    try:
        for qos, message in zip(consumers, messages):
            qos.append(message, message.delivery_tag)
        before = len(redis.hashes["unacked"])
        # Duplicate consumer finds the DB Job already locked and ACKs its own
        # delivery. The first consumer might then crash before finishing.
        consumers[1].ack(messages[1].delivery_tag)
        first_recoverable = messages[0].delivery_tag in redis.hashes["unacked"]
        consumers[0].restore_by_tag(messages[0].delivery_tag)
        return before, first_recoverable, channels[0].restored
    finally:
        for qos in consumers:
            qos._on_collect.cancel()


def main():
    envelopes = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    assert len(envelopes) == 2
    for envelope in envelopes:
        assert envelope["headers"]["id"] == "job_delivery_probe"
        assert envelope["properties"]["correlation_id"] == "job_delivery_probe"
    previous = copy.deepcopy(envelopes)
    for envelope in previous:
        envelope["properties"]["delivery_tag"] = envelope["headers"]["id"]
    assert duplicate_consumer_ack(previous) == (1, False, [])
    before, recoverable, restored = duplicate_consumer_ack(envelopes)
    assert (before, recoverable, len(restored)) == (2, True, 1)
    assert restored[0]["headers"]["id"] == "job_delivery_probe"
    print(f"Kombu {kombu.__version__}: old tags overwrite unacked; unique delivery tags preserve crash recovery")


if __name__ == "__main__":
    main()
