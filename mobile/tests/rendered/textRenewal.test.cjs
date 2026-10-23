const assert=require('node:assert/strict'),test=require('node:test');
const {bundle,React:R,Test}=require('./harness.cjs');

for(const resource of ['captions','story'])test(`protected ${resource}: quiet renewal, hard cache deadline, failure and Retry`,async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0,root;
 const {CaptionLayer,StoryPanel,TextResources,ApiError}=await bundle("export {CaptionLayer} from './src/content/CaptionLayer';export {StoryPanel} from './src/content/StoryPanel';export {TextResources} from './src/content/resources';export {ApiError} from './src/api/client';");
 const requests=[],denials=[];
 const request=(path,signal)=>new Promise((resolve,reject)=>requests.push({path,signal,resolve,reject}));
 const resources=new TextResources({getText:request,getJson:request},{kind:'space',spaceId:9},e=>denials.push(e),()=>now);
 const sample=text=>resource==='captions'?`WEBVTT\n\n00:00.000 --> 00:09.000\n${text}`:{context:{kind:'space',spaceId:9},publicationId:1,storyText:text};
 const player={subscribeClock:fn=>{fn(5);return()=>{};}};
 let props=resource==='captions'?{resources,publicationId:1,duration:10,player,visible:true,bottom:40,paused:true}:{resources,publicationId:1,preview:'Preview',active:true,height:600,onExpanded:()=>{}};
 const component=resource==='captions'?CaptionLayer:StoryPanel;
 const render=async patch=>{props={...props,...patch};await Test.act(async()=>root?root.update(R.createElement(component,props)):root=Test.create(R.createElement(component,props)));};
 const texts=()=>root.root.findAllByType('Text').map(n=>n.props.children);
 const press=async label=>{await Test.act(async()=>root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel===label).props.onPress());};
 const tick=async ms=>{now+=ms;await Test.act(async()=>t.mock.timers.tick(ms));};
 const settle=async text=>{await Test.act(async()=>requests.at(-1).resolve(sample(text)));};
 try{
  await render({});if(resource==='story')await press('Expand story');await settle('Current protected text');assert.ok(texts().includes('Current protected text'));
  await tick(45_000);assert.equal(requests.length,2);assert.ok(texts().includes('Current protected text'));assert.equal(root.root.findAllByType('ActivityIndicator').length,0);
  await tick(1000);await settle('Renewed protected text');assert.ok(texts().includes('Renewed protected text'));
  // Collapse/hide and reopen at age 55s since the request that verified this text.
  if(resource==='story')await press('Collapse story');else await render({visible:false});
  await tick(54_000);
  if(resource==='story')await press('Expand story');else await render({visible:true});
  assert.ok(texts().includes('Renewed protected text'));assert.equal(requests.length,2,'cache read should not pretend to verify access again');
  await tick(0);assert.equal(requests.length,3);assert.ok(texts().includes('Renewed protected text'));
  await tick(4999);assert.ok(texts().includes('Renewed protected text'));await tick(1);
  assert.ok(!texts().includes('Renewed protected text'));assert.equal(requests[2].signal.aborted,true);
  await settle('Late private text');assert.ok(!texts().includes('Late private text'));
  await press(resource==='captions'?'Retry captions':'Retry story');await settle('Recovered private text');assert.ok(texts().includes('Recovered private text'));
  await tick(45_000);await Test.act(async()=>requests.at(-1).reject(new Error('Offline')));assert.ok(!texts().includes('Recovered private text'));
  await press(resource==='captions'?'Retry captions':'Retry story');await settle('Before denial');await tick(45_000);
  await Test.act(async()=>requests.at(-1).reject(new ApiError('Permission removed',403,'forbidden')));assert.equal(denials.length,1);assert.ok(!texts().includes('Before denial'));
 }finally{if(root)await Test.act(async()=>root.unmount());resources.clear();t.mock.timers.reset();}
});
