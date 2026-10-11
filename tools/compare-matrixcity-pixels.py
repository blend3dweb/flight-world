"""Measure WebGPU colour/detail against a Splatfacto ROI from identical cameras."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/matrixcity/quality-check"


def rgb(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)


def srgb_encode(linear: np.ndarray) -> np.ndarray:
    value = linear / 255
    return np.where(value <= .0031308, 12.92 * value, 1.055 * np.power(value, 1 / 2.4) - .055) * 255


def compare(frame: str, mode: str) -> dict:
    native = rgb(OUT / f"{frame}-native-roi.png")
    native_full = rgb(OUT / f"{frame}-native-full.png")
    source = rgb(ROOT / f"data/matrixcity/training/small_city_block_3_half/images/{frame}.png")
    web = rgb(OUT / f"{frame}-web-{mode}.png")
    if native.shape != web.shape:
        raise ValueError("Different image dimensions")
    neutral = rgb(OUT / f"{frame}-web-neutral.png")
    corrected = rgb(OUT / f"{frame}-web-srgb-fixed.png")
    foreground = np.uint8((neutral.mean(axis=2) > 28) & (corrected.mean(axis=2) > 28))
    mask = cv2.erode(foreground, np.ones((11, 11), np.uint8)).astype(bool)
    if mask.mean() < .08:
        raise ValueError(f"Almost empty browser image: {frame}, {mode}")
    native_luma = cv2.cvtColor(native.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    web_luma = cv2.cvtColor(web.astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    native_edge = cv2.Laplacian(native_luma, cv2.CV_32F)
    web_edge = cv2.Laplacian(web_luma, cv2.CV_32F)
    native_gradient = cv2.Sobel(native_luma, cv2.CV_32F, 1, 0) ** 2 + cv2.Sobel(native_luma, cv2.CV_32F, 0, 1) ** 2
    web_gradient = cv2.Sobel(web_luma, cv2.CV_32F, 1, 0) ** 2 + cv2.Sobel(web_luma, cv2.CV_32F, 0, 1) ** 2
    n, w = native[mask], web[mask]
    result = {
        "frame": frame,
        "mode": mode,
        "foreground_percent": round(float(mask.mean() * 100), 2),
        "source_vs_native_full_psnr_db": round(float(10 * np.log10(255 ** 2 / np.mean((source - native_full) ** 2))), 2),
        "native_full_vs_roi_foreground_mae": round(float(np.abs(native_full[mask] - n).mean()), 2),
        "mean_native_rgb": [round(float(value), 1) for value in n.mean(axis=0)],
        "mean_web_rgb": [round(float(value), 1) for value in w.mean(axis=0)],
        "mae_raw": round(float(np.abs(n - w).mean()), 2),
        "mae_srgb_encoded_native": round(float(np.abs(srgb_encode(n) - w).mean()), 2),
        "luma_correlation": round(float(np.corrcoef(native_luma[mask], web_luma[mask])[0, 1]), 4),
        "laplacian_correlation": round(float(np.corrcoef(native_edge[mask], web_edge[mask])[0, 1]), 4),
        "gradient_energy_web_over_native": round(float(web_gradient[mask].mean() / native_gradient[mask].mean()), 3),
    }
    return result


def main() -> None:
    results = [compare(frame, mode) for frame in ("0178", "0213") for mode in ("neutral", "app", "srgb-fixed")]
    (OUT / "pixel-report.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
