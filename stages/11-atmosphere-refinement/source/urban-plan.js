import {CITY,shoreZ} from './city-layout.js';
// Connected, irregular street graph. Each block uses the same junction vertices
// as the roads; its inset polygon defines the buildable area and pavements.
export function cityPoint(u,v){return [CITY.x+u+65*Math.sin(v*.006)+u*.15*Math.sin(v*.003),CITY.z+v-170+65*Math.sin(u*.004)+.14*u+40*Math.sin(v*.006+u*.002)];}
export const junctions=Array.from({length:7},(_,i)=>Array.from({length:6},(_,j)=>cityPoint((i-3)*176,(j-2.5)*176)));
export function inset(poly,d){
 return poly.map((p,i)=>{const prev=poly[(i+poly.length-1)%poly.length],next=poly[(i+1)%poly.length];
  const edge=(a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),nx=-dz/l,nz=dx/l;return [nx,nz,nx*a[0]+nz*a[1]+d];};
  const a=edge(prev,p),b=edge(p,next),det=a[0]*b[1]-a[1]*b[0];return [(a[2]*b[1]-a[1]*b[2])/det,(a[0]*b[2]-a[2]*b[0])/det];
 });
}
export function inside(p,poly){return poly.every((a,i)=>{const b=poly[(i+1)%poly.length];return (b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0])>=-.001;});}
export function rectangle(x,z,w,d,angle=0){return [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([u,v])=>[x+Math.cos(angle)*u+Math.sin(angle)*v,z-Math.sin(angle)*u+Math.cos(angle)*v]);}
export function mixQuad(poly,u,v){return [(1-v)*((1-u)*poly[0][0]+u*poly[1][0])+v*((1-u)*poly[3][0]+u*poly[2][0]),(1-v)*((1-u)*poly[0][1]+u*poly[1][1])+v*((1-u)*poly[3][1]+u*poly[2][1])];}
export const coast=Array.from({length:121},(_,i)=>{const x=CITY.x-640+i*1320/120;return [x,shoreZ(x)-30];});
