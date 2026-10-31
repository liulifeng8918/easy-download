const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const files=['electron/download/controller.cjs','electron/download/douyin-resolver.cjs','electron/download/douyin-metadata.cjs','electron/download/media-verifier.cjs','electron/renderer/app.html','electron/renderer/ui.js','runtime/easy_download_sidecar.exe','python/download_engine.py','docs/2026-11-01-douyin-hotfix-2.md'];
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
const base=path.join(root,'release-1.0.1','win-unpacked');
const payload=path.join(root,'build','douyin-hotfix2-payload');
const patch=path.join(root,'build','douyin-hotfix2-update');
const output=path.join(root,'release-1.0.1-hotfix2');
if(JSON.parse(fs.readFileSync(path.join(base,'resources','app','package.json'),'utf8')).version!=='1.0.1')throw new Error('Base is not 1.0.1');
for(const target of [payload,patch])if(fs.existsSync(target))throw new Error('Preserve existing hotfix build before rebuilding: '+target);
fs.cpSync(base,payload,{recursive:true});fs.mkdirSync(patch,{recursive:true});fs.mkdirSync(output,{recursive:true});
const manifest={baseVersion:'1.0.1',patch:'douyin-hotfix2',files:[]};
for(const relative of files){
 const source=path.join(root,relative),baseFile=path.join(base,'resources','app',relative);
 for(const destination of [path.join(payload,'resources','app',relative),path.join(patch,'resources','app',relative)]){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);}
 const hotfix1File=path.join(root,'build','douyin-hotfix1-final-payload','resources','app',relative);
 manifest.files.push({path:'resources/app/'+relative,sha256:hash(source),baseSha256:fs.existsSync(baseFile)?hash(baseFile):null,acceptedBaseSha256:[...new Set([baseFile,hotfix1File].filter(f=>fs.existsSync(f)).map(hash))]});
}
fs.writeFileSync(path.join(patch,'hotfix-manifest.json'),JSON.stringify(manifest,null,2));
fs.writeFileSync(path.join(patch,'补丁说明.txt'),'易下载 1.0.1 抖音修复 2\r\n\r\n先退出易下载。将本补丁的 resources 文件夹合并到原先包含 易下载.exe 的目录，替换同名文件。重新打开原 EXE 后，右下角应显示 1.0.1 · 抖音修复 2。\r\n不需要重新连接 Chrome。此补丁更新内置本机引擎和抖音处理代码，不更换主程序 易下载.exe、yt-dlp、FFmpeg、扩展、激活或个人数据。\r\n只适用于 1.0.1 或其抖音修复 1。旧格式文件不会被删除；兼容格式另存，重复下载已存在的兼容文件仍会进行完整核验。\r\n完整说明在 resources/app/docs/2026-11-01-douyin-hotfix-2.md。\r\n');
const archive=path.join(output,'EasyDownload-1.0.1-douyin-hotfix2-update.zip');
if(fs.existsSync(archive))throw new Error('Hotfix archive already exists');
const result=spawnSync('powershell.exe',['-NoProfile','-Command',`Compress-Archive -Path ${quote(path.join(patch,'*'))} -DestinationPath ${quote(archive)} -CompressionLevel Optimal`],{windowsHide:true,encoding:'utf8'});
if(result.status!==0)throw new Error('Patch ZIP failed: '+result.stderr);
fs.writeFileSync(archive+'.sha256',hash(archive)+'  '+path.basename(archive)+'\r\n');
fs.copyFileSync(path.join(patch,'hotfix-manifest.json'),path.join(output,'hotfix-manifest.json'));
console.log(JSON.stringify({archive,bytes:fs.statSync(archive).size,payload,files:files.length},null,2));
