import assert from 'node:assert/strict';
import test from 'node:test';
import { CreatorStore,adaptCreator } from '../src/profiles/creatorStore';
import { ApiError } from '../src/api/client';
import { StackRouter,CommonActions,StackActions } from '@react-navigation/routers';

const view={creator:{id:2,displayName:'Creator',handle:null,avatarUrl:null,bio:null},personalEntry:{state:'allowed',space:{id:8,name:'Personal',slug:'personal',ulid:null,type:'personal'}}};
test('creator adapter minimizes fields, ignores denied metadata and rejects wrong identities',()=>{
  const adapted=adaptCreator({...view,creator:{...view.creator,email:'hidden',avatarUrl:'https://user:pass@example.test/private'}},2);
  assert.equal(adapted.creator.avatarUrl,null);assert.equal(JSON.stringify(adapted).includes('hidden'),false);
  assert.throws(()=>adaptCreator({...view,creator:{...view.creator,id:3}},2));
  assert.throws(()=>adaptCreator({...view,personalEntry:{...view.personalEntry,space:{...view.personalEntry.space,type:'group'}}},2));
  const denied=adaptCreator({...view,personalEntry:{state:'unavailable',space:view.personalEntry.space}},2);
  assert.deepEqual(denied.personalEntry,{state:'unavailable'});
});
test('personal entry rechecks permission and coalesces repeated taps',async()=>{
  let calls=0,resolve!:(v:unknown)=>void;
  const store=new CreatorStore({getJson:async()=>{calls++;if(calls===1)return view;return new Promise(r=>{resolve=r;});}},2);
  await store.refresh();const pending=store.enter();assert.equal(await store.enter(),null);assert.equal(calls,2);
  resolve({...view,personalEntry:{state:'unavailable'}});assert.equal(await pending,null);
  assert.equal(store.getSnapshot().view?.personalEntry.state,'unavailable');
});
test('cancelled profile/entry responses cannot navigate or invalidate another identity',async()=>{
  let resolve!:(v:unknown)=>void,invalidated=0;let calls=0;
  const store=new CreatorStore({getJson:async()=>{calls++;return calls===1?view:new Promise(r=>{resolve=r;});}},2,()=>invalidated++);
  await store.refresh();const pending=store.enter();store.cancel();resolve(view);
  assert.equal(await pending,null);assert.equal(invalidated,0);
  const expired=new CreatorStore({getJson:async()=>{throw new ApiError('Expired',401);}},2,()=>invalidated++);
  await expired.refresh();assert.equal(invalidated,1);assert.equal(expired.getSnapshot().view,null);
});
test('profile not found and network failures leave retryable state without stale optional fields',async()=>{
  let error:unknown=null;const store=new CreatorStore({getJson:async()=>{if(error)throw error;return view;}},2);
  await store.refresh();error=new ApiError('Unavailable',404);await store.refresh();assert.equal(store.getSnapshot().missing,true);assert.equal(store.getSnapshot().view,null);
  error=new ApiError('Offline');await store.refresh();assert.equal(store.getSnapshot().missing,false);assert.equal(store.getSnapshot().loading,false);
  error=null;await store.refresh();assert.equal(store.getSnapshot().view?.creator.id,2);
});
test('single Feed detours preserve Account/Settings parent and do not accumulate routes',()=>{
  const router=StackRouter({initialRouteName:'Feed'});
  const options={routeNames:['Feed','CreatorProfile','Account','Settings','Spaces'],routeParamList:{},routeGetIdList:{}};
  let state=router.getInitialState(options);
  const dispatch=(action:any)=>{const next=router.getStateForAction(state,action,options);assert.ok(next && next.stale===false);state=next;};
  for(let i=0;i<15;i++){
    dispatch(CommonActions.navigate('CreatorProfile',{creatorId:2,journeyGeneration:i}));
    for(const name of ['Account','Settings']){dispatch(CommonActions.navigate(name));dispatch(CommonActions.goBack());assert.equal(state.routes[state.index].name,'CreatorProfile');}
    dispatch(StackActions.popTo('Feed'));assert.equal(state.routes.length,1);
    dispatch(CommonActions.navigate('CreatorProfile',{creatorId:2,journeyGeneration:i}));
    dispatch(CommonActions.goBack());assert.equal(state.routes.length,1);
  }
});
