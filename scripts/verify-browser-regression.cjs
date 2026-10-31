// Real isolated Chromium extension + Electron + frozen Python integration.
// Never reads or modifies the user's installed Chrome extensions/profile.
const { chromium, _electron: electron } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const http = require('node:http');
const {spawnSync}=require('node:child_process');
const root = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-browser-regression-'));
const evidence = path.join(root, 'output', 'browser-regression');
fs.mkdirSync(evidence, {recursive:true});
const executable = process.env.EASY_DOWNLOAD_TEST_EXECUTABLE;
const appRoot = executable ? path.join(path.dirname(executable), 'resources', 'app') : root;
const extension = path.join(scratch, 'extension');
fs.cpSync(path.join(appRoot,'extension'), extension, {recursive:true});
// Only the copied fixture endpoints change; shipped extension stays on its
// stable production ports. Existing user app can continue running untouched.
for(const name of fs.readdirSync(extension).filter(n=>/\.(js|json)$/.test(n))) {
  const file=path.join(extension,name);
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('17894','24894').replaceAll('17893','24893'));
}
let app, browser, fixtureServer;
const results=[];
const env={...process.env,APPDATA:path.join(scratch,'roaming'),LOCALAPPDATA:path.join(scratch,'local'),EASY_DOWNLOAD_PORT:'24893',EASY_DOWNLOAD_BROWSER_PORT:'24894',EASY_DOWNLOAD_SKIP_BROWSER_OPEN:'1'};
delete env.ELECTRON_RUN_AS_NODE;
async function wait(predicate, ms=60000) {const end=Date.now()+ms; while(Date.now()<end){if(await predicate())return; await new Promise(r=>setTimeout(r,500));}throw new Error('Timed out waiting for integration result');}
(async()=>{
  app=await electron.launch({executablePath:executable||require('electron'),args:[...(executable?[]:[root]),`--user-data-dir=${path.join(scratch,'app-data')}`],env,cwd:root,timeout:60000});
  const page=await app.firstWindow();
  await page.waitForFunction(()=>document.querySelector('#licenseStatus')?.textContent.includes('免费版'));
  const downloads=path.join(scratch,'downloads');fs.mkdirSync(downloads);
  const fixture=path.join(scratch,'sample.mp4');
  assert.equal(spawnSync(path.join(appRoot,'bin','ffmpeg.exe'),['-y','-f','lavfi','-i','color=c=blue:s=160x90:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','libx264','-c:a','aac','-shortest',fixture],{windowsHide:true,stdio:'ignore'}).status,0);
  const bytes=fs.readFileSync(fixture);
  fixtureServer=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'video/mp4','content-length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);});
  await new Promise(resolve=>fixtureServer.listen(0,'127.0.0.1',resolve));
  const fixtureProxy=`http://127.0.0.1:${fixtureServer.address().port}`;
  await page.evaluate(({dir,proxy})=>window.easyDownload.request('/v1/settings',{method:'POST',body:JSON.stringify({outputDir:dir,proxy,autoProxy:false})}),{dir:downloads,proxy:fixtureProxy});
  browser=await chromium.launchPersistentContext(path.join(scratch,'chrome'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
  const ticket=await page.evaluate(()=>window.easyDownload.connectChrome());
  const oldExtension=await fetch('http://127.0.0.1:24894/v1/browser/bootstrap',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket:ticket.ticket})});
  assert.equal(oldExtension.status,426);
  assert.equal((await page.evaluate(t=>window.easyDownload.browserSetupStatus(t),ticket.ticket)).paired,false);
  results.push('old extension cannot create a false successful pairing or consume the setup ticket');
  const setup=await browser.newPage();
  const setupUrl=`http://127.0.0.1:24894/browser-setup?ticket=${ticket.ticket}`;
  async function navigateSetup(){
    try { await setup.goto(setupUrl,{waitUntil:'domcontentloaded'}); }
    catch(error){if(!/ERR_ABORTED|interrupted by another navigation/.test(String(error.message)))throw error;}
  }
  await navigateSetup();
  await wait(async()=> {
    if(setup.url()==='about:blank')await navigateSetup();
    return (await page.evaluate(t=>window.easyDownload.browserSetupStatus(t),ticket.ticket)).paired;
  }).catch(async error=>{
    const diagnostic=await worker.evaluate(async()=>{const s=await chrome.storage.local.get(['bridgeToken','lastStatus']);return {credentialSaved:!!s.bridgeToken,lastStatus:s.lastStatus};});
    diagnostic.wizard=await setup.locator('body').innerText().catch(()=> 'no wizard document');
    diagnostic.urlPath=new URL(setup.url()).pathname;
    throw new Error(error.message+'; '+JSON.stringify(diagnostic));
  });
  console.log('PASS real extension connection confirmation');
  results.push('real Chrome extension bootstrap + authenticated acknowledgement');
  const preflight=await fetch('http://127.0.0.1:24894/v1/browser/submit',{method:'OPTIONS',headers:{origin:'chrome-extension://test','access-control-request-headers':'x-easy-download-bridge,content-type'}});
  assert.match(preflight.headers.get('access-control-allow-headers'),/x-easy-download-bridge/);
  results.push('browser custom-header CORS preflight');
  // A synthetic media fixture through an owned local HTTP proxy. The public
  // URL validator stays intact, and this also verifies saved proxy handoff.
  await worker.evaluate(()=>chrome.storage.local.set({domains:['media.ed-fixture.test']}));
  const source=await browser.newPage();
  await source.route('http://media.ed-fixture.test/sample.mp4',route=>route.fulfill({contentType:'text/html',body:'<title>Synthetic video download fixture</title><h1>Non-DRM fixture</h1>'}));
  await source.goto('http://media.ed-fixture.test/sample.mp4');
  await source.bringToFront();
  const extensionId = new URL(worker.url()).host;
  const popup=await browser.newPage();
  await source.bringToFront();
  // Headless Chromium does not expose the OS toolbar bubble as a Page.
  // Load the exact packaged popup document in an inactive extension tab;
  // chrome.tabs.query still sees the active public-video source tab.
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.waitForLoadState();
  await popup.locator('#direct').click();
  await wait(async()=>{
    const value=await page.evaluate(()=>window.easyDownload.downloadTasks());
    const task=value.tasks.find(t=>t.url.includes('media.ed-fixture.test'));
    if(task?.status==='failed')throw new Error(task.error);
    return task?.status==='completed';
  },180000);
  results.push('real extension popup document button -> bridge -> controller -> saved proxy -> frozen engine -> synthetic MP4 completion (not OS toolbar bubble)');
  console.log('PASS extension synthetic download');
  await page.screenshot({path:path.join(evidence,'download-completed.png'),fullPage:true});
  // Douyin feed resolves the current visible player, not the homepage.
  const dy=await browser.newPage();
  await dy.route('https://www.douyin.com/**',route=>route.fulfill({contentType:'text/html',body:'<div data-e2e="feed-active-video" class="video_7701612994102316328"><video></video></div>'}));
  await dy.goto('https://www.douyin.com/?recommend=1');
  await wait(async()=>{
    try {return (await worker.evaluate(async()=>{const tabs=await chrome.tabs.query({active:true,currentWindow:true});return chrome.tabs.sendMessage(tabs[0].id,{type:'page-video'});})).url==='https://www.douyin.com/video/7701612994102316328';}catch{return false;}
  });
  results.push('real content script chooses active Douyin feed video identity');
  if(process.env.EASY_DOWNLOAD_LIVE_DOUYIN){
    await page.evaluate(proxy=>window.easyDownload.request('/v1/settings',{method:'POST',body:JSON.stringify({proxy,autoProxy:true})}),process.env.EASY_DOWNLOAD_TEST_PROXY||'');
    const real=await browser.newPage();
    const liveUrl=process.env.EASY_DOWNLOAD_LIVE_DOUYIN_URL||'https://www.douyin.com/video/7701612994102316328';
    await real.goto(liveUrl,{waitUntil:'domcontentloaded',timeout:60000});
    const expectedVideoUrl=real.url();
    await popup.close();
    const livePopup=await browser.newPage();
    await real.bringToFront();
    await livePopup.goto(`chrome-extension://${extensionId}/popup.html`);
    await livePopup.locator('#direct').click();
    console.log('SUBMIT real Douyin via extension');
    await wait(async()=>{
      const value=await page.evaluate(()=>window.easyDownload.downloadTasks());
      const task=value.tasks.find(t=>t.url===expectedVideoUrl);
      if(task?.status==='failed')throw new Error(task.error);
      return task?.status==='completed';
    },240000);
    results.push('real Douyin page -> packaged extension popup document -> full actual video download + decode');
  }
  // A different portable app credential must not masquerade as connected.
  await worker.evaluate(()=>chrome.storage.local.set({bridgeToken:'stale-test-credential'}));
  const stale=await worker.evaluate(async()=>{try {await submitUrl('https://www.youtube.com/watch?v=test');return 'unexpected';}catch(e){return e.message;}});
  assert.match(stale,/连接已失效/);
  results.push('stale portable connection is rejected with reconnect guidance');
  console.log(JSON.stringify({ok:true,results,scratch,files:fs.readdirSync(downloads)},null,2));
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({ok:true,results,scratch,executable:executable||'source',at:new Date().toISOString()},null,2));
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close().catch(()=>{});if(app)await app.close().catch(()=>{});if(fixtureServer)fixtureServer.close();});
