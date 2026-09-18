const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const stage=process.argv[2]||'04-ocean';
if(fs.existsSync(path.join(__dirname,'stages',stage,'complete.json')))throw Error('Completed audit is protected. Choose a new output stage.');
if(Number(stage.slice(0,2))<8&&fs.existsSync(path.join(__dirname,'stages',stage,'gpu-audit.json')))throw Error('Archived audit is protected. Choose a new output stage.');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true,args:['--force-high-performance-gpu','--use-webgpu-power-preference=high-performance']});try{const p=await b.newPage({viewport:{width:1280,height:720}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await p.goto('http://127.0.0.1:8765/webgpu/index.html?render=1');await p.waitForFunction(()=>window.flightReady,null,{timeout:120000});
 const windows=await p.evaluate(async()=>{
  const T=await import('./vendor/three.module.js'),d=flight.inspect(),c=d.infrastructure,source=c.towerMesh.material[0];
  const material=new T.MeshBasicNodeMaterial();material.colorNode=source.userData.windowMask;
  const geo=new T.PlaneGeometry(1,1);geo.setAttribute('facadeSize',new T.InstancedBufferAttribute(new Float32Array([600,300,1]),3));geo.setAttribute('facadeSeed',new T.InstancedBufferAttribute(new Float32Array([100,100]),2));
  const mesh=new T.InstancedMesh(geo,material,1);mesh.setMatrixAt(0,new T.Matrix4().makeScale(600,300,1));const scene=new T.Scene();scene.add(mesh);const camera=new T.OrthographicCamera(-300,300,150,-150,.1,100);camera.position.z=5;
  const target=new T.RenderTarget(1280,640,{type:T.UnsignedByteType}),counts=[];
  for(const density of [.55,.275,.275]){c.windowDensity.value=density;d.renderer.setRenderTarget(target);d.renderer.render(scene,camera);const bytes=await d.renderer.readRenderTargetPixelsAsync(target,0,0,1280,640);let count=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]>100)count++;counts.push(count);}
  c.windowDensity.value=.275;d.renderer.setRenderTarget(null);geo.dispose();material.dispose();target.dispose();return {counts,ratio:counts[1]/counts[0]};
 });assert.ok(windows.ratio>.46&&windows.ratio<.54);assert.equal(windows.counts[1],windows.counts[2]);
 const reflection=await p.evaluate(async()=>{
  flight.reset();flight.setEnvironment({hour:0,cycle:false,weather:'sun'},{immediate:true});const d=flight.inspect(),spec={eye:[-1850,9,-1130],target:[-2040,48,-1950]},canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');
  const images=[];
  async function pixels(){const url=await flight.captureShot(spec);images.push(url);const image=new Image();image.src=url;await image.decode();ctx.drawImage(image,0,0,1280,720);return ctx.getImageData(0,420,1280,260).data;}
  const a=await pixels();d.infrastructure.group.visible=false;const b=await pixels();d.infrastructure.group.visible=true;await pixels();let changed=0,sum=0;for(let i=0;i<a.length;i+=4){const delta=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);if(delta>30)changed++;sum+=delta;}return {changedWaterPixels:changed,meanChannelDifference:sum/(a.length/4*3),images:images.slice(0,2)};
 });reflection.images.forEach((url,i)=>fs.writeFileSync(path.join(__dirname,'stages',stage,'reflection-'+(i?'hidden':'visible')+'.png'),Buffer.from(url.split(',')[1],'base64')));delete reflection.images;console.log('Reflection',reflection);assert.ok(reflection.changedWaterPixels>1000,'City must change pixels inside the water reflection');
 const atmosphere=await p.evaluate(async()=>{
  const d=flight.inspect(),u=d.atmosphere.sky.material.uniforms;flight.reset();flight.setEnvironment({hour:10,cycle:false});
  const origin=u.cloudOrigin.value.toArray();d.camera.rotation.y+=1;d.atmosphere.apply(d.camera);const rotated=u.cloudOrigin.value.toArray();
  const memories=[];for(let k=0;k<12;k++){flight.setEnvironment({hour:k%2?0:12,weather:['sun','rain','snow'][k%3]},{immediate:true});await d.renderer.backend.device.queue.onSubmittedWorkDone();memories.push({...d.renderer.info.memory});}
  return {origin,rotated,firstWarm:memories[5],last:memories[11],rainInstances:d.atmosphere.precipitation.rain.geometry.attributes.position.count,snowInstances:d.atmosphere.precipitation.snow.count};
 });assert.deepEqual(atmosphere.origin,atmosphere.rotated);assert.equal(atmosphere.firstWarm.textures,atmosphere.last.textures);assert.equal(atmosphere.firstWarm.geometries,atmosphere.last.geometries);
 const report={windows,reflection,atmosphere,errors};fs.mkdirSync(path.join(__dirname,'stages',stage),{recursive:true});fs.writeFileSync(path.join(__dirname,'stages',stage,'gpu-audit.json'),JSON.stringify(report,null,2));assert.deepEqual(errors,[]);console.log(JSON.stringify(report,null,2));
 }finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1)});
