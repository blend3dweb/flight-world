// Shared terrain and infrastructure layout, in metres. Synthetic Oceania archipelago.
export const CITY={x:-2000,z:-1900,y:12,cols:6,rows:5,pitch:176,street:24};
export const AIRPORT={x:2500,z:-3200,y:28,runwayX:2730,runwayLength:1740};
export const PADS=[[-2000,-1900,710,1000,12],[2500,-3200,660,1250,28]];
export function padWeight(x,z,p){const d=Math.max(Math.abs(x-p[0])-p[2],Math.abs(z-p[1])-p[3]);const t=Math.max(0,Math.min(1,1-d/150));return t*t*(3-2*t);}
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
export function bridgeHeight(x){const t=Math.max(0,Math.min(1,(x+1472)/3452));return (1-t)*12+t*28+Math.sin(Math.PI*t)*10;}
export function shoreZ(x){const u=x+2010;return -1460+.00105*u*u+34*Math.sin(u*.008)+18*Math.sin(u*.018+.7);}
export function urbanHeight(x,z,h,index){
 if(index<2){const p=PADS[index],w=padWeight(x,z,p);h+=(p[4]-h)*w;
  if(index===0){const shore=shoreZ(x),bay=(1-smooth(710,940,Math.abs(x+2010)))*smooth(shore-28,shore+75,z);const bed=-12-Math.min(28,Math.max(0,z-shore)*.028);h+=(Math.min(h,bed)-h)*bay;}
  if(x>-1472&&x<2000){const corridor=1-smooth(18,65,Math.abs(z+1988));h+=(Math.min(h,bridgeHeight(x)-2)-h)*corridor;}
 }
 return h;
}
export function reservedLand(x,z){return PADS.some(p=>Math.abs(x-p[0])<p[2]+65&&Math.abs(z-p[1])<p[3]+65)||(x>-1510&&x<2020&&Math.abs(z+1988)<85);}
// Injected into the ocean shader so depth colouring follows exactly the modified coast.
export const URBAN_GLSL=`
 if(i<2){
  vec4 pad=i==0?vec4(-2000.,-1900.,710.,1000.):vec4(2500.,-3200.,660.,1250.);
  float d=max(abs(p.x-pad.x)-pad.z,abs(p.y-pad.y)-pad.w);
  float t=clamp(1.-d/150.,0.,1.);h=mix(h,i==0?12.:28.,t*t*(3.-2.*t));
  if(i==0){float u=p.x+2010.;float shore=-1460.+.00105*u*u+34.*sin(u*.008)+18.*sin(u*.018+.7);float bay=(1.-smoothstep(710.,940.,abs(u)))*smoothstep(shore-28.,shore+75.,p.y);float bed=-12.-min(28.,max(0.,p.y-shore)*.028);h=mix(h,min(h,bed),bay);}
  if(p.x>-1472.&&p.x<2000.){float t=clamp((p.x+1472.)/3452.,0.,1.);float y=mix(12.,28.,t)+sin(3.14159265359*t)*10.;h=mix(h,min(h,y-2.),1.-smoothstep(18.,65.,abs(p.y+1988.)));}
 }
`;
