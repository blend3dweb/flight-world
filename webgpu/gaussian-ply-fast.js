// Binary float PLY path for large local assets: no intermediate JS number arrays.
import { FileLoader } from 'three/webgpu';
import { createGaussianSplatGeometry, createPackedSphericalHarmonicsBand, SH_BAND_COMPONENTS, SH_BAND_WORDS, sigmoid, writeColorBytesFromSH0, writeCovariance } from './node_modules/three/examples/jsm/utils/GaussianSplatUtils.js';

export async function loadGaussianPLY(url, onProgress, onParse) {
  const loader = new FileLoader();loader.setResponseType('arraybuffer');
  const data = await loader.loadAsync(url, onProgress);
  const bytes = new Uint8Array(data);
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(65536, bytes.length)));
  const match = /^ply\r?\n([\s\S]*?)end_header\r?\n/.exec(text);
  if (!match || !match[1].includes('format binary_little_endian 1.0')) throw new Error('Expected binary little-endian float PLY');
  const header = match[0], properties = header.split(/\r?\n/).filter(line => line.startsWith('property '));
  if (properties.some(line => !line.startsWith('property float '))) throw new Error('Only float vertex properties supported');
  if ((header.match(/^element /gm) || []).length !== 1) throw new Error('Expected a vertex-only PLY');
  const names = properties.map(line => line.split(/\s+/)[2]);
  const count = Number(/element vertex (\d+)/.exec(header)?.[1]);
  const stride = names.length * 4, offset = header.length;
  if (!Number.isInteger(count) || count < 1 || offset + count * stride !== data.byteLength) throw new Error('Invalid PLY size');
  const index = name => {const i = names.indexOf(name);if (i < 0) throw new Error(`Missing ${name}`);return i * 4;};
  const pos = ['x','y','z'].map(index), dc = [0,1,2].map(i => index(`f_dc_${i}`));
  const scale = [0,1,2].map(i => index(`scale_${i}`)), rot = [0,1,2,3].map(i => index(`rot_${i}`)), opacity = index('opacity');
  const restCount = names.filter(name => /^f_rest_\d+$/.test(name)).length;
  if (restCount !== 0 && restCount !== 45) throw new Error('Expected SH0 or SH3');
  const rest = Array.from({length: restCount}, (_, i) => index(`f_rest_${i}`));
  const centers = new Float32Array(count * 3), covariances = new Float32Array(count * 6), colors = new Uint8ClampedArray(count * 4);
  const sh = {}, bands = {};
  if (restCount) for (let degree = 1; degree <= 3; degree++) {bands[degree] = createPackedSphericalHarmonicsBand(count, degree);sh[`sh${degree}`] = bands[degree].packed;}
  const view = new DataView(data);
  for (let begin = 0; begin < count; begin += 25000) {
    const end = Math.min(count, begin + 25000);
    for (let i = begin; i < end; i++) {
      const base = offset + i * stride;
      for (let c = 0; c < 3; c++) centers[i * 3 + c] = view.getFloat32(base + pos[c], true);
      writeCovariance(covariances, i * 6, Math.exp(view.getFloat32(base + scale[0], true)), Math.exp(view.getFloat32(base + scale[1], true)), Math.exp(view.getFloat32(base + scale[2], true)), view.getFloat32(base + rot[1], true), view.getFloat32(base + rot[2], true), view.getFloat32(base + rot[3], true), view.getFloat32(base + rot[0], true));
      writeColorBytesFromSH0(colors, i * 4, view.getFloat32(base + dc[0], true), view.getFloat32(base + dc[1], true), view.getFloat32(base + dc[2], true), sigmoid(view.getFloat32(base + opacity, true)));
      if (restCount) for (let degree = 1; degree <= 3; degree++) {
        const bandOffset = degree === 1 ? 0 : degree === 2 ? 3 : 8;
        const target = bands[degree].bytes, targetOffset = i * SH_BAND_WORDS[degree] * 4;
        for (let j = 0; j < SH_BAND_COMPONENTS[degree]; j++) target[targetOffset + j] = view.getFloat32(base + rest[bandOffset + Math.floor(j / 3) + (j % 3) * 15], true) * 128 + 128;
      }
    }
    onParse?.(end / count);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return createGaussianSplatGeometry(centers, covariances, colors, sh);
}
