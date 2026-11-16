const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{Readable}=require('stream'),{createRuntime}=require('./agent-runtime.cjs'),{createApp}=require('./server.cjs'),{createCanvas}=require('@napi-rs/canvas');
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5))}throw Error('Test timed out')}
(async()=>{
 fs.mkdirSync(path.join(__dirname,'.office-data'),{recursive:true});
 const directory=fs.mkdtempSync(path.join(__dirname,'.office-data/inbox-test-'));
 try{
  const invoke=async a=>({text:a.id==='linh'?JSON.stringify({summary:'Báo cáo thử riêng',questions:[],tasks:[]}):JSON.stringify({approved:true,summary:'Kết quả thử',questions:[],revisions:[]})});
  const rt=createRuntime({directory,invoke}),job=rt.start('Báo cáo dùng kiểm tra');
  assert.throws(()=>rt.setReportDone(job.id,true),/đang chạy|chưa có/);await until(()=>job.status==='completed');
  rt.setReportDone(job.id,true);const closedAt=job.ownerClosedAt;assert(closedAt);assert.equal(job.ownerClosedBy,'duc');assert.equal(job.status,'completed');rt.setReportDone(job.id,true);assert.equal(job.ownerClosedAt,closedAt);assert.equal(job.events.filter(e=>e.state==='owner_closed').length,1);
  const restored=createRuntime({directory,invoke});assert.equal(restored.get(job.id).ownerClosedAt,closedAt);restored.setReportDone(job.id,false);assert.equal(restored.get(job.id).ownerClosedAt,null);assert.equal(restored.get(job.id).events.at(-1).state,'owner_reopened');
  assert.throws(()=>rt.setReportDone('missing',true),/Không tìm/);assert.throws(()=>rt.setReportDone(job.id,'yes'),/không hợp lệ/);
  const app=createApp(restored,8882);
  async function request(method,url,data,token,origin){const req=Readable.from(data===undefined?[]:[JSON.stringify(data)]);req.method=method;req.url=url;req.headers={host:'127.0.0.1:8882',...(token?{'x-office-token':token}:{}),...(origin?{origin}: {})};let status,result;const res={writeHead(code){status=code},end(body){result=JSON.parse(body)}};await app.listeners('request')[0](req,res);return {status,result}}
  const session=await request('GET','/api/team');const token=session.result.token;
  assert.equal((await request('POST',`/api/jobs/${job.id}/done`,{done:true})).status,403);
  assert.equal((await request('POST',`/api/jobs/${job.id}/done`,{done:true},token,'https://other.example')).status,403);
  assert.equal((await request('POST',`/api/jobs/${job.id}/done`,{done:true},token)).status,200);
  assert((await request('GET','/api/jobs')).result.jobs[0].ownerClosedAt);
  assert.equal((await request('POST',`/api/jobs/${job.id}/done`,{done:false},token)).status,200);
  const {createOwnerInbox,pendingReports}=await import('./office-inbox.js'),canvas=createCanvas(1024,640),target={canvas,ctx:canvas.getContext('2d'),texture:{needsUpdate:false}};
  let rows=Array.from({length:6},(_,i)=>({id:'report-'+i,status:'completed',request:'Báo cáo '+i,result:'Kết luận kiểm tra '+i})),toggled=null,composed=false;
  const box=createOwnerInbox(target,{onToggle(id,done){toggled={id,done};rows=rows.map(j=>j.id===id?{...j,ownerClosedAt:done?'2026-11-16T10:00:00Z':null}:j);box.draw(rows)},onCompose(){composed=true}});
  const click=(x,y)=>box.click({x:x/1024,y:1-y/640});box.draw(rows);assert.equal(box.pendingCount,6);click(955,231);assert.deepEqual(toggled,{id:'report-0',done:true});assert.equal(pendingReports(rows).length,5);click(605,589);click(955,231);assert.deepEqual(toggled,{id:'report-0',done:false});assert.equal(pendingReports(rows).length,6);
  click(345,589);click(300,230);assert.equal(box.selectedJobId,'report-0');click(100,590);assert(composed);box.draw(rows);fs.writeFileSync('.office-data/preview-owner-inbox-component.png',canvas.toBuffer('image/png'));
  console.log('PASS durable owner sign-off, idempotency, reopen, unchanged AI result, token/origin checks, real API routing, report counts, per-row checkbox, archive and detail selection.');
 }finally{if(!path.resolve(directory).startsWith(path.resolve(__dirname,'.office-data')+path.sep))throw Error('Unsafe test cleanup path');fs.rmSync(directory,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exit(1)});
