const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const stage=process.argv[2]||'08-ocean-refinement',out=path.join(__dirname,'stages',stage,'ocean-audit');fs.mkdirSync(out,{recursive:true});
if(fs.existsSync(path.join(out,'../complete.json')))throw Error('Completed ocean audit is protected. Choose a new output stage.');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--force-high-performance-gpu','--use-webgpu-power-preference=high-performance']});try{
 const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:8765/webgpu/index.html?render=1');await page.waitForFunction(()=>window.flightReady,null,{timeout:120000});
 const result=await page.evaluate(async()=>{
  const d=flight.inspect(),frames={};
  flight.reset();flight.setEnvironment({hour:10,cycle:false,weather:'sun',autoWeather:false},{immediate:true});flight.step(8);
  const spec={eye:[-1840.01,9,-1130],target:[-2040,48,-1950]};
  async function shot(name,s=spec){const url=await flight.captureShot(s);frames[name]=url;const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=900;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,550,1600,350).data;}
  function difference(a,b){let sum=0,changed=0;for(let i=0;i<a.length;i+=4){const delta=Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);sum+=delta;if(delta>18)changed++;}return {meanChannelDifference:sum/(a.length/4*3),changedPixels:changed};}
  await flight.captureShot(spec); // Warm reflection mipmaps and the new camera's shadow state.
  const a=await shot('01-bay');const repeat=await shot('02-repeat');
  const crossing=await shot('03-grid-crossing',{eye:[-1839.99,9,-1130],target:[-2040,48,-1950]});
  const windBefore=d.water.uniforms.wind.value;d.water.uniforms.wind.value=2;const windy=await shot('04-wind');d.water.uniforms.wind.value=windBefore;
  flight.step(1/60);const motion=await shot('05-next-frame');
  await shot('06-open-ocean',{eye:[-500,6,2000],target:[-2000,3,0]});
  await shot('07-from-above',{eye:[-500,800,1800],target:[-1400,0,-2400]});
  await shot('08-shore',{eye:[-2200,18,-1290],target:[-2270,0,-1370]});
  return {frames,repeat:difference(a,repeat),gridCrossing:difference(a,crossing),wind:difference(a,windy),motion:difference(a,motion),backend:d.renderer.backend.device.adapterInfo.vendor};
 });
 for(const [name,url] of Object.entries(result.frames))fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(url.split(',')[1],'base64'));delete result.frames;
 console.log(JSON.stringify(result,null,2));
 assert.ok(result.repeat.meanChannelDifference<.02,'Frozen ocean must stay within sub-pixel rasterization tolerance');
 assert.ok(result.gridCrossing.meanChannelDifference<.5,'Crossing the former snapped grid boundary must be smooth');
 assert.ok(result.wind.changedPixels>1000,'Wind must affect water without changing the sky or rain');
 assert.ok(result.motion.changedPixels>100,'Waves must move');
 assert.ok(result.motion.meanChannelDifference<8,'One frame must not flicker across the water');
 assert.deepEqual(errors,[]);result.errors=errors;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
