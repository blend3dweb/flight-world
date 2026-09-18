const {chromium}=require('C:/Users/sva/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');

const outputDir=path.join(__dirname,'exports');
fs.mkdirSync(outputDir,{recursive:true});

async function showExternal(page,location,azimuth){
 await page.evaluate(({location,azimuth})=>{
  flight.startFlight(location);
  flight.setView('external');
  flight.setOrbit({auto:true,distance:30,azimuth,elevation:.22});
 },{location,azimuth});
}

(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:false,args:['--force-high-performance-gpu','--use-webgpu-power-preference=high-performance','--window-size=1620,980']});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:900},acceptDownloads:true}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('http://127.0.0.1:8765/webgpu/index.html');
  await page.waitForFunction(()=>window.flightReady,null,{timeout:120000});
  await page.evaluate(()=>{
   flight.setQuality('high');
   flight.startFlight('city');
   flight.setView('cockpit');
   flight.setEnvironment({hour:8,cycle:true,cycleSeconds:20,weather:'sun',autoWeather:false},{immediate:true});
  });
  await page.waitForTimeout(3000);

  const downloadPromise=page.waitForEvent('download',{timeout:45000});
  await page.evaluate(()=>{
   const type=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
   const canvas=flight.getCanvas(),stream=canvas.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:10000000}),chunks=[];
   recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
   recorder.onstop=()=>{stream.getTracks().forEach(track=>track.stop());const url=URL.createObjectURL(new Blob(chunks,{type})),link=document.createElement('a');link.href=url;link.download='flight-world-tour.webm';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);};
   function compose(){flight.getCanvas();if(recorder.state==='recording')requestAnimationFrame(compose);}
   recorder.start(1000);compose();setTimeout(()=>recorder.state==='recording'&&recorder.stop(),20000);
  });
  await page.waitForTimeout(4000);
  await showExternal(page,'islands',.7);
  await page.waitForTimeout(4000);
  await page.evaluate(()=>flight.setEnvironment({weather:'rain',autoWeather:false}));
  await page.waitForTimeout(4000);
  await showExternal(page,'airport',2.2);
  await page.evaluate(()=>flight.setEnvironment({weather:'snow',autoWeather:false}));
  await page.waitForTimeout(4000);
  await showExternal(page,'city',4.1);
  await page.evaluate(()=>flight.setEnvironment({weather:'sun',autoWeather:false}));

  const download=await downloadPromise;
  const suggested=download.suggestedFilename();
  const output=path.join(outputDir,'flight-world-tour.webm');
  await download.saveAs(output);
  assert.ok(fs.statSync(output).size>1000000,'Recorded video is unexpectedly small.');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({output,size:fs.statSync(output).size,suggested,errors},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
