"""Render two fixed MatrixCity cameras from the trained Splatfacto checkpoint.

The resulting diagnostic PNGs stay in ignored data/matrixcity/quality-check/.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from nerfstudio.data.scene_box import OrientedBox
from nerfstudio.utils.eval_utils import eval_setup


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "data/matrixcity/outputs/matrixcity-block3-final/splatfacto/2026-10-04_194005/config.yml"
PARSER = CONFIG.parent / "dataparser_transforms.json"
OUT = ROOT / "data/matrixcity/quality-check"
FRAMES = ("0178", "0213")
ROI_MIN = np.array([-125.0, -625.0, -5.0])
ROI_MAX = np.array([5.0, -495.0, 140.0])


def save_rgb(tensor: torch.Tensor, path: Path) -> None:
    pixels = (tensor.detach().float().cpu().numpy().clip(0, 1) * 255 + .5).astype(np.uint8)
    Image.fromarray(pixels, "RGB").save(path)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    def cpu_cache(config):
        config.pipeline.datamanager.cache_images = "cpu"
        return config

    _, pipeline, checkpoint, step = eval_setup(CONFIG, test_mode="test", update_config_callback=cpu_cache)
    parser = json.loads(PARSER.read_text(encoding="utf-8"))
    transform = np.asarray(parser["transform"], dtype=np.float32)
    scale = float(parser["scale"])
    rotation = transform[:, :3]
    centre = (ROI_MIN + ROI_MAX) * .5
    box = OrientedBox(
        R=torch.from_numpy(rotation).to(pipeline.model.device),
        T=torch.from_numpy((rotation @ centre + transform[:, 3]) * scale).to(pipeline.model.device),
        S=torch.from_numpy((ROI_MAX - ROI_MIN) * scale).to(pipeline.model.device),
    )
    report = {"checkpoint": str(checkpoint), "step": step, "views": []}
    for name in FRAMES:
        found = None
        for split in ("train_dataset", "eval_dataset"):
            dataset = getattr(pipeline.datamanager, split)
            matches = [i for i, path in enumerate(dataset.image_filenames) if path.stem == name]
            if matches:
                found = dataset, matches[0], split
                break
        if found is None:
            raise FileNotFoundError(f"Camera {name} absent from train/eval datasets")
        dataset, index, split = found
        camera = dataset.cameras[index:index + 1]
        with torch.no_grad():
            full = pipeline.model.get_outputs_for_camera(camera)["rgb"]
            cropped = pipeline.model.get_outputs_for_camera(camera, obb_box=box)["rgb"]
        full_path = OUT / f"{name}-native-full.png"
        crop_path = OUT / f"{name}-native-roi.png"
        save_rgb(full, full_path)
        save_rgb(cropped, crop_path)
        input_path = dataset.image_filenames[index]
        report["views"].append({"frame": name, "split": split, "source": str(input_path),
                                "full": str(full_path), "roi": str(crop_path),
                                "width": int(camera.width.item()), "height": int(camera.height.item())})
        print(f"Rendered {name}: {split}, {camera.width.item()}x{camera.height.item()}", flush=True)
    (OUT / "native-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
