// Usage: node render.cjs [ffmpeg executable] [playwright module directory]
const fs=require('node:fs');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {chromium}=require(process.argv[3]||'playwright');
const ffmpeg=process.argv[2]||'ffmpeg';
const width=1920,height=1080,fps=30,duration=40;
(async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
  try{
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('http://127.0.0.1:8765/?render=1');await page.waitForFunction(()=>window.flightReady,null,{timeout:60000});
    await page.evaluate(()=>{window.flight.seek(10);window.flight.setView('external');window.flight.setOrbit({azimuth:.65,elevation:.18,distance:18,auto:false});window.flight.setEnvironment({hour:11,cycle:false,weather:'sun'},{immediate:true});});
    const output=path.join(__dirname,'aero-flight-v3.mp4');
    const encoder=spawn(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','pipe:0',
      '-f','lavfi','-i','anoisesrc=color=brown:amplitude=0.085:sample_rate=48000',
      '-f','lavfi','-i','sine=frequency=88:sample_rate=48000',
      '-filter_complex','[1:a]lowpass=f=450,volume=0.65[n];[2:a]volume=0.12[e];[n][e]amix=inputs=2:normalize=0,afade=t=in:st=0:d=2,afade=t=out:st=38:d=2[a]',
      '-map','0:v','-map','[a]','-vf','scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-c:a','aac','-b:a','128k','-t',String(duration),'-movflags','+faststart',output],{stdio:['pipe','ignore','pipe']});
    let encoderError='';encoder.stderr.on('data',b=>encoderError+=b);encoder.stdin.on('error',()=>{});
    const completion=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('close',code=>code===0?resolve():reject(new Error(encoderError||`ffmpeg exit ${code}`)));});
    for(let i=0;i<fps*duration;i++){
      const jpg=await page.evaluate((index)=>{
        if(index>0)window.flight.step(1/30);
        if(index===180)window.flight.setEnvironment({weather:'rain',hour:13});
        if(index===420)window.flight.setEnvironment({weather:'snow'});
        if(index===660)window.flight.setEnvironment({weather:'sun'});
        if(index===780){window.flight.setEnvironment({hour:17,cycle:true,cycleSeconds:16});window.flight.setOrbit({azimuth:-1.2,elevation:.12,auto:true});}
        if(index===930)window.flight.setOrbit({azimuth:3.2,elevation:-.45,auto:false});
        if(index===1050)window.flight.setOrbit({azimuth:1.1,elevation:.18,auto:true});
        return window.flight.getCanvas().toDataURL('image/jpeg',.96).split(',')[1];
      },i);
      if(!encoder.stdin.write(Buffer.from(jpg,'base64')))await once(encoder.stdin,'drain');
      if(i%120===0)console.log(`Rendered ${i}/${fps*duration} frames`);
      if([0,360,600,810,960,1080,1199].includes(i))await page.screenshot({path:path.join(__dirname,`v3-frame-${String(i).padStart(4,'0')}.png`)});
      if(errors.length)throw new Error(errors.join('\n'));
    }
    encoder.stdin.end();await completion;
    console.log(JSON.stringify({output,bytes:fs.statSync(output).size,frames:fps*duration,width,height,fps,duration,errors},null,2));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
