import tempfile
import unittest
from io import BytesIO
from pathlib import Path

from PIL import Image

from app.local_public_assets import (
    LocalPublicAssetError,
    build_public_asset_url,
    delete_local_public_asset,
    prepare_image,
    resolve_local_public_asset,
    store_local_public_image,
)


def png_bytes(size=(320, 240), color=(30, 80, 150, 255)) -> bytes:
    output = BytesIO()
    Image.new("RGBA", size, color).save(output, format="PNG")
    return output.getvalue()


class LocalPublicAssetTests(unittest.TestCase):
    def test_store_resolve_build_url_and_delete(self):
        with tempfile.TemporaryDirectory() as root:
            asset = store_local_public_image(
                png_bytes(),
                root_dir=root,
                max_bytes=1_000_000,
                target_bytes=100_000,
            )

            resolved = resolve_local_public_asset(root, asset.token)
            self.assertTrue(resolved.is_file())
            self.assertEqual(resolved.read_bytes(), png_bytes())
            self.assertEqual(
                build_public_asset_url("https://example.trycloudflare.com", asset.token),
                f"https://example.trycloudflare.com/api/local-assets/{asset.token}",
            )
            self.assertTrue(delete_local_public_asset(root, asset.storage_path))
            self.assertFalse(resolved.exists())

    def test_large_image_is_optimized_before_storage(self):
        source = BytesIO()
        Image.new("RGB", (1600, 1200), (35, 90, 180)).save(source, format="BMP")
        original = source.getvalue()

        with tempfile.TemporaryDirectory() as root:
            asset = store_local_public_image(
                original,
                root_dir=root,
                max_bytes=10_000_000,
                target_bytes=80_000,
            )

            self.assertTrue(asset.optimized)
            self.assertLessEqual(asset.uploaded_bytes, 80_000)
            self.assertTrue(asset.token.endswith(".jpg"))

    def test_invalid_image_and_oversized_image_are_rejected(self):
        with self.assertRaises(LocalPublicAssetError):
            prepare_image(b"not-an-image", max_bytes=1000, target_bytes=500)

        with self.assertRaises(LocalPublicAssetError):
            prepare_image(png_bytes() + b"padding", max_bytes=10, target_bytes=5)

    def test_path_traversal_and_non_https_base_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(LocalPublicAssetError):
                resolve_local_public_asset(root, "../secret.png")
            with self.assertRaises(LocalPublicAssetError):
                delete_local_public_asset(root, "local_public/../secret.png")

        with self.assertRaises(LocalPublicAssetError):
            build_public_asset_url("http://127.0.0.1:8001", "a" * 32 + ".png")

    def test_small_transparent_image_is_preserved(self):
        original = png_bytes()
        prepared = prepare_image(
            original,
            max_bytes=1_000_000,
            target_bytes=100_000,
        )

        self.assertFalse(prepared.optimized)
        self.assertEqual(prepared.content_type, "image/png")
        self.assertEqual(prepared.data, original)


if __name__ == "__main__":
    unittest.main()
