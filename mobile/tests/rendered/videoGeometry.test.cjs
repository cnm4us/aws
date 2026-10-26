const assert=require('node:assert/strict');
const test=require('node:test');
const {bundle,React:R,Test}=require('./harness.cjs');
test('presentation geometry ignores stale source reads, uses displayed orientation and cleans size listeners',async()=>{
 const {useVideoSize,createNativePlayer,e}=await bundle("export {useVideoSize} from './src/playback/useVideoSize';export {createNativePlayer} from './src/playback/useFeedPlayback';");
 const reads=[];e.presentationSize=()=>new Promise(resolve=>reads.push(resolve));const player=createNativePlayer();let value,root;
 function Probe({source,frame=false}){value=useVideoSize(player,source,{width:100,height:200},frame,'readyToPlay');return null;}
 try{
  await Test.act(async()=>{root=Test.create(R.createElement(Probe,{source:'a'}));});assert.equal(player.native.count(),2);
  await Test.act(async()=>root.update(R.createElement(Probe,{source:'b'})));assert.equal(player.native.count(),2);
  await Test.act(async()=>reads[0]({width:1920,height:1080}));assert.deepEqual(value,{width:100,height:200});
  await Test.act(async()=>reads[1]({width:720,height:1280}));assert.deepEqual(value,{width:720,height:1280});
  await Test.act(async()=>player.native.emit('videoTrackChange',{videoTrack:{size:{width:1280,height:720}}}));
  await Test.act(async()=>reads[2]({width:1080,height:1920}));assert.deepEqual(value,{width:720,height:1280},'Same aspect ratio retains stable geometry');
  await Test.act(async()=>root.update(R.createElement(Probe,{source:'b',frame:true})));await Test.act(async()=>root.unmount());root=null;
  await Test.act(async()=>reads[3]({width:1,height:1}));assert.equal(player.native.count(),0);assert.equal(player.native.loads,0);
 }finally{if(root)await Test.act(async()=>root.unmount());player.release();}
});
