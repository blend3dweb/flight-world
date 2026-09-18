const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:8765/?render=1');await page.waitForFunction(()=>window.flightReady);
  await page.evaluate(()=>{window.flight.seek(12);window.flight.setView('external');window.flight.setOrbit({azimuth:.4,elevation:.13,distance:18});});
  for(const [name,hour,weather] of [['day',11,'sun'],['sunset',18.15,'sun'],['night',0,'sun'],['rain',13,'rain'],['snow',13,'snow']]){
   await page.evaluate(({hour,weather})=>window.flight.setEnvironment({hour,weather,cycle:false,autoWeather:false},{immediate:true}),{hour,weather});
   await page.screenshot({path:__dirname+`/environment-${name}.png`});
   console.log(name,JSON.stringify(await page.evaluate(()=>{
    const {renderer,atmosphere}=window.flight.inspect();const samples=[];
    for(let face=0;face<6;face++){const data=new Uint16Array(4);renderer.readRenderTargetPixels(atmosphere.cubeTarget,256,256,1,1,data,face);samples.push(Array.from(data));}
    return {environment:window.flight.getState().environment,cube:samples};
   })));
  }
  console.log(JSON.stringify({errors}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
