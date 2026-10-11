"""Derive conservative building collision proxies from the depth-fused mesh."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
import open3d as o3d


ROOT = Path(__file__).resolve().parents[1]
GEOMETRY = ROOT / "data" / "matrixcity" / "geometry" / "block_3_roi"
CELL_M = 1.0
MIN_AREA_M2 = 500
BUILDING_THRESHOLD_M = 10.0


def signed_area(polygon: np.ndarray) -> float:
    return float(np.sum(polygon[:, 0] * np.roll(polygon[:, 1], -1)
                        - np.roll(polygon[:, 0], -1) * polygon[:, 1]) * 0.5)


def point_in_triangle(point: np.ndarray, a: np.ndarray, b: np.ndarray, c: np.ndarray) -> bool:
    p0, p1, p2 = c - a, b - a, point - a
    den = p0[0] * p1[1] - p1[0] * p0[1]
    if abs(den) < 1e-9:
        return False
    u = (p2[0] * p1[1] - p1[0] * p2[1]) / den
    v = (p0[0] * p2[1] - p2[0] * p0[1]) / den
    return u >= -1e-9 and v >= -1e-9 and u + v <= 1 + 1e-9


def triangulate(polygon: np.ndarray) -> list[tuple[int, int, int]]:
    remaining = list(range(len(polygon)))
    triangles = []
    while len(remaining) > 3:
        ear = None
        for offset, current in enumerate(remaining):
            prev = remaining[offset - 1]
            nxt = remaining[(offset + 1) % len(remaining)]
            a, b, c = polygon[[prev, current, nxt]]
            cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if cross <= 1e-8:
                continue
            if any(point_in_triangle(polygon[index], a, b, c)
                   for index in remaining if index not in (prev, current, nxt)):
                continue
            ear = (offset, (prev, current, nxt))
            break
        if ear is None:
            raise RuntimeError("Could not triangulate building footprint")
        remaining.pop(ear[0])
        triangles.append(ear[1])
    triangles.append(tuple(remaining))
    return triangles


def make_prism(polygon: np.ndarray, base: float, top: float) -> o3d.geometry.TriangleMesh:
    count = len(polygon)
    low = np.column_stack((polygon, np.full(count, base)))
    high = np.column_stack((polygon, np.full(count, top)))
    vertices = np.concatenate((low, high))
    faces = []
    for a, b, c in triangulate(polygon):
        faces.append((count + a, count + b, count + c))
        faces.append((c, b, a))
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt))
        faces.append((index, count + nxt, count + index))
    mesh = o3d.geometry.TriangleMesh()
    mesh.vertices = o3d.utility.Vector3dVector(vertices)
    mesh.triangles = o3d.utility.Vector3iVector(np.asarray(faces, dtype=np.int32))
    mesh.compute_vertex_normals()
    return mesh


def main() -> None:
    mesh_meta = json.loads((GEOMETRY / "mesh_metadata.json").read_text(encoding="utf-8"))
    source = o3d.io.read_triangle_mesh(str(GEOMETRY / "visible_surfaces_source.ply"))
    vertices = np.asarray(source.vertices)
    faces = np.asarray(source.triangles)
    points = np.concatenate((vertices, vertices[faces].mean(axis=1)))
    x_min, x_max, y_min, y_max = mesh_meta["roi_m"][:4]
    width, height = int(round((x_max - x_min) / CELL_M)), int(round((y_max - y_min) / CELL_M))
    ix = np.floor((points[:, 0] - x_min) / CELL_M).astype(int)
    iy = np.floor((points[:, 1] - y_min) / CELL_M).astype(int)
    inside = (ix >= 0) & (ix < width) & (iy >= 0) & (iy < height)
    heightmap = np.full((height, width), -999.0, dtype=np.float32)
    np.maximum.at(heightmap, (iy[inside], ix[inside]), points[inside, 2])
    footprint = (heightmap > BUILDING_THRESHOLD_M).astype(np.uint8)
    footprint = cv2.morphologyEx(footprint, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    footprint = cv2.morphologyEx(footprint, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    total, labels, stats, _ = cv2.connectedComponentsWithStats(footprint)
    buildings = []
    skipped = []

    for component in sorted(range(1, total), key=lambda item: int(stats[item, cv2.CC_STAT_AREA]), reverse=True):
        left, top, box_width, box_height, area = (int(value) for value in stats[component])
        if area < MIN_AREA_M2:
            continue
        box = [left + x_min, top + y_min, left + box_width + x_min, top + box_height + y_min]
        if left == 0 or top == 0 or left + box_width == width or top + box_height == height:
            skipped.append({"bounds_m": box, "area_m2": area, "reason": "footprint touches ROI boundary"})
            continue
        mask = (labels == component).astype(np.uint8)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour = max(contours, key=cv2.contourArea)
        simplified = cv2.approxPolyDP(contour, epsilon=0.75 / CELL_M, closed=True)[:, 0, :]
        polygon = np.column_stack((x_min + (simplified[:, 0] + 0.5) * CELL_M,
                                   y_min + (simplified[:, 1] + 0.5) * CELL_M)).astype(np.float64)
        if signed_area(polygon) < 0:
            polygon = polygon[::-1]
        roof = float(np.percentile(heightmap[mask > 0], 90))
        border = cv2.dilate(mask, np.ones((7, 7), np.uint8)) & ~mask
        ground_samples = heightmap[(border > 0) & (heightmap > -5) & (heightmap < 5)]
        if len(ground_samples) < 10:
            skipped.append({"bounds_m": box, "area_m2": area, "reason": "insufficient measured ground"})
            continue
        ground = float(np.median(ground_samples))
        collider = make_prism(polygon, ground, roof)
        if not collider.is_watertight() or collider.is_self_intersecting():
            raise RuntimeError(f"Invalid collision proxy for component {component}")
        object_id = f"matrixcity-building-{len(buildings) + 1:03d}"
        filename = f"{object_id}-collider.ply"
        if not o3d.io.write_triangle_mesh(str(GEOMETRY / filename), collider, write_ascii=False):
            raise RuntimeError(f"Could not save {filename}")
        buildings.append({
            "id": object_id,
            "source": "depth-derived footprint and roof-height proxy",
            "collider": filename,
            "bounds_m": box,
            "area_m2": area,
            "ground_m": ground,
            "roof_proxy_m": roof,
            "polygon_xy_m": polygon.tolist(),
            "vertices": len(collider.vertices),
            "triangles": len(collider.triangles),
            "watertight": True,
        })
    if not buildings:
        raise RuntimeError("No complete building footprint found in ROI")
    result = {"coordinate_system": "MatrixCity source, metres, Z up",
              "cell_m": CELL_M,
              "threshold_m": BUILDING_THRESHOLD_M,
              "objects": buildings,
              "excluded_partial_components": skipped,
              "caution": "Collision proxy roofs are conservative height quantiles, not detailed architectural geometry."}
    (GEOMETRY / "collision_metadata.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Built {len(buildings)} watertight collider(s), excluded {len(skipped)} partial component(s)")
    for building in buildings:
        print(f"{building['id']}: {building['area_m2']} m2, base {building['ground_m']:.2f} m, "
              f"roof {building['roof_proxy_m']:.2f} m")


if __name__ == "__main__":
    main()
