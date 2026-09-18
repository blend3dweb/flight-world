import * as THREE from './vendor/three.module.js';

// Approximate high-wing light seaplane, in metres, with the nose along local -Z.
export function createAircraft(){
  const aircraft=new THREE.Group();aircraft.name='AERO 042 seaplane';
  const ivory=new THREE.MeshStandardMaterial({color:'#efeadd',metalness:.22,roughness:.38});
  const gold=new THREE.MeshStandardMaterial({color:'#d8ad42',metalness:.24,roughness:.4});
  const dark=new THREE.MeshStandardMaterial({color:'#253235',metalness:.45,roughness:.4});
  const frame=new THREE.MeshStandardMaterial({color:'#dadbd2',metalness:.55,roughness:.28});
  const glass=new THREE.MeshPhysicalMaterial({color:'#41636d',metalness:.25,roughness:.18,transparent:true,opacity:.82,side:THREE.DoubleSide});
  function mesh(geometry,material,parent=aircraft){const m=new THREE.Mesh(geometry,material);parent.add(m);return m;}
  function box(size,pos,material=ivory,parent=aircraft){const m=mesh(new THREE.BoxGeometry(...size),material,parent);m.position.set(...pos);return m;}
  function rod(a,b,r=.025,material=frame,parent=aircraft){
    const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),direction=end.clone().sub(start);
    const m=mesh(new THREE.CylinderGeometry(r,r,direction.length(),10),material,parent);
    m.position.copy(start).add(end).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());return m;
  }
  function polygon(points,material=glass){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(points.flat(),3));
    const indices=[];for(let i=1;i<points.length-1;i++)indices.push(0,i,i+1);
    geometry.setIndex(indices);geometry.computeVertexNormals();return mesh(geometry,material);
  }
  function loft(rings,material,parent=aircraft){
    const positions=[],indices=[],segments=40;
    for(const [z,width,height,centerY] of rings)for(let i=0;i<=segments;i++){
      const a=i/segments*Math.PI*2;positions.push(Math.cos(a)*width,centerY+Math.sin(a)*height,z);
    }
    for(let k=0;k<rings.length-1;k++)for(let i=0;i<segments;i++){
      const a=k*(segments+1)+i,b=a+segments+1;indices.push(a,a+1,b,a+1,b+1,b);
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();return mesh(geo,material,parent);
  }
  loft([[-3.95,.02,.02,0],[-3.72,.39,.37,0],[-3.0,.56,.48,0],[-1.7,.65,.55,0],[.35,.65,.53,0],[1.15,.48,.41,.02],[2.6,.24,.24,.13],[4.05,.07,.12,.25],[4.3,0,0,.26]],ivory);
  // Painted lower cowling and an uninterrupted side stripe.
  loft([[-3.88,.04,.035,-.12],[-3.6,.36,.26,-.13],[-2.7,.54,.31,-.18],[-1.72,.60,.30,-.23],[-1.65,0,0,-.25]],gold);
  for(const side of [-1,1]){
    polygon([[side*.654,-.08,-1.65],[side*.654,-.20,.25],[side*.247,.035,2.6],[side*.1,.15,3.75],[side*.25,.105,2.6],[side*.655,-.04,.25]],gold);
  }
  // Raised cabin, divided windshield and side windows beneath the high wing.
  box([1.14,.53,1.9],[0,.47,-.62],dark);
  polygon([[-.61,.35,-1.75],[.61,.35,-1.75],[.5,1.04,-1.03],[-.5,1.04,-1.03]]);
  rod([0,.35,-1.76],[0,1.06,-1.035],.026,ivory);
  for(const side of [-1,1]){
    polygon([[side*.627,.27,-1.60],[side*.51,1.045,-1.03],[side*.56,1.015,-.12],[side*.657,.26,-.12]]);
    polygon([[side*.658,.26,-.04],[side*.56,1.015,-.04],[side*.52,.9,.58],[side*.61,.25,.71]]);
    rod([side*.66,.25,-.08],[side*.56,1.025,-.08],.03,ivory);
    rod([side*.627,.27,-1.6],[side*.51,1.045,-1.03],.033,ivory);
    rod([side*.61,.25,.71],[side*.52,.9,.58],.032,ivory);
    rod([side*.51,1.045,-1.03],[side*.52,.9,.58],.035,ivory);
    box([.025,.035,.16],[side*.659,.17,-.30],dark);
  }
  polygon([[-.52,.9,.58],[.52,.9,.58],[.48,.3,1.1],[-.48,.3,1.1]]);
  // Airfoil cross sections with closed ends and tapered tips.
  function wing(x0,x1,z,y,chord0,chord1,material){
    const profile=[[-.5,0],[-.43,.065],[-.23,.095],[.05,.067],[.5,.005],[.25,-.026],[-.16,-.035],[-.43,-.022]];
    const vertices=[],indices=[];
    for(const [x,chord] of [[x0,chord0],[x1,chord1]])for(const [pz,py] of profile)vertices.push(x,y+py*chord+Math.abs(x)*.017,z+pz*chord);
    const n=profile.length;
    for(let i=0;i<n;i++){const next=(i+1)%n;indices.push(i,next,i+n,next,next+n,i+n);}
    for(let i=1;i<n-1;i++){indices.push(0,i+1,i,n,n+i,n+i+1);}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setIndex(indices);geo.computeVertexNormals();
    const m=mesh(geo,material);m.material.side=THREE.DoubleSide;return m;
  }
  wing(-5.3,5.3,-.50,1.12,1.62,1.62,ivory);
  wing(-5.85,-5.3,-.50,1.12,1.26,1.62,gold);wing(5.3,5.85,-.50,1.12,1.62,1.26,gold);
  wing(-1.85,1.85,3.13,.32,.9,.9,ivory);wing(-2.13,-1.85,3.13,.32,.57,.9,gold);wing(1.85,2.13,3.13,.32,.9,.57,gold);
  const finShape=new THREE.Shape();finShape.moveTo(2.58,.32);finShape.lineTo(3.23,1.9);finShape.lineTo(3.74,1.88);finShape.lineTo(4.13,.34);finShape.closePath();
  const finGeo=new THREE.ExtrudeGeometry(finShape,{depth:.10,bevelEnabled:true,bevelSize:.035,bevelThickness:.025,bevelSegments:1,steps:1});
  // Shape coordinates (z,y) become local aircraft coordinates (x,y,z).
  const fp=finGeo.attributes.position;for(let i=0;i<fp.count;i++){const z=fp.getX(i),y=fp.getY(i),x=fp.getZ(i)-.05;fp.setXYZ(i,x,y,z);}finGeo.computeVertexNormals();mesh(finGeo,ivory).material.side=THREE.DoubleSide;
  const tailCap=box([.115,.18,.48],[0,1.78,3.48],gold);tailCap.rotation.x=.035;
  for(const side of [-1,1]){
    rod([side*.53,-.23,-.44],[side*3.95,1.17,-.48],.038,frame);
    rod([side*.53,-.20,.46],[side*3.95,1.17,-.03],.024,frame);
    // Separate flap and aileron hinge lines on the wing surface.
    rod([side*.95,1.2,.18],[side*3.0,1.235,.18],.009,dark);
    rod([side*3.15,1.24,.18],[side*5.2,1.275,.18],.009,dark);
    const nav=mesh(new THREE.SphereGeometry(.065,10,8),new THREE.MeshBasicMaterial({color:side<0?'#e74b3c':'#79d995'}));nav.position.set(side*5.78,1.24,-.55);
  }
  // Twin floats, attachment struts, dark step and small water rudders.
  const floatMat=new THREE.MeshStandardMaterial({color:'#bdc6c3',metalness:.52,roughness:.35});
  for(const side of [-1,1]){
    const floatGroup=new THREE.Group();floatGroup.position.set(side*1.1,-1.62,0);aircraft.add(floatGroup);
    loft([[-3.6,0,0,.20],[-3.15,.27,.23,.10],[-2.1,.36,.31,0],[.25,.37,.32,0],[.52,.34,.20,.05],[2.2,.26,.18,.05],[2.85,.07,.12,.12],[3.0,0,0,.13]],floatMat,floatGroup);
    box([.57,.035,4.2],[0,.26,-.2],dark,floatGroup);
    for(const z of [-1.6,.8])rod([side*.50,-.32,z+.25],[side*1.1,-1.36,z],.045,frame);
    box([.055,.42,.34],[side*1.1,-1.82,2.62],dark);
  }
  rod([-1.1,-1.38,-1.3],[1.1,-1.38,-1.3],.03,frame);rod([-1.1,-1.38,1.0],[1.1,-1.38,1.0],.03,frame);
  const propeller=new THREE.Group();propeller.position.set(0,0,-3.93);aircraft.add(propeller);
  for(let i=0;i<3;i++){
    const bladeGroup=new THREE.Group();bladeGroup.rotation.z=i*Math.PI*2/3;propeller.add(bladeGroup);
    const blade=box([.145,1.37,.047],[0,.78,0],dark,bladeGroup);blade.rotation.y=.24;
    box([.15,.12,.05],[0,1.40,0],gold,bladeGroup);
  }
  const disc=mesh(new THREE.CircleGeometry(1.48,64),new THREE.MeshBasicMaterial({color:'#889291',transparent:true,opacity:.075,side:THREE.DoubleSide,depthWrite:false}),propeller);
  const spinner=mesh(new THREE.ConeGeometry(.24,.46,32),gold);spinner.rotation.x=-Math.PI/2;spinner.position.set(0,0,-4.10);
  // Registration decals are attached to the airframe, never camera-facing.
  const label=document.createElement('canvas');label.width=512;label.height=128;const lc=label.getContext('2d');
  lc.fillStyle='#263837';lc.font='bold 68px Arial';lc.textAlign='center';lc.textBaseline='middle';lc.fillText('AERO 042',256,64);
  const labelTex=new THREE.CanvasTexture(label);labelTex.colorSpace=THREE.SRGBColorSpace;
  const labelMat=new THREE.MeshBasicMaterial({map:labelTex,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1});
  for(const side of [-1,1]){const decal=mesh(new THREE.PlaneGeometry(1.06,.265),labelMat);decal.rotation.y=side*Math.PI/2;decal.position.set(side*.448,.12,1.42);}
  return {aircraft,propeller};
}
