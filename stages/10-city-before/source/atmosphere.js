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
  sky.material.colorNode=skyNight({base:vec3(sky.material.colorNode),d:positionLocal.normalize(),sun:uniforms.sunPosition.normalize(),moon:uniforms.moonDirection,day:uniforms.daylight,storm:uniforms.rainAmount.max(uniforms.snowAmount.mul(.8)),origin:uniforms.cloudOrigin});
  // One reusable HDR cubemap feeds both the visible sky and the ocean sampler.
  const cubeTarget=new THREE.CubeRenderTarget(256,{type:THREE.HalfFloatType,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter});
  const cubeCamera=new THREE.CubeCamera(.1,1000,cubeTarget);
  const pmrem=new THREE.PMREMGenerator(renderer);let filteredTarget;
  const moonlight=new THREE.DirectionalLight('#9fbbef',.15);scene.add(moonlight);
  const moonDir=new THREE.Vector3();
  const fogColor=new THREE.Color();const warm=new THREE.Color('#d79d83'),dayFog=new THREE.Color('#a8c1d0'),nightFog=new THREE.Color('#101a2e'),stormFog=new THREE.Color('#71828d');
  let lastCapture=-Infinity,lastHour=-100,captureCount=0,dirty=true,lastPosition=new THREE.Vector3(Infinity,0,0);
  let daylight=1,fogDensity=.000035,wind=1;
  const precipitation=createPrecipitation();scene.add(precipitation.rain,precipitation.snow);
  function getState(){return {...state,daylight,fogDensity,wind,reflectionUpdates:captureCount};}
  function set(values,{immediate=false}={}){
    if(Number.isFinite(values.hour))state.hour=((values.hour%24)+24)%24;
    if(typeof values.cycle==='boolean')state.cycle=values.cycle;
    if(Number.isFinite(values.cycleSeconds))state.cycleSeconds=clamp(values.cycleSeconds,16,1800);
    if(['sun','rain','snow'].includes(values.weather))state.weather=values.weather;
    if(typeof values.autoWeather==='boolean')state.autoWeather=values.autoWeather;
    if(immediate){state.rain=state.weather==='rain'?1:0;state.snow=state.weather==='snow'?1:0;}
    dirty=true;
  }
  function reset(){Object.assign(state,defaults,{rain:0,snow:0,elapsed:0});dirty=true;}
  function advance(dt){
    state.elapsed+=dt;
    if(state.cycle)state.hour=(state.hour+dt*24/state.cycleSeconds)%24;
    if(state.autoWeather)state.weather=['sun','rain','snow'][Math.floor(state.elapsed/45)%3];
    const blend=1-Math.exp(-dt/2.4);
    state.rain=THREE.MathUtils.lerp(state.rain,state.weather==='rain'?1:0,blend);
    state.snow=THREE.MathUtils.lerp(state.snow,state.weather==='snow'?1:0,blend);
  }
  function apply(camera){
    const phase=(state.hour-6)/24*Math.PI*2;
    sunDir.set(-Math.cos(phase),Math.sin(phase)*.84,-.54).normalize();
    moonDir.copy(sunDir).negate();uniforms.moonDirection.value.copy(moonDir);
    daylight=smooth(-.15,.20,sunDir.y);const direct=smooth(-.02,.23,sunDir.y);
    const storm=Math.max(state.rain,state.snow*.8);const dusk=1-smooth(.02,.30,Math.abs(sunDir.y));
    sunlight.intensity=3.4*direct*(1-storm*.87);sunlight.position.copy(camera.position).addScaledVector(sunDir,15000);sunlight.target.position.copy(camera.position);sunlight.target.updateMatrixWorld();
    sunlight.color.set('#fff4db').lerp(new THREE.Color('#ff914c'),dusk*.72);
    hemisphere.intensity=THREE.MathUtils.lerp(.24,1.45,daylight)*(1-storm*.40);
    hemisphere.color.set('#b1d2f1').lerp(new THREE.Color('#677994'),1-daylight);
    moonlight.position.copy(camera.position).addScaledVector(moonDir,15000);moonlight.target.position.copy(camera.position);moonlight.target.updateMatrixWorld();moonlight.intensity=.65*(1-daylight)*(1-storm*.7);
    fogColor.copy(dayFog).lerp(warm,dusk*.65).lerp(stormFog,storm*.75).lerp(nightFog,1-daylight);
    fogDensity=.000032+state.rain*.00018+state.snow*.00029;scene.fog.color.copy(fogColor);scene.fog.density=fogDensity;
    wind=.7+state.rain*1.3+state.snow*.55;
    uniforms.sunPosition.value.copy(sunDir).multiplyScalar(450000);
    uniforms.daylight.value=daylight;uniforms.rainAmount.value=state.rain;uniforms.snowAmount.value=state.snow;uniforms.cloudCover.value=.28+storm*.68;
    uniforms.turbidity.value=2.1+state.rain*6+state.snow*4;
    sky.elapsed.value=state.elapsed;
    uniforms.cloudOrigin.value.set(camera.position.x*.00016+state.elapsed*.004,camera.position.z*.00016+state.elapsed*.001);
    if(dirty||Math.abs(state.hour-lastHour)>.15||state.elapsed-lastCapture>=1.5||camera.position.distanceTo(lastPosition)>200){
      const toneMapping=renderer.toneMapping;renderer.toneMapping=THREE.NoToneMapping;
      cubeCamera.update(renderer,skyScene);renderer.toneMapping=toneMapping;
      filteredTarget=pmrem.fromCubemap(cubeTarget.texture,filteredTarget);
      scene.background=cubeTarget.texture;scene.environment=filteredTarget.texture;scene.environmentIntensity=.48;
      lastCapture=state.elapsed;lastHour=state.hour;lastPosition.copy(camera.position);dirty=false;captureCount++;
    }
    precipitation.update(camera.position,state.elapsed,state.rain,state.snow,daylight,wind);
  }
  return {sky,skyScene,cubeTarget,moonDir,fogColor,precipitation,getState,set,reset,advance,apply,
    get daylight(){return daylight;},get fogDensity(){return fogDensity;},get wind(){return wind;},
    dispose(){cubeTarget.dispose();filteredTarget?.dispose();pmrem.dispose();}
  };
}
