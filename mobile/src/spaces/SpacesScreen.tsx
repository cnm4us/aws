import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {AppState,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useIsFocused} from '@react-navigation/native';
import {useAuth} from '../auth/useAuth';
import {useViewerClient} from '../feed/useViewerFeed';
import {contextKey,type FeedContext} from '../feed/context';
import {fetchMySpaces,type MySpaces,type SpaceSummary} from './api';
import {ApiError} from '../api/client';
import {Action,Message} from '../ui/Message';
import {IconButton} from '../ui/IconButton';

export function SpacesScreen({selected,onSelect,onSignIn,onClose,onMenu}:{selected:FeedContext;onSelect:(c:FeedContext)=>void;onSignIn:()=>void;onMenu?:()=>void;onClose:()=>void}){
  const {snapshot}=useAuth();const {client,auth,generation}=useViewerClient();const focused=useIsFocused();
  const [active,setActive]=useState(AppState.currentState==='active');
  const [data,setData]=useState<MySpaces|null>(null),[error,setError]=useState<string|null>(null),[revision,setRevision]=useState(0);
  const selectedOnce=useRef(false);
  const live=useRef({mounted:false,focused});live.current.focused=focused;
  useLayoutEffect(()=>{live.current.mounted=true;return()=>{live.current.mounted=false;};},[]);
  const current=()=>live.current.mounted&&live.current.focused&&AppState.currentState==='active'&&auth.getSnapshot().generation===generation;
  useEffect(()=>{const sub=AppState.addEventListener('change',s=>setActive(s==='active'));return()=>sub.remove();},[]);
  useEffect(()=>{
    const controller=new AbortController();setData(null);setError(null);
    if(!focused||!active||snapshot.status!=='authenticated')return;
    void fetchMySpaces(client,controller.signal).then(value=>{if(!controller.signal.aborted&&current())setData(value);}).catch(e=>{
      if(controller.signal.aborted||!current())return;
      if(e instanceof ApiError&&e.status===401)void auth.invalidate(generation);
      setError('Cannot load spaces. Reconnect and try again.');
    });return()=>controller.abort();
  },[client,revision,snapshot.status,focused,active]);
  const select=(context:FeedContext)=>{if(!current()||selectedOnce.current||context.kind==='space'&&auth.getSnapshot().status!=='authenticated')return;selectedOnce.current=true;onSelect(context);};
  const masked=!focused||!active||snapshot.status==='unavailable'||snapshot.status==='signingOut';
  const render=(space:SpaceSummary)=>{
    const context:FeedContext={kind:'space',spaceId:space.id,name:space.name,type:space.type};
    return <View key={space.id} style={styles.entry}>
      <Action label={`${contextKey(selected)===contextKey(context)?'✓ ':''}${space.name}`} onPress={()=>select(context)}/>
      <Text style={styles.detail}>{space.type} · {space.relationship}{space.subscribed&&space.relationship!=='subscriber'?' · Subscriber':''}</Text>
    </View>;
  };
  return <SafeAreaView accessibilityViewIsModal style={[styles.screen,{backgroundColor:masked?'#000':'rgba(0,0,0,0.8)'}]} edges={['top','bottom','left','right']}>
    <View style={styles.header}><View style={{flexDirection:'row',justifyContent:'space-between'}}><IconButton icon="close" label="Close space menu" onPress={()=>{if(focused)onClose();}}/>{onMenu&&<IconButton icon="menu" label="Open menu" onPress={onMenu}/>}</View><Text accessibilityRole="header" style={styles.heading}>Spaces</Text></View>
    <ScrollView contentContainerStyle={styles.content}>
      {masked?<Message scrollable={false} title="Checking access"/>:<>
        <Action label={selected.kind==='global'?'✓ Global':'Global'} onPress={()=>select({kind:'global'})}/>
        {snapshot.status!=='authenticated'?<><Message scrollable={false} title="Sign in to view your spaces"/><Action label="Account" onPress={()=>{if(current())onSignIn();}}/></>:
          error?<Message scrollable={false} title="Cannot load spaces" message={error} onRetry={()=>{if(current())setRevision(v=>v+1);}}/>:
          !data?<Message scrollable={false} title="Loading spaces" busy/>:<>
            {data.personal&&<><Text style={styles.heading}>Personal</Text>{render(data.personal)}</>}
            <Text style={styles.heading}>Groups</Text>{data.groups.length?data.groups.map(render):<Text style={styles.detail}>No groups yet.</Text>}
            <Text style={styles.heading}>Channels</Text>{data.channels.length?data.channels.map(render):<Text style={styles.detail}>No channels yet.</Text>}
            <Action label="Refresh spaces" onPress={()=>{if(current())setRevision(v=>v+1);}}/>
          </>}
      </>}
    </ScrollView>
  </SafeAreaView>;
}
const styles=StyleSheet.create({screen:{flex:1},header:{padding:16,gap:8},content:{padding:20,gap:16},heading:{color:'#fff',fontSize:22,fontWeight:'700'},detail:{color:'#c7c7ce',fontSize:15},entry:{gap:6}});
