const assert=require('assert/strict'),{createCanvas}=require('@napi-rs/canvas');
(async()=>{
 const T=await import('./vendor/three.module.js'),{createOfficeLife}=await import('./office-life.js'),{createOfficeAvatar}=await import('./office-avatar.js'),roster=require('./team.json');
 global.document={createElement:()=>createCanvas(512,220)};
 const scene=new T.Scene(),desks=[];for(let i=0;i<10;i++){const group=new T.Group();group.scale.set(.76,.9,.78);group.position.set(i===9?6.4:-4.6+(i%3)*3.5,0,i===9?-3.7:-.9+Math.floor(i/3)*3.15);if(i===9)group.rotation.y=Math.PI;scene.add(group);const sprite=new T.Sprite(new T.SpriteMaterial()),canvas=createCanvas(384,128);group.add(sprite);const avatar=createOfficeAvatar(T,group,{id:'test',color:'#668877'});desks.push({group,avatar,tag:{sprite,tex:{canvas,ctx:canvas.getContext('2d'),texture:{needsUpdate:false}},key:''}})}
 let ownerPending=2;const busy=new Set(['my']),life=createOfficeLife(T,scene,desks,roster,a=>({text:busy.has(a.id)?'Đang xử lý':'Sẵn sàng',pendingCount:a.isOwner?ownerPending:0})),base=performance.now()/1000;let moved=false;
 for(let i=0;i<2400;i++){const time=base+i*.05;if(i===300)busy.add('hung');life.tick(time,true);for(const a of life.activities){const [x,y,z]=a.position;assert(x>=-11.2&&x<=5&&z>=-4.3&&z<=7.9);if(a.name==='My')assert.equal(a.state,'seated');if(a.state!=='seated')moved=true;for(let j=0;j<9;j++){const dx=-4.6+(j%3)*3.5,dz=-.9+Math.floor(j/3)*3.15;assert(!(Math.abs(x-dx)<1.15&&Math.abs(z-dz)<.70),'Avatar crossed a desk: '+a.name)}}}
 const ownerBubble=desks[9].group.children.find(o=>o.isSprite&&o.userData.action==='desk');assert(ownerBubble.visible);ownerPending=0;life.tick(base+121,true);assert.equal(ownerBubble.visible,false);
 assert(moved);assert.equal(life.activities.find(a=>a.name==='Hùng').state,'seated');assert(desks[5].avatar.person.children.some(o=>o.isSprite&&o.visible));
 console.log('PASS 8 idle actors, busy agents stay/return to seats, thinking cloud visible, office boundaries and desk-free walking paths over 120 simulated seconds.');
})().catch(e=>{console.error(e);process.exit(1)});
