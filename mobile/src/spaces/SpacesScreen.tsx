import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/useAuth';
import { useViewerClient } from '../feed/useViewerFeed';
import { contextKey,type FeedContext } from '../feed/context';
import { fetchMySpaces, type MySpaces, type SpaceSummary } from './api';
import { ApiError } from '../api/client';
import { Action, Message } from '../ui/Message';

export function SpacesScreen({selected,onSelect,onSignIn}:{selected:FeedContext;onSelect:(c:FeedContext)=>void;onSignIn:()=>void}) {
  const {snapshot}=useAuth();const {client,auth,generation}=useViewerClient();
  const [data,setData]=useState<MySpaces|null>(null),[error,setError]=useState<string|null>(null),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setData(null);setError(null);
    if(snapshot.status!=='authenticated')return;
    void fetchMySpaces(client,controller.signal).then(data=>{if(!controller.signal.aborted)setData(data);}).catch(e=>{
      if(controller.signal.aborted)return;
      if(e instanceof ApiError && e.status===401)void auth.invalidate(generation);
      setError(e instanceof Error?e.message:'Cannot load spaces.');
    });return()=>controller.abort();
  },[client,revision,snapshot.status]);
  if(snapshot.status!=='authenticated')return <ScrollView contentContainerStyle={styles.flex}><Message scrollable={false} title="Sign in to view your spaces"/><Action label="Account" onPress={onSignIn}/><Action label="Global" onPress={()=>onSelect({kind:'global'})}/></ScrollView>;
  const render=(space:SpaceSummary)=>{
    const context:FeedContext={kind:'space',spaceId:space.id,name:space.name,type:space.type};
    return <View key={space.id} style={styles.entry}>
      <Action label={`${contextKey(selected)===contextKey(context)?'✓ ':''}${space.name}`} onPress={()=>onSelect(context)}/>
      <Text style={styles.detail}>{space.type} · {space.relationship}{space.subscribed && space.relationship!=='subscriber'?' · Subscriber':''}</Text>
    </View>;
  };
  return <ScrollView contentContainerStyle={styles.content}>
    <Action label={selected.kind==='global'?'✓ Global':'Global'} onPress={()=>onSelect({kind:'global'})}/>
    {error?<Message scrollable={false} title="Cannot load spaces" message={error} onRetry={()=>setRevision(v=>v+1)}/>:!data?<Message scrollable={false} title="Loading spaces" busy/>:<>
      {data.personal && <><Text style={styles.heading}>Personal</Text>{render(data.personal)}</>}
      <Text style={styles.heading}>Groups</Text>{data.groups.length?data.groups.map(render):<Text style={styles.detail}>No groups yet.</Text>}
      <Text style={styles.heading}>Channels</Text>{data.channels.length?data.channels.map(render):<Text style={styles.detail}>No channels yet.</Text>}
      <Action label="Refresh spaces" onPress={()=>setRevision(v=>v+1)}/>
    </>}
  </ScrollView>;
}
const styles=StyleSheet.create({flex:{flexGrow:1,backgroundColor:'#000',padding:20,gap:12},content:{padding:20,gap:16},heading:{color:'#fff',fontSize:22,fontWeight:'700'},detail:{color:'#c7c7ce',fontSize:15},entry:{gap:6}});
