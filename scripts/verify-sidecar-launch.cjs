const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {sidecarArguments}=require('../electron/download/sidecar-launch.cjs');
const root=path.resolve(__dirname,'..');
const token='-isolated-launch-regression-credential-32-plus';
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'ed-sidecar-launch-'));
const appRoot=process.env.EASY_DOWNLOAD_TEST_APP_ROOT||root;
const child=spawn(path.join(appRoot,'runtime','easy_download_sidecar.exe'),sidecarArguments({port:29893,token,root:appRoot}),{env:{...process.env,LOCALAPPDATA:scratch},stdio:'ignore',windowsHide:true});
(async()=>{
  const end=Date.now()+30000;
  while(Date.now()<end){
    if(child.exitCode!==null)throw new Error('Frozen sidecar exited before health check');
    try{
      const r=await fetch('http://127.0.0.1:29893/health',{headers:{'X-Easy-Download-Session':token}});
      const health=await r.json();
      assert.equal(r.status,200);assert.equal(health.engineRevision,'1.0.1-r1');
      console.log('PASS frozen sidecar starts and authenticates with a dash-prefixed credential');
      return;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error('Dash-prefixed startup health check timed out');
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{
  if(child.pid)spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
});
