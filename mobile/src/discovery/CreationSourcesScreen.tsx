import {useEffect,useRef,useState} from 'react';
import {AppState,ScrollView,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useIsFocused} from '@react-navigation/native';
import {useViewerClient} from '../feed/useViewerFeed';
import {contextName,type SourceContext} from '../feed/context';
import {ViewerHeader} from '../ui/ViewerHeader';
import {Action,Message} from '../ui/Message';
export type CreationSource={publicationId:number;spaceId:number;productionUlid:string;sourceContext:SourceContext};
export function CreationSourcesScreen({publicationId,onSelect,onAbout,onClose,onMenu}:{publicationId:number;onSelect:(source:CreationSource)=>void;onAbout:(source:CreationSource)=>void;onClose:()=>void;onMenu:()=>void}){
 const {client,auth,generation}=useViewerClient(),focused=useIsFocused(),[items,setItems]=useState<CreationSource[]|null>(null),[error,setError]=useState(''),[revision,setRevision]=useState(0),[active,setActive]=useState(AppState.currentState==='active');
 const live=useRef({focused,active});live.current={focused,active};
 const current=()=>live.current.focused&&live.current.active&&auth.getSnapshot().generation===generation&&AppState.currentState==='active';
 useEffect(()=>{const sub=AppState.addEventListener('change',state=>setActive(state==='active'));return()=>{sub.remove();live.current={focused:false,active:false};};},[]);
 useEffect(()=>{setItems(null);if(!focused||!active)return;setError('');const request=new AbortController();
 void client.getJson(`/api/viewer/v1/feed/creations/publications/${publicationId}/contexts`,request.signal).then((raw:any)=>{
  if(request.signal.aborted||auth.getSnapshot().generation!==generation||AppState.currentState!=='active')return;
  if(raw?.publicationId!==publicationId||!Array.isArray(raw.items)||raw.items.length>500)throw Error('Invalid publication contexts.');
  const rows=raw.items.map((row:any)=>{const c=row.sourceContext;if(!Number.isSafeInteger(row.publicationId)||row.publicationId<=0||!Number.isSafeInteger(row.spaceId)||row.spaceId<=0||typeof row.productionUlid!=='string'||!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(row.productionUlid)||!c||!(c.kind==='global'||c.kind==='space'&&c.spaceId===row.spaceId&&typeof c.name==='string'&&c.name.length<=255&&['personal','group','channel'].includes(c.type)))throw Error('Invalid publication context.');return row as CreationSource;});setItems(rows);
 }).catch(e=>{if(current()&&!request.signal.aborted)setError(e instanceof Error?e.message:'Cannot load publication contexts.');});return()=>request.abort();
 },[client,focused,generation,publicationId,revision,active]);
 return <SafeAreaView style={{flex:1,backgroundColor:'#0b0d12'}} edges={['top','bottom','left','right']}>
  <ViewerHeader title="Published in" onBack={()=>{if(current())onClose();}} onMenu={()=>{if(current())onMenu();}}/>
  <ScrollView contentContainerStyle={{padding:20,gap:16}}>
   {!focused||!active?null:error?<Message scrollable={false} title="Cannot load publications" message={error} onRetry={()=>{setError('');setRevision(v=>v+1);}}/>:!items?<Message scrollable={false} title="Loading publications" busy/>:<>
    <Text style={{color:'#d2d7e2',fontSize:17,lineHeight:25}}>Choose a place to watch this video or read its rules.</Text>
    {items.map(row=>{
     const name=contextName(row.sourceContext);
     return <View key={row.publicationId} style={{padding:14,gap:10,borderRadius:14,borderWidth:1,borderColor:'#343d4d',backgroundColor:'#171c26'}}>
      <Action label={`${name}${row.sourceContext.kind==='space'?` · ${row.sourceContext.type}`:''}`} onPress={()=>{if(current())onSelect(row);}}/>
      <Action label={`About & Rules: ${name}`} onPress={()=>{if(current())onAbout(row);}}/>
     </View>;
    })}
   </>}
  </ScrollView>
 </SafeAreaView>;
}
