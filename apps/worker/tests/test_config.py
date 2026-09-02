import os
import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from worker.config import build_database_url, load_settings, redact_url


class ConfigTest(unittest.TestCase):
    def test_build_database_url_from_db_env(self) -> None:
        original = os.environ.copy()
        try:
            os.environ.pop("DATABASE_URL", None)
            os.environ["DB_HOST"] = "postgres"
            os.environ["DB_PORT"] = "5433"
            os.environ["DB_USER"] = "manju"
            os.environ["DB_PASSWORD"] = "secret"
            os.environ["DB_NAME"] = "ai_manju"
            os.environ["DB_SSLMODE"] = "disable"

            self.assertEqual(
                build_database_url(),
                "host=postgres port=5433 user=manju password=secret dbname=ai_manju sslmode=disable",
            )
        finally:
            os.environ.clear()
            os.environ.update(original)

    def test_redact_url_password(self) -> None:
        self.assertEqual(redact_url("redis://user:secret@redis:6379/0"), "redis://user:***@redis:6379/0")

    def test_load_settings_accepts_optional_provider_rate_limit(self) -> None:
        original = os.environ.copy()
        try:
            os.environ["WORKER_PROVIDER_RATE_LIMIT"] = "2/s"
            os.environ["WORKER_CONCURRENCY"] = "8"
            settings = load_settings()
            self.assertEqual(settings.provider_rate_limit, "2/s")
            self.assertEqual(settings.worker_concurrency, 8)
        finally:
            os.environ.clear()
            os.environ.update(original)


if __name__ == "__main__":
    unittest.main()
