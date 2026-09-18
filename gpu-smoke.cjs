const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{const b=await chromium.launch({channel:'chrome',headless:true});const p=await b.newPage();p.on('pageerror',e=>console.log('PAGEERROR',e.message+' '+e.stack));p.on('console',m=>{if(['error','warning'].includes(m.type()))console.log(m.type(),m.text().slice(0,5000));});await p.goto('http://127.0.0.1:8765/webgpu/index.html?render=1');try{await p.waitForFunction(()=>window.flightReady,null,{timeout:30000});console.log(await p.evaluate(()=>flight.getState()));await p.screenshot({path:'webgpu/smoke.png'});}catch(e){console.log(e.message);}await b.close();})();


