"""Create a smaller Splatfacto training copy of the aligned MatrixCity block."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import cv2


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "matrixcity" / "prepared" / "small_city_block_3"
TARGET = ROOT / "data" / "matrixcity" / "training" / "small_city_block_3_half"
SCALE = 2


def main() -> None:
    original = json.loads((SOURCE / "transforms.json").read_text(encoding="utf-8"))
    TARGET.joinpath("images").mkdir(parents=True, exist_ok=True)
    frames = []
    for frame in original["frames"]:
        source = SOURCE / frame["file_path"]
        target = TARGET / frame["file_path"]
        image = cv2.imread(str(source), cv2.IMREAD_COLOR)
        if image is None:
            raise ValueError(f"Could not read {source}")
        resized = cv2.resize(image, (original["w"] // SCALE, original["h"] // SCALE), interpolation=cv2.INTER_AREA)
        if not cv2.imwrite(str(target), resized):
            raise ValueError(f"Could not write {target}")
        frames.append({"file_path": frame["file_path"], "transform_matrix": frame["transform_matrix"]})
    payload = {key: value for key, value in original.items() if key not in ("frames", "ply_file_path")}
    for key in ("fl_x", "fl_y", "cx", "cy", "w", "h"):
        payload[key] /= SCALE
    payload["w"] = int(payload["w"])
    payload["h"] = int(payload["h"])
    payload["frames"] = frames
    payload["ply_file_path"] = "depth_sampled_init.ply"
    shutil.copyfile(SOURCE / "depth_sampled_init.ply", TARGET / "depth_sampled_init.ply")
    (TARGET / "transforms.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Prepared {len(frames)} half-resolution views in {TARGET}")


if __name__ == "__main__":
    main()
