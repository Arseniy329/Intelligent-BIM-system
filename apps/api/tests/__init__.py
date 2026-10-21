import sys
from pathlib import Path

# Ensure apps/api directory is in sys.path for test discovery
API_DIR = Path(__file__).resolve().parent.parent
if str(API_DIR) not in sys.path:
    sys.path.insert(0, str(API_DIR))
