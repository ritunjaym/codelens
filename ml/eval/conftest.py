"""
pytest configuration for ml/eval/.

Adds the repo root to sys.path so that `from ml.eval.metrics import ...`
works when running pytest from any working directory.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Repo root = three levels up from this file (ml/eval/conftest.py)
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
