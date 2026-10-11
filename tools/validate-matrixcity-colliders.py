"""Numerically validate MatrixCity collision proxies and object identities."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import open3d as o3d


ROOT = Path(__file__).resolve().parents[1]
GEOMETRY = ROOT / "data" / "matrixcity" / "geometry" / "block_3_roi"


def main() -> None:
    source = json.loads((GEOMETRY / "collision_metadata.json").read_text(encoding="utf-8"))
    roi = json.loads((GEOMETRY / "mesh_metadata.json").read_text(encoding="utf-8"))["roi_m"]
    ids = set()
    reports = []
    for obj in source["objects"]:
        if obj["id"] in ids:
            raise ValueError(f"Duplicate object ID: {obj['id']}")
        ids.add(obj["id"])
        mesh = o3d.io.read_triangle_mesh(str(GEOMETRY / obj["collider"]))
        vertices = np.asarray(mesh.vertices)
        if not mesh.is_watertight() or mesh.is_self_intersecting() or mesh.get_volume() <= 0:
            raise ValueError(f"Invalid solid: {obj['id']}")
        if not (vertices[:, 0].min() >= roi[0] and vertices[:, 0].max() <= roi[1]
                and vertices[:, 1].min() >= roi[2] and vertices[:, 1].max() <= roi[3]):
            raise ValueError(f"Collider outside ROI: {obj['id']}")
        contour = np.asarray(obj["polygon_xy_m"], dtype=np.float32)
        x0, y0, x1, y1 = obj["bounds_m"]
        xy = [(x, y) for x in np.arange(x0 + 1, x1 - 1, 2.0)
              for y in np.arange(y0 + 1, y1 - 1, 2.0)
              if cv2.pointPolygonTest(contour, (float(x), float(y)), False) > 0]
        if len(xy) < 10:
            raise ValueError(f"Too few interior roof test points: {obj['id']}")
        sample = np.asarray(xy[:: max(1, len(xy) // 100)][:100], dtype=np.float32)
        origin = np.column_stack((sample, np.full(len(sample), obj["roof_proxy_m"] + 20)))
        direction = np.tile([0, 0, -1], (len(sample), 1))
        rays = o3d.core.Tensor(np.column_stack((origin, direction)), dtype=o3d.core.Dtype.Float32)
        scene = o3d.t.geometry.RaycastingScene()
        scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(mesh))
        distances = scene.cast_rays(rays)["t_hit"].numpy()
        if not np.all(np.isfinite(distances)) or np.max(np.abs(distances - 20)) > 0.01:
            raise ValueError(f"Roof raycast mismatch: {obj['id']}")
        reports.append({
            "id": obj["id"],
            "watertight": True,
            "self_intersecting": False,
            "volume_m3": float(mesh.get_volume()),
            "roof_test_rays": len(sample),
            "max_roof_ray_error_m": float(np.max(np.abs(distances - 20))),
        })
    result = {"objects": reports, "excluded_partial_components": source["excluded_partial_components"]}
    (GEOMETRY / "collision_validation.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Validated {len(reports)} solid collider(s) with {sum(item['roof_test_rays'] for item in reports)} roof rays")


if __name__ == "__main__":
    main()
