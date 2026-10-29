import {FeedDestinationTile} from './FeedDestinationTile';
import type {AggregateKind} from '../feed/context';
import {useEffect,useRef,useState} from 'react';
import {AccessibilityInfo,AppState,findNodeHandle,ScrollView,StyleSheet,Text,useWindowDimensions,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useIsFocused} from '@react-navigation/native';
import {useAuth} from '../auth/useAuth';
import {useViewerClient} from '../feed/useViewerFeed';
import {Action,Message} from '../ui/Message';
import {adaptCard,adaptDirectory,discoveryPrefix,type SpaceCard as Card} from './api';
import {SpaceCard} from './SpaceCard';
import {ViewerHeader} from '../ui/ViewerHeader';
import {cardLayout,CARD_GAP,PAGE_PADDING} from './cardLayout';

export function DiscoveryScreen({mode='home',genre,overlay=false,onSelect,onAbout,onMenu,onRecent,onGenre,onAccount,onClose,onAggregate}:{mode?:'home'|'saved'|'groups'|'channels'|'chooser'|'recent'|'genre';onAggregate?:(kind:AggregateKind)=>void;overlay?:boolean;genre?:{slug:string;name:string};onSelect:(space:Card)=>void;onAbout:(space:Card)=>void;onMenu?:()=>void;onRecent:()=>void;onGenre:(genre:{slug:string;name:string})=>void;onAccount:()=>void;onClose?:()=>void}) {
  const [chooserType,setChooserType]=useState<'groups'|'channels'>('groups');
  const savedType=mode==='groups'||mode==='channels'?mode:mode==='chooser'?chooserType:null;
  const savedMode=mode==='saved'||!!savedType;
  const savedLabel=savedType==='groups'?'Your Groups':savedType==='channels'?'Your Channels':'Your Spaces';
  const {snapshot,baseUrl}=useAuth(),{client,auth,generation}=useViewerClient(),focused=useIsFocused();
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[version,setVersion]=useState(0),[busy,setBusy]=useState(false),[active,setActive]=useState(AppState.currentState==='active');
  const dataClient=useRef(client),pageGeneration=useRef(0),pagination=useRef<AbortController|null>(null);
  const dimensions=useWindowDimensions(),[safeWidth,setSafeWidth]=useState(dimensions.width);
  const width=Math.max(0,safeWidth-PAGE_PADDING*2),layout=cardLayout(width,dimensions.fontScale),largeText=dimensions.fontScale>=1.3;
  const pending=useRef(new Set<number>()),[saving,setSaving]=useState<Set<number>>(new Set()),[saveErrors,setSaveErrors]=useState<Record<number,string>>({});
  const aboutRefs=useRef(new Map<string,View>()),returnFocus=useRef<string|null>(null);
  const offsets=useRef<Record<string,number>>({}),[status,setStatus]=useState(''),heading=useRef<Text>(null);
  useEffect(()=>{if(savedType)setData(null);},[savedType]);
  useEffect(()=>{pending.current=new Set();setSaving(new Set());setSaveErrors({});setStatus('');},[client]);
  useEffect(()=>{if(status)AccessibilityInfo.announceForAccessibility?.(status);},[status]);
  const live=useRef({focused,active,generation});live.current={focused,active,generation};
  const current=()=>live.current.focused&&AppState.currentState==='active'&&auth.getSnapshot().generation===generation;
  const read=async(signal:AbortSignal)=>{
    if(mode==='home') {
      const raw=await client.getJson(`${discoveryPrefix}/home`,signal) as any;
      if(!raw||!Array.isArray(raw.genres)||raw.genres.length>6||!Array.isArray(raw.recent))throw Error('Unexpected discovery information.');
      return {recentFeeds:Array.isArray(raw.recentFeeds)?raw.recentFeeds.filter((r:any)=>['following','creations'].includes(r.kind)):[],global:adaptCard(raw.global),recent:raw.recent.map(adaptCard),genres:raw.genres.map((g:any)=>{
        if(typeof g.slug!=='string'||!/^[a-z0-9-]{1,80}$/.test(g.slug)||typeof g.name!=='string'||g.name.length>100||!Array.isArray(g.items)||g.items.length>12)throw Error('Unexpected genres.');
        return {slug:g.slug,name:g.name,items:g.items.map(adaptCard)};
      })};
    }
    if(savedMode) {
      const raw=await client.getJson(`${discoveryPrefix}/saved${savedType?'?type='+ (savedType==='groups'?'group':'channel'):''}`,signal) as any;
      return {...adaptDirectory(raw),global:raw.global?adaptCard(raw.global):null,personal:raw.personal?adaptCard(raw.personal):null};
    }
    if(mode==='recent'){const raw=await client.getJson(`${discoveryPrefix}/recent`,signal) as any;return {...adaptDirectory(raw),recentFeeds:Array.isArray(raw.recentFeeds)?raw.recentFeeds.filter((r:any)=>['following','creations'].includes(r.kind)):[]};}
    return adaptDirectory(await client.getJson(`${discoveryPrefix}/directory?genre=${encodeURIComponent(genre!.slug)}`,signal));
  };
  useEffect(()=>{const sub=AppState.addEventListener('change',s=>setActive(s==='active'));return()=>sub.remove();},[]);
  useEffect(()=>{const controller=new AbortController();++pageGeneration.current;pagination.current?.abort();pagination.current=null;setBusy(false);if(!focused||!active)return;
    if(snapshot.status==='unavailable'||snapshot.status==='signingOut'){setData(null);return;}
    if((savedMode||mode==='recent')&&snapshot.status!=='authenticated'){setData(null);return;}
    if(dataClient.current!==client)setData(null);
    setSaving(new Set(pending.current));setError('');void read(controller.signal).then(value=>{if(current()&&!controller.signal.aborted){dataClient.current=client;setData(value)}}).catch(e=>{if(current()&&!controller.signal.aborted)setError(e instanceof Error?e.message:'Cannot load spaces.');});
    return()=>{controller.abort();++pageGeneration.current;pagination.current?.abort();pagination.current=null;};
  },[client,focused,active,mode,genre?.slug,savedType,version,snapshot.status]);
  useEffect(()=>{if(!focused||!active||!data||returnFocus.current===null)return;
    const id=returnFocus.current;const timer=setTimeout(()=>{const node=aboutRefs.current.get(id);const target=node?findNodeHandle(node):null;if(target){AccessibilityInfo.setAccessibilityFocus(target);returnFocus.current=null;}},0);
    return()=>clearTimeout(timer);
  },[focused,active,!!data]);
  const mutate=async(space:Card)=>{
    if(!current()||pending.current.has(space.id))return;if(snapshot.status!=='authenticated'){onAccount();return;}
    const operations=pending.current;operations.add(space.id);setSaving(new Set(operations));setSaveErrors(e=>({...e,[space.id]:''}));
    try {
      await client.postJson(`${discoveryPrefix}/spaces/${space.id}/save`,{saved:!space.saved});
      if(!current()||pending.current!==operations)return;
      const update=(s:Card)=>s.id===space.id?{...s,saved:!space.saved}:s;
      setData((previous:any)=>previous?{...previous,items:previous.items?.filter((s:Card)=>!(savedMode&&space.saved&&s.id===space.id)).map(update),recent:previous.recent?.map(update),genres:previous.genres?.map((g:any)=>({...g,items:g.items.map(update)}))}:previous);
      setStatus(`${space.saved?'Removed':'Saved'} ${space.name}${space.saved?' from':' to'} ${onAggregate?(space.type==='group'?'Your Groups':'Your Channels'):'Your Spaces'}.`);
      if(savedMode&&space.saved)setTimeout(()=>{if(current()){const target=findNodeHandle(heading.current);if(target)AccessibilityInfo.setAccessibilityFocus(target);}},0);
    } catch(e) {
      if(current()&&pending.current===operations)setSaveErrors(errors=>({...errors,[space.id]:'Could not confirm saving. Tap the checkbox to try again, or reopen this page to refresh.'}));
    } finally {operations.delete(space.id);if(current()&&pending.current===operations)setSaving(new Set(operations));}
  };
  const tile=(space:Card,cardWidth:number,scope='list')=><SpaceCard key={space.id} space={space} baseUrl={baseUrl} width={cardWidth} largeText={largeText}
    collectionLabels={!!onAggregate} saving={saving.has(space.id)} error={saveErrors[space.id]} onOpen={()=>{if(current())onSelect(space);}} aboutRef={node=>{if(node)aboutRefs.current.set(`${scope}:${space.id}`,node);else aboutRefs.current.delete(`${scope}:${space.id}`);}} onAbout={()=>{if(current()){returnFocus.current=`${scope}:${space.id}`;onAbout(space);}}} onSave={()=>void mutate(space)}/>;
  const feedRow=(id:string,kinds:AggregateKind[])=><ScrollView key={id} horizontal testID={`feed-row-${id}`} style={{flexGrow:0}} contentContainerStyle={styles.tiles} contentOffset={{x:offsets.current[id]||0,y:0}} onScroll={event=>{offsets.current[id]=event.nativeEvent.contentOffset.x;}} scrollEventThrottle={100}>{kinds.map(kind=><FeedDestinationTile key={kind} kind={kind} baseUrl={baseUrl} width={layout.carouselWidth} signedIn={snapshot.status==='authenticated'} onOpen={()=>{if(current())onAggregate?.(kind);}}/>)}</ScrollView>;
  const carousel=(id:string,items:Card[])=><ScrollView key={id} horizontal style={{flexGrow:0}} testID={`space-row-${id}`} contentContainerStyle={styles.tiles}
    contentOffset={{x:offsets.current[id]||0,y:0}} onScroll={event=>{offsets.current[id]=event.nativeEvent.contentOffset.x;}} scrollEventThrottle={100}>
    {items.map(space=>tile(space,layout.carouselWidth,id))}</ScrollView>;
  const pagePath=(cursor?:string)=>savedType?`${discoveryPrefix}/saved?type=${savedType==='groups'?'group':'channel'}${cursor?'&cursor='+encodeURIComponent(cursor):''}`:`${discoveryPrefix}/directory?genre=${encodeURIComponent(genre!.slug)}${cursor?'&cursor='+encodeURIComponent(cursor):''}`;
  return <SafeAreaView style={[styles.screen,overlay&&{backgroundColor:'rgba(0,0,0,0.8)'}]} edges={['top','bottom','left','right']}>
    <ViewerHeader titleRef={heading} title={savedMode?savedLabel:mode==='recent'?'Continue':mode==='genre'?genre?.name||'Spaces':'Home'} onMenu={onMenu} onBack={onClose?()=>{if(current())onClose();}:undefined}/>
    {mode==='chooser'&&<View style={styles.navigation}><Action label={`${chooserType==='groups'?'✓ ':''}Groups`} onPress={()=>setChooserType('groups')}/><Action label={`${chooserType==='channels'?'✓ ':''}Channels`} onPress={()=>setChooserType('channels')}/></View>}
    <View style={{flex:1}} onLayout={event=>setSafeWidth(event.nativeEvent.layout.width)}>
    {!focused||!active||snapshot.status==='signingOut'?<View style={{flex:1,backgroundColor:'#000'}}/>:snapshot.status==='unavailable'?<Message title="Cannot verify sign-in" message={snapshot.message??undefined} onRetry={()=>{void auth.retryValidation();}}/>:dataClient.current!==client&&data?<Message title="Loading spaces" busy/>:<ScrollView testID="space-page" contentOffset={{x:0,y:offsets.current.page||0}} onScroll={event=>{offsets.current.page=event.nativeEvent.contentOffset.y;}} scrollEventThrottle={100} contentContainerStyle={styles.content}>
      {error&&<Message scrollable={false} title="Cannot load spaces" message={error} onRetry={()=>setVersion(v=>v+1)}/>}
      {(savedMode||mode==='recent')&&snapshot.status!=='authenticated'?<><Text style={styles.text}>Sign in to use {savedMode?savedLabel:'Continue'}.</Text><Action label="Sign in" onPress={onAccount}/></>:!data&&!error?<Message scrollable={false} title="Loading spaces" busy/>:data?<>
        {mode==='home'&&onAggregate&&<View style={{gap:12}}><Text style={styles.heading}>Your feeds</Text>{feedRow('destinations',['following','creations'])}</View>}
        {(mode==='home'||mode==='recent')&&onAggregate&&!!data.recentFeeds?.length&&<View style={{gap:12}}><Text style={styles.heading}>Continue your feeds</Text>{feedRow('recent-feeds',data.recentFeeds.map((r:any)=>r.kind))}</View>}
        {!savedType&&data.global&&<><Text style={styles.heading} accessibilityRole="header">Watch Global</Text>{tile(data.global,width)}</>}
        {!savedType&&data.personal&&tile(data.personal,layout.listWidth)}
        {!!data.recent?.length&&<><View style={styles.row}><Text style={styles.heading} accessibilityRole="header">Continue</Text><Action label="See all recently visited spaces" onPress={onRecent}/></View>{carousel('recent',data.recent.slice(0,6))}</>}
        {data.genres?.map((g:any)=><View key={g.slug} style={{gap:12}}><View style={styles.row}><Text style={styles.heading} accessibilityRole="header">{g.name}</Text><Action label={`See all ${g.name} spaces`} onPress={()=>onGenre({slug:g.slug,name:g.name})}/></View>
          {g.items.length?carousel(g.slug,g.items):<Text style={styles.text}>Spaces will appear here as they are added.</Text>}</View>)}
        <View style={styles.grid}>{data.items?.map((space:Card)=>tile(space,layout.listWidth))}</View>{data.items?.length===0&&<Text style={styles.text}>{savedMode?`Save ${savedType??'spaces'} for quick access.`:'No spaces to show yet.'}</Text>}
        {data.nextCursor&&<Action label="More spaces" disabled={busy} onPress={()=>{if(!current()||busy)return;setBusy(true);const visit=pageGeneration.current,controller=new AbortController();pagination.current=controller;const valid=()=>visit===pageGeneration.current&&!controller.signal.aborted&&current();void client.getJson(pagePath(data.nextCursor),controller.signal).then(raw=>{if(valid()){const next=adaptDirectory(raw);setData((previous:any)=>{if(!previous)return previous;const seen=new Set(previous.items.map((item:Card)=>item.id));return {...previous,items:[...previous.items,...next.items.filter(item=>!seen.has(item.id))],nextCursor:next.nextCursor};});}}).catch(e=>{if(valid())setError(e.message)}).finally(()=>{if(pagination.current===controller)pagination.current=null;if(valid())setBusy(false)});}}/>}
        {mode==='recent'&&(!!data.items?.length||!!data.recentFeeds?.length)&&<Action label="Clear viewing history" onPress={()=>{void client.deleteJson(`${discoveryPrefix}/recent`).then(()=>{if(current())setVersion(v=>v+1);}).catch(e=>{if(current())setError(e.message)});}}/>}
      </>:null}
    </ScrollView>}
    </View>
  </SafeAreaView>;
}
export const styles=StyleSheet.create({screen:{flex:1,backgroundColor:'#0b0d12'},content:{padding:20,gap:22,paddingBottom:30},header:{padding:PAGE_PADDING,gap:12,flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between'},title:{color:'#fff',fontSize:30,fontWeight:'700'},heading:{color:'#fff',fontSize:24,fontWeight:'700',flexShrink:1},text:{color:'#d2d7e2',fontSize:17,lineHeight:25},kind:{color:'#a6c7ff',fontSize:15,textTransform:'capitalize'},tile:{backgroundColor:'#171c26',borderColor:'#343d4d',borderWidth:1,borderRadius:14,padding:14,gap:12,maxWidth:380,minWidth:220},artwork:{height:120,borderRadius:8,backgroundColor:'#28394d',alignItems:'center',justifyContent:'center'},initial:{color:'#d5e7fa',fontSize:46},tiles:{gap:CARD_GAP,alignItems:'stretch'},grid:{flexDirection:'row',flexWrap:'wrap',gap:CARD_GAP,alignItems:'stretch'},row:{flexDirection:'row',flexWrap:'wrap',gap:12,alignItems:'center',justifyContent:'space-between'},navigation:{flexDirection:'row',flexWrap:'wrap',gap:8,padding:12,backgroundColor:'#000'}});
