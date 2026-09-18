const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const stage=process.argv[2];if(!stage||!/^[a-z0-9-]+$/.test(stage)||Number(stage.slice(0,2))<8)throw Error('Specify a new stage from 08 onwards; archived benchmarks are protected.');
const out=__dirname+'/stages/'+stage;fs.mkdirSync(out,{recursive:true});
if(fs.existsSync(out+'/complete.json'))throw Error('Completed benchmark is protected. Choose a new output stage.');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:false,args:['--force-high-performance-gpu','--use-webgpu-power-preference=high-performance','--window-size=1940,1180']});try{
 const page=await browser.newPage({viewport:{width:1920,height:1080}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message);});page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.log('CONSOLE ERROR',m.text());}});
 page.on('framenavigated',f=>{if(f===page.mainFrame())console.log('NAVIGATION',f.url());});page.on('crash',()=>console.log('PAGE CRASH'));page.on('close',()=>console.log('PAGE CLOSE'));browser.on('disconnected',()=>console.log('BROWSER DISCONNECTED'));
 await page.goto('http://127.0.0.1:8765/webgpu/index.html?test=1');await page.bringToFront();await page.waitForFunction(()=>window.flightReady,null,{timeout:120000});
 const report={mode:'Visible Chrome, live application animation, 1920x1080, high quality',date:new Date().toISOString(),scenarios:[],errors};
 report.device=await page.evaluate(()=>{const d=flight.inspect(),a=d.renderer.backend.device.adapterInfo;return {vendor:a.vendor,architecture:a.architecture,width:d.renderer.domElement.width,height:d.renderer.domElement.height,quality:flight.getState().quality};});assert.equal(report.device.vendor,'nvidia');assert.equal(report.device.width,1920);assert.equal(report.device.height,1080);
 const scenarios=[{name:'city-day',hour:10,weather:'sun',location:'city'},{name:'night-orbit',hour:0,weather:'sun',location:'city',external:true},{name:'rain-low-forest',hour:12,weather:'rain',location:'islands',low:true},{name:'airport-snow',hour:12,weather:'snow',location:'airport'}];
 for(const s of scenarios){
  await page.evaluate(s=>{flight.startFlight(s.location);flight.setEnvironment({hour:s.hour,cycle:false,weather:s.weather,autoWeather:false},{immediate:true});if(s.external){flight.setView('external');flight.setOrbit({auto:true,distance:30});}if(s.low)flight.place({x:-3030,y:75,z:-1300,heading:0,pitch:0});},s);
  await page.bringToFront();await page.waitForTimeout(8000);const trials=[];let state;
  for(let trial=0;trial<3;trial++){await page.bringToFront();const timing=await page.evaluate(async()=>{
   await new Promise(resolve=>{let frames=0;function warm(){if(++frames>=30)resolve();else requestAnimationFrame(warm);}requestAnimationFrame(warm);});const times=[];await new Promise(resolve=>{const start=performance.now();let last=start;function tick(now){times.push(now-last);last=now;if(now-start<6000)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});times.shift();const ordered=[...times].sort((a,b)=>a-b);return {frames:times.length,averageFps:1000/(times.reduce((a,b)=>a+b,0)/times.length),medianMs:ordered[Math.floor(ordered.length*.5)],p95Ms:ordered[Math.floor(ordered.length*.95)],p99Ms:ordered[Math.floor(ordered.length*.99)],state:flight.getState()};
   });state=timing.state;delete timing.state;trials.push(timing);}
  const middle=key=>[...trials].sort((a,b)=>a[key]-b[key])[1][key],timing={frames:Math.round(middle('frames')),averageFps:middle('averageFps'),medianMs:middle('medianMs'),p95Ms:middle('p95Ms'),p99Ms:middle('p99Ms'),trials,state};
  report.scenarios.push({name:s.name,...timing});console.log(JSON.stringify({name:s.name,fps:timing.averageFps,p95:timing.p95Ms,trials:trials.map(t=>Math.round(t.averageFps*10)/10)}));await page.screenshot({path:out+'/live-'+s.name+'.png'});
 }
 // A full accelerated day/night cycle and three weather states in a continuous live flight.
 await page.evaluate(()=>{flight.startFlight('city');flight.setEnvironment({hour:10,cycle:true,cycleSeconds:90,weather:'sun',autoWeather:true},{immediate:true});});
 report.soak=[];for(let i=0;i<5;i++){
  await page.waitForTimeout(30000);const sample=await page.evaluate(()=>({state:flight.getState(),memory:{...flight.inspect().renderer.info.memory},nearTrees:flight.inspect().vegetation.tiles.reduce((sum,t)=>sum+t.near.count,0)}));report.soak.push(sample);console.log(JSON.stringify({soakSeconds:(i+1)*30,weather:sample.state.environment.weather,hour:sample.state.environment.hour,bytes:sample.memory.total}));
 }
 assert.ok(report.scenarios.every(s=>s.frames>=30&&Number.isFinite(s.averageFps)&&Number.isFinite(s.p95Ms)));assert.ok(report.soak.some(s=>s.state.environment.weather==='rain'));assert.ok(report.soak.some(s=>s.state.environment.weather==='snow'));assert.deepEqual(errors,[]);
 fs.writeFileSync(out+'/benchmark.json',JSON.stringify(report,null,2));console.log('Visible browser benchmark and 150-second soak complete');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});

