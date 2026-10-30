import {useEffect,useRef,useState} from 'react';
import {Alert,AppState,ScrollView,Text,View,useWindowDimensions} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useIsFocused} from '@react-navigation/native';
import {useAuth} from '../auth/useAuth';
import {useViewerClient} from '../feed/useViewerFeed';
import {ViewerHeader} from '../ui/ViewerHeader';
import {Action,Message} from '../ui/Message';
import {SpaceCard} from './SpaceCard';
import {adaptCard,discoveryPrefix,type SpaceCard as Card} from './api';

type AccessRow={id:number;name:string;status:string;kind:string;validUntil:string|null;space:Card|null};
type Support={id:number;status:string;provider:string;amountCents:number|null;currency:string;pendingAction:string|null;canCancel:boolean};
function adapt(raw:any){
 if(!raw||!Array.isArray(raw.items)||raw.items.length>20||!Array.isArray(raw.support)||raw.support.length>20||!(raw.nextCursor===null||typeof raw.nextCursor==='string'&&raw.nextCursor.length<=250))throw Error('Unexpected subscriptions.');
 const items:AccessRow[]=raw.items.map((r:any)=>{if(!Number.isSafeInteger(r.id)||r.id<=0||typeof r.name!=='string'||r.name.length>255||!['active','canceled','past_due','expired'].includes(r.status)||!['Free subscription','Existing channel access'].includes(r.kind)||!(r.validUntil===null||typeof r.validUntil==='string'&&Number.isFinite(Date.parse(r.validUntil.replace(' ','T')+'Z'))))throw Error('Unexpected channel access.');return {...r,space:r.space===null?null:adaptCard(r.space)};});
 const support:Support[]=raw.support.map((r:any)=>{if(!Number.isSafeInteger(r.id)||r.id<=0||!['pending','active','suspended','canceled','expired'].includes(r.status)||r.provider!=='paypal'||!(r.amountCents===null||Number.isSafeInteger(r.amountCents)&&r.amountCents>=0)||!/^[A-Z]{3}$/.test(r.currency)||!(r.pendingAction===null||['cancel','resume','change_plan'].includes(r.pendingAction))||typeof r.canCancel!=='boolean')throw Error('Unexpected billing information.');return r;});return {items,support,nextCursor:raw.nextCursor as string|null};
}
export function SubscriptionsScreen({onMenu,onClose,onSelect,onAbout}:{onMenu:()=>void;onClose:()=>void;onSelect:(space:Card)=>void;onAbout:(space:Card)=>void}){
 const {baseUrl,snapshot}=useAuth();
 const {client,auth,generation}=useViewerClient(),focused=useIsFocused(),dimensions=useWindowDimensions();
 const [active,setActive]=useState(AppState.currentState==='active'),[data,setData]=useState<ReturnType<typeof adapt>|null>(null),[error,setError]=useState(''),[version,setVersion]=useState(0),[busy,setBusy]=useState(false),[width,setWidth]=useState(dimensions.width);
 const live=useRef({focused,active});live.current={focused,active};const visible=()=>live.current.focused&&live.current.active&&AppState.currentState==='active'&&auth.getSnapshot().generation===generation;const current=()=>visible()&&auth.getSnapshot().status==='authenticated';
 const page=useRef<AbortController|null>(null),epoch=useRef(0);
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>setActive(s==='active'));return()=>{sub.remove();live.current={focused:false,active:false};};},[]);
 useEffect(()=>{const request=new AbortController(),visit=++epoch.current;page.current?.abort();setData(null);setBusy(false);setError('');if(!current())return;
  void client.getJson(`${discoveryPrefix}/subscriptions`,request.signal).then(raw=>{if(current()&&epoch.current===visit&&!request.signal.aborted)setData(adapt(raw));}).catch(e=>{if(current()&&!request.signal.aborted)setError(e.message);});return()=>{request.abort();page.current?.abort();++epoch.current;};
 },[client,focused,active,generation,version,snapshot.status]);
 const save=async(space:Card)=>{if(!current()||busy)return;setBusy(true);try{await client.postJson(`${discoveryPrefix}/save-v2/${space.id}`,{saved:!space.saved});if(current())setData(previous=>previous?{...previous,items:previous.items.map(r=>r.space?.id===space.id?{...r,space:{...r.space,saved:!space.saved}}:r)}:previous);}catch(e){if(current())setError((e as Error).message);}finally{if(current())setBusy(false);}};
 const cancel=(s:Support)=>{if(!current()||busy)return;Alert.alert('Cancel support subscription?','This requests cancellation from the payment provider. Your saved shortcuts will not change.',[{text:'Keep subscription',style:'cancel'},{text:'Cancel subscription',style:'destructive',onPress:()=>{if(!current())return;setBusy(true);void client.postJson(`${discoveryPrefix}/subscriptions/${s.id}/cancel`,{}).then(()=>{if(current())setVersion(v=>v+1);}).catch(e=>{if(current()){setError(e.message);setBusy(false);}});}}]);};
 return <SafeAreaView style={{flex:1,backgroundColor:'#0b0d12'}} edges={['top','bottom','left','right']}><ViewerHeader title="Subscriptions" onMenu={()=>{if(visible())onMenu();}} onBack={()=>{if(visible())onClose();}}/><View style={{flex:1}} onLayout={e=>setWidth(e.nativeEvent.layout.width)}><ScrollView contentContainerStyle={{padding:20,gap:18}}>
  {!focused||!active?null:snapshot.status!=='authenticated'?<Message scrollable={false} title="Verify sign-in to view subscriptions"/>:<>{error&&<Message scrollable={false} title="Cannot confirm subscriptions" message={error} onRetry={()=>setVersion(v=>v+1)}/>}{!data&&!error?<Message scrollable={false} title="Loading subscriptions" busy/>:data&&<>
   <Text style={{color:'#d2d7e2',fontSize:17,lineHeight:25}}>Subscriptions and existing channel access are listed here whether or not you save their shortcuts.</Text>
   {data.items.length===0&&<Text style={{color:'#fff',fontSize:17}}>No channel subscriptions or access records yet.</Text>}
   {data.items.map(r=><View key={r.id} style={{gap:10}}><Text style={{color:'#d2d7e2',fontSize:17}}>{r.kind} · {r.status}{r.validUntil?` · Until ${new Date(r.validUntil.replace(' ','T')+'Z').toLocaleDateString()}`:''}</Text>{r.space?<SpaceCard collectionLabels space={r.space} baseUrl={baseUrl} width={Math.max(0,width-40)} largeText={dimensions.fontScale>=1.3} saving={busy} onOpen={()=>{if(current())onSelect(r.space!);}} onAbout={()=>{if(current())onAbout(r.space!);}} onSave={()=>void save(r.space!)}/>:<Text style={{color:'#fff',fontSize:17}}>{r.name}</Text>}</View>)}
   {data.nextCursor&&<Action disabled={busy} label="More subscriptions" onPress={()=>{if(!current()||busy)return;setBusy(true);const visit=epoch.current,request=new AbortController();page.current=request;void client.getJson(`${discoveryPrefix}/subscriptions?cursor=${encodeURIComponent(data.nextCursor!)}`,request.signal).then(raw=>{if(current()&&epoch.current===visit&&!request.signal.aborted){const next=adapt(raw);setData(previous=>previous?{...next,items:[...previous.items,...next.items.filter(r=>!previous.items.some(old=>old.id===r.id))],support:[...previous.support,...next.support.filter(r=>!previous.support.some(old=>old.id===r.id))]}:next);}}).catch(e=>{if(current()&&!request.signal.aborted)setError(e.message);}).finally(()=>{if(current()&&epoch.current===visit)setBusy(false);});}}/>}
   {!!data.support.length&&<Text style={{color:'#fff',fontSize:22,fontWeight:'700'}} accessibilityRole="header">Site support subscriptions</Text>}
   {data.support.map(s=><View key={s.id} style={{gap:10,padding:14,borderWidth:1,borderColor:'#343d4d',borderRadius:14}}><Text style={{color:'#fff',fontSize:17}}>PayPal support · {s.status}{s.pendingAction?` · ${s.pendingAction} pending`:''}</Text>{s.amountCents!==null&&<Text style={{color:'#d2d7e2',fontSize:17}}>{s.currency} {(s.amountCents/100).toFixed(2)}</Text>}<Text style={{color:'#d2d7e2',fontSize:15}}>This billing record does not identify a channel subscription.</Text>{s.status==='active'&&!s.pendingAction&&!s.canCancel&&<Text style={{color:'#d2d7e2',fontSize:15}}>Subscription management is currently unavailable.</Text>}{s.canCancel&&<Action label={`Cancel support subscription ${s.id}`} disabled={busy} onPress={()=>cancel(s)}/>}</View>)}
   <Action label="Refresh subscriptions" disabled={busy} onPress={()=>setVersion(v=>v+1)}/>
  </>}</>}
 </ScrollView></View></SafeAreaView>;
}
