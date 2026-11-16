const THIGH=.50,SHIN=.56,ANKLE=.13;

export function poseOfficeAvatar(v,standing,time=0,moving=false,activity=null){
 const lift=standing?(moving?.14+Math.sin(time*11.8)*.012:.20):0;
 v.body.position.y=lift;
 v.legs.forEach((hip,i)=>{
  let footZ=standing?0:-.45,footY=ANKLE,toe=0;
  if(moving){
   const phase=((time*.94+i*.5)%1+1)%1,stride=.36;
   if(phase<.5)footZ=-stride+4*stride*phase;
   else{const swing=(phase-.5)*2,smooth=swing*swing*(3-2*swing);footZ=stride-2*stride*smooth;footY+=Math.sin(Math.PI*swing)*.12;toe=Math.sin(Math.PI*swing)*.12;}
  }
  const hipY=.96+lift,dy=footY-hipY,dz=footZ;
  const distance=Math.min(THIGH+SHIN-.0001,Math.max(.001,Math.hypot(dy,dz)));
  const along=(THIGH*THIGH-SHIN*SHIN+distance*distance)/(2*distance),bend=Math.sqrt(Math.max(0,THIGH*THIGH-along*along));
  const kneeY=hipY+dy/distance*along-dz/distance*bend,kneeZ=dz/distance*along+dy/distance*bend;
  const upperAngle=Math.atan2(-kneeZ,hipY-kneeY),lowerAngle=Math.atan2(-(footZ-kneeZ),kneeY-footY);
  hip.position.set(i===0?-.155:.155,hipY,0);hip.rotation.x=upperAngle;
  v.knees[i].rotation.x=lowerAngle-upperAngle;
  v.feet[i].rotation.x=-lowerAngle+toe;
 });
 v.arms.forEach((arm,i)=>arm.rotation.x=moving?Math.sin(time*5.9+i*Math.PI)*.25:activity==='coffee'?(i===1?-1.1:0):standing?.02:-.35);
 v.cup.visible=activity==='coffee';v.can.visible=activity==='plant';v.can.rotation.z=v.can.visible?Math.sin(time*.8)*.12-.3:0;
}

export function createOfficeAvatar(T,parent,a){
 const person=new T.Group();person.position.set(0,0,1.13);parent.add(person);
 const body=new T.Group();person.add(body);const legs=[],knees=[],feet=[],arms=[],hands=[];
 const materials=new Map(),material=color=>{if(!materials.has(color))materials.set(color,new T.MeshStandardMaterial({color,roughness:.72}));return materials.get(color)};
 const box=(p,w,h,d,x,y,z,color)=>{const mesh=new T.Mesh(new T.BoxGeometry(w,h,d),material(color));mesh.position.set(x,y,z);mesh.castShadow=mesh.receiveShadow=true;p.add(mesh);return mesh};
 const cylinder=(p,top,bottom,h,x,y,z,color)=>{const mesh=new T.Mesh(new T.CylinderGeometry(top,bottom,h,20),material(color));mesh.position.set(x,y,z);mesh.castShadow=true;p.add(mesh);return mesh};
 box(body,.45,.51,.29,0,1.25,0,a.color);box(body,.48,.12,.36,0,.96,-.08,a.color);
 for(const side of [-1,1]){
  const hip=new T.Group();person.add(hip);legs.push(hip);
  box(hip,.145,THIGH,.17,0,-THIGH/2,0,'#4e5561');
  const knee=new T.Group();knee.position.y=-THIGH;hip.add(knee);knees.push(knee);
  box(knee,.125,SHIN,.145,0,-SHIN/2,0,'#4e5561');
  const foot=new T.Group();foot.position.y=-SHIN;knee.add(foot);feet.push(foot);
  box(foot,.18,.12,.33,0,-.01,-.075,'#393f48');box(foot,.185,.025,.34,0,-.066,-.075,'#292f37');
  const arm=box(body,.12,.4,.14,side*.29,1.22,-.08,a.color);arms.push(arm);
  const hand=new T.Mesh(new T.SphereGeometry(.075,12,10),material('#d7b18b'));hand.position.set(side*.29,1.02,-.16);body.add(hand);hands.push(hand);
 }
 cylinder(body,.085,.085,.13,0,1.56,0,'#d7b18b');
 const head=new T.Mesh(new T.SphereGeometry(.21,20,16),material('#d7b18b'));head.scale.set(.86,1.12,.91);head.position.set(0,1.81,0);head.castShadow=true;body.add(head);
 const hair=new T.Mesh(new T.SphereGeometry(.216,20,12,0,Math.PI*2,0,Math.PI*.62),material('#3d3c31'));hair.scale.set(.88,1.13,.94);hair.position.copy(head.position);body.add(hair);
 if(['linh','my'].includes(a.id)){const tail=new T.Mesh(new T.SphereGeometry(.13,12,10),material('#3d3c31'));tail.scale.set(.7,1.3,.8);tail.position.set(0,1.7,.2);body.add(tail)}
 if(a.id==='hung'){const hat=new T.Mesh(new T.SphereGeometry(.235,16,10,0,Math.PI*2,0,Math.PI/2),material('#c6a64e'));hat.position.set(0,1.91,0);body.add(hat);cylinder(body,.27,.27,.035,0,1.91,0,'#c6a64e')}
 for(const side of [-1,1]){const eye=new T.Mesh(new T.SphereGeometry(.016,8,6),material('#3e4034'));eye.position.set(side*.075,1.84,-.174);body.add(eye)}
 const cup=new T.Group();body.add(cup);cylinder(cup,.075,.06,.13,0,0,0,'#e4d7b4');cylinder(cup,.062,.062,.012,0,.068,0,'#5c4735');cup.position.set(.29,1.48,-.18);
 const can=new T.Group();can.position.set(-.30,1.03,-.18);body.add(can);cylinder(can,.11,.11,.18,0,0,0,'#9baf8b');box(can,.28,.035,.035,-.17,.02,0,'#9baf8b').rotation.z=.3;
 const avatar={person,body,legs,knees,feet,arms,hands,head,cup,can};poseOfficeAvatar(avatar,false);return avatar;
}
