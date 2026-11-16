const fs=require('fs'),path=require('path');
function knowledgeInstruction(agentId,directory=path.join(__dirname,'.office-data')){
 const file=path.join(directory,'agent-knowledge.json');if(!fs.existsSync(file))return '';
 const entry=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')).agents?.[agentId];if(!entry)return '';
 const resources=(entry.resources||[]).filter(r=>{try{return new URL(r.url).protocol==='https:'}catch{return false}}).map(r=>({title:r.title,category:r.category,url:r.url}));
 return '\nNGUỒN TRA CỨU RIÊNG DO QUẢN LÝ DỰ ÁN CUNG CẤP:\n'+JSON.stringify(resources)+'\nYêu cầu sử dụng:\n'+(entry.rules||[]).join('\n')+'\nChỉ báo đã tra cứu khi có kết quả thực đọc. Nếu phiên này không có công cụ truy cập NotebookLM, báo rõ hạn chế và nhờ Linh hỗ trợ qua phiên có trình duyệt; tiếp tục đọc hồ sơ gốc được cấp quyền khi phù hợp.';
}
module.exports={knowledgeInstruction};
