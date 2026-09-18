import * as T from './vendor/three.module.js';
import {attribute,uv,normalGeometry,varying,vec2,vec3,mix,smoothstep,fract,floor,sin,dot,step,color,materialEmissive,fwidth} from './vendor/tsl.js';
export function makeFacade(i,density){
 const material=new T.MeshStandardNodeMaterial({color:['#77a5ad','#b9d2cf','#dfd9c4','#6d9da7'][i],roughness:i===2?.65:.29,metalness:i===2?.08:.42,emissive:'#ffca80',emissiveIntensity:0});
 const size=attribute('facadeSize','vec3'),seed=varying(attribute('facadeSeed','vec2'));
 const width=i===3?size.x.mul(Math.PI*2):mix(size.x,size.z,step(.5,normalGeometry.x.abs()));
 const facade=varying(uv().mul(vec2(width,size.y))),grid=facade.div(vec2(2.9,3.8)),cell=fract(grid),aa=fwidth(grid).mul(1.2);
 const win=smoothstep(vec2(.10,.20).sub(aa),vec2(.10,.20).add(aa),cell).mul(vec2(1).sub(smoothstep(vec2(.87,.91).sub(aa),vec2(.87,.91).add(aa),cell)));
 const mask=win.x.mul(win.y),occupied=step(density.oneMinus(),fract(sin(dot(floor(grid).add(floor(seed)),vec2(12.9898,78.233))).mul(43758.5453)));
 material.colorNode=color(material.color).mul(mix(vec3(1.18),vec3(.31,.53,.62),mask));
 material.emissiveNode=materialEmissive.mul(mask).mul(occupied);
 material.userData.windowMask=mask.mul(occupied);
 return material;
}
