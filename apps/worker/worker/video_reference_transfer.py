"""Prepare a smaller temporary MP4 for suppliers that must fetch references."""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

from .config import Settings

# Large camera/export bitrates can exceed the public relay's download budget.
# Only the supplier reference copy is encoded; the uploaded asset stays intact.
REFERENCE_COMPACT_MIN_BYTES = 10 * 1024 * 1024
REFERENCE_COMPACT_TIMEOUT_SECONDS = 60
REFERENCE_COMPACT_MAX_RATE = "2500k"
REFERENCE_COMPACT_BUFFER = "5000k"
REFERENCE_COMPACT_CRF = "20"
REFERENCE_DURATION_TOLERANCE_SECONDS = 0.1
logger = logging.getLogger(__name__)


def media_info(path: Path, settings: Settings) -> dict:
    executable = Path(settings.ffmpeg_bin).with_name("ffprobe" + Path(settings.ffmpeg_bin).suffix)
    result = subprocess.run(
        [str(executable), "-v", "error", "-protocol_whitelist", "file,pipe",
         "-show_entries", "format=duration:stream=codec_type,width,height,r_frame_rate",
         "-of", "json", str(path)], capture_output=True, timeout=10, check=True,
    )
    return json.loads(result.stdout)


def equivalent_media(source: dict, output: dict) -> bool:
    try:
        before, after = source["streams"], output["streams"]
        # Do not drop tracks, frames, change aspect ratio, or trim the reference.
        if not before or before != after or not any(s.get("codec_type") == "video" for s in before):
            return False
        duration = float(source["format"]["duration"])
        return duration > 0 and abs(duration - float(output["format"]["duration"])) <= REFERENCE_DURATION_TOLERANCE_SECONDS
    except (KeyError, TypeError, ValueError):
        return False


def prepare_reference_transfer(source: Path, media_type: str, settings: Settings) -> Path:
    if media_type not in {"video/mp4", "video/quicktime"} or source.stat().st_size < REFERENCE_COMPACT_MIN_BYTES:
        return source
    target = source.with_name(source.name + "-transfer.mp4")
    try:
        before = media_info(source, settings)
        subprocess.run(
            [settings.ffmpeg_bin, "-v", "error", "-nostdin", "-y",
             "-protocol_whitelist", "file,pipe", "-i", str(source), "-map", "0",
             "-c", "copy", "-c:v", "libx264", "-threads", "1", "-preset", "veryfast",
             "-crf", REFERENCE_COMPACT_CRF, "-maxrate", REFERENCE_COMPACT_MAX_RATE,
             "-bufsize", REFERENCE_COMPACT_BUFFER, "-movflags", "+faststart", str(target)],
            capture_output=True, timeout=REFERENCE_COMPACT_TIMEOUT_SECONDS, check=True,
        )
        if 0 < target.stat().st_size < source.stat().st_size and equivalent_media(before, media_info(target, settings)):
            return target
    except (OSError, ValueError, TypeError, subprocess.SubprocessError):
        # An optional transfer optimization must not make a valid asset unusable.
        # Never log command stderr: user metadata may be embedded in the file.
        logger.warning("reference transfer optimization unavailable")
    return source
