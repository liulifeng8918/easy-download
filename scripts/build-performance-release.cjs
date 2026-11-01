// Reuse the known-launchable Electron shell; replace only application resources.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
const base=path.join(root,'release-1.0.1','win-unpacked'),payload=path.join(root,'build',`performance-${version}-payload`),patch=path.join(root,'build',`performance-${version}-update`),release=path.join(root,`release-${version}`);
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const quote=s=>"'"+s.replaceAll("'","''")+"'";
if(fs.existsSync(payload)||fs.existsSync(patch))throw new Error('Preserve existing build directories; use a new build version');
if(fs.existsSync(path.join(base,'resources','app','user-data')))throw new Error('Base contains user data');
fs.cpSync(base,payload,{recursive:true});fs.mkdirSync(patch,{recursive:true});fs.mkdirSync(release,{recursive:true});
const files=['package.json','LICENSE','THIRD_PARTY_NOTICES.md','README.md','electron/main.cjs','electron/preload.cjs','electron/renderer/app.html','electron/renderer/ui.js','electron/renderer/ui.css','electron/renderer/ui-pro.css','runtime/easy_download_sidecar.exe','docs/易下载用户操作手册-1.0.2.pdf','docs/2026-11-01-1.0.2-release.md','docs/2026-11-01-1.0.2-acceptance.md'];
for(const dir of ['electron/download','python'])for(const name of fs.readdirSync(path.join(root,dir)))if(/\.(cjs|py)$/.test(name))files.push(dir+'/'+name);
const manifest={version,baseVersion:'1.0.1',preservesUserData:true,files:[]};
for(const relative of files){
 const source=path.join(root,relative);if(!fs.existsSync(source))throw new Error('Missing release resource: '+relative);
 for(const destination of [path.join(payload,'resources','app',relative),path.join(patch,'resources','app',relative)]){fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(source,destination);}
 manifest.files.push({path:'resources/app/'+relative,sha256:hash(source),size:fs.statSync(source).size});
}
for(const unchanged of ['易下载.exe','resources/app/bin/yt-dlp.exe','resources/app/bin/ffmpeg.exe','resources/app/runtime/node.exe'])if(hash(path.join(payload,unchanged))!==hash(path.join(base,unchanged)))throw new Error('Unexpected runtime shell change');
fs.writeFileSync(path.join(release,'update-manifest.json'),JSON.stringify(manifest,null,2));fs.writeFileSync(path.join(patch,'update-manifest.json'),JSON.stringify(manifest,null,2));
for(const name of ['LICENSE','THIRD_PARTY_NOTICES.md'])fs.copyFileSync(path.join(root,name),path.join(patch,name));
fs.writeFileSync(path.join(patch,'更新说明.txt'),'易下载 '+version+' 更新包\r\n先退出易下载，将 resources 文件夹合并到原易下载.exe 所在目录，覆盖同名文件。再次打开原 EXE，软件内应显示 '+version+'。\r\n请保留原 resources/app/user-data，不要删除，不需要重置 Chrome 连接。新用户请使用完整绿色 ZIP。主 EXE、yt-dlp、FFmpeg、Node 和 Chrome 扩展未更换。\r\n');
const archive=path.join(release,`EasyDownload-${version}-update.zip`);
const zip=spawnSync('powershell.exe',['-NoProfile','-Command',`$ErrorActionPreference='Stop'; Compress-Archive -Path ${quote(path.join(patch,'*'))} -DestinationPath ${quote(archive)} -CompressionLevel Optimal`],{windowsHide:true,encoding:'utf8'});
if(zip.status!==0)throw new Error(zip.stderr);fs.writeFileSync(archive+'.sha256',hash(archive)+'  '+path.basename(archive)+'\r\n');
const built=spawnSync(process.execPath,[path.join(root,'scripts','build-portable-package.cjs')],{cwd:root,env:{...process.env,PORTABLE_PAYLOAD_DIR:payload,PORTABLE_OUTPUT_DIR:release},windowsHide:true,encoding:'utf8'});
if(built.status!==0)throw new Error(built.stderr||built.stdout);console.log(built.stdout);console.log(JSON.stringify({files:manifest.files.length,payload,patch,release}));
