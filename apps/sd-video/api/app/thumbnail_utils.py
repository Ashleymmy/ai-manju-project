"""
缩微图处理工具 — 图片和视频缩微图生成
"""

import subprocess
import tempfile
import os
import json
from io import BytesIO
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    Image = None


async def generate_image_thumbnail(
    image_data: bytes,
    size: tuple = (320, 180),
    quality: int = 85,
) -> bytes:
    """
    生成图片缩微图

    Args:
        image_data: 原始图片数据（字节）
        size: 缩微图尺寸 (宽, 高)，默认 (320, 180)
        quality: JPEG 质量 (1-100)，默认 85

    Returns:
        缩微图数据（字节）
    """
    if not Image:
        raise RuntimeError("Pillow 库未安装，请运行: pip install Pillow")

    try:
        # 打开原始图片
        img = Image.open(BytesIO(image_data))

        # 转换 RGBA 到 RGB（处理透明背景）
        if img.mode in ("RGBA", "LA", "P"):
            # 创建白色背景
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        # 按宽高比调整大小
        img.thumbnail(size, Image.Resampling.LANCZOS)

        # 创建指定大小的新图片 (使用黑色背景)
        thumb = Image.new("RGB", size, (0, 0, 0))
        offset = ((size[0] - img.width) // 2, (size[1] - img.height) // 2)
        thumb.paste(img, offset)

        # 保存为 JPEG
        output = BytesIO()
        thumb.save(output, format="JPEG", quality=quality, optimize=True)
        return output.getvalue()
    except Exception as e:
        raise RuntimeError(f"生成图片缩微图失败: {str(e)}")


async def extract_video_thumbnail(
    video_path: str,
    timestamp: str = "00:00:00",
    size: tuple = (320, 180),
    output_format: str = "jpeg",
) -> bytes:
    """
    从视频中提取缩微图（关键帧）

    Args:
        video_path: 视频文件路径或URL
        timestamp: 提取时间戳 (HH:MM:SS 或 秒数)，默认第1秒
        size: 输出尺寸 (宽, 高)，默认 (320, 180)
        output_format: 输出格式 ("jpeg" 或 "png")

    Returns:
        缩微图数据（字节）

    Note:
        需要系统安装 ffmpeg
        在 Windows: choco install ffmpeg
        在 macOS: brew install ffmpeg
        在 Linux: sudo apt-get install ffmpeg
    """
    try:
        # 检测 ffmpeg
        subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            check=True,
            timeout=5,
        )
    except (subprocess.CalledProcessError, FileNotFoundError, subprocess.TimeoutExpired):
        raise RuntimeError("ffmpeg 未安装或不在 PATH 中。请先安装 ffmpeg")

    temp_output = None
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            temp_output = os.path.join(tmpdir, f"thumbnail.{output_format}")

            # 构建 ffmpeg 命令
            cmd = [
                "ffmpeg",
                "-i", video_path,
                "-ss", timestamp,
                "-vf", f"scale={size[0]}:{size[1]}:force_original_aspect_ratio=decrease,pad={size[0]}:{size[1]}:(ow-iw)/2:(oh-ih)/2:black",
                "-vframes", "1",
                "-y",
                temp_output,
            ]

            # 执行 ffmpeg
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
            )

            if result.returncode != 0:
                raise RuntimeError(f"ffmpeg 提取失败: {result.stderr}")

            # 读取生成的缩微图
            if not os.path.exists(temp_output):
                raise RuntimeError("缩微图生成失败")

            with open(temp_output, "rb") as f:
                thumbnail_data = f.read()

            return thumbnail_data
    except subprocess.TimeoutExpired:
        raise RuntimeError("ffmpeg 处理超时")
    except Exception as e:
        raise RuntimeError(f"提取视频缩微图失败: {str(e)}")


async def get_image_dimensions(image_data: bytes) -> tuple:
    """
    获取图片尺寸 (宽, 高)
    """
    if not Image:
        raise RuntimeError("Pillow 库未安装")

    try:
        img = Image.open(BytesIO(image_data))
        return (img.width, img.height)
    except Exception as e:
        raise RuntimeError(f"获取图片尺寸失败: {str(e)}")


async def ensure_min_image_size(
    image_data: bytes,
    min_width: int = 300,
    min_height: int = 300,
    max_width: int | None = None,
    max_height: int | None = None,
    quality: int = 92,
) -> tuple[bytes, int, int, bool]:
    """
    确保图片最小尺寸要求。

    Returns:
        (处理后图片字节, 宽, 高, 是否已处理)
    """
    if not Image:
        raise RuntimeError("Pillow 库未安装")

    try:
        img = Image.open(BytesIO(image_data))
        if img.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[-1] if img.mode == "RGBA" else None)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")

        width, height = img.width, img.height
        within_max_width = max_width is None or width <= max_width
        within_max_height = max_height is None or height <= max_height
        if width >= min_width and height >= min_height and within_max_width and within_max_height:
            return image_data, width, height, False

        min_scale = max(min_width / max(width, 1), min_height / max(height, 1))
        max_scale = min(
            max_width / max(width, 1) if max_width is not None else 1.0,
            max_height / max(height, 1) if max_height is not None else 1.0,
            1.0,
        )
        scale = max_scale if max_scale < 1.0 else (min_scale if min_scale > 1.0 else 1.0)
        resized_width = max(1, int(round(width * scale)))
        resized_height = max(1, int(round(height * scale)))
        if max_width is not None:
            resized_width = min(max_width, resized_width)
        if max_height is not None:
            resized_height = min(max_height, resized_height)

        resized = img.resize((resized_width, resized_height), Image.Resampling.LANCZOS)
        new_width = max(min_width, resized_width)
        new_height = max(min_height, resized_height)
        if (new_width, new_height) != resized.size:
            canvas = Image.new("RGB", (new_width, new_height), (255, 255, 255))
            canvas.paste(resized, ((new_width - resized_width) // 2, (new_height - resized_height) // 2))
            resized = canvas
        output = BytesIO()
        resized.save(output, format="JPEG", quality=quality, optimize=True)
        return output.getvalue(), new_width, new_height, True
    except Exception as e:
        raise RuntimeError(f"图片最小尺寸修复失败: {str(e)}")


async def get_video_info(video_path: str) -> dict:
    """
    获取视频信息（时长、分辨率等）

    Returns:
        字典包含:
        - duration: 视频时长（秒）
        - width: 视频宽度
        - height: 视频高度
        - fps: 帧率
    """
    try:
        # 使用 JSON 格式输出，避免由于索引偏移导致的解析失败
        cmd = [
            "ffprobe",
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=duration,width,height,r_frame_rate:format=duration",
            "-of", "json",
            video_path,
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
        )

        if result.returncode != 0:
            raise RuntimeError(f"ffprobe 获取失败: {result.stderr}")

        data = json.loads(result.stdout)
        if not data:
            raise RuntimeError("无法解析视频信息: JSON 为空")

        streams = data.get("streams", [])
        fmt = data.get("format", {})

        # 基础数据初始化
        duration = 0
        width = 0
        height = 0
        fps = 0

        if streams:
            video_stream = streams[0]
            width = int(video_stream.get("width") or 0)
            height = int(video_stream.get("height") or 0)

            # 优先从 stream 获取时长，获取不到再看 format
            duration_str = video_stream.get("duration") or fmt.get("duration")
            if duration_str:
                try:
                    duration = float(duration_str)
                except:
                    duration = 0

            # 安全解析帧率 (如 "24/1")
            fps_str = video_stream.get("r_frame_rate", "0/1")
            if fps_str and "/" in fps_str:
                try:
                    num, denom = map(float, fps_str.split("/"))
                    fps = num / denom if denom > 0 else 0
                except:
                    fps = 0
            elif fps_str:
                try:
                    fps = float(fps_str)
                except:
                    fps = 0

        return {
            "duration": int(duration),
            "width": width,
            "height": height,
            "fps": round(fps, 3),
        }
    except subprocess.TimeoutExpired:
        raise RuntimeError("ffprobe 获取超时")
    except Exception as e:
        raise RuntimeError(f"获取视频信息失败: {str(e)}")


async def get_audio_duration(audio_data: bytes, original_path: str = "") -> float:
    """
    获取音频时长（秒）。
    使用 ffprobe 从字节数据中检测时长，支持 mp3/wav/m4a 等常见格式。

    Args:
        audio_data: 音频文件字节数据
        original_path: 原始文件路径，用于推断扩展名让 ffprobe 正确识别容器格式

    Returns:
        时长（秒），浮点数；获取失败返回 0.0
    """
    fd, tmp_file = -1, None
    try:
        suffix = ".mp3"
        if original_path:
            ext = Path(original_path).suffix.lower()
            if ext in (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"):
                suffix = ext

        # 使用 mkstemp 生成临时文件并获取底层文件描述符
        fd, tmp_file = tempfile.mkstemp(suffix=suffix)

        # 使用 fdopen 安全地写入数据并显式关闭文件描述符以释放 Windows 文件锁
        with os.fdopen(fd, 'wb') as f:
            f.write(audio_data)
        fd = -1 # 表明已安全关闭，避免 finally 重复关闭

        # 双路探测：同时提取 format 和 streams 的 duration，应对不同容器格式的 metadata 缺失
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration:stream=duration",
            "-of", "json",
            tmp_file,
        ]

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
        )

        if result.returncode != 0:
            return 0.0

        data = json.loads(result.stdout)

        # 优先读取 streams 的 duration（例如部分 wav 格式无 format duration）
        duration_str = None
        streams = data.get("streams", [])
        if streams:
            duration_str = streams[0].get("duration")

        if not duration_str:
            duration_str = data.get("format", {}).get("duration")

        if duration_str:
            return float(duration_str)
        return 0.0

    except Exception:
        return 0.0
    finally:
        if fd != -1:
            try:
                os.close(fd)
            except Exception:
                pass
        if tmp_file and os.path.exists(tmp_file):
            try:
                os.remove(tmp_file)
            except Exception:
                pass
