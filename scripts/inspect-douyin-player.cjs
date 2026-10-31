// Public-page diagnostic. Never logs signed media addresses or browser cookies.
const {chromium}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path');
let browser;
function safeShape(v,d=0){
  if(d>6)return Array.isArray(v)?`array(${v.length})`:typeof v;
  if(typeof v==='string'){
    if(/^(?:https?:)?\/\//.test(v)){try{const u=new URL(v,'https://www.douyin.com');return {host:u.host,split:/media-(?:video|audio)-/.test(u.pathname),queryKeys:[...u.searchParams.keys()]};}catch{return 'invalid-url';}}
    return v.length>120?`string(${v.length})`:v;
  }
  if(Array.isArray(v))return v.slice(0,2).map(x=>safeShape(x,d+1));
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).slice(0,50).map(([k,x])=>[k,safeShape(x,d+1)]));
  return v;
}
(async()=>{
  browser=await chromium.launch({channel:'chromium',headless:true});
  const page=await browser.newPage();
  const metadata=[];
  page.on('response',async response=>{
    if(new URL(response.url()).pathname!=='/aweme/v1/web/aweme/detail/')return;
    try{const data=await response.json();const item=data.aweme_detail;metadata.push({keys:Object.keys(data),id:item?.aweme_id,video:safeShape(item?.video)});}catch{}
  });
  await page.goto(process.env.EASY_DOWNLOAD_DOUYIN_URL||'https://www.douyin.com/video/7702290728143146275',{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('#RENDER_DATA').waitFor({state:'attached',timeout:30000});
  await page.waitForFunction(()=>[...document.querySelectorAll('video')].some(v=>v.duration>0),{},{timeout:30000});
  const report=await page.evaluate(()=>{
    const id=location.pathname.match(/\/(?:video|share\/video)\/(\d+)/)?.[1];
    const raw=document.querySelector('#RENDER_DATA').textContent;
    const data=JSON.parse(raw.startsWith('%')?decodeURIComponent(raw):raw);
    const matches=[],mediaPaths=[];let count=0;
    function shape(v,d=0){
      if(d>6)return Array.isArray(v)?`array(${v.length})`:typeof v;
      if(typeof v==='string'){
        if(/^(?:https?:)?\/\//.test(v)){try{const u=new URL(v,location.href);return {host:u.host,split:/media-(?:video|audio)-/.test(u.pathname),extension:u.pathname.match(/\.[a-z0-9]{2,5}$/i)?.[0]||'',queryKeys:[...u.searchParams.keys()]};}catch{return 'invalid-url';}}
        return v.length>160?`string(${v.length})`:v;
      }
      if(Array.isArray(v))return v.slice(0,2).map(x=>shape(x,d+1));
      if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).slice(0,45).map(([k,x])=>[k,shape(x,d+1)]));
      return v;
    }
    function walk(v,p,d){
      if(!v||typeof v!=='object'||d>18||++count>20000)return;
      if(Object.values(v).some(x=>typeof x==='string'&&x===id))matches.push({path:p,keys:Object.keys(v),data:shape(v)});
      for(const[k,x]of Object.entries(v)){
        if(/video|aweme|play.*addr/i.test(k))mediaPaths.push({path:p+'.'+k,type:typeof x,keys:x&&typeof x==='object'?Object.keys(x).slice(0,25):[]});
        if(x&&typeof x==='object')walk(x,p+'.'+k,d+1);
      }
    }
    walk(data,'root',0);
    const chunks=[];
    for(const s of document.querySelectorAll('script:not([src])')){
      const m=s.textContent.match(/^\s*self\.__pace_f\.push\(([\s\S]*)\)\s*;?\s*$/);
      if(!m)continue;
      try{const entry=JSON.parse(m[1]);if(entry[0]===1&&typeof entry[1]==='string')chunks.push(entry[1]);}catch{}
    }
    let flightRecords=0;
    for(const line of chunks.flatMap(c=>c.split('\n'))){
      const m=line.match(/^[0-9a-f]+:([\[{][\s\S]*)$/i);if(!m)continue;
      try{walk(JSON.parse(m[1]),'flight.'+(flightRecords++),0);}catch{}
    }
    return {id,rootKeys:Object.keys(data),flightRecords,chunkHeaders:chunks.map(c=>({length:c.length,prefix:c.slice(0,60)})),matches:matches.slice(0,6),mediaPaths:mediaPaths.filter(x=>!x.path.startsWith('root.app.')).slice(0,25)};
  });
  const folder=path.resolve('output','playwright');fs.mkdirSync(folder,{recursive:true});
  report.responses=metadata;
  fs.writeFileSync(path.join(folder,'douyin-render-shape.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({id:report.id,detailResponses:metadata.length,evidence:path.join(folder,'douyin-render-shape.json')}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
