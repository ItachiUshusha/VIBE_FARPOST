"""Сохраняет открытые шрифты локально; не требуется при обычном запуске."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1] / "frontend/public"


def fetch(item):
    url, name = item
    target = ROOT / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return name
    request = urllib.request.Request(url, headers={"User-Agent": "FarPost-Butterfly-MVP/1.0"})
    with urllib.request.urlopen(request, timeout=25) as response:
        target.write_bytes(response.read())
    return name


if __name__ == "__main__":
    tasks = [
        ("https://fonts.gstatic.com/s/manrope/v23/xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk79FO_F.ttf", "fonts/manrope-regular.ttf"),
        ("https://fonts.gstatic.com/s/manrope/v23/xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk4jE-_F.ttf", "fonts/manrope-semibold.ttf"),
        ("https://fonts.gstatic.com/s/manrope/v23/xn7_YHE41ni1AdIRqAuZuw1Bx9mbZk4aE-_F.ttf", "fonts/manrope-bold.ttf"),
        ("https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt", "fonts/Manrope-LICENSE.txt"),
    ]
    for char_range in ["0-255", "256-511", "1024-1279", "8192-8447"]:
        tasks.append((f"https://demotiles.maplibre.org/font/Open%20Sans%20Semibold/{char_range}.pbf", f"fonts/Open Sans Semibold/{char_range}.pbf"))
    with ThreadPoolExecutor(max_workers=4) as pool:
        for name in pool.map(fetch, tasks):
            print(name)
