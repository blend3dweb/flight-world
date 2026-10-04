"""Fetch the bounded MatrixCity aerial block used by the stage 15 data trial."""

from __future__ import annotations

import hashlib
import json
import sys
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "data" / "matrixcity"
BASE = "https://huggingface.co/datasets/BoDai/MatrixCity/resolve/main/"
FILES = {
    "small_city/aerial/train/block_3/transforms.json": None,
    "small_city/aerial/train/block_3/transforms_origin.json": None,
    "small_city/aerial/train/block_3.tar": (
        855872512,
        "809fe5a6113ceb76abe4e1860c4bd9d72e6064c41af8805766a5112e1e352661",
    ),
    "small_city_depth_float32/aerial/train/block_3_depth.tar": (
        762603520,
        "2d27221efb7c5d5cda60b573aa66d06a4102caf5c53bcce6bac571ae27fbeadb",
    ),
}


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(relative: str, expected: tuple[int, str] | None) -> None:
    target = DEST / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and (
        expected is None or (target.stat().st_size == expected[0] and digest(target) == expected[1])
    ):
        print(f"Verified existing: {relative}", flush=True)
        return

    temp = target.with_name(target.name + ".part")
    temp.unlink(missing_ok=True)
    url = BASE + relative
    print(f"Downloading: {relative}", flush=True)
    with urllib.request.urlopen(url, timeout=60) as response, temp.open("wb") as output:
        size = 0
        last_report = 0
        while chunk := response.read(8 * 1024 * 1024):
            output.write(chunk)
            size += len(chunk)
            if size - last_report >= 128 * 1024 * 1024:
                print(f"  {size / 1024**2:.0f} MiB", flush=True)
                last_report = size
    if expected and (size != expected[0] or digest(temp) != expected[1]):
        raise RuntimeError(f"Size or SHA-256 mismatch: {relative}")
    if relative.endswith(".json"):
        with temp.open(encoding="utf-8") as stream:
            json.load(stream)
    temp.replace(target)
    print(f"Saved: {relative} ({size} bytes)", flush=True)


def main() -> int:
    for relative, expected in FILES.items():
        fetch(relative, expected)
    return 0


if __name__ == "__main__":
    sys.exit(main())
