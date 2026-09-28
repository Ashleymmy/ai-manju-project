import copy
import threading

from worker.video_checkpoint import VideoCheckpoint


class CheckpointStore:
    """Explicit test-only durable-store substitute, shared across redeliveries."""
    def __init__(self):
        self.status = "running"
        self.checkpoint = {}
        self.lock = threading.Lock()
        self.fail_read = False
        self.fail_write = False

    def get_video_checkpoint(self, _job):
        if self.fail_read:
            raise ConnectionError("database unavailable")
        return {"status": self.status, "checkpoint": copy.deepcopy(self.checkpoint)}

    def save_video_checkpoint(self, _job, value, expected_revision):
        if self.fail_write:
            raise ConnectionError("database unavailable")
        with self.lock:
            if self.status not in {"queued", "running"} or self.checkpoint.get("revision", 0) != expected_revision:
                return None
            self.checkpoint = copy.deepcopy(value)
            return {"id": _job, "status": self.status}


def isolated_checkpoint(job_id, payload, _settings):
    return VideoCheckpoint(CheckpointStore(), job_id, payload.get("provider") or {})
