import unittest
from worker.image_specs import gemini_image_config
from worker.image_output_validation import meets_requested_dimensions


class ImageSpecsTest(unittest.TestCase):
    def test_canvas_budgets_map_to_native_resolution_not_detail_quality(self):
        for size, tier in [("832x1248", "1K"), ("1664x2496", "2K"), ("2336x3504", "4K")]:
            for quality in ("low", "high", "auto"):
                self.assertEqual(gemini_image_config({"size": size, "quality": quality}), {"aspectRatio": "2:3", "imageSize": tier})
        self.assertEqual(gemini_image_config({"size": "auto"}), {})

    def test_gemini_block_rounding_is_allowed_but_wrong_tier_and_aspect_are_not(self):
        self.assertTrue(meets_requested_dimensions(848, 1264, (832, 1248), gemini=True))
        self.assertTrue(meets_requested_dimensions(1696, 2528, (1664, 2496), gemini=True))
        self.assertTrue(meets_requested_dimensions(3392, 5056, (2336, 3504), gemini=True))
        self.assertFalse(meets_requested_dimensions(848, 1264, (1664, 2496), gemini=True))
        self.assertFalse(meets_requested_dimensions(1024, 1536, (2336, 3504), gemini=True))
        self.assertFalse(meets_requested_dimensions(1536, 1024, (1024, 1536), gemini=True))
        self.assertFalse(meets_requested_dimensions(848, 1264, (832, 1248)))
