const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {playlistMetadata,selectManifest,observeManifests}=require('../electron/download/yifan-browser.cjs');
const {parseMasterPlaylist}=require('../electron/download/yifan-resolver.cjs');
const url='https://www.iyf.tv/play/kNyFnqHa7LB';
const media='https://cdn.example.test/main.m3u8';
const body='#EXTM3U\n#EXTINF:12.5,\na.ts\n#EXTINF:7.5,\nb.ts\n#EXT-X-ENDLIST\n';
const state={pageUrl:url,videos:[{active:true,duration:20,area:800000,width:1280,height:720}]};

test('finite public HLS metadata includes every fragment and rejects unsafe or incomplete media',()=>{
 assert.deepEqual(playlistMetadata(body,media),{mediaUrl:media,duration:20,fragments:2,protectedMedia:false});
 assert.equal(playlistMetadata(body,'http://127.0.0.1/private.m3u8'),null);
 assert.equal(playlistMetadata(body.replace('#EXT-X-ENDLIST',''),media),null);
 assert.equal(playlistMetadata('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\na.m3u8',media),null);
 assert.equal(parseMasterPlaylist(body,media),media);
});

test('target page identity and dominant visible player duration exclude ads and other episodes',()=>{
 const manifest=playlistMetadata(body,media);
 assert.equal(selectManifest(state,[{...manifest,duration:5}],'kNyFnqHa7LB'),null);
 assert.equal(selectManifest({...state,pageUrl:'https://www.iyf.tv/play/other123'},[manifest],'kNyFnqHa7LB'),null);
 assert.equal(selectManifest({...state,videos:[{...state.videos[0],active:false}]},[manifest],'kNyFnqHa7LB'),null);
 const selected=selectManifest({...state,videos:[{active:true,duration:5,area:100},...state.videos]},[manifest],'kNyFnqHa7LB');
 assert.equal(selected.duration,20);assert.equal(selected.height,720);assert.equal(selected.requireAudio,true);
});

test('protected streams and EME players stay blocked without rejecting standard identity keys',()=>{
 const manifest=playlistMetadata(body,media);
 assert.throws(()=>selectManifest({...state,videos:[{...state.videos[0],encrypted:true}]},[manifest],'kNyFnqHa7LB'),{code:'DRM_PROTECTED'});
 for(const key of ['METHOD=SAMPLE-AES','METHOD=AES-128,KEYFORMAT="com.apple.streamingkeydelivery"']){
  const protectedManifest=playlistMetadata(body.replace('#EXTM3U','#EXTM3U\n#EXT-X-KEY:'+key),media);
  assert.throws(()=>selectManifest(state,[protectedManifest],'kNyFnqHa7LB'),{code:'DRM_PROTECTED'});
 }
 assert.equal(playlistMetadata(body.replace('#EXTM3U','#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,KEYFORMAT="identity"'),media).protectedMedia,false);
});

test('network observer starts without awaiting navigation and reads only completed matching-frame responses',async()=>{
 const api=new EventEmitter(),calls=[],observed=[];let detached=false;
 api.attach=()=>{};api.detach=()=>{detached=true;};
 api.sendCommand=(method,args)=>{calls.push({method,args});return method==='Network.getResponseBody'?Promise.resolve({body,base64Encoded:false}):new Promise(()=>{});};
 const stop=observeManifests({debugger:api},m=>observed.push(m));
 assert.equal(typeof stop,'function');
 api.emit('message',{},'Page.frameNavigated',{frame:{id:'main'}});
 const response={url:media,status:200,mimeType:'application/vnd.apple.mpegurl'};
 api.emit('message',{},'Network.responseReceived',{requestId:'other',frameId:'ad-frame',response});
 api.emit('message',{},'Network.loadingFinished',{requestId:'other',encodedDataLength:body.length});
 api.emit('message',{},'Network.responseReceived',{requestId:'target',frameId:'main',response});
 assert.equal(calls.filter(c=>c.method==='Network.getResponseBody').length,0);
 api.emit('message',{},'Network.loadingFinished',{requestId:'target',encodedDataLength:body.length});
 await new Promise(setImmediate);
 assert.equal(observed.length,1);assert.equal(observed[0].duration,20);
 stop();assert.equal(detached,true);assert.equal(api.listenerCount('message'),0);
});
