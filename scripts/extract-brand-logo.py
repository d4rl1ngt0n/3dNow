import re
import base64
from pathlib import Path

root = Path(r"c:\Users\HP\Downloads\3DNow_18\quote-engine-src")
src = (root / "3dnow_17.html").read_text(encoding="utf-8")
match = re.search(r'class="brand-logo"\s+src="data:image/png;base64,([^"]+)"', src)
if not match:
    raise SystemExit("logo not found")
out_dir = root / "server" / "assets"
out_dir.mkdir(parents=True, exist_ok=True)
png = out_dir / "brand-logo.png"
png.write_bytes(base64.b64decode(match.group(1)))
print(f"wrote {png} ({png.stat().st_size} bytes)")
