"""Prepare a matched MatrixCity RGB/depth/camera set for one aerial block."""

from __future__ import annotations

import json
import math
import struct
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "matrixcity"
OUT = SOURCE / "prepared" / "small_city_block_3"
POSES = SOURCE / "small_city/aerial/train/block_3/transforms.json"
RGB_TAR = SOURCE / "small_city/aerial/train/block_3.tar"
DEPTH_TAR = SOURCE / "small_city_depth_float32/aerial/train/block_3_depth.tar"
WIDTH, HEIGHT = 1920, 1080


def save_member(archive: tarfile.TarFile, member_name: str, target: Path) -> None:
    member = archive.getmember(member_name)
    if not member.isfile():
        raise ValueError(f"Expected regular file: {member_name}")
    source = archive.extractfile(member)
    if source is None:
        raise ValueError(f"Cannot read: {member_name}")
    target.parent.mkdir(parents=True, exist_ok=True)
    with source, target.open("wb") as output:
        while chunk := source.read(8 * 1024 * 1024):
            output.write(chunk)


def main() -> None:
    with POSES.open(encoding="utf-8") as stream:
        original = json.load(stream)
    angle = original["camera_angle_x"]
    focal = 0.5 * WIDTH / math.tan(0.5 * angle)
    frames = []
    indices = set()
    with tarfile.open(RGB_TAR) as rgb, tarfile.open(DEPTH_TAR) as depth:
        for frame in original["frames"]:
            index = int(frame["frame_index"])
            if index in indices:
                raise ValueError(f"Duplicate frame index: {index}")
            indices.add(index)
            stem = f"{index:04d}"
            rgb_path = OUT / "images" / f"{stem}.png"
            depth_path = OUT / "depth_cm" / f"{stem}.exr"
            save_member(rgb, f"./block_3/{stem}.png", rgb_path)
            save_member(depth, f"block_3_depth/{stem}.exr", depth_path)
            with rgb_path.open("rb") as stream:
                header = stream.read(24)
            if header[:8] != b"\x89PNG\r\n\x1a\n" or struct.unpack(">II", header[16:24]) != (WIDTH, HEIGHT):
                raise ValueError(f"Unexpected PNG size: {rgb_path}")
            with depth_path.open("rb") as stream:
                if stream.read(4) != b"\x76\x2f\x31\x01":
                    raise ValueError(f"Unexpected EXR header: {depth_path}")
            matrix = [row.copy() for row in frame["rot_mat"]]
            for row in matrix[:3]:
                for col in range(3):
                    row[col] *= 100.0  # MatrixCity stores the rotation scaled by 0.01.
            frames.append({
                "file_path": f"images/{stem}.png",
                "depth_file_path": f"depth_cm/{stem}.exr",
                "transform_matrix": matrix,
            })
    payload = {
        "camera_model": "OPENCV",
        "fl_x": focal,
        "fl_y": focal,
        "cx": WIDTH / 2,
        "cy": HEIGHT / 2,
        "w": WIDTH,
        "h": HEIGHT,
        "frames": frames,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    with (OUT / "transforms.json").open("w", encoding="utf-8") as stream:
        json.dump(payload, stream, indent=2)
    with (OUT / "SOURCE.md").open("w", encoding="utf-8") as stream:
        stream.write(
            "MatrixCity Small City aerial block_3; source: "
            "https://huggingface.co/datasets/BoDai/MatrixCity/tree/main\n"
            "Dataset license: CC BY-NC 4.0 (non-commercial).\n"
            "Camera translations are in metres; source 3x3 rotations were scaled by 0.01 and restored here.\n"
            "EXR depth is Z-depth in centimetres; multiply by 0.01 for metres.\n"
            "RGB and depth filenames are matched by frame_index.\n"
        )
    print(f"Prepared {len(frames)} RGB/depth/camera pairs in {OUT}")


if __name__ == "__main__":
    main()
