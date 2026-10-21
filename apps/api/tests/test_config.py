import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))

from src.core.config import Settings


class TestConfig(unittest.TestCase):
    def test_settings_requires_supabase_env_vars(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            # Without SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY,
            # ValidationError should be raised
            with self.assertRaises(ValidationError) as context:
                Settings(_env_file=None)
            errors = context.exception.errors()
            missing_fields = {e["loc"][0] for e in errors}
            self.assertIn("SUPABASE_URL", missing_fields)
            self.assertIn("SUPABASE_SERVICE_ROLE_KEY", missing_fields)

    def test_settings_valid(self) -> None:
        env = {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "secret-role-key",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = Settings(_env_file=None)
            self.assertEqual(settings.SUPABASE_URL, "https://test.supabase.co")
            self.assertEqual(settings.SUPABASE_SERVICE_ROLE_KEY, "secret-role-key")

    def test_settings_cors_defaults(self) -> None:
        env = {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "secret-role-key",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = Settings(_env_file=None)
            self.assertEqual(
                settings.CORS_ORIGINS,
                ["http://localhost:3000", "http://127.0.0.1:3000"],
            )
            self.assertEqual(settings.CORS_ORIGIN_REGEX, r"^https:\/\/.*\.vercel\.app$")

    def test_settings_cors_custom(self) -> None:
        env = {
            "SUPABASE_URL": "https://test.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "secret-role-key",
            "CORS_ORIGINS": '["https://example.com"]',
            "CORS_ORIGIN_REGEX": r"^https:\/\/preview-.*\.example\.com$",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = Settings(_env_file=None)
            self.assertEqual(settings.CORS_ORIGINS, ["https://example.com"])
            self.assertEqual(
                settings.CORS_ORIGIN_REGEX,
                r"^https:\/\/preview-.*\.example\.com$",
            )


if __name__ == "__main__":
    unittest.main()
