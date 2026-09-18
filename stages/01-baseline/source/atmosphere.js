import * as THREE from './vendor/three.module.js';
import { Sky } from './vendor/Sky.js';

const clamp=THREE.MathUtils.clamp;
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
const defaults={hour:10,cycle:true,cycleSeconds:240,weather:'sun',autoWeather:false};
const skyFunctions=`
  uniform float daylight;
  uniform float cloudCover;
  uniform float rainAmount;
  uniform float snowAmount;
  uniform vec2 cloudOrigin;
  uniform vec3 moonDirection;
  float weatherHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
  float weatherNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(weatherHash(i),weatherHash(i+vec2(1,0)),f.x),mix(weatherHash(i+vec2(0,1)),weatherHash(i+vec2(1,1)),f.x),f.y);}
  float cloudFbm(vec2 p){float n=0.,a=.52;mat2 turn=mat2(.80,-.60,.60,.80);for(int i=0;i<5;i++){n+=a*weatherNoise(p);p=turn*p*2.07+vec2(7.1,3.9);a*=.49;}return n;}
  vec3 weatherSky(vec3 base,vec3 direction,vec2 uv,vec3 sun){
    float night=1.-smoothstep(-.12,.13,sun.y);
    vec3 nightColor=mix(vec3(.009,.019,.039),vec3(.0014,.0032,.009),pow(max(direction.y,0.),.4));
    vec2 cell=uv*vec2(800.,400.);float starSeed=weatherHash(floor(cell));
    float starAA=max(fwidth(cell.x),fwidth(cell.y));
    vec2 starCenter=.25+.5*vec2(weatherHash(floor(cell)+23.1),weatherHash(floor(cell)-17.8));
    float star=1.-smoothstep(.045,.11+starAA*.23,length(fract(cell)-starCenter));
    star*=step(.9965,starSeed)*smoothstep(.01,.25,direction.y);
    nightColor+=vec3(.75,.86,1.)*star*1.4*smoothstep(.12,.40,-sun.y);
    float moonDot=max(dot(direction,moonDirection),0.);
    float moon=smoothstep(.99978,.99985,moonDot);
    float crater=.72+.28*weatherNoise(direction.xz*800.);
    nightColor+=vec3(.75,.83,1.0)*(moon*crater*2.4+pow(moonDot,260.)*.035);
    float twilight=exp(-abs(sun.y)*13.);
    vec3 dayTint=mix(vec3(.12,.18,.27),vec3(.50,.34,.25),twilight);
    vec3 c=mix(base*dayTint,nightColor,night);
    float facing=pow(max(dot(normalize(vec3(direction.x,0.,direction.z)),normalize(vec3(sun.x,0.,sun.z))),0.),4.);
    c+=(vec3(.36,.063,.012)*facing+vec3(.045,.012,.035))*twilight*exp(-max(direction.y,0.)*6.);
    float storm=max(rainAmount,snowAmount*.8);
    c=mix(c,mix(vec3(.009,.015,.025),vec3(.25,.30,.34),daylight),storm*.67);
    // Fixed world-space cloud layers. Looking around changes the perspective,
    // never their orientation. Ray-plane intersections give natural parallax.
    float horizon=smoothstep(.015,.10,direction.y);
    vec2 p=direction.xz/max(direction.y,.035)*.70+cloudOrigin;
    float n=cloudFbm(p+cloudFbm(p*.42)*1.25);
    float thin=cloudFbm(p*2.0+12.7);
    float density=smoothstep(.70-cloudCover*.32,.85-cloudCover*.32,n+thin*.12);
    density=1.-exp(-density*(2.2+storm*3.5));
    density=max(density,storm*.45);
    float shade=clamp(.5+(n-cloudFbm(p+sun.xz*.40))*3.3,.06,1.);
    float sunset=(1.-smoothstep(.03,.30,abs(sun.y)))*(1.-night);
    vec3 lit=mix(vec3(1.15,1.18,1.16),vec3(1.35,.59,.22),sunset*.8);
    vec3 cloudColor=mix(vec3(.19,.24,.29),lit,shade);
    cloudColor=mix(cloudColor,vec3(.20,.24,.28)+shade*.22,storm*.76);
    cloudColor*=mix(.028,1.,daylight);
    cloudColor+=vec3(.007,.011,.020)*(1.-daylight);
    c=mix(c,cloudColor,density*horizon);
    return max(c,vec3(0.));
  }
`;

export function createAtmosphere({renderer,scene,sunlight,hemisphere,sunDir}){
  const state={...defaults,rain:0,snow:0,elapsed:0};
  const skyScene=new THREE.Scene();
  const sky=new Sky();sky.scale.setScalar(450);skyScene.add(sky);
  const uniforms=sky.material.uniforms;
  uniforms.rayleigh.value=2.6;uniforms.turbidity.value=2.1;uniforms.mieCoefficient.value=.004;uniforms.mieDirectionalG.value=.80;
  Object.assign(uniforms,{daylight:{value:1},cloudCover:{value:.33},rainAmount:{value:0},snowAmount:{value:0},cloudOrigin:{value:new THREE.Vector2()},moonDirection:{value:new THREE.Vector3()}});
  sky.material.fragmentShader=skyFunctions+sky.material.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );','gl_FragColor = vec4( weatherSky(retColor,direction,uv,vSunDirection), 1.0 );');
  // One reusable HDR cubemap feeds both the visible sky and the ocean sampler.
  const cubeTarget=new THREE.WebGLCubeRenderTarget(512,{type:THREE.HalfFloatType,generateMipmaps:true,minFilter:THREE.LinearMipmapLinearFilter});
  const cubeCamera=new THREE.CubeCamera(.1,1000,cubeTarget);
  const pmrem=new THREE.PMREMGenerator(renderer);pmrem.compileCubemapShader();let filteredTarget;
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
    uniforms.cloudOrigin.value.set(camera.position.x*.00016+state.elapsed*.004,camera.position.z*.00016+state.elapsed*.001);
    if(dirty||Math.abs(state.hour-lastHour)>.02||state.elapsed-lastCapture>=.75||camera.position.distanceTo(lastPosition)>200){
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

function createPrecipitation(){
  const commonVertex=`
    #include <common>
    #include <logdepthbuf_pars_vertex>
    uniform vec3 center;uniform float elapsed;uniform float wind;uniform float sizeScale;
    varying float visibility;
  `;
  const commonFragment=`
    #include <logdepthbuf_pars_fragment>
    uniform float amount;uniform float daylight;varying float visibility;
  `;
  function makeUniforms(){return {center:{value:new THREE.Vector3()},elapsed:{value:0},wind:{value:1},amount:{value:0},daylight:{value:1},sizeScale:{value:900}};}
  let seed=4291;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const drops=[],tips=[];
  for(let i=0;i<2600;i++){const p=[rand()*150,rand()*100,rand()*150];drops.push(...p,...p);tips.push(0,1);}
  const rg=new THREE.BufferGeometry();rg.setAttribute('position',new THREE.Float32BufferAttribute(drops,3));rg.setAttribute('tip',new THREE.Float32BufferAttribute(tips,1));
  const rm=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:makeUniforms(),vertexShader:commonVertex+`
    attribute float tip;void main(){
      vec3 world=vec3(mod(position.x+elapsed*wind*9.-center.x,150.)-75.,mod(position.y-elapsed*48.-center.y,100.)-50.,mod(position.z+elapsed*4.-center.z,150.)-75.)+center;
      world+=vec3(-wind*.16,1.15,0.)*tip;
      visibility=(1.-smoothstep(30.,82.,distance(world,center)))*(.6+.4*tip);
      gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);
      #include <logdepthbuf_vertex>
    }`,fragmentShader:commonFragment+`void main(){
      #include <logdepthbuf_fragment>
      gl_FragColor=vec4(mix(vec3(.30,.40,.53),vec3(.72,.81,.89),daylight),amount*visibility*.43);
    }`});
  const rain=new THREE.LineSegments(rg,rm);rain.frustumCulled=false;rain.renderOrder=3;
  const flakes=[];for(let i=0;i<1800;i++)flakes.push(rand()*130,rand()*90,rand()*130);
  const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(flakes,3));
  const sm=new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:makeUniforms(),vertexShader:commonVertex+`
    void main(){
      vec3 world=vec3(mod(position.x+elapsed*wind*2.+sin(elapsed+position.y)*1.2-center.x,130.)-65.,mod(position.y-elapsed*4.2-center.y,90.)-45.,mod(position.z+elapsed*.8+cos(elapsed*.6+position.y)-center.z,130.)-65.)+center;
      vec4 mv=viewMatrix*vec4(world,1.);gl_Position=projectionMatrix*mv;
      gl_PointSize=clamp(sizeScale*(.12+fract(position.x)*.14)/max(-mv.z,1.),1.5,11.);
      visibility=1.-smoothstep(32.,68.,distance(world,center));
      #include <logdepthbuf_vertex>
    }`,fragmentShader:commonFragment+`void main(){
      #include <logdepthbuf_fragment>
      float r=length(gl_PointCoord-.5);float alpha=1.-smoothstep(.12,.5,r);if(alpha<.02)discard;
      gl_FragColor=vec4(mix(vec3(.48,.57,.72),vec3(.95,.97,1.),daylight),alpha*amount*visibility*.92);
    }`});
  const snow=new THREE.Points(sg,sm);snow.frustumCulled=false;snow.renderOrder=4;
  return {rain,snow,update(center,time,r,s,daylight,wind){for(const [object,amount] of [[rain,r],[snow,s]]){object.visible=amount>.002;const u=object.material.uniforms;u.center.value.copy(center);u.elapsed.value=time;u.amount.value=amount;u.daylight.value=daylight;u.wind.value=wind;u.sizeScale.value=innerHeight;}}};
}
