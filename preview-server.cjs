// Development preview: never imports the Codex runner, private config, or project documents.
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),{createPreviewData,createPreviewJobs}=require('./preview-data.cjs');
const files=['index.html','office.js','office-dashboard.js','office-life.js','office-avatar.js','office-inbox.js','team.json','assets/logo-casa-luna.png','vendor/three.module.js','vendor/three.core.js','vendor/LICENSE-three.txt'];
function createPreviewServer(){const token=crypto.randomBytes(24).toString('hex'),jobs=createPreviewJobs(),data=createPreviewData();
 const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
 return http.createServer(async(req,res)=>{try{const pathname=decodeURIComponent(new URL(req.url,'http://preview').pathname);
  if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return json(res,403,{error:'Nguồn yêu cầu không hợp lệ.'});
  if(pathname.startsWith('/api/')){
   if(req.method==='GET'){
    if(pathname==='/api/team')return json(res,200,{team:JSON.parse(fs.readFileSync(path.join(__dirname,'team.json'),'utf8')),health:{runner:'preview-only',preview:true,activeJobCount:0,executableAvailable:false},token});
    if(pathname==='/api/jobs')return json(res,200,{jobs});
    if(pathname==='/api/dashboard')return json(res,200,data);
    if(pathname==='/api/workflows')return json(res,200,{workflows:[{status:'paused_preview_only'}]});
   }
   if(req.method!=='POST'||req.headers['x-office-token']!==token)return json(res,403,{error:'Phiên xem thử không hợp lệ.'});
   let raw='';for await(const part of req){raw+=part;if(raw.length>50000)return json(res,413,{error:'Nội dung quá dài.'})}const input=JSON.parse(raw||'{}');
   const match=pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/done$/);
   if(match){const job=jobs.find(j=>j.id===match[1]);if(!job||typeof input.done!=='boolean')return json(res,400,{error:'Báo cáo mẫu không hợp lệ.'});job.ownerClosedAt=input.done?new Date().toISOString():null;return json(res,200,{job})}
   return json(res,409,{error:'Đây là bản xem thử giao diện. Chạy bản local để giao việc thật cho Codex.'});
  }
  if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Không hỗ trợ.'});
  const file=pathname==='/'?'index.html':pathname.slice(1);if(!files.includes(file))return json(res,404,{error:'Not found'});
  const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png','.txt':'text/plain'}[path.extname(file)];
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:fs.readFileSync(path.join(__dirname,file)));
 }catch{return json(res,400,{error:'Yêu cầu xem thử không hợp lệ.'})}});
}
if(require.main===module){const port=Number(process.env.PORT||3000);createPreviewServer().listen(port,'0.0.0.0',()=>console.log(`UI preview only: http://localhost:${port}`))}
module.exports={createPreviewServer};
