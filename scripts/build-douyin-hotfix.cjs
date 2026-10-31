const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const files=['electron/download/controller.cjs','electron/download/douyin-resolver.cjs','electron/download/douyin-metadata.cjs','electron/download/media-verifier.cjs','electron/renderer/app.html','docs/2026-10-31-douyin-hotfix-1.md'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const base=path.join(root,'release-1.0.1','win-unpacked');
const payload=path.join(root,'build','douyin-hotfix1-final-payload');
const patch=path.join(root,'build','douyin-hotfix1-final-update');
const output=path.join(root,'release-1.0.1-hotfix1-final');
if(JSON.parse(fs.readFileSync(path.join(base,'resources','app','package.json'),'utf8')).version!=='1.0.1')throw new Error('Base is not 1.0.1');
for(const target of [payload,patch])if(fs.existsSync(target))throw new Error('Preserve existing hotfix build before rebuilding: '+target);
fs.cpSync(base,payload,{recursive:true});fs.mkdirSync(patch,{recursive:true});fs.mkdirSync(output,{recursive:true});
const manifest={baseVersion:'1.0.1',patch:'douyin-hotfix1-final',files:[]};
for(const relative of files){
 const source=path.join(root,relative),baseFile=path.join(base,'resources','app',relative);
 for(const destination of [path.join(payload,'resources','app',relative),path.join(patch,'resources','app',relative)]){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);}
 manifest.files.push({path:'resources/app/'+relative,sha256:hash(source),baseSha256:fs.existsSync(baseFile)?hash(baseFile):null});
}
fs.writeFileSync(path.join(patch,'hotfix-manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(patch,'补丁说明.txt'),'易下载 1.0.1 抖音修复 1\r\n\r\n先退出易下载。将本补丁的 resources 文件夹合并到原先包含 易下载.exe 的目录，替换同名文件。重新打开原 EXE 后，右下角应显示 1.0.1 · 抖音修复 1。\r\n不需要重新连接 Chrome；补丁不更换 EXE、下载引擎、扩展、激活或个人数据。\r\n只适用于 1.0.1。完整说明在 resources/app/docs/2026-10-31-douyin-hotfix-1.md。\r\n');
const archive=path.join(output,'EasyDownload-1.0.1-douyin-hotfix1-final-update.zip');
if(fs.existsSync(archive))throw new Error('Hotfix archive already exists');
const result=spawnSync('powershell.exe',['-NoProfile','-Command',`Compress-Archive -Path ${quote(path.join(patch,'*'))} -DestinationPath ${quote(archive)} -CompressionLevel Optimal`],{windowsHide:true,encoding:'utf8'});
if(result.status!==0)throw new Error('Patch ZIP failed: '+result.stderr);
fs.writeFileSync(archive+'.sha256',hash(archive)+'  '+path.basename(archive)+'\r\n');
fs.copyFileSync(path.join(patch,'hotfix-manifest.json'),path.join(output,'hotfix-manifest.json'));
console.log(JSON.stringify({archive,bytes:fs.statSync(archive).size,payload,files:files.length},null,2));
