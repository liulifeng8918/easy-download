const {_electron:electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ed-platform-regression-'));
const executable=process.env.EASY_DOWNLOAD_TEST_EXECUTABLE;
const cases=[
  ['Douyin',process.env.EASY_DOWNLOAD_DOUYIN_URL||'https://www.douyin.com/video/7701612994102316328','best'],
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
      const network=[];
      target.on('response',async response=>{
        try {
          const u=new URL(response.url()),headers=await response.allHeaders();
          const type=headers['content-type']||'';
          if(!/(douyin|byte|snssdk)/i.test(u.host))return;
          if(!/(video|audio|mpegurl|octet-stream|json)/i.test(type))return;
          network.push({host:u.host,pathShape:u.pathname.split('/').map(p=>p.length>30?'[long]':p).join('/'),queryKeys:[...u.searchParams.keys()],targetId:u.searchParams.get('__vid'),resource:response.request().resourceType(),status:response.status(),contentType:type});
          if(network.length>100)network.shift();
          fs.writeFileSync(path.join(scratch,'douyin-network-summary.json'),JSON.stringify(network,null,2));
        }catch{}
      });
      const timer=setInterval(async()=>{
        if(target.isClosed()){clearInterval(timer);return;}
        if(!target.url().includes('douyin.com'))return;
        try{
          const state=await target.evaluate(()=>({
            pagePath:location.pathname,title:document.title,viewport:[innerWidth,innerHeight],
            dataScripts:[...document.querySelectorAll('script:not([src])')].filter(s=>s.id||s.type==='application/json'||s.textContent.includes('7702290728143146275')).map(s=>({id:s.id,type:s.type,length:s.textContent.length,prefix:s.textContent.slice(0,100).replace(/https?:[^\s"']+/g,'[url]')})),
            targetData:(()=>{
              const id=location.pathname.match(/\/(?:video|share\/video)\/(\d+)/)?.[1];
              const raw=document.querySelector('#RENDER_DATA')?.textContent;
              if(!id||!raw)return [];
              let data;try{data=JSON.parse(raw.startsWith('%')?decodeURIComponent(raw):raw);}catch{return [];}
              const found=[];let visited=0;
              const shape=(v,depth=0)=>{if(depth>3)return typeof v;if(typeof v==='string')return /^https?:/.test(v)?{host:(()=>{try{return new URL(v).host;}catch{return '';}})(),dash:/media-(?:video|audio)-/.test(v),keys:(()=>{try{return [...new URL(v).searchParams.keys()];}catch{return [];}})()}:v.slice(0,80);if(Array.isArray(v))return v.slice(0,2).map(x=>shape(x,depth+1));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).slice(0,40).map(([k,x])=>[k,shape(x,depth+1)]));return v;};
              const walk=(v,p,d)=>{if(!v||typeof v!=='object'||d>16||++visited>10000)return;if([v.aweme_id,v.awemeId,v.id].some(x=>String(x)===id)&&v.video)found.push({path:p,keys:Object.keys(v),video:shape(v.video)});for(const [k,x]of Object.entries(v))if(x&&typeof x==='object')walk(x,p+'.'+k,d+1);};
              walk(data,'root',0);return found.slice(0,4);
            })(),
            body:(document.body?.innerText||'').slice(0,1600),
            videos:[...document.querySelectorAll('video')].map(v=>({duration:Number.isFinite(v.duration)?v.duration:null,srcType:v.currentSrc?.split(':')[0],mediaHost:v.currentSrc?.startsWith('http')?new URL(v.currentSrc).host:null,mediaId:v.currentSrc?.startsWith('http')?new URL(v.currentSrc).searchParams.get('__vid'):null,encrypted:!!v.mediaKeys,width:v.videoWidth,height:v.videoHeight,rect:[v.getBoundingClientRect().width,v.getBoundingClientRect().height,v.getBoundingClientRect().top],display:getComputedStyle(v).display,visibility:getComputedStyle(v).visibility}))
          }));
          const {collectObservation,selectDouyinMedia,pageVideoId}=require('../electron/download/douyin-resolver.cjs');
          const actual=await target.evaluate(collectObservation);
          state.resolver={pageVideoId:pageVideoId(actual.pageUrl),selected:!!selectDouyinMedia(actual,pageVideoId(actual.pageUrl)),encrypted:actual.encrypted,challenge:actual.challenge,loginRequired:actual.loginRequired,unavailable:actual.unavailable,videos:actual.videos.map(v=>({active:v.active,duration:v.duration,width:v.width,height:v.height,valid:(()=>{try{require('../electron/download/link-input.cjs').validatePublicUrl(v.src);return true;}catch(e){return e.code;}})()}))};
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
    // Reuse only this app's already authorized site sync, never the Chrome
    // cookie database. Keep all values in memory and out of logs/evidence.
    const domains=(process.env.EASY_DOWNLOAD_SYNC_DOMAINS||'youtube.com').split(',').filter(d=>['youtube.com','douyin.com'].includes(d));
    const py="import os,sys;sys.path.insert(0,'python');os.environ['LOCALAPPDATA']=sys.argv[1];from cookie_store import CookieStore;s=CookieStore().read() or '';domains=sys.argv[2].split(',');lines=[l for l in s.splitlines() if l and not l.startswith('#') and any(l.split('\\t')[0].lstrip('.').lower()==d or l.split('\\t')[0].lstrip('.').lower().endswith('.'+d) for d in domains)];print('# Netscape HTTP Cookie File\\n# scoped authorized regression\\n'+'\\n'.join(lines))";
    const synced=spawnSync('python',['-c',py,process.env.EASY_DOWNLOAD_SYNC_SOURCE,domains.join(',')],{cwd:root,encoding:'utf8',windowsHide:true});
    if(synced.status===0&&synced.stdout.split('\n').filter(l=>l.includes('\t')).length){
      const paired=await page.evaluate(()=>window.easyDownload.request('/v1/pairing'));
      const resp=await fetch(`http://127.0.0.1:${enginePort}/cookies`,{method:'POST',headers:{'X-Easy-Download-Bridge':paired.bridgeToken,'X-Easy-Download-Domains':domains.join(',')},body:synced.stdout});
      if(!resp.ok)throw new Error('Scoped sync regression failed');
      console.log('using previously authorized site sync; no cookie contents logged');
    }
  }
  const repeats=Math.max(1,Math.min(3,Number(process.env.EASY_DOWNLOAD_TEST_REPEAT)||1));
  for(const [site,url,quality] of Array.from({length:repeats},()=>cases).flat()){
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
        if(current?.status==='failed')throw new Error([current.error,current.progress].filter(Boolean).join(' | '));
        if(current?.status==='completed'){done=current;break;}
        if(Date.now()-lastUpdate>30000){console.log(`${site} ${current?.status||'pending'} ${current?.progress||''}`);lastUpdate=Date.now();}
        await new Promise(r=>setTimeout(r,1000));
      }
      if(!done)throw new Error('bounded test timeout; no claim of completion');
      results.push({site,ok:true,seconds:Math.round((Date.now()-start)/1000),duration:done.media?.duration,hasVideo:done.media?.hasVideo,hasAudio:done.media?.hasAudio,bytes:fs.statSync(done.output_path).size,output:done.output_path});
    }catch(e){results.push({site,ok:false,seconds:Math.round((Date.now()-start)/1000),error:String(e.message).replace(/https?:\/\/\S+/g,'[url]')});}
    console.log(JSON.stringify(results.at(-1)));
    fs.mkdirSync(path.join(root,'output','platform-regression'),{recursive:true});
    const report=JSON.stringify({executable:executable||'source',results,scratch,at:new Date().toISOString()},null,2);
    fs.writeFileSync(path.join(root,'output','platform-regression','result.json'),report);
    fs.writeFileSync(path.join(root,'output','platform-regression',path.basename(scratch)+'.json'),report);
  }
  if(results.some(r=>!r.ok)) process.exitCode=1;
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
