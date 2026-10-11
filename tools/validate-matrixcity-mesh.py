"""Check topology and held-out depth agreement without creating images."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import OpenEXR
import open3d as o3d


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "matrixcity" / "prepared" / "small_city_block_3"
GEOMETRY = ROOT / "data" / "matrixcity" / "geometry" / "block_3_roi"
SCALE = 8
MAX_VIEWS = 12


def depth_and_roi(frame: dict, camera: dict, roi: list[float]) -> tuple[np.ndarray, np.ndarray]:
    width, height = camera["w"] // SCALE, camera["h"] // SCALE
    depth_cm = OpenEXR.File(str(SOURCE / frame["depth_file_path"])).channels()["RGBA"].pixels[:, :, 0]
    depth = cv2.resize(depth_cm, (width, height), interpolation=cv2.INTER_NEAREST).astype(np.float32) * 0.01
    u, v = np.meshgrid(np.arange(width), np.arange(height))
    local = np.stack(((u - camera["cx"] / SCALE) * depth / (camera["fl_x"] / SCALE),
                      -(v - camera["cy"] / SCALE) * depth / (camera["fl_y"] / SCALE),
                      -depth), axis=-1)
    pose = np.asarray(frame["transform_matrix"], dtype=np.float64)
    world = local @ pose[:3, :3].T + pose[:3, 3]
    roi_mask = np.isfinite(depth) & (depth > 0.1)
    for axis, low, high in ((0, roi[0], roi[1]), (1, roi[2], roi[3]), (2, roi[4], roi[5])):
        roi_mask &= (world[..., axis] >= low) & (world[..., axis] <= high)
    return depth, roi_mask


def main() -> None:
    mesh_meta = json.loads((GEOMETRY / "mesh_metadata.json").read_text(encoding="utf-8"))
    camera = json.loads((SOURCE / "transforms.json").read_text(encoding="utf-8"))
    integrated = {item["frame"] for item in mesh_meta["source_views"]}
    mesh = o3d.io.read_triangle_mesh(str(GEOMETRY / "visible_surfaces_source.ply"))
    mesh.compute_triangle_normals()
    scene = o3d.t.geometry.RaycastingScene()
    scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(mesh))
    width, height = camera["w"] // SCALE, camera["h"] // SCALE
    fx, fy = camera["fl_x"] / SCALE, camera["fl_y"] / SCALE
    cx, cy = camera["cx"] / SCALE, camera["cy"] / SCALE
    intrinsic = o3d.core.Tensor([[fx, 0.0, cx], [0.0, fy, cy], [0.0, 0.0, 1.0]], dtype=o3d.core.Dtype.Float64)
    candidates = []
    for frame in camera["frames"]:
        if frame["file_path"] in integrated:
            continue
        depth, roi_mask = depth_and_roi(frame, camera, mesh_meta["roi_m"])
        if roi_mask.sum() >= 500:
            candidates.append((frame, depth, roi_mask))
    if not candidates:
        raise RuntimeError("No held-out MatrixCity views cover the mesh ROI")
    chosen = np.linspace(0, len(candidates) - 1, min(MAX_VIEWS, len(candidates)), dtype=int)
    reports = []
    all_errors = []
    total_roi_pixels = 0
    total_hits = 0
    cv_to_nerfstudio = np.diag([1.0, -1.0, -1.0, 1.0])
    for index in chosen:
        frame, depth, roi_mask = candidates[index]
        pose = np.asarray(frame["transform_matrix"], dtype=np.float64)
        world_to_camera = np.linalg.inv(pose @ cv_to_nerfstudio)
        rays = scene.create_rays_pinhole(intrinsic, o3d.core.Tensor(world_to_camera), width, height)
        hit = scene.cast_rays(rays)["t_hit"].numpy()
        ray_values = rays.numpy()
        with np.errstate(invalid="ignore"):
            world_hit = ray_values[..., :3] + ray_values[..., 3:] * hit[..., None]
            camera_hit = world_hit @ world_to_camera[:3, :3].T + world_to_camera[:3, 3]
        found = roi_mask & np.isfinite(hit)
        errors = np.abs(camera_hit[..., 2][found] - depth[found])
        total_roi_pixels += int(roi_mask.sum())
        total_hits += int(found.sum())
        if len(errors):
            all_errors.append(errors)
        reports.append({
            "frame": frame["file_path"],
            "roi_pixels": int(roi_mask.sum()),
            "mesh_hits": int(found.sum()),
            "coverage": float(found.sum() / roi_mask.sum()),
            "median_depth_error_m": float(np.median(errors)) if len(errors) else None,
            "p95_depth_error_m": float(np.percentile(errors, 95)) if len(errors) else None,
        })
    error = np.concatenate(all_errors)
    normals = np.asarray(mesh.triangle_normals)
    vertices = np.asarray(mesh.vertices)
    triangles = np.asarray(mesh.triangles)
    p0, p1, p2 = vertices[triangles[:, 0]], vertices[triangles[:, 1]], vertices[triangles[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(p1 - p0, p2 - p0), axis=1)
    result = {
        "mesh_vertices": len(vertices),
        "mesh_triangles": len(triangles),
        "watertight": mesh.is_watertight(),
        "edge_manifold": mesh.is_edge_manifold(),
        "roof_like_area_m2": float(area[np.abs(normals[:, 2]) > 0.8].sum()),
        "facade_like_area_m2": float(area[np.abs(normals[:, 2]) < 0.3].sum()),
        "held_out_candidate_views": len(candidates),
        "held_out_tested_views": len(reports),
        "held_out_roi_pixels": total_roi_pixels,
        "held_out_mesh_hit_coverage": total_hits / total_roi_pixels,
        "held_out_median_depth_error_m": float(np.median(error)),
        "held_out_p95_depth_error_m": float(np.percentile(error, 95)),
        "views": reports,
    }
    (GEOMETRY / "validation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Held-out coverage {result['held_out_mesh_hit_coverage']:.3f}; "
          f"median depth error {result['held_out_median_depth_error_m']:.2f} m; "
          f"p95 {result['held_out_p95_depth_error_m']:.2f} m")
    print(f"Watertight: {result['watertight']}; roof-like area {result['roof_like_area_m2']:.0f} m2; "
          f"facade-like area {result['facade_like_area_m2']:.0f} m2")


if __name__ == "__main__":
    main()
