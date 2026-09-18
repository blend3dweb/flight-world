const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const origin = 'http://127.0.0.1:8765';
async function checkServer() {
  let response;
  try { response = await fetch(origin + '/webgpu/index.html', { signal: AbortSignal.timeout(1500) }); }
  catch { return false; }
  if (!response.ok || !(await response.text()).includes('flight.js')) throw new Error('Port 8765 is occupied by another application.');
  return true;
}
async function launch() {
  if (!fs.existsSync(path.join(__dirname, 'webgpu/node_modules/three/build/three.webgpu.js'))) {
    throw new Error('Dependencies missing. Run npm ci --prefix webgpu, then start again.');
  }
  if (!await checkServer()) {
    const server = spawn(process.execPath, [path.join(__dirname, 'serve.cjs')], { cwd: __dirname, detached: true, stdio: 'ignore', windowsHide: true });
    server.unref();
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (await checkServer()) { ready = true; break; }
    }
    if (!ready) throw new Error('Flight server did not start. Run node serve.cjs to inspect the error.');
  }
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const executables = ['Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe'];
  const browser = executables.flatMap(name => roots.map(root => path.join(root, name))).find(file => fs.existsSync(file));
  if (!browser) throw new Error('Chrome or Edge is required. Open ' + origin + '/webgpu/index.html in a WebGPU browser.');
  // A separate browser profile makes GPU selection independent of already open personal windows.
  const child = spawn(browser, ['--user-data-dir=' + path.join(__dirname, '.chrome-webgpu'), '--no-first-run', '--no-default-browser-check', '--force-high-performance-gpu', '--use-webgpu-power-preference=high-performance', '--new-window', origin + '/webgpu/index.html'], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log('AERO WebGPU: ' + origin + '/webgpu/index.html');
}
launch().catch(error => { console.error(error.message); process.exitCode = 1; });
