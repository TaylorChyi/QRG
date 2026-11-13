"""Render the existing Jinja UI for a browser-local static build."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from qrg_web import app  # noqa: E402

response = app.test_client().get('/?lang=zh-CN')
if response.status_code != 200:
    raise SystemExit(f'Could not render QRG: HTTP {response.status_code}')
sys.stdout.write(response.get_data(as_text=True))
