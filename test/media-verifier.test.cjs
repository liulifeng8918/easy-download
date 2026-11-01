const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {verifyMedia}=require('../electron/download/media-verifier.cjs');
test('quick checks inspect both ends, reject fake files and wrong duration; deep mode remains available',{skip:process.platform!=='win32'},async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'ed-quick-check-')),ffmpeg=path.resolve(__dirname,'../bin/ffmpeg.exe');
 const video=path.join(folder,'valid.mp4'),fake=path.join(folder,'fake.mp4');fs.writeFileSync(fake,'not media');
 assert.equal(spawnSync(ffmpeg,['-y','-f','lavfi','-i','color=c=blue:s=160x90:d=4','-f','lavfi','-i','sine=frequency=440:duration=4','-c:v','libx264','-c:a','aac','-shortest',video],{windowsHide:true,stdio:'ignore'}).status,0);
 const task={output_path:video,output_dir:folder,quality:'best'};
 assert.equal((await verifyMedia(task,{duration:4,requireAudio:true},ffmpeg)).mode,'quick');
 assert.equal((await verifyMedia(task,{mode:'deep',duration:4,requireAudio:true},ffmpeg)).mode,'deep');
 assert.equal((await verifyMedia(task,{duration:200},ffmpeg)).ok,false);
 assert.equal((await verifyMedia({...task,output_path:fake},{},ffmpeg)).ok,false);
 assert.equal((await verifyMedia({...task,output_dir:path.join(folder,'other')},{},ffmpeg)).ok,false);
});
