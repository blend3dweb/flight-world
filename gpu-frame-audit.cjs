const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const stage=process.argv[2];if(!stage||!/^[a-z0-9-]+$/.test(stage))throw Error('Specify an output stage.');
const out=path.join(__dirname,'stages',stage);fs.mkdirSync(out,{recursive:true});
if(fs.existsSync(path.join(out,'complete.json')))throw Error('Completed audit is protected.');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:false,args:['--force-high-performance-gpu','--use-webgpu-power-preference=high-performance','--window-size=1940,1180']});try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto('http://127.0.0.1:8765/webgpu/index.html?test=1');await page.waitForFunction(()=>window.flightReady,null,{timeout:120000});
 const result={date:new Date().toISOString(),device:await page.evaluate(()=>flight.inspect().renderer.backend.device.adapterInfo.vendor),scenarios:[],errors};
 const scenarios=[{name:'city-day',hour:10,weather:'sun',location:'city'},{name:'night-orbit',hour:0,weather:'sun',location:'city',external:true},{name:'rain-low-forest',hour:12,weather:'rain',location:'islands',low:true},{name:'airport-snow',hour:12,weather:'snow',location:'airport'}];
 for(const scenario of scenarios){
  await page.evaluate(s=>{flight.startFlight(s.location);flight.setEnvironment({hour:s.hour,cycle:false,weather:s.weather,autoWeather:false},{immediate:true});if(s.external){flight.setView('external');flight.setOrbit({auto:true,distance:30});}if(s.low)flight.place({x:-3030,y:75,z:-1300,heading:0,pitch:0});},scenario);
  const sample=await page.evaluate(async()=>{await new Promise(r=>setTimeout(r,5000));const times=[];await new Promise(resolve=>{const start=performance.now();let last=start;function tick(now){times.push(now-last);last=now;if(now-start<8000)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});times.shift();const ordered=[...times].sort((a,b)=>a-b),pick=q=>ordered[Math.min(ordered.length-1,Math.floor(ordered.length*q))];return {frames:times.length,averageFps:1000/(times.reduce((a,b)=>a+b,0)/times.length),medianMs:pick(.5),p95Ms:pick(.95),p99Ms:pick(.99),maxMs:ordered.at(-1),over33:times.filter(v=>v>33.4).length,over50:times.filter(v=>v>50).length,state:flight.getState()};});
  result.scenarios.push({name:scenario.name,...sample});console.log(JSON.stringify(result.scenarios.at(-1)));
 }
 assert.equal(result.device,'nvidia');assert.ok(result.scenarios.every(s=>s.frames>100));assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'frame-audit.json'),JSON.stringify(result,null,2));
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
