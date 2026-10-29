import {useEffect,useRef,useState} from 'react';
import {AppState,View,Text} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useIsFocused} from '@react-navigation/native';
import {useAuth} from '../auth/useAuth';
import {ViewerHeader} from '../ui/ViewerHeader';
import {Action,Message} from '../ui/Message';
import {contextName,type AggregateKind} from '../feed/context';
export function DestinationEntryScreen({kind,onEnter,onClose,onMenu,onAccount}:{kind:AggregateKind;onEnter:(fresh:boolean)=>Promise<void>;onClose:()=>void;onMenu:()=>void;onAccount:()=>void}){
 const {snapshot}=useAuth(),focused=useIsFocused(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[active,setActive]=useState(AppState.currentState==='active'),started=useRef(false),live=useRef(false);
 useEffect(()=>{live.current=focused;return()=>{live.current=false;};},[focused]);
 const enter=async(fresh=false)=>{if(!live.current||busy||AppState.currentState!=='active')return;setBusy(true);setError('');try{await onEnter(fresh);}catch(e){if(live.current&&AppState.currentState==='active')setError(e instanceof Error?e.message:'Cannot open this feed.');}finally{if(live.current)setBusy(false);}};
 useEffect(()=>{const sub=AppState.addEventListener('change',state=>{setActive(state==='active');if(state!=='active'){setBusy(false);setError('Opening paused while the app was away. Retry when you are ready.');}});return()=>sub.remove();},[]);
 useEffect(()=>{if(!started.current&&focused&&active&&snapshot.status==='authenticated'){started.current=true;void enter();}},[focused,snapshot.status,active]);
 return <SafeAreaView style={{flex:1,backgroundColor:'#000'}} edges={['top','bottom','left','right']}><ViewerHeader title={contextName({kind})} onBack={onClose} onMenu={onMenu} menuDisabled={busy}/>
  <View style={{flex:1,padding:20,gap:16}}>{!active||!focused?null:snapshot.status!=='authenticated'?<><Text style={{color:'#fff',fontSize:17}}>Sign in to view {contextName({kind})}.</Text><Action label="Sign in" onPress={onAccount}/></>:busy?<Message title="Loading feed" busy/>:error?<><Message title="Cannot restore feed" message={error}/><Action label="Retry feed" onPress={()=>{void enter();}}/><Action label="Start from current feed" onPress={()=>{void enter(true);}}/></>:null}</View>
 </SafeAreaView>;
}
