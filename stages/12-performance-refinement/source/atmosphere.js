import * as THREE from './vendor/three.module.js';
import { SkyMesh } from './vendor/SkyMesh.js';
import { uniform,positionLocal,vec3 } from './vendor/tsl.js';
import {skyNight} from './sky-nodes.js';
import {createPrecipitation} from './precipitation.js';

const clamp=THREE.MathUtils.clamp;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const defaults={hour:10,cycle:true,cycleSeconds:240,weather:'sun',autoWeather:false};
export function createAtmosphere({renderer,scene,sunlight,hemisphere,sunDir}){
  const state={...defaults,rain:0,snow:0,elapsed:0};
  const skyScene=new THREE.Scene();
  const sky=new SkyMesh();sky.scale.setScalar(450);skyScene.add(sky);
  const uniforms={rayleigh:sky.rayleigh,turbidity:sky.turbidity,mieCoefficient:sky.mieCoefficient,mieDirectionalG:sky.mieDirectionalG,sunPosition:sky.sunPosition,daylight:uniform(1),cloudCover:uniform(.28),rainAmount:uniform(0),snowAmount:uniform(0),cloudOrigin:uniform(new THREE.Vector2()),moonDirection:uniform(new THREE.Vector3())};
  sky.material.uniforms=uniforms;sky.cloudCoverage.value=0;
  uniforms.rayleigh.value=2.6;uniforms.turbidity.value=2.1;uniforms.mieCoefficient.value=.004;uniforms.mieDirectionalG.value=.8;
  sky.material.colorNode=skyNight({base:vec3(sky.material.colorNode),d:positionLocal.normalize(),sun:uniforms.sunPosition.normalize(),moon:uniforms.moonDirection,day:uniforms.daylight,storm:uniforms.rainAmount.max(uniforms.snowAmount.mul(.8)),cover:uniforms.cloudCover,origin:uniforms.cloudOrigin});
  // One reusable HDR cubemap feeds both the visible sky and the ocean sampler.
  const cubeTarget=new THREE.CubeRenderTarget(256,{type:THREE.HalfFloatType,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter});
  const cubeCamera=new THREE.CubeCamera(.1,1000,cubeTarget);
  const pmrem=new THREE.PMREMGenerator(renderer);let filteredTarget;
  const moonlight=new THREE.DirectionalLight('#9fbbef',.15);scene.add(moonlight);
  const moonDir=new THREE.Vector3();
  const fogColor=new THREE.Color();const warm=new THREE.Color('#e19a76'),dayFog=new THREE.Color('#a8c7d5'),nightFog=new THREE.Color('#0d1830'),rainFog=new THREE.Color('#61727d'),snowFog=new THREE.Color('#bac5c8');
  let lastCapture=-Infinity,lastEnvironment=-Infinity,lastHour=-100,captureCount=0,pmremUpdates=0,dirty=true,lastPosition=new THREE.Vector3(Infinity,0,0);
  let captureFace=-1,pmremPending=false,environmentDirty=true,forceFullCapture=false,applyFrame=0,pmremPendingFrame=-1;
  let daylight=1,fogDensity=.000035,wind=1;
  const precipitation=createPrecipitation();scene.add(precipitation.rain,precipitation.snow);
  function getState(){return {...state,daylight,fogDensity,wind,reflectionUpdates:captureCount,pmremUpdates,captureFace};}
  function set(values,{immediate=false}={}){
    if(Number.isFinite(values.hour))state.hour=((values.hour%24)+24)%24;
    if(typeof values.cycle==='boolean')state.cycle=values.cycle;
    if(Number.isFinite(values.cycleSeconds))state.cycleSeconds=clamp(values.cycleSeconds,16,1800);
    if(['sun','rain','snow'].includes(values.weather))state.weather=values.weather;
    if(typeof values.autoWeather==='boolean')state.autoWeather=values.autoWeather;
    if(immediate){state.rain=state.weather==='rain'?1:0;state.snow=state.weather==='snow'?1:0;forceFullCapture=true;}
    dirty=true;environmentDirty=true;
  }
  function reset(){Object.assign(state,defaults,{rain:0,snow:0,elapsed:0});dirty=true;environmentDirty=true;forceFullCapture=true;}
  function advance(dt){
    state.elapsed+=dt;
    if(state.cycle)state.hour=(state.hour+dt*24/state.cycleSeconds)%24;
    if(state.autoWeather)state.weather=['sun','rain','snow'][Math.floor(state.elapsed/45)%3];
    const blend=1-Math.exp(-dt/2.4);
    state.rain=THREE.MathUtils.lerp(state.rain,state.weather==='rain'?1:0,blend);
    state.snow=THREE.MathUtils.lerp(state.snow,state.weather==='snow'?1:0,blend);
  }
  function updateFilteredEnvironment(){
    filteredTarget=pmrem.fromCubemap(cubeTarget.texture,filteredTarget);
    scene.environment=filteredTarget.texture;lastEnvironment=state.elapsed;pmremPending=false;environmentDirty=false;pmremUpdates++;
  }
  function fullCapture(){
    const toneMapping=renderer.toneMapping;renderer.toneMapping=THREE.NoToneMapping;
    cubeCamera.update(renderer,skyScene);renderer.toneMapping=toneMapping;
    scene.background=cubeTarget.texture;captureCount++;captureFace=-1;pmremPending=false;
    updateFilteredEnvironment();lastCapture=state.elapsed;lastHour=state.hour;dirty=false;
  }
  function captureOneFace(){
    if(cubeCamera.coordinateSystem!==renderer.coordinateSystem){cubeCamera.coordinateSystem=renderer.coordinateSystem;cubeCamera.updateCoordinateSystem();}
    const oldTarget=renderer.getRenderTarget(),oldFace=renderer.getActiveCubeFace(),oldLevel=renderer.getActiveMipmapLevel();
    const toneMapping=renderer.toneMapping,mipmaps=cubeTarget.texture.generateMipmaps;
    renderer.toneMapping=THREE.NoToneMapping;cubeTarget.texture.generateMipmaps=captureFace===5&&mipmaps;
    renderer.setRenderTarget(cubeTarget,captureFace,cubeCamera.activeMipmapLevel);renderer.render(skyScene,cubeCamera.children[captureFace]);
    renderer.setRenderTarget(oldTarget,oldFace,oldLevel);renderer.toneMapping=toneMapping;cubeTarget.texture.generateMipmaps=mipmaps;
    captureFace++;
    if(captureFace===6){cubeTarget.texture.needsPMREMUpdate=true;captureFace=-1;pmremPending=environmentDirty||state.elapsed-lastEnvironment>=15;pmremPendingFrame=applyFrame;scene.background=cubeTarget.texture;captureCount++;lastCapture=state.elapsed;lastHour=state.hour;dirty=false;}
  }
  function apply(camera,{immediate=false}={}){
    applyFrame++;
    const phase=(state.hour-6)/24*Math.PI*2;
    sunDir.set(-Math.cos(phase),Math.sin(phase)*.84,-.54).normalize();
    moonDir.copy(sunDir).negate();uniforms.moonDirection.value.copy(moonDir);
    daylight=smooth(-.15,.20,sunDir.y);const direct=smooth(-.02,.23,sunDir.y);
    const storm=Math.max(state.rain,state.snow*.8);const dusk=1-smooth(.02,.30,Math.abs(sunDir.y));
    sunlight.intensity=3.4*direct*(1-storm*.87);sunlight.position.copy(camera.position).addScaledVector(sunDir,15000);sunlight.target.position.copy(camera.position);sunlight.target.updateMatrixWorld();
    sunlight.color.set('#fff4db').lerp(new THREE.Color('#ff914c'),dusk*.72);
    hemisphere.intensity=THREE.MathUtils.lerp(.30,1.45,daylight)*(1-storm*.40);
    hemisphere.color.set('#b1d2f1').lerp(new THREE.Color('#677994'),1-daylight);
    moonlight.position.copy(camera.position).addScaledVector(moonDir,15000);moonlight.target.position.copy(camera.position);moonlight.target.updateMatrixWorld();moonlight.intensity=.65*(1-daylight)*(1-storm*.7);
    fogColor.copy(dayFog).lerp(warm,dusk*.72).lerp(rainFog,state.rain*.78).lerp(snowFog,state.snow*.58).lerp(nightFog,(1-daylight)*(1-state.snow*.35));
    fogDensity=.000030+state.rain*.00020+state.snow*.00026;scene.fog.color.copy(fogColor);scene.fog.density=fogDensity;
    wind=.7+state.rain*1.3+state.snow*.55;
    uniforms.sunPosition.value.copy(sunDir).multiplyScalar(450000);
    uniforms.daylight.value=daylight;uniforms.rainAmount.value=state.rain;uniforms.snowAmount.value=state.snow;uniforms.cloudCover.value=.24+state.rain*.70+state.snow*.52;
    uniforms.turbidity.value=2.1+state.rain*6+state.snow*4;
    sky.elapsed.value=state.elapsed;
    // Translation keeps the procedural dome fixed in world space; only elapsed
    // simulation time and weather wind move the cloud field.
    uniforms.cloudOrigin.value.set(camera.position.x*.00016+state.elapsed*.0034*wind,camera.position.z*.00016+state.elapsed*.0009*wind);
    const captureDue=dirty||Math.abs(state.hour-lastHour)>.5||state.elapsed-lastCapture>=5||camera.position.distanceTo(lastPosition)>650;
    if(captureCount===0||immediate||forceFullCapture){fullCapture();forceFullCapture=false;lastPosition.copy(camera.position);}
    else{
      if(captureFace<0&&captureDue&&!pmremPending){captureFace=0;lastPosition.copy(camera.position);}
      if(captureFace>=0)captureOneFace();
      // PMREM is deliberately separated from the sixth cubemap face so the two
      // most expensive atmosphere operations never land in the same live frame.
      if(pmremPending&&applyFrame>pmremPendingFrame)updateFilteredEnvironment();
    }
    scene.environmentIntensity=THREE.MathUtils.lerp(.26,.52,daylight)*(1-storm*.28);
    renderer.toneMappingExposure=THREE.MathUtils.lerp(.92,1.06,daylight)*(1-state.snow*.06);
    precipitation.update(camera.position,state.elapsed,state.rain,state.snow,daylight,wind);
  }
  return {sky,skyScene,cubeTarget,moonDir,fogColor,precipitation,getState,set,reset,advance,apply,
    get daylight(){return daylight;},get fogDensity(){return fogDensity;},get wind(){return wind;},
    dispose(){cubeTarget.dispose();filteredTarget?.dispose();pmrem.dispose();}
  };
}
