// Compare transfer strategies on the same freshly resolved public media URL.
const {app,BrowserWindow,session}=require('electron');
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DouyinResolver}=require('../electron/download/douyin-resolver.cjs');
const {verifyMedia}=require('../electron/download/media-verifier.cjs');
const root=path.resolve(__dirname,'..'),folder=fs.mkdtempSync(path.join(os.tmpdir(),'ed-dy-speed-'));
app.on('window-all-closed',e=>e.preventDefault());
function transfer(media,chunk){return new Promise(resolve=>{
 const output=path.join(folder,chunk?'chunk.mp4':'native.mp4'),start=Date.now();
 const args=['--ignore-config','--proxy','','--no-playlist','--no-warnings','--socket-timeout','15','--retries','1','--ffmpeg-location',path.join(root,'bin'),'--referer',media.referer,'--user-agent',media.userAgent,'-o',output];
 if(chunk)args.push('--http-chunk-size','4M');args.push(media.mediaUrl);
 const child=spawn(path.join(root,'bin','yt-dlp.exe'),args,{windowsHide:true,stdio:'ignore'});
 const timer=setTimeout(()=>spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}),120000);
 child.on('close',async code=>{clearTimeout(timer);const seconds=(Date.now()-start)/1000;const result={chunk,code,seconds,bytes:fs.existsSync(output)?fs.statSync(output).size:0};if(code===0)result.check=await verifyMedia({output_path:output,output_dir:folder,quality:'best'},{requireAudio:true},path.join(root,'bin','ffmpeg.exe'));console.log(JSON.stringify(result));resolve(result);});
});}
app.whenReady().then(async()=>{const resolver=new DouyinResolver({BrowserWindow,session,timeoutMs:45000});try{const media=await resolver.resolve('https://www.douyin.com/video/7702750071644769576',{});await transfer(media,false);await transfer(media,true);}finally{resolver.dispose();app.quit();}}).catch(e=>{console.error(e.code||e.message);app.quit();});
