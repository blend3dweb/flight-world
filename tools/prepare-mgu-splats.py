"""Prepare reproducible local SH3 subsets; preserve the original full PLY."""
import argparse
import json
import shutil
from pathlib import Path

import numpy as np
import importlib.util

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, default=Path(r'D:\new_pro\GaussianSplatting\PSHT\mgu.ply'))
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('ply_reader', ROOT / 'tools/prepare-matrixcity-web-splats.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    data, names = module.ply_data(args.source)
    if not all(f'f_rest_{i}' in names for i in range(45)):
        raise ValueError('Expected SH3')
    out = ROOT / 'data/mgu'
    out.mkdir(parents=True, exist_ok=True)
    # Percentile bounds frame the subject without letting distant floaters dominate.
    xyz = data[::10, :3]
    bounds = np.percentile(xyz, [1, 99], axis=0).tolist()
    levels = []
    for count in (250000, 750000):
        count = min(count, len(data))
        selected = np.linspace(0, len(data)-1, count, dtype=np.int64)
        target = out / f'mgu-{count}.ply'
        header = '\n'.join(['ply', 'format binary_little_endian 1.0',
                            f'element vertex {count}',
                            *(f'property float {name}' for name in names), 'end_header', ''])
        with target.open('wb') as stream:
            stream.write(header.encode('ascii'))
            for start in range(0, count, 50000):
                np.asarray(data[selected[start:start+50000]], dtype='<f4').tofile(stream)
        levels.append({'count': count, 'file': target.name, 'bytes': target.stat().st_size})
    target = out / 'mgu-full.ply'
    shutil.copy2(args.source, target)
    levels.append({'count': len(data), 'file': target.name, 'bytes': target.stat().st_size})
    metadata = {'source': str(args.source), 'count': len(data), 'shDegree': 3,
                'bounds': bounds, 'levels': levels, 'selection': 'evenly spaced source records; unchanged covariance, opacity and SH3',
                'geometry': None, 'coordinateUnits': 'unknown; original model coordinates'}
    (out / 'metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
