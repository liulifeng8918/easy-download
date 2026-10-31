const {_electron:electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ed-platform-regression-'));
const executable=process.env.EASY_DOWNLOAD_TEST_EXECUTABLE;
const cases=[
  ['Douyin','https://www.douyin.com/video/7701612994102316328','best'],
  ['YouTube',process.env.EASY_DOWNLOAD_YOUTUBE_URL||'https://www.youtube.com/watch?v=jNQXAC9IVRw','720'],
  ['Bilibili','https://www.bilibili.com/video/BV1xx411c7mD','720'],
  ['Weibo','https://m.weibo.cn/detail/4189191225395228','best'],
  ['Yifan-long','https://www.yifan.tv/watch?v=HIVJn4VQvwrHXVmL0LMq51','best'],
];
let app;
const results=[];
(async()=>{
  const enginePort=process.env.EASY_DOWNLOAD_REGRESSION_PORT||'25893';
  const env={...process.env,APPDATA:path.join(scratch,'roaming'),LOCALAPPDATA:path.join(scratch,'local'),EASY_DOWNLOAD_PORT:enginePort,EASY_DOWNLOAD_BROWSER_PORT:String(Number(enginePort)+1),EASY_DOWNLOAD_SKIP_BROWSER_OPEN:'1'};
  delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({executablePath:executable||require('electron'),args:[...(executable?[]:[root]),`--user-data-dir=${path.join(scratch,'appdata')}`],env,cwd:root,timeout:60000});
  const page=await app.firstWindow();
  if(process.env.EASY_DOWNLOAD_DIAGNOSE_DOUYIN){
    app.on('window',target=>{
      const timer=setInterval(async()=>{
        if(target.isClosed()){clearInterval(timer);return;}
        if(!target.url().includes('douyin.com'))return;
        try{
          const state=await target.evaluate(()=>({
            pagePath:location.pathname,title:document.title,viewport:[innerWidth,innerHeight],
            body:(document.body?.innerText||'').slice(0,1600),
            videos:[...document.querySelectorAll('video')].map(v=>({duration:Number.isFinite(v.duration)?v.duration:null,srcType:v.currentSrc?.split(':')[0],mediaHost:v.currentSrc?.startsWith('http')?new URL(v.currentSrc).host:null,mediaId:v.currentSrc?.startsWith('http')?new URL(v.currentSrc).searchParams.get('__vid'):null,encrypted:!!v.mediaKeys,width:v.videoWidth,height:v.videoHeight,rect:[v.getBoundingClientRect().width,v.getBoundingClientRect().height,v.getBoundingClientRect().top],display:getComputedStyle(v).display,visibility:getComputedStyle(v).visibility}))
          }));
          const {collectObservation,selectDouyinMedia}=require('../electron/download/douyin-resolver.cjs');
          const actual=await target.evaluate(collectObservation);
          state.resolver={selected:!!selectDouyinMedia(actual,'7701612994102316328'),encrypted:actual.encrypted,challenge:actual.challenge,loginRequired:actual.loginRequired,unavailable:actual.unavailable,videos:actual.videos.map(v=>({active:v.active,duration:v.duration,width:v.width,height:v.height,valid:(()=>{try{require('../electron/download/link-input.cjs').validatePublicUrl(v.src);return true;}catch(e){return e.code;}})()}))};
          fs.writeFileSync(path.join(scratch,'douyin-observation.json'),JSON.stringify(state,null,2));
          await target.screenshot({path:path.join(scratch,'douyin-observation.png')});
        }catch{}
      },5000);
      timer.unref();
    });
  }
  app.process().stderr.on('data',chunk=>{const text=chunk.toString();if(/startup failed|uncaught|unhandled/i.test(text))console.error(text);});
  await page.waitForFunction(()=>document.querySelector('#licenseStatus')?.textContent.includes('免费版'));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
  const proxy=process.env.EASY_DOWNLOAD_TEST_PROXY||'';
  const outputDir=path.join(scratch,'downloads');fs.mkdirSync(outputDir);
  await page.evaluate(s=>window.easyDownload.request('/v1/settings',{method:'POST',body:JSON.stringify(s)}),{outputDir,proxy,autoProxy:true});
  if(process.env.EASY_DOWNLOAD_SYNC_SOURCE){
    // Reuse only this app's already authorized YouTube sync, never the Chrome
    // cookie database. Keep all values in memory and out of logs/evidence.
    const py="import os,sys;sys.path.insert(0,'python');os.environ['LOCALAPPDATA']=sys.argv[1];from cookie_store import CookieStore;s=CookieStore().read() or '';lines=[l for l in s.splitlines() if l and not l.startswith('#') and l.split('\\t')[0].lstrip('.') in ('youtube.com','www.youtube.com')];print('# Netscape HTTP Cookie File\\n# scoped YouTube regression\\n'+'\\n'.join(lines))";
    const synced=spawnSync('python',['-c',py,process.env.EASY_DOWNLOAD_SYNC_SOURCE],{cwd:root,encoding:'utf8',windowsHide:true});
    if(synced.status===0&&synced.stdout.split('\n').filter(l=>l.includes('\t')).length){
      const paired=await page.evaluate(()=>window.easyDownload.request('/v1/pairing'));
      const resp=await fetch(`http://127.0.0.1:${enginePort}/cookies`,{method:'POST',headers:{'X-Easy-Download-Bridge':paired.bridgeToken,'X-Easy-Download-Domains':'youtube.com'},body:synced.stdout});
      if(!resp.ok)throw new Error('Scoped sync regression failed');
      console.log('using previously authorized YouTube sync; no cookie contents logged');
    }
  }
  for(const [site,url,quality] of cases){
    if(process.env.EASY_DOWNLOAD_TEST_SITES&&!process.env.EASY_DOWNLOAD_TEST_SITES.split(',').includes(site))continue;
    const start=Date.now();
    console.log(`START ${site}`);
    try{
      const task=await page.evaluate(p=>window.easyDownload.downloadStart(p),{input:url,quality});
      const end=Date.now()+(site==='Yifan-long'?900000:240000);
      let done,lastUpdate=0;
      while(Date.now()<end){
        const data=await page.evaluate(()=>window.easyDownload.downloadTasks());
        const current=data.tasks.find(t=>t.id===task.task.id);
        if(current?.status==='failed')throw new Error(current.error);
        if(current?.status==='completed'){done=current;break;}
        if(Date.now()-lastUpdate>30000){console.log(`${site} ${current?.status||'pending'} ${current?.progress||''}`);lastUpdate=Date.now();}
        await new Promise(r=>setTimeout(r,1000));
      }
      if(!done)throw new Error('bounded test timeout; no claim of completion');
      results.push({site,ok:true,seconds:Math.round((Date.now()-start)/1000),duration:done.media?.duration,bytes:fs.statSync(done.output_path).size,output:done.output_path});
    }catch(e){results.push({site,ok:false,seconds:Math.round((Date.now()-start)/1000),error:String(e.message).replace(/https?:\/\/\S+/g,'[url]')});}
    console.log(JSON.stringify(results.at(-1)));
    fs.mkdirSync(path.join(root,'output','platform-regression'),{recursive:true});
    const report=JSON.stringify({executable:executable||'source',results,scratch,at:new Date().toISOString()},null,2);
    fs.writeFileSync(path.join(root,'output','platform-regression','result.json'),report);
    fs.writeFileSync(path.join(root,'output','platform-regression',path.basename(scratch)+'.json'),report);
  }
  if(results.some(r=>!r.ok)) process.exitCode=1;
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
