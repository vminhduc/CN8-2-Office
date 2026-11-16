const fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'public');
// Deliberate allowlist: never publish working files, screenshots or local servers.
const files=['index.html','office.js','office-dashboard.js','office-life.js','office-avatar.js','office-inbox.js','team.json','assets/logo-casa-luna.png','vendor/three.module.js','vendor/three.core.js','vendor/LICENSE-three.txt'];
for(const file of files){const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(root,file),target)}
console.log('Prepared UI assets in public/ ('+files.length+' files).');
