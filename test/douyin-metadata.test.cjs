const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {extractDouyinMetadata,observeDouyinMetadata}=require('../electron/download/douyin-metadata.cjs');
const {selectDouyinMedia}=require('../electron/download/douyin-resolver.cjs');
const {DouyinResolver}=require('../electron/download/douyin-resolver.cjs');
const {DownloadError}=require('../electron/download/link-input.cjs');
function detail(){return {status_code:0,aweme_detail:{aweme_id:'123',desc:'target',video:{format:'dash',duration:193300,play_addr_h264:{height:1080,width:1920,url_list:['https://v1.douyinvod.com/full.mp4']},bit_rate:[{format:'dash',play_addr:{height:1080,url_list:['https://v1.douyinvod.com/media-video-hvc1/']}},{format:'mp4',bit_rate:500,height:576,play_addr:{height:576,width:1024,url_list:['https://v1.douyinvod.com/small.mp4']}}]}}};}
test('DASH blob player uses only its own complete MP4 alternatives and requested quality',()=>{
 const metadata=extractDouyinMetadata(detail());
 assert.ok(metadata.formats.every(f=>!f.mediaUrl.includes('media-video-')));
 const state={pageUrl:'https://www.douyin.com/video/123',metadata,videos:[{active:true,src:'blob:https://www.douyin.com/test',duration:193.3}]};
 assert.equal(selectDouyinMedia(state,'123').height,1080);
 assert.equal(selectDouyinMedia(state,'123','720').height,576);
 assert.equal(selectDouyinMedia(state,'123').requireAudio,true);
 state.metadata.videoId='999';assert.equal(selectDouyinMedia(state,'123'),null);
});
test('authorized Chrome state is used only after an explicit website login requirement',async()=>{
 const calls=[];const resolver=new DouyinResolver({loadCookies:async()=>[]});
 resolver._resolve=async(_url,settings)=>{calls.push(settings.useAuthorizedCookies);if(!settings.useAuthorizedCookies)throw new DownloadError('LOGIN_REQUIRED','login');return {videoId:'123'};};
 assert.equal((await resolver.resolve('https://www.douyin.com/video/123')).videoId,'123');
 assert.deepEqual(calls,[false,true]);
});
test('metadata rejects private URLs, other CDNs, mismatching identity and DRM',()=>{
 for(const raw of ['http://127.0.0.1/full.mp4','https://evil.test/full.mp4','https://v1.douyinvod.com/full.mp4?__vid=999']){
   const d=detail();d.aweme_detail.video.bit_rate=[];d.aweme_detail.video.play_addr_h264.url_list=[raw];assert.equal(extractDouyinMetadata(d),null);
 }
 const d=detail();d.aweme_detail.video.is_drm=true;assert.equal(extractDouyinMetadata(d),null);
});
test('observer reads only completed normal detail responses, then detaches cleanly',async()=>{
 const api=new EventEmitter();let detached=false;const received=[];
 api.attach=()=>{};api.detach=()=>{detached=true;};
 api.sendCommand=async name=>name==='Network.getResponseBody'?{body:JSON.stringify(detail()),base64Encoded:false}:{};
 const stop=await observeDouyinMetadata({debugger:api},v=>received.push(v));
 api.emit('message',null,'Network.responseReceived',{requestId:'wrong',response:{url:'https://evil.test/aweme/v1/web/aweme/detail/',status:200}});
 api.emit('message',null,'Network.loadingFinished',{requestId:'wrong',encodedDataLength:10});
 api.emit('message',null,'Network.responseReceived',{requestId:'right',response:{url:'https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=123',status:200}});
 api.emit('message',null,'Network.loadingFinished',{requestId:'right',encodedDataLength:10});
 await new Promise(r=>setImmediate(r));
 assert.equal(received.length,1);assert.equal(received[0].videoId,'123');
 stop();assert.equal(api.listenerCount('message'),0);assert.equal(detached,true);
});

test('a delayed Network.enable never prevents the first navigation',async()=>{
 const api=new EventEmitter();api.attach=()=>{};api.detach=()=>{};api.sendCommand=()=>new Promise(()=>{});
 const stop=await Promise.race([observeDouyinMetadata({debugger:api},()=>{}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('navigation would be blocked')),100))]);
 assert.equal(typeof stop,'function');stop();
});

test('full decode rejects a missing expected soundtrack but accepts the complete file',{skip:process.platform!=='win32'},async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const {spawnSync}=require('node:child_process');
 const {verifyMedia}=require('../electron/download/media-verifier.cjs');
 const root=path.resolve(__dirname,'..'),ffmpeg=path.join(root,'bin','ffmpeg.exe');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ed-audio-verification-'));
 const silent=path.join(folder,'silent.mp4'),complete=path.join(folder,'complete.mp4');
 assert.equal(spawnSync(ffmpeg,['-y','-f','lavfi','-i','color=c=blue:s=160x90:d=1','-c:v','libx264',silent],{stdio:'ignore',windowsHide:true}).status,0);
 assert.equal(spawnSync(ffmpeg,['-y','-f','lavfi','-i','color=c=blue:s=160x90:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-c:a','aac','-shortest',complete],{stdio:'ignore',windowsHide:true}).status,0);
 const missing=await verifyMedia({output_path:silent,output_dir:folder,quality:'best'},{requireAudio:true},ffmpeg);
 assert.equal(missing.ok,false);assert.match(missing.message,/声音/);
 const good=await verifyMedia({output_path:complete,output_dir:folder,quality:'best'},{requireAudio:true},ffmpeg);
 assert.equal(good.ok,true);assert.equal(good.hasAudio,true);
});
