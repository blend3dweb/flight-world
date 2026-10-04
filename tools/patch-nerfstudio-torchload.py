"""Make Nerfstudio 1.1.5 read locally created checkpoints with PyTorch >=2.6."""

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "data" / "matrixcity" / "train-env" / "Lib" / "site-packages" / "nerfstudio"
FILES = (
    PACKAGE / "engine" / "trainer.py",
    PACKAGE / "utils" / "eval_utils.py",
)
OLD = 'torch.load(load_path, map_location="cpu")'
NEW = 'torch.load(load_path, map_location="cpu", weights_only=False)'
OLD_EXPLICIT = 'torch.load(load_checkpoint, map_location="cpu")'
NEW_EXPLICIT = 'torch.load(load_checkpoint, map_location="cpu", weights_only=False)'
OPTIMIZER_OLD = 'self.pipeline.load_pipeline(loaded_state["pipeline"], loaded_state["step"])\n            self.optimizers.load_optimizers'
OPTIMIZER_NEW = 'self.pipeline.load_pipeline(loaded_state["pipeline"], loaded_state["step"])\n            self.optimizers = self.setup_optimizers()\n            self.optimizers.load_optimizers'


def main() -> None:
    for path in FILES:
        source = path.read_text(encoding="utf-8")
        updated = source.replace(OLD, NEW).replace(OLD_EXPLICIT, NEW_EXPLICIT)
        if updated == source and NEW not in source:
            raise RuntimeError(f"Expected torch.load call not found: {path}")
        if updated != source:
            path.write_text(updated, encoding="utf-8")
        print(f"Patched checkpoint loading: {path}")

    trainer = FILES[0]
    source = trainer.read_text(encoding="utf-8")
    if source.count(OPTIMIZER_OLD) != 2 and source.count(OPTIMIZER_NEW) != 2:
        raise RuntimeError("Expected two optimizer reload sites in Nerfstudio trainer")
    updated = source.replace(OPTIMIZER_OLD, OPTIMIZER_NEW)
    if updated != source:
        trainer.write_text(updated, encoding="utf-8")
    print(f"Rebound optimizers to restored Splatfacto parameters: {trainer}")


if __name__ == "__main__":
    main()
