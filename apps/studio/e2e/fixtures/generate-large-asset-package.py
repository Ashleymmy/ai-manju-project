"""Create a synthetic 34-file ZIP64 asset package for the isolated import E2E."""
import argparse
import base64
import json
from pathlib import Path
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--file-mib", type=int, default=34)
args = parser.parse_args()
if args.file_mib < 1:
    parser.error("--file-mib must be positive")
size = args.file_mib * 1024 * 1024
png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
manifest = {
    "app": "ai-manju-studio", "version": 2,
    "folders": [{"id": "root", "name": "大包导入验证", "parent_id": "", "sort_order": 0},
                {"id": "child", "name": "子目录", "parent_id": "root", "sort_order": 0}],
    "tags": [{"id": "label", "name": "容量验证", "parent_id": "", "inherit_mode": "auto", "description": ""}],
    "assets": [], "files": [],
}
block = bytes(1024 * 1024)
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
    for index in range(34):
        name, asset_id = f"素材_{index:03}.png", f"qa_{index:03}"
        path = f"大包导入验证/子目录/{name}"
        manifest["assets"].append({"id": asset_id, "name": name, "type": "image", "content_type": "image/png",
                                   "folder_id": "child", "category": "character", "tag_ids": ["label"],
                                   "tags": ["容量验证"], "note": f"备注 {index}"})
        manifest["files"].append({"assetId": asset_id, "path": path, "mimeType": "image/png", "bytes": size})
        with archive.open(path, "w", force_zip64=True) as output:
            output.write(png)
            remaining = size - len(png)
            while remaining:
                part = min(len(block), remaining)
                output.write(block[:part])
                remaining -= part
    archive.writestr("assets.json", json.dumps(manifest, ensure_ascii=False))
print(f"assets=34 bytes={args.output.stat().st_size} per_file_mib={args.file_mib} ZIP64=True")
