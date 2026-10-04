"""Make a bounded RGB-D point cloud for MatrixCity block_3 splat initialization.

Run with the isolated Python environment containing numpy, OpenEXR and opencv-python-headless.
The cloud is sampled geometry, not a watertight collision mesh.
"""

from __future__ import annotations

import json
from pathlib import Path

import OpenEXR
import cv2
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "matrixcity" / "prepared" / "small_city_block_3"
PIXEL_STEP = 12
FRAME_STEP = 4


def main() -> None:
    with (DATA / "transforms.json").open(encoding="utf-8") as stream:
        source = json.load(stream)
    all_points = []
    all_colors = []
    for frame in source["frames"][::FRAME_STEP]:
        depth = OpenEXR.File(str(DATA / frame["depth_file_path"])).channels()["RGBA"].pixels[:, :, 0]
        image = cv2.imread(str(DATA / frame["file_path"]), cv2.IMREAD_COLOR)
        if image is None or depth.shape != image.shape[:2]:
            raise ValueError(f"RGB/depth mismatch: {frame['file_path']}")
        yy, xx = np.mgrid[0 : source["h"] : PIXEL_STEP, 0 : source["w"] : PIXEL_STEP]
        z = depth[::PIXEL_STEP, ::PIXEL_STEP].reshape(-1).astype(np.float32) * 0.01
        x = ((xx.reshape(-1) - source["cx"]) / source["fl_x"]) * z
        y = -((yy.reshape(-1) - source["cy"]) / source["fl_y"]) * z
        local = np.stack((x, y, -z), axis=1)
        pose = np.asarray(frame["transform_matrix"], dtype=np.float32)
        world = local @ pose[:3, :3].T + pose[:3, 3]
        color = image[::PIXEL_STEP, ::PIXEL_STEP, ::-1].reshape(-1, 3)
        valid = np.isfinite(world).all(axis=1) & (z > 0.1) & (z < 1000)
        all_points.append(world[valid])
        all_colors.append(color[valid])
    points = np.concatenate(all_points)
    colors = np.concatenate(all_colors)
    output = DATA / "depth_sampled_init.ply"
    with output.open("wb") as stream:
        stream.write((
            "ply\nformat binary_little_endian 1.0\n"
            f"element vertex {len(points)}\n"
            "property float x\nproperty float y\nproperty float z\n"
            "property uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n"
        ).encode("ascii"))
        packed = np.empty(len(points), dtype=[("xyz", "<f4", (3,)), ("rgb", "u1", (3,))])
        packed["xyz"] = points
        packed["rgb"] = colors
        stream.write(packed.tobytes())
    bounds = {"min": points.min(axis=0).tolist(), "max": points.max(axis=0).tolist()}
    (DATA / "pointcloud_metadata.json").write_text(json.dumps({
        "source_frames": len(source["frames"]),
        "sampled_frames": len(all_points),
        "pixel_step": PIXEL_STEP,
        "points": len(points),
        "bounds_m": bounds,
        "source": "MatrixCity RGB and float32 EXR Z-depth",
    }, indent=2), encoding="utf-8")
    source["ply_file_path"] = output.name
    (DATA / "transforms.json").write_text(json.dumps(source, indent=2), encoding="utf-8")
    print(f"Wrote {len(points)} points to {output}")
    print(f"Bounds (m): {bounds}")


if __name__ == "__main__":
    main()
