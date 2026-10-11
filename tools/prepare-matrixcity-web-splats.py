"""Crop trained MatrixCity splats to the trial ROI and write a bounded SH0 PLY."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/matrixcity/exports/block_3_final/splat.ply"
GEOMETRY = ROOT / "data/matrixcity/geometry/block_3_roi"
PARSER = ROOT / "data/matrixcity/outputs/matrixcity-block3-final/splatfacto/2026-10-04_194005/dataparser_transforms.json"
ROI_MIN = np.array([-125.0, -625.0, -5.0])
ROI_MAX = np.array([5.0, -495.0, 140.0])
MAX_SPLATS = 30000
PROPERTIES = ("x", "y", "z", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
              "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3")


def ply_data(path: Path) -> tuple[np.memmap, list[str]]:
    with path.open("rb") as stream:
        header = []
        while (line := stream.readline()) and line.strip() != b"end_header":
            header.append(line.decode("ascii").strip())
        offset = stream.tell()
    if not header or header[0] != "ply" or "format binary_little_endian 1.0" not in header:
        raise ValueError("Expected binary little-endian PLY")
    count = int(next(line.split()[2] for line in header if line.startswith("element vertex ")))
    names = [line.split()[2] for line in header if line.startswith("property float ")]
    if not set(PROPERTIES).issubset(names):
        raise ValueError("Missing Gaussian properties in PLY")
    if path.stat().st_size != offset + count * len(names) * 4:
        raise ValueError("Unexpected PLY payload layout")
    return np.memmap(path, mode="r", dtype="<f4", offset=offset, shape=(count, len(names))), names


def main() -> None:
    splats, names = ply_data(SOURCE)
    parser = json.loads(PARSER.read_text(encoding="utf-8"))
    transform = np.asarray(parser["transform"], dtype=np.float64)
    scale = float(parser["scale"])
    rotation, translation = transform[:, :3], transform[:, 3]
    if not np.allclose(rotation @ rotation.T, np.eye(3), atol=1e-4):
        raise ValueError("Dataparser transform is not an orthogonal rotation")
    centers = np.asarray(splats[:, [names.index(key) for key in ("x", "y", "z")]], dtype=np.float64)
    source_centers = (centers / scale - translation) @ rotation
    inside = np.all((source_centers >= ROI_MIN) & (source_centers <= ROI_MAX), axis=1)
    candidates = np.flatnonzero(inside)
    # A fixed, spatially dispersed subset is reproducible and avoids a camera-order bias.
    if len(candidates) > MAX_SPLATS:
        xyz = source_centers[candidates]
        cell = np.floor((xyz - ROI_MIN) / 2.0).astype(np.int32)
        key = cell[:, 0] * 73856093 ^ cell[:, 1] * 19349663 ^ cell[:, 2] * 83492791
        opacity = splats[candidates, names.index("opacity")]
        order = np.lexsort((-opacity, key))
        sorted_candidates = candidates[order]
        sorted_key = key[order]
        first = np.r_[True, sorted_key[1:] != sorted_key[:-1]]
        selected = sorted_candidates[first]
        if len(selected) > MAX_SPLATS:
            selected = selected[np.linspace(0, len(selected) - 1, MAX_SPLATS, dtype=np.int64)]
        elif len(selected) < MAX_SPLATS:
            extra = sorted_candidates[~first]
            selected = np.r_[selected, extra[:MAX_SPLATS - len(selected)]]
    else:
        selected = candidates
    selected = np.sort(selected)
    output = GEOMETRY / "splats_roi_sh0_30k.ply"
    header = "\n".join(["ply", "format binary_little_endian 1.0",
                        "comment MatrixCity local trial; source dataset CC BY-NC 4.0",
                        f"element vertex {len(selected)}",
                        *(f"property float {name}" for name in PROPERTIES), "end_header", ""]) 
    with output.open("wb") as stream:
        stream.write(header.encode("ascii"))
        columns = [names.index(name) for name in PROPERTIES]
        np.asarray(splats[selected][:, columns], dtype="<f4").tofile(stream)
    metadata = {
        "source_count": len(splats), "crop_count": len(candidates), "export_count": len(selected),
        "roi_source_m": {"min": ROI_MIN.tolist(), "max": ROI_MAX.tolist()},
        "selection": "2 m spatial cells, highest logit opacity per cell, capped at 30000; SH degree 0",
        "output": str(output.relative_to(ROOT)), "bytes": output.stat().st_size,
        "license": "MatrixCity CC BY-NC 4.0; local evaluation only",
    }
    (GEOMETRY / "splat_web_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
