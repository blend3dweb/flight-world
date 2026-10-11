"""Fuse MatrixCity depth into a bounded visible-surface mesh.

This is geometry for alignment tests, not a watertight or semantic city model.
Run with the isolated train-env (Open3D, OpenEXR, NumPy, OpenCV).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
import OpenEXR
import open3d as o3d


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "matrixcity" / "prepared" / "small_city_block_3"
OUTPUT = ROOT / "data" / "matrixcity" / "geometry" / "block_3_roi"
DEFAULT_ROI = (-120.0, 0.0, -620.0, -500.0, -5.0, 180.0)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--roi", type=float, nargs=6, default=DEFAULT_ROI,
                        metavar=("XMIN", "XMAX", "YMIN", "YMAX", "ZMIN", "ZMAX"))
    parser.add_argument("--downscale", type=int, default=4)
    parser.add_argument("--frame-stride", type=int, default=4)
    parser.add_argument("--max-frames", type=int, default=0, help="0 means all selected frames")
    parser.add_argument("--voxel", type=float, default=0.75, help="metres in source coordinates")
    parser.add_argument("--truncation", type=float, default=3.0, help="TSDF truncation in metres")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.downscale < 1 or args.frame_stride < 1 or args.voxel <= 0 or args.truncation <= args.voxel:
        raise ValueError("Invalid sampling or TSDF resolution")
    x_min, x_max, y_min, y_max, z_min, z_max = args.roi
    if not (x_min < x_max and y_min < y_max and z_min < z_max):
        raise ValueError("Invalid ROI bounds")

    source = json.loads((SOURCE / "transforms.json").read_text(encoding="utf-8"))
    frames = source["frames"][:: args.frame_stride]
    if args.max_frames:
        if args.max_frames < 1:
            raise ValueError("max-frames must be positive")
        indices = np.linspace(0, len(frames) - 1, min(args.max_frames, len(frames)), dtype=int)
        frames = [frames[index] for index in indices]

    width, height = source["w"] // args.downscale, source["h"] // args.downscale
    fx, fy = source["fl_x"] / args.downscale, source["fl_y"] / args.downscale
    cx, cy = source["cx"] / args.downscale, source["cy"] / args.downscale
    intrinsic = o3d.camera.PinholeCameraIntrinsic(width, height, fx, fy, cx, cy)
    tsdf = o3d.pipelines.integration.ScalableTSDFVolume(
        voxel_length=args.voxel,
        sdf_trunc=args.truncation,
        color_type=o3d.pipelines.integration.TSDFVolumeColorType.NoColor,
        volume_unit_resolution=16,
        depth_sampling_stride=1,
    )
    pixels_x, pixels_y = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    zero_color = o3d.geometry.Image(np.zeros((height, width, 3), dtype=np.uint8))
    cv_to_nerfstudio = np.diag([1.0, -1.0, -1.0, 1.0])
    records = []

    for number, frame in enumerate(frames, 1):
        depth_cm = OpenEXR.File(str(SOURCE / frame["depth_file_path"])).channels()["RGBA"].pixels[:, :, 0]
        depth_m = cv2.resize(depth_cm, (width, height), interpolation=cv2.INTER_NEAREST).astype(np.float32) * 0.01
        pose = np.asarray(frame["transform_matrix"], dtype=np.float64)
        local = np.stack(((pixels_x - cx) * depth_m / fx,
                          -(pixels_y - cy) * depth_m / fy,
                          -depth_m), axis=-1)
        world = local @ pose[:3, :3].T + pose[:3, 3]
        valid = np.isfinite(depth_m) & (depth_m > 0.1) & (depth_m < 1000.0)
        valid &= (world[..., 0] >= x_min) & (world[..., 0] <= x_max)
        valid &= (world[..., 1] >= y_min) & (world[..., 1] <= y_max)
        valid &= (world[..., 2] >= z_min) & (world[..., 2] <= z_max)
        count = int(valid.sum())
        if count:
            depth_m[~valid] = 0.0
            rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
                zero_color,
                o3d.geometry.Image(np.ascontiguousarray(depth_m)),
                depth_scale=1.0,
                depth_trunc=1000.0,
                convert_rgb_to_intensity=False,
            )
            camera_to_world_cv = pose @ cv_to_nerfstudio
            tsdf.integrate(rgbd, intrinsic, np.linalg.inv(camera_to_world_cv))
        records.append({"frame": frame["file_path"], "valid_roi_pixels": count})
        print(f"{number}/{len(frames)} {frame['file_path']}: {count} ROI pixels", flush=True)

    mesh = tsdf.extract_triangle_mesh()
    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_unreferenced_vertices()
    mesh.compute_vertex_normals()
    vertices = np.asarray(mesh.vertices)
    if len(vertices) == 0:
        raise RuntimeError("TSDF produced an empty mesh")
    args.output.mkdir(parents=True, exist_ok=True)
    mesh_path = args.output / "visible_surfaces_source.ply"
    if not o3d.io.write_triangle_mesh(str(mesh_path), mesh, write_ascii=False, write_vertex_normals=True):
        raise RuntimeError(f"Could not write {mesh_path}")
    metadata = {
        "kind": "visible surfaces only; no watertight buildings or semantic object IDs",
        "source": "MatrixCity Small City aerial train block_3 float32 EXR Z-depth",
        "coordinates": "MatrixCity source world coordinates, metres, Z up",
        "roi_m": list(args.roi),
        "downscale": args.downscale,
        "frame_stride": args.frame_stride,
        "frames_selected": len(frames),
        "frames_integrated": sum(record["valid_roi_pixels"] > 0 for record in records),
        "valid_roi_pixels": sum(record["valid_roi_pixels"] for record in records),
        "voxel_m": args.voxel,
        "truncation_m": args.truncation,
        "vertices": len(vertices),
        "triangles": len(mesh.triangles),
        "bounds_m": {"min": vertices.min(axis=0).tolist(), "max": vertices.max(axis=0).tolist()},
        "source_views": records,
    }
    (args.output / "mesh_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(f"Mesh: {len(vertices)} vertices, {len(mesh.triangles)} triangles, {mesh_path}")


if __name__ == "__main__":
    main()
