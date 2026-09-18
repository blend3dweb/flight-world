const { chromium } = require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome',args:['--enable-webgl','--ignore-gpu-blocklist']});
  const page=await browser.newPage({viewport:{width:1600,height:900},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:8765/?render=1');
  await page.waitForFunction(()=>window.flightReady,{timeout:60000});
  await page.evaluate(()=>window.flight.seek(12));
  await page.screenshot({path:path.join(__dirname,'preview.png')});
  console.log(JSON.stringify({errors,state:await page.evaluate(()=>window.flight.getState())},null,2));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
