import * as T from './vendor/three.module.js';
import {uniform,positionWorld,positionGeometry,modelWorldMatrix,cameraPosition,cameraViewMatrix,vec2,vec3,vec4,mix,screenUV,cubeTexture,reflect,normalize,dot,pow,texture,reflector,wgslFn,smoothstep,uv} from './vendor/tsl.js';
import {noise2} from './sky-nodes.js';
// The same world-space spectrum drives the surface and its normals. Suppress
// wavelengths smaller than the mesh/pixel footprint instead of aliasing them.
const waveField=wgslFn(`fn waveField(p:vec2f,t:f32,wind:f32,footprint:f32)->vec3f{
 var result=vec3f(0.);
 for(var i=0;i<8;i++){
  let fi=f32(i);let angle=.43+sin(fi*2.39996)*1.8;let direction=vec2f(cos(angle),sin(angle));
  let len=96./pow(2.17,fi);let k=6.283185/len;
  let band=1.-smoothstep(len*.15,len*.5,footprint);
  let a=.46/pow(2.10,fi)*(.7+wind*.65)*band;
  let crossDirection=vec2f(-direction.y,direction.x);
  let warp=dot(p,crossDirection)*k*.33+fi*1.7;
  let phase=dot(p,direction)*k+.9*sin(warp)-t*sqrt(9.81*k)+fi*1.31;
  let gradient=(direction+crossDirection*.297*cos(warp))*k;
  result+=vec3f(gradient.x*a*cos(phase),a*sin(phase),gradient.y*a*cos(phase));
 }
 return result;
}`);
const pixelFootprint=wgslFn(`fn pixelFootprint(p:vec2f)->f32{return max(length(dpdx(p)),length(dpdy(p)));}`);
function heightTexture(ground,size,bounds){
 const data=new Uint16Array(size*size);const [x,z,w,h]=bounds;
 for(let j=0;j<size;j++)for(let i=0;i<size;i++)data[j*size+i]=T.DataUtils.toHalfFloat(ground(x+(i+.5)/size*w,z+(j+.5)/size*h));
 const map=new T.DataTexture(data,size,size,T.RedFormat,T.HalfFloatType);map.minFilter=map.magFilter=T.LinearFilter;map.needsUpdate=true;return map;
}
export function createOcean({scene,atmosphere,sunDir,ground}){
 const uniforms={time:uniform(0),sun:uniform(sunDir),eye:uniform(new T.Vector3()),daylight:uniform(1),rainAmount:uniform(0),snowAmount:uniform(0),wind:uniform(1),fogDensity:uniform(.000032),reflectionStrength:uniform(1)};
 const globalBounds=[-15000,-24000,32000,32000],localBounds=[-4000,-4000,4300,4300];
 const heightMap=heightTexture(ground,1024,globalBounds),coastMap=heightTexture(ground,768,localBounds);
 const heightAt=(p)=>{const localUV=p.sub(vec2(...localBounds.slice(0,2))).div(4300),edge=localUV.sub(.5).abs().x.max(localUV.sub(.5).abs().y),weight=edge.smoothstep(.46,.49).oneMinus();return mix(texture(heightMap,p.sub(vec2(-15000,-24000)).div(32000)).r,texture(coastMap,localUV).r,weight);};
 const t=uniforms.time,world=modelWorldMatrix.mul(vec4(positionGeometry,1)).xyz;
 const depth=heightAt(positionWorld.xz).negate();
 const field=(p,footprint)=>waveField({p,t,wind:uniforms.wind,footprint});
 const dist=cameraPosition.distance(positionWorld),footprint=pixelFootprint({p:positionWorld.xz});
 const calm=smoothstep(0,10,depth),slope=field(positionWorld.xz,footprint);
 const n=normalize(vec3(slope.x.negate().mul(calm),1,slope.z.negate().mul(calm)));
 const v=normalize(cameraPosition.sub(positionWorld));
 const fresnel=pow(dot(n,v).max(0).oneMinus(),5).mul(uniforms.rainAmount.mul(-.08).add(.72)).add(.02);
 const roughLod=uniforms.rainAmount.mul(1.25).add(1.15).add(smoothstep(100,3500,dist).mul(1.4));
 const sky=cubeTexture(atmosphere.cubeTarget.texture,reflect(v.negate(),n)).level(roughLod.add(.8));
 const planar=reflector({resolutionScale:.5,bounces:false,samples:1,generateMipmaps:true});
 planar.reflector.updateBeforeType='render';planar.target.rotation.x=-Math.PI/2;scene.add(planar.target);
 // Project the normal into the current view so ripples follow camera heading.
 const viewSlope=cameraViewMatrix.mul(vec4(n.x,0,n.z,0)).xyz;
 const distortion=vec2(viewSlope.x.negate(),viewSlope.z.mul(.65)).mul(.055).mul(smoothstep(600,5000,dist).oneMinus());
 planar.uvNode=screenUV.flipX().add(distortion).clamp(.002,.998);
 const reflected=mix(sky,planar.level(roughLod),smoothstep(1800,6500,dist).oneMinus().mul(uniforms.reflectionStrength));
 // Absorption varies by channel; the same bathymetry used for displacement
 // exposes warm sand in the shallows without drawing a flat turquoise ring.
 const transmission=vec3(.18,.075,.045).mul(depth.max(0).negate()).exp();
 const water=mix(vec3(.006,.057,.084),vec3(.18,.28,.19),transmission).mul(uniforms.daylight.mul(.96).add(.04));
 const patches=noise2(positionWorld.xz.mul(.23).add(vec2(t.mul(.08),t.mul(-.05))));
 const shorePhase=depth.mul(3.7).sub(t.mul(1.15)).add(noise2(positionWorld.xz.mul(.07)).mul(3));
 const shore=shorePhase.sin().smoothstep(.25,.85).mul(patches.smoothstep(.28,.72)).mul(depth.max(0).mul(-.65).exp()).mul(depth.smoothstep(0,.18));
 const crest=slope.y.smoothstep(.6,1.1).mul(patches.smoothstep(.46,.74)).mul(uniforms.rainAmount).mul(calm).mul(.32);
 const foam=shore.mul(uniforms.rainAmount.mul(.4).add(.42)).add(crest).clamp(0,.75);
 const h=normalize(v.add(uniforms.sun)),nh=dot(n,h).max(0),a2=uniforms.rainAmount.mul(.10).add(.19).pow(4);
 const distribution=a2.div(nh.mul(nh).mul(a2.sub(1)).add(1).pow(2).mul(Math.PI));
 const glint=distribution.mul(.003).min(1.5).mul(uniforms.daylight).mul(dot(n,uniforms.sun).max(0)).mul(uniforms.rainAmount.oneMinus());
 const mat=new T.MeshBasicNodeMaterial();
 mat.colorNode=mix(mix(water,reflected,fresnel).add(vec3(1,.83,.62).mul(glint)),vec3(.65,.72,.70).mul(uniforms.daylight.mul(.95).add(.05)),foam);
 const grid=uv().sub(.5).mul(2).abs(),gridEdge=grid.x.max(grid.y);
 const meshFootprint=gridEdge.pow(3).mul(297600).add(650).div(96);
 mat.positionNode=positionGeometry.add(vec3(0,field(world.xz,meshFootprint).y.mul(smoothstep(0,10,heightAt(world.xz).negate())),0));
 mat.maskNode=depth.greaterThan(-.08);
 mat.uniforms=uniforms;
 const geo=new T.PlaneGeometry(2,2,192,192);geo.rotateX(-Math.PI/2);const p=geo.attributes.position;
 const warp=v=>Math.sign(v)*(Math.abs(v)*650+Math.pow(Math.abs(v),4)*74400);
 for(let i=0;i<p.count;i++){p.setX(i,warp(p.getX(i)));p.setZ(i,warp(p.getZ(i)));}geo.computeBoundingSphere();
 const ocean=new T.Mesh(geo,mat);ocean.name='Ocean — geometric waves and city reflection';ocean.frustumCulled=false;
 return {ocean,uniforms,planar,heightMap,coastMap,update(camera){ocean.position.set(camera.position.x,0,camera.position.z);},dispose(){geo.dispose();mat.dispose();planar.dispose();heightMap.dispose();coastMap.dispose();}};
}
