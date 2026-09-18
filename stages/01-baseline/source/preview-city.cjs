const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'chrome',headless:true});try{
const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.goto('http://127.0.0.1:8765/?render=1');await page.waitForFunction(()=>window.flightReady,null,{timeout:60000});
await page.evaluate(()=>{flight.setEnvironment({hour:10,cycle:false},{immediate:true});flight.seek(5);});
await page.screenshot({path:__dirname+'/city-flight.png'});
for(const shot of [
 {name:'city-overview',eye:[-840,840,-690],target:[-2050,55,-1830]},
 {name:'city-street',eye:[-2215,43,-1408],target:[-2200,62,-1650]},
 {name:'city-airport',eye:[3500,670,-1890],target:[2450,28,-3240]},
 {name:'city-bridge',eye:[400,220,-1250],target:[-250,60,-1990]}
]){
 const data=await page.evaluate(({eye,target})=>{const d=flight.inspect();d.cockpit.visible=false;d.aircraft.visible=false;d.camera.position.set(...eye);d.camera.lookAt(...target);d.atmosphere.apply(d.camera);d.ocean.material.uniforms.eye.value.copy(d.camera.position);d.renderer.render(d.scene,d.camera);return d.renderer.domElement.toDataURL().split(',')[1];},shot);
 fs.writeFileSync(__dirname+'/'+shot.name+'.png',Buffer.from(data,'base64'));
}
console.log(JSON.stringify({errors,info:await page.evaluate(()=>({stats:flight.inspect().infrastructure.stats,render:flight.inspect().renderer.info.render,geometries:flight.inspect().renderer.info.memory.geometries}))},null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
