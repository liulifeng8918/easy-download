const test = require('node:test');
const assert = require('node:assert/strict');
const { currentPageVideo } = require('../extension/page-video.js');
const { selectDouyinMedia, DouyinResolver } = require('../electron/download/douyin-resolver.cjs');
const { DownloadController } = require('../electron/download/controller.cjs');
const { sidecarArguments } = require('../electron/download/sidecar-launch.cjs');

test('startup passes dash-prefixed random credentials without argparse ambiguity', () => {
  for(const token of ['-random','--random','_random','ordinary']) {
    const args=sidecarArguments({port:17893,token,root:'D:/app'});
    assert.ok(args.includes(`--token=${token}`));
    assert.ok(!args.includes('--token'));
    assert.equal(sidecarArguments({script:'engine.py',port:17893,token,root:'D:/app'})[0],'engine.py');
  }
});

test('Douyin feed toolbar chooses active video instead of feed URL', () => {
  const doc = { querySelector: () => ({className:'other video_7701612994102316328 sliderVideo',querySelector:()=>({})}) };
  assert.equal(currentPageVideo(doc, 'https://www.douyin.com/?recommend=1').url, 'https://www.douyin.com/video/7701612994102316328');
  assert.match(currentPageVideo({querySelector:()=>null}, 'https://www.douyin.com/?recommend=1').error, /具体/);
});
test('Douyin blob accepts observed media only with exact target identity', () => {
  const state = {pageUrl:'https://www.douyin.com/video/123',videos:[{active:true,src:'blob:https://www.douyin.com/abc',duration:10}],networkMedia:['https://v1.douyinvod.com/stream?__vid=999']};
  assert.equal(selectDouyinMedia(state,'123'),null);
  state.networkMedia.push('https://v1.douyinvod.com/stream?__vid=123');
  assert.equal(selectDouyinMedia(state,'123').duration,10);
});

test('a playable Douyin video does not wait for unrelated page resources to finish', async () => {
  const state={pageUrl:'https://www.douyin.com/video/123',videos:[{active:true,duration:10,src:'https://v1.douyinvod.com/video.mp4?__vid=123'}]};
  class Window {
    constructor(){this.webContents={isLoadingMainFrame:()=>true,executeJavaScript:async()=>state,setAudioMuted(){},setWindowOpenHandler(){},on(){},getUserAgent:()=> 'test'};}
    setMenu(){} on(){} loadURL(){return Promise.resolve();} isDestroyed(){return false;} destroy(){}
  }
  const s={setPermissionRequestHandler(){},setPermissionCheckHandler(){},webRequest:{onBeforeRequest(){}},setProxy:async()=>{}};
  const resolver=new DouyinResolver({BrowserWindow:Window,session:{fromPartition:()=>s},loadCookies:()=>{throw new Error('Public playback must not depend on imported Chrome cookies');},timeoutMs:1000});
  assert.equal((await resolver.resolve(state.pageUrl)).videoId,'123');
});
test('generic actual download retains the proxy policy used in preflight', async () => {
  let submitted;
  const c = new DownloadController({request:async (route, init) => {
    if(route==='/v1/settings') return {settings:{proxy:'http://127.0.0.1:7892',autoProxy:true,outputDir:'D:/test'}};
    if(route==='/v1/links/check') return {check:{ready:true}};
    submitted=JSON.parse(init.body); return {task:{id:'proxy-test'}};
  }});
  await c.start({input:'https://www.youtube.com/watch?v=test'});
  assert.equal(submitted.proxy,'http://127.0.0.1:7892');
  assert.equal(submitted.autoProxy,true);
});

test('4K and MP3 selections and a queue-specific output directory reach the engine', async () => {
  const submitted=[];
  const c = new DownloadController({request:async (route, init) => {
    if(route==='/v1/settings') return {settings:{outputDir:'D:/default'}};
    if(route==='/v1/links/check') return {check:{ready:true}};
    submitted.push(JSON.parse(init.body)); return {task:{id:String(submitted.length)}};
  }});
  await c.start({input:'https://www.youtube.com/watch?v=test',quality:'2160',outputDir:'D:/queue'});
  await c.start({input:'https://www.youtube.com/watch?v=test',quality:'best',format:'mp3'});
  assert.equal(submitted[0].quality,'2160');
  assert.equal(submitted[0].outputDir,'D:/queue');
  assert.equal(submitted[1].quality,'audio');
  assert.equal(submitted[1].format,'mp3');
});
