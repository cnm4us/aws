import assert from 'node:assert/strict';
import test from 'node:test';
import {feedGeometry,FEED_NAVIGATION_HEIGHT} from '../src/feed/feedGeometry';
const close=(a:number,b:number)=>assert.ok(Math.abs(a-b)<.001,`${a} != ${b}`);
test('width-fit portrait geometry crops both vertical edges equally on a shorter phone',()=>{
 const g=feedGeometry(375,667-FEED_NAVIGATION_HEIGHT,{width:720,height:1280});
 close(g.mediaHeight,666.666666);close(g.mediaTop,-31.833333);close(g.mediaHeight+g.mediaTop-g.pageHeight,-g.mediaTop);assert.equal(g.width,375);
});
test('tall phones and landscape/square sources stay full-width, top-aligned with black spare space',()=>{
 for(const size of [{width:720,height:1280},{width:1920,height:1080},{width:1000,height:1000}]){
  const g=feedGeometry(390,844-64-34,size);assert.equal(g.mediaTop,0);assert.equal(g.width,390);close(g.mediaHeight/g.width,size.height/size.width);assert.ok(g.visibleHeight<=g.pageHeight);
 }
});
test('page height stays fixed across mixed source shapes and invalid geometry stays finite',()=>{
 for(const size of [{width:9,height:30},{width:16,height:9},null,{width:0,height:0},{width:NaN,height:Infinity}]){
  const g=feedGeometry(320,500,size);assert.equal(g.pageHeight,500);assert.ok(Object.values(g).every(v=>typeof v!=='number'||Number.isFinite(v)));
 }
 const g=feedGeometry(NaN,-1,null);assert.equal(g.width,0);assert.equal(g.pageHeight,0);
});
