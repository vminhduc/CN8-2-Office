const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
process.chdir(path.resolve(__dirname,'..'));fs.mkdirSync('.office-data',{recursive:true});
for(const file of ['test-runtime.cjs','test-mail-workflow.cjs','test-dashboard-data.cjs','test-office-avatar.cjs','test-office-life.cjs','test-owner-reports.cjs','test-preview.cjs','test-agent-knowledge.cjs']){
 const result=spawnSync(process.execPath,[file],{stdio:'inherit',env:process.env});if(result.status!==0)process.exit(result.status||1);
}
