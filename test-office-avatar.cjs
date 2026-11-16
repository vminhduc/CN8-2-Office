const assert=require('assert/strict');
(async()=>{
 const T=await import('./vendor/three.module.js'),{createOfficeAvatar,poseOfficeAvatar}=await import('./office-avatar.js');
 const parent=new T.Group(),v=createOfficeAvatar(T,parent,{id:'linh',color:'#668877'}),point=o=>o.getWorldPosition(new T.Vector3());
 function check(standing,time,moving){
  poseOfficeAvatar(v,standing,time,moving);parent.updateMatrixWorld(true);
  for(let i=0;i<2;i++){
   const hip=point(v.legs[i]),knee=point(v.knees[i]),foot=point(v.feet[i]);
   assert(Math.abs(hip.distanceTo(knee)-.50)<1e-9,'Thigh length changed');
   assert(Math.abs(knee.distanceTo(foot)-.56)<1e-9,'Shin length changed');
   const phase=((time*.94+i*.5)%1+1)%1,swing=moving&&phase>=.5;
   assert(foot.y>=.13-1e-9&&foot.y<=.251,'Foot left expected floor/step height');
   if(!swing){assert(Math.abs(foot.y-.13)<1e-9,'Planted foot floats');const up=new T.Vector3(0,1,0).applyQuaternion(v.feet[i].getWorldQuaternion(new T.Quaternion()));assert(up.y>.999999,'Planted shoe tilts');}
  }
 }
 check(false,0,false);check(true,0,false);
 let previous=null;for(let frame=0;frame<600;frame++){check(true,frame/120,true);const feet=v.feet.map(point);if(previous)feet.forEach((p,i)=>assert(p.distanceTo(previous[i])<.035,'Foot jumps between frames'));previous=feet;}
 console.log('PASS articulated leg lengths, seated/standing feet on floor, alternating planted/swing feet and continuous 5-second gait.');
})().catch(error=>{console.error(error);process.exit(1)});
