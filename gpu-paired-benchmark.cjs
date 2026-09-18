const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.join(__dirname,'stages/08-ocean-refinement');
if(fs.existsSync(path.join(out,'complete.json')))throw Error('Completed comparison is protected. Use a separate comparison output for a new investigation.');
(async()=>{
 let browser;
 const errors=[],samples=[];let variant='before';
 try{
  for(let round=0;round<3;round++)for(const name of (round%2?['after','before']:['before','after'])){
   variant=name;
   browser=await chromium.launch({channel:'chrome',headless:false,args:['--force-high-performance-gpu','--use-webgpu-power-preference=high-performance','--window-size=1940,1180']});
  const page=await browser.newPage({viewport:{width:1920,height:1080}});
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  // Only these application files changed in stage 08. Serve their exact archived
  // versions for A, then current files for B; all other assets and settings match.
  for(const file of ['flight.js','ocean.js'])await page.route('**/webgpu/'+file,route=>variant==='before'?route.fulfill({path:path.join(__dirname,'stages/08-ocean-before/source',file),contentType:'text/javascript'}):route.continue());
   await page.goto('http://127.0.0.1:8765/webgpu/index.html?test=1');await page.bringToFront();await page.waitForFunction(()=>window.flightReady,null,{timeout:120000});
   const device=await page.evaluate(()=>{flight.startFlight('city');flight.setEnvironment({hour:0,cycle:false,weather:'sun',autoWeather:false},{immediate:true});flight.setView('external');flight.setOrbit({auto:true,distance:30});const r=flight.inspect().renderer;return {vendor:r.backend.device.adapterInfo.vendor,width:r.domElement.width,height:r.domElement.height,quality:flight.getState().quality};});
   assert.deepEqual(device,{vendor:'nvidia',width:1920,height:1080,quality:'high'});
   const timing=await page.evaluate(async()=>{
    await new Promise(r=>setTimeout(r,4000));const times=[];await new Promise(resolve=>{const start=performance.now();let last=start;function tick(now){times.push(now-last);last=now;if(now-start<8000)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});times.shift();times.sort((a,b)=>a-b);return {frames:times.length,averageFps:1000/(times.reduce((a,b)=>a+b,0)/times.length),medianMs:times[Math.floor(times.length*.5)],p95Ms:times[Math.floor(times.length*.95)]};
   });samples.push({round:round+1,variant,...timing});console.log(JSON.stringify(samples.at(-1)));await browser.close();browser=null;
  }
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)],summary={};
  for(const v of ['before','after']){const rows=samples.filter(s=>s.variant===v);summary[v]={averageFps:median(rows.map(s=>s.averageFps)),medianMs:median(rows.map(s=>s.medianMs)),p95Ms:median(rows.map(s=>s.p95Ms))};}
  summary.fpsChangePercent=(summary.after.averageFps/summary.before.averageFps-1)*100;summary.p95ChangePercent=(summary.after.p95Ms/summary.before.p95Ms-1)*100;
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'paired-night-fresh.json'),JSON.stringify({date:new Date().toISOString(),mode:'Visible Chrome, NVIDIA, 1920x1080 high, night orbit, 4s warmup + 8s measurement, alternating A/B order, fresh browser for each sample',samples,summary,errors},null,2));console.log(JSON.stringify(summary,null,2));
 }finally{await browser?.close();}
})().catch(e=>{console.error(e);process.exit(1)});
