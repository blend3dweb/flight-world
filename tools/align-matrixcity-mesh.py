"""Put the depth-fused mesh into the trained MatrixCity Gaussian coordinates."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import open3d as o3d


ROOT = Path(__file__).resolve().parents[1]
GEOMETRY = ROOT / "data" / "matrixcity" / "geometry" / "block_3_roi"
PARSER = ROOT / "data" / "matrixcity" / "outputs" / "matrixcity-block3-final" / "splatfacto" / "2026-10-04_194005" / "dataparser_transforms.json"
SPLAT = ROOT / "data" / "matrixcity" / "exports" / "block_3_final" / "splat.ply"


def main() -> None:
    source_path = GEOMETRY / "visible_surfaces_source.ply"
    mesh = o3d.io.read_triangle_mesh(str(source_path))
    source_vertices = np.asarray(mesh.vertices)
    if len(source_vertices) == 0:
        raise RuntimeError(f"Empty source mesh: {source_path}")
    parser = json.loads(PARSER.read_text(encoding="utf-8"))
    transform = np.asarray(parser["transform"], dtype=np.float64)
    scale = float(parser["scale"])
    if transform.shape != (3, 4) or scale <= 0:
        raise ValueError("Unexpected Nerfstudio dataparser transform")
    normalized = (source_vertices @ transform[:, :3].T + transform[:, 3]) * scale
    mesh.vertices = o3d.utility.Vector3dVector(normalized)
    mesh.compute_vertex_normals()
    aligned_path = GEOMETRY / "visible_surfaces_splat.ply"
    if not o3d.io.write_triangle_mesh(str(aligned_path), mesh, write_ascii=False, write_vertex_normals=True):
        raise RuntimeError(f"Could not write {aligned_path}")

    gaussian = o3d.io.read_point_cloud(str(SPLAT))
    gaussian_vertices = np.asarray(gaussian.points)
    if len(gaussian_vertices) == 0:
        raise RuntimeError(f"No Gaussian positions in {SPLAT}")
    mesh_points = o3d.geometry.PointCloud()
    mesh_points.points = mesh.vertices
    distances = np.asarray(mesh_points.compute_point_cloud_distance(gaussian), dtype=np.float64)
    score = {
        "source_mesh": str(source_path.relative_to(ROOT)),
        "aligned_mesh": str(aligned_path.relative_to(ROOT)),
        "gaussian_reference": str(SPLAT.relative_to(ROOT)),
        "dataparser_transform": transform.tolist(),
        "dataparser_scale": scale,
        "vertices": len(normalized),
        "gaussians": len(gaussian_vertices),
        "aligned_bounds": {"min": normalized.min(axis=0).tolist(), "max": normalized.max(axis=0).tolist()},
        "gaussian_bounds": {"min": gaussian_vertices.min(axis=0).tolist(), "max": gaussian_vertices.max(axis=0).tolist()},
        "nearest_gaussian_distance_m": {
            "median": float(np.median(distances) / scale),
            "p90": float(np.percentile(distances, 90) / scale),
            "p95": float(np.percentile(distances, 95) / scale),
        },
        "note": "Nearest splat mean is a spatial alignment check, not proof of surface accuracy or collision geometry.",
    }
    (GEOMETRY / "alignment_metadata.json").write_text(json.dumps(score, indent=2), encoding="utf-8")
    print(f"Aligned {len(normalized)} mesh vertices against {len(gaussian_vertices)} Gaussian means")
    print(f"Nearest mean distance: median {score['nearest_gaussian_distance_m']['median']:.2f} m; "
          f"p95 {score['nearest_gaussian_distance_m']['p95']:.2f} m")


if __name__ == "__main__":
    main()
