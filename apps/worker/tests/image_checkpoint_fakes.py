from video_checkpoint_fakes import CheckpointStore
from worker.image_checkpoint import ImageCheckpoint


class ImageCheckpointStore(CheckpointStore):
    get_image_checkpoint = CheckpointStore.get_video_checkpoint
    save_image_checkpoint = CheckpointStore.save_video_checkpoint


def isolated_image_checkpoint(job_id, payload, provider, settings):
    return ImageCheckpoint(ImageCheckpointStore(), job_id, provider, settings)
