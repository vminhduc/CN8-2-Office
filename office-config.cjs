const fs=require('fs'),path=require('path'),os=require('os');
let local={};const file=path.join(__dirname,'office.local.json');
if(fs.existsSync(file))local=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
module.exports={dashboardSheetId:process.env.OFFICE_SHEET_ID||'',dashboardWebsite:'',projectRoot:'',libraryRoot:'',downloadRoot:path.join(os.homedir(),'Downloads','CHECK'),mailboxEmail:'',spmSenderAddresses:[],driveRootId:'',approvalSystemHosts:[],pythonExe:process.env.OFFICE_PYTHON||'',pdftoppmExe:process.env.OFFICE_PDFTOPPM||'',...local};
