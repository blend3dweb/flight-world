const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8765/?render=1');await page.waitForFunction(()=>window.flightReady);
    await page.evaluate(()=>window.flight.seek(8));
    await page.keyboard.press('Space');const paused=await page.evaluate(()=>window.flight.getState());await page.evaluate(()=>window.flight.step(1));const unchanged=await page.evaluate(()=>window.flight.getState());assert.equal(paused.time,unchanged.time);
    await page.keyboard.press('Space');await page.keyboard.down('ArrowRight');await page.evaluate(()=>{for(let i=0;i<60;i++)window.flight.step(1/30);});await page.keyboard.up('ArrowRight');const turned=await page.evaluate(()=>window.flight.getState());assert.equal(turned.auto,false);assert.ok(turned.roll<0);assert.notEqual(turned.heading,paused.heading);
    await page.keyboard.down('ArrowDown');await page.evaluate(()=>{for(let i=0;i<60;i++)window.flight.step(1/30);});await page.keyboard.up('ArrowDown');const climb=await page.evaluate(()=>window.flight.getState());assert.ok(climb.y>turned.y);
    await page.keyboard.press('KeyR');const reset=await page.evaluate(()=>window.flight.getState());assert.equal(reset.time,0);assert.equal(reset.auto,true);
    await page.keyboard.press('KeyC');assert.equal(await page.locator('#cockpit').getAttribute('aria-pressed'),'false');
    await page.evaluate(()=>window.flight.seek(20));await page.setViewportSize({width:390,height:844});await page.screenshot({path:__dirname+'/mobile-preview.png'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),390);
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:['pause freezes simulation','right bank switches to manual and turns','pitch increases altitude','reset restores state','cockpit toggle','mobile viewport without overflow'],errors},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
