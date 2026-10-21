import sys
from pathlib import Path

# Ensure the project root (apps/api) is in sys.path for serverless execution
ROOT_DIR = Path(__file__).resolve().parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from src.main import app

__all__ = ["app"]
