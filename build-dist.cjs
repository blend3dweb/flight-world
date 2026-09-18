const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const source = path.join(root, 'webgpu');
const output = path.join(root, 'dist');
const esbuild = require(path.join(source, 'node_modules', 'esbuild'));
const { minify } = require(path.join(source, 'node_modules', 'html-minifier-terser'));

if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
  throw new Error(`Unsafe output path: ${output}`);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

(async () => {
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });

  const result = await esbuild.build({
    entryPoints: [path.join(source, 'flight.js')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: ['chrome113', 'edge113'],
    treeShaking: true,
    minify: true,
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    legalComments: 'none',
    sourcemap: false,
    charset: 'utf8',
  });

  const javascript = result.outputFiles[0].contents;
  const bundleName = `app.${sha256(javascript).slice(0, 10)}.min.js`;
  fs.writeFileSync(path.join(output, bundleName), javascript);

  let html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
  html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/, '');
  html = html.replace("await import('./flight.js')", `await import('./${bundleName}')`);
  html = html.replace('href="/"', 'href="./"');
  html = await minify(html, {
    collapseWhitespace: true,
    conservativeCollapse: true,
    removeComments: true,
    minifyCSS: true,
    removeRedundantAttributes: true,
    sortAttributes: true,
    sortClassName: true,
  });
  fs.writeFileSync(path.join(output, 'index.html'), `${html}\n`);

  fs.copyFileSync(path.join(source, 'smoke.png'), path.join(output, 'smoke.png'));
  fs.copyFileSync(path.join(source, 'node_modules', 'three', 'LICENSE'), path.join(output, 'THREE-LICENSE.txt'));

  const files = fs.readdirSync(output).sort().map((name) => {
    const data = fs.readFileSync(path.join(output, name));
    return { name, bytes: data.length, sha256: sha256(data) };
  });
  const manifest = {
    application: 'flight-world',
    entry: 'index.html',
    format: 'static-web',
    threeVersion: '0.186.0',
    files,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  };
  fs.writeFileSync(path.join(output, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({ output, bundleName, fileCount: files.length + 1, totalBytes: manifest.totalBytes }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
