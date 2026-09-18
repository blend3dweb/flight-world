const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const stage=process.argv[2]||'13-reflection-stability';
if(!/^[a-z0-9-]+$/.test(stage)||Number(stage.slice(0,2))<13)throw Error('Specify a stage from 13 onwards.');
const out=path.join(__dirname,'stages',stage);fs.mkdirSync(out,{recursive:true});
if(fs.existsSync(path.join(out,'complete.json')))throw Error('Completed stage is protected.');

async function sample(browser,{baseline=false}={}){
 const page=await browser.newPage({viewport:{width:1200,height:675}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 if(baseline){
  const source=path.join(__dirname,'stages','12-performance-refinement','source');
  for(const file of ['flight.js','ocean.js'])await page.route(`**/webgpu/${file}`,route=>route.fulfill({path:path.join(source,file),contentType:'text/javascript'}));
 }
 await page.goto('http://127.0.0.1:8765/webgpu/index.html?test=1');
 await page.waitForFunction(()=>window.flightReady,null,{timeout:120000});
 await page.evaluate(()=>{flight.startFlight('city');flight.setView('cockpit');flight.setEnvironment({hour:10,cycle:false,weather:'sun'},{immediate:true});flight.place({x:-1730,y:350,z:-1000,heading:0,pitch:0,roll:0});document.querySelector('#pause').click();});
 const adapter=await page.evaluate(()=>flight.inspect().renderer.backend.device.adapterInfo.vendor);
 const samples=[];
 let previous=await page.evaluate(()=>flight.getState().ocean.reflectionUpdates);
 for(let i=1;i<=12;i++){
  const state=await page.evaluate(i=>{flight.place({heading:i*.012,roll:Math.sin(i*.32)*.16});return flight.getState().ocean;},i);
  samples.push({frame:i,updates:state.reflectionUpdates,delta:state.reflectionUpdates-previous,turning:state.turning??null,angularDelta:state.angularDelta??null,resolutionScale:state.resolutionScale});previous=state.reflectionUpdates;
  if(!baseline&&[1,4,8,12].includes(i))await page.screenshot({path:path.join(out,`turn-cockpit-${String(i).padStart(2,'0')}.png`)});
 }
 const settling=[];
 for(let i=1;i<=20;i++){
  const state=await page.evaluate(()=>{flight.step(0);return flight.getState().ocean;});
  settling.push({frame:i,updates:state.reflectionUpdates,delta:state.reflectionUpdates-previous,turning:state.turning??null,resolutionScale:state.resolutionScale});previous=state.reflectionUpdates;
 }
 await page.evaluate(()=>{if(flight.getState().paused)document.querySelector('#pause').click();flight.startFlight('city');flight.setView('cockpit');flight.setEnvironment({hour:10,cycle:false,weather:'sun'},{immediate:true});});
 await page.keyboard.down('ArrowLeft');await page.waitForTimeout(2000);
 const performance=await page.evaluate(async()=>{
  const updatesBefore=flight.getState().ocean.reflectionUpdates,times=[];
  await new Promise(resolve=>{const start=window.performance.now();let last=start;function tick(now){times.push(now-last);last=now;if(now-start<5000)requestAnimationFrame(tick);else resolve();}requestAnimationFrame(tick);});times.shift();
  const ordered=[...times].sort((a,b)=>a-b),state=flight.getState();return {frames:times.length,averageFps:1000/(times.reduce((a,b)=>a+b,0)/times.length),p95Ms:ordered[Math.floor(ordered.length*.95)],reflectionUpdates:state.ocean.reflectionUpdates-updatesBefore,resolutionScale:state.ocean.resolutionScale,turning:state.ocean.turning??null};
 });
 await page.keyboard.up('ArrowLeft');await page.close();return {adapter,samples,settling,performance,errors};
}

(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true,args:['--force-high-performance-gpu','--use-webgpu-power-preference=high-performance']});try{
 const before=await sample(browser,{baseline:true}),after=await sample(browser);
 console.log(JSON.stringify({beforeDeltas:before.samples.map(s=>s.delta),afterDeltas:after.samples.map(s=>s.delta),afterTurning:after.samples.map(s=>s.turning)},null,2));
 assert.equal(after.adapter,'nvidia');
 assert.ok(before.samples.filter(sample=>sample.delta===0).length>=6,'baseline should expose cached turning frames');
 assert.ok(after.samples.every(sample=>sample.delta===1&&sample.turning===true),'turning reflection must update every frame');
 assert.ok(after.samples.every(sample=>sample.resolutionScale<.42),'turning target must use bounded resolution');
 const stable=after.settling.slice(-9);assert.equal(stable.at(-1).turning,false);assert.ok(stable.reduce((sum,sample)=>sum+sample.delta,0)<=4,'stable camera should return to normal cadence');
 assert.equal(stable.at(-1).resolutionScale,.42);assert.deepEqual(before.errors,[]);assert.deepEqual(after.errors,[]);
 console.log(JSON.stringify({turnPerformance:{before:before.performance,after:after.performance}},null,2));
 assert.ok(after.performance.averageFps>=before.performance.averageFps*.6,'adaptive refresh caused excessive turn slowdown');
 const report={stage,date:new Date().toISOString(),before,after,errors:[]};
 fs.writeFileSync(path.join(out,'reflection-turn-audit.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({adapter:after.adapter,beforeDeltas:before.samples.map(s=>s.delta),afterDeltas:after.samples.map(s=>s.delta),stableDeltas:stable.map(s=>s.delta),turnPerformance:{before:before.performance,after:after.performance},errors:report.errors},null,2));
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exit(1)});
