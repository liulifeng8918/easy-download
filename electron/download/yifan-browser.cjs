// Observe the normal public site's player. No API signing, cookie DB access,
// CAPTCHA automation, DRM decryption, or hidden paid-quality selection.
const {randomUUID}=require('node:crypto');
const {DownloadError,validatePublicUrl}=require('./link-input.cjs');
const {isYifanNavigation,yifanVideoId}=require('./yifan-resolver.cjs');

function playlistMetadata(text,mediaUrl){
 if(typeof text!=='string'||text.length>2*1024*1024||!text.trimStart().startsWith('#EXTM3U'))return null;
 try{validatePublicUrl(mediaUrl);}catch{return null;}
 const fragments=[...text.matchAll(/^#EXTINF:([\d.]+)/gm)];
 if(!fragments.length||!text.includes('#EXT-X-ENDLIST'))return null;
 const duration=fragments.reduce((sum,item)=>sum+Number(item[1]),0);
 if(!Number.isFinite(duration)||duration<=0)return null;
 const protectedMedia=text.split(/\r?\n/).some(line=>{
  if(!/^#EXT-X-(?:SESSION-)?KEY:/i.test(line))return false;
  const format=line.match(/KEYFORMAT\s*=\s*(?:"([^"]*)"|([^,\s]+))/i);
  return /METHOD=SAMPLE-AES/i.test(line)||!!(format&&(format[1]??format[2]).toLowerCase()!=='identity');
 });
 return {mediaUrl,duration,fragments:fragments.length,protectedMedia};
}
function selectManifest(state,manifests,expectedId){
 if(!state||!isYifanNavigation(state.pageUrl)||yifanVideoId(state.pageUrl)!==expectedId)return null;
 const player=(state.videos||[]).filter(v=>v.active&&Number.isFinite(v.duration)&&v.duration>0).sort((a,b)=>(b.area||0)-(a.area||0))[0];
 if(!player)return null;
 if(player.encrypted)throw new DownloadError('DRM_PROTECTED','这个视频使用 DRM 加密保护，易下载不提供下载。');
 const selected=manifests.find(m=>Math.abs(m.duration-player.duration)<=Math.max(2,player.duration*0.01));
 if(!selected)return null;
 if(selected.protectedMedia)throw new DownloadError('DRM_PROTECTED','这个视频使用受保护的播放流，易下载不提供下载。');
 return {...selected,duration:player.duration,width:player.width||0,height:player.height||0,requireAudio:true};
}
function collectPlayer(){
 const text=(document.body?.innerText||'').slice(0,16000);
 return {pageUrl:location.href,title:document.title,challenge:/请稍候|Just a moment|正在进行安全验证|请完成.{0,10}验证/i.test(document.title+'\n'+text),loginRequired:/登录后(?:才能|可)(?:观看|播放)|请先登录.{0,15}(?:观看|播放)/.test(text),videos:[...document.querySelectorAll('video')].map(v=>{const r=v.getBoundingClientRect(),s=getComputedStyle(v);return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,area:r.width*r.height,active:r.width>120&&r.height>60&&s.display!=='none'&&s.visibility!=='hidden',encrypted:!!v.mediaKeys};})};
}
function observeManifests(contents,onManifest){
 const api=contents.debugger,pending=new Map();let stopped=false,mainFrame;
 try{api.attach('1.3');}catch{throw new DownloadError('YIFAN_PLAYER_UNAVAILABLE','爱壹帆播放组件无法初始化，请关闭易下载后重试。');}
 const listener=async(_event,method,params)=>{
  if(stopped)return;
  if(method==='Page.frameNavigated'&&!params.frame.parentId){mainFrame=params.frame.id;return;}
  if(method==='Network.responseReceived'){
   const response=params.response;
   try{const url=new URL(validatePublicUrl(response.url));if(response.status!==200||(mainFrame&&params.frameId&&params.frameId!==mainFrame))return;if(/mpegurl/i.test(response.mimeType)||url.pathname.endsWith('.m3u8')){if(pending.size<40)pending.set(params.requestId,url.href);}}catch{}
   return;
  }
  if(method==='Network.loadingFailed'){pending.delete(params.requestId);return;}
  if(method!=='Network.loadingFinished'||!pending.has(params.requestId))return;
  const url=pending.get(params.requestId);pending.delete(params.requestId);
  if(params.encodedDataLength>2*1024*1024)return;
  try{const result=await api.sendCommand('Network.getResponseBody',{requestId:params.requestId});if(stopped)return;const text=result.base64Encoded?Buffer.from(result.body,'base64').toString('utf8'):result.body;const metadata=playlistMetadata(text,url);if(metadata)onManifest(metadata);}catch{}
 };
 api.on('message',listener);
 // Never wait for Network.enable before navigation: Chromium can defer it
 // until the first document exists.
 api.sendCommand('Network.enable').catch(()=>{});api.sendCommand('Page.enable').catch(()=>{});
 return ()=>{stopped=true;pending.clear();api.removeListener('message',listener);try{api.detach();}catch{}};
}
function diagnostic(event){try{const {app}=require('electron'),fs=require('node:fs'),path=require('node:path');if(!app?.isReady())return;const file=path.join(app.getPath('userData'),'yifan-diagnostic.log');if(!fs.existsSync(file)||fs.statSync(file).size<1024*1024)fs.appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...event})+'\n');}catch{}}
class YifanBrowserResolver{
 constructor({BrowserWindow,session,parent,progress,timeoutMs=90000}){Object.assign(this,{BrowserWindow,session,parent,progress,timeoutMs});this.windows=new Set();this.tail=Promise.resolve();this.disposed=false;}
 resolve(url,settings={}){const next=this.tail.then(()=>this._resolve(url,settings));this.tail=next.catch(()=>{});return next;}
 async _resolve(url,settings){
  if(this.disposed)throw new DownloadError('CANCELLED','本次解析已取消。');
  const videoId=yifanVideoId(url);if(!videoId)throw new DownloadError('INVALID_URL','没有识别到爱壹帆播放页。');
  const context=this.session.fromPartition('easy-download-yifan-'+randomUUID());
  const viaProxy=!!settings.proxy;
  await context.setProxy(viaProxy?{mode:'fixed_servers',proxyRules:settings.proxy}:{mode:'direct'});
  context.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));context.setPermissionCheckHandler(()=>false);
  context.webRequest.onBeforeRequest({urls:['*://*/*']},(request,callback)=>{try{validatePublicUrl(request.url);callback({cancel:false});}catch{callback({cancel:true});}});
  const win=new this.BrowserWindow({width:1280,height:900,show:false,parent:this.parent?.()||undefined,title:'易下载 · 爱壹帆网站验证',autoHideMenuBar:true,webPreferences:{session:context,sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
  this.windows.add(win);win.setMenu(null);win.webContents.setAudioMuted(true);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  const manifests=[];let cancelled=false,shown=false,loadError,lastLog=0,slowNotice=false;
  const stop=observeManifests(win.webContents,item=>{if(manifests.length<30&&!manifests.some(m=>m.mediaUrl===item.mediaUrl))manifests.push(item);});
  for(const event of ['will-navigate','will-redirect'])win.webContents.on(event,(e,target)=>{try{if(!isYifanNavigation(target))e.preventDefault();}catch{e.preventDefault();}});
  win.on('closed',()=>{cancelled=true;this.windows.delete(win);});
  diagnostic({kind:'resolve-start',videoId,route:viaProxy?'proxy':'direct'});
  const start=Date.now();let deadline=start+this.timeoutMs;
  win.loadURL(url).catch(error=>{loadError=error;});
  try{
   while(Date.now()<deadline&&!cancelled&&!this.disposed){
    let state;
    try{state=await Promise.race([win.webContents.executeJavaScript(`(${collectPlayer.toString()})()`),new Promise(resolve=>{const t=setTimeout(()=>resolve(null),1500);t.unref?.();})]);}catch{}
    if(state){
     if(Date.now()-lastLog>5000){lastLog=Date.now();diagnostic({kind:'player-state',videoId,manifests:manifests.length,challenge:state.challenge,loginRequired:state.loginRequired});}
     const selected=selectManifest(state,manifests,videoId);
     if(selected){diagnostic({kind:'manifest-selected',videoId,duration:selected.duration,fragments:selected.fragments,height:selected.height});return {...selected,sourceUrl:url,videoId,title:String(state.title||'爱壹帆视频').replace(/-免费在线观看-爱壹帆.*$/,'').slice(0,180),referer:state.pageUrl,userAgent:win.webContents.getUserAgent(),viaProxy};}
     if((state.challenge||state.loginRequired)&&!shown){shown=true;deadline=Date.now()+300000;this.progress?.({stage:'verification',url,message:'爱壹帆需要网站验证，请在网站窗口中正常完成验证，完成后自动继续。无需重新连接 Chrome。'});win.show();win.focus();}
    }
    if(loadError&&!state)throw new DownloadError('YIFAN_NETWORK_FAILED','爱壹帆页面无法连接，请检查当前线路。');
    if(!slowNotice&&Date.now()-start>12000){slowNotice=true;this.progress?.({stage:'page-loading',url,message:'正在等待爱壹帆正常播放器加载，无需重复点击下载。'});}
    await new Promise(resolve=>setTimeout(resolve,500));
   }
   throw new DownloadError(cancelled||this.disposed?'CANCELLED':'YIFAN_PLAYER_TIMEOUT',cancelled||this.disposed?'本次网站解析已取消。':'未取得当前视频的公开播放流；请确认网站能够正常播放。无需反复连接 Chrome。');
  }finally{stop();this.windows.delete(win);if(!win.isDestroyed())win.destroy();context.clearStorageData?.().catch(()=>{});}
 }
 dispose(){this.disposed=true;for(const win of this.windows)if(!win.isDestroyed())win.destroy();this.windows.clear();}
}
module.exports={YifanBrowserResolver,playlistMetadata,selectManifest,observeManifests};
