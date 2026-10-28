import {useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {AccessibilityInfo,AppState,Keyboard,KeyboardAvoidingView,Linking,Platform,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useIsFocused} from '@react-navigation/native';
import {useAuth} from '../auth/useAuth';
import {useViewerClient} from '../feed/useViewerFeed';
import {ApiError} from '../api/client';
import {Action,Message} from '../ui/Message';
import {IconButton} from '../ui/IconButton';
import {ReportStore} from './reportStore';
import {ReportMemory} from './reportMemory';
import {formatReportTime,type ReportTarget,type ReportBlock} from './api';
import {reportCards,type ReportCard} from './reportPresentation';
import {RuleSectionMenu,focusReportControl,type RuleSection} from './RuleSectionMenu';

export function ReportScreen({target,generation:visitGeneration,feedKey,capturedSeconds,memory,onClose,onDenied,onSignIn}:{
 target:ReportTarget;generation:number;feedKey:string;capturedSeconds:number;memory:ReportMemory;onClose:()=>void;onDenied:(e:Error)=>void;onSignIn:()=>void;
}) {
 const {snapshot,baseUrl}=useAuth(),{auth,client,generation}=useViewerClient(),focused=useIsFocused();
 const callbacks=useRef({onDenied,onClose});callbacks.current={onDenied,onClose};
 const store=useMemo(()=>new ReportStore(client,target,memory,`${feedKey}:${target.publicationId}`,e=>{
  if(auth.getSnapshot().generation===generation){if(e instanceof ApiError&&e.status===401)void auth.invalidate(generation);else callbacks.current.onDenied(e);}
 },()=>{AccessibilityInfo.announceForAccessibility?.('Report sent.');callbacks.current.onClose();}),[auth,client,generation,feedKey,target.publicationId,target.context.kind,target.context.kind==='space'?target.context.spaceId:0,memory]);
 const state=useSyncExternalStore(store.subscribe,store.getSnapshot);
 useEffect(()=>{
  const update=()=>{const background=AppState.currentState!=='active';if(background)memory.clearDrafts();
   store.setActive(focused&&visitGeneration===generation&&!background&&auth.getSnapshot().status==='authenticated');};
  update();const sub=AppState.addEventListener('change',update),unsubscribe=auth.subscribe(update);
  return()=>{sub.remove();unsubscribe();store.setActive(false);};
 },[auth,store,focused,visitGeneration,generation,memory]);
 useEffect(()=>()=>store.dispose(),[store]);
 const anonymous=snapshot.status==='anonymous'&&focused&&visitGeneration===generation&&AppState.currentState==='active';
 const blocked=!state.authorized||snapshot.status!=='authenticated'||!focused||visitGeneration!==generation||AppState.currentState!=='active';
 const {options,draft,detail,selected}=state,own=options?.myReport;
 const selectedKey=selected?`${selected.groupId}:${selected.ruleId}`:null;
 const [section,setSection]=useState<RuleSection>('description'),[menuOpen,setMenuOpen]=useState(false),[linkError,setLinkError]=useState<string|null>(null);
 const list=useRef<ScrollView>(null),ruleScroll=useRef<ScrollView>(null),heading=useRef<View>(null),more=useRef(new Map<string,View>());
 const listState=useRef({offset:0,content:0,height:0,restore:false,contentReady:false,focusKey:null as string|null});
 useEffect(()=>{setSection('description');setMenuOpen(false);setLinkError(null);if(selectedKey&&!blocked)focusReportControl(heading.current);},[selectedKey,blocked]);
 useEffect(()=>{if(blocked){listState.current={offset:0,content:0,height:0,restore:false,contentReady:false,focusKey:null};more.current.clear();}},[blocked]);
 useEffect(()=>{if(state.sending)setMenuOpen(false);},[state.sending]);
 useEffect(()=>{ruleScroll.current?.scrollTo({y:0,animated:false});setLinkError(null);},[section,detail?.version,selectedKey]);
 const restoreList=()=>{
  const saved=listState.current;if(!saved.restore||!saved.contentReady||!saved.height||!list.current)return;
  const y=Math.max(0,Math.min(saved.offset,saved.content-saved.height));saved.restore=false;saved.offset=y;
  list.current.scrollTo({y,animated:false});focusReportControl(saved.focusKey?more.current.get(saved.focusKey)??heading.current:heading.current);
 };
 const openRule=(groupId:number,ruleId:number,key:string)=>{Keyboard.dismiss();listState.current.focusKey=key;void store.detail(groupId,ruleId);};
 const back=()=>{Keyboard.dismiss();setMenuOpen(false);listState.current.restore=true;listState.current.contentReady=false;store.back();};
 const close=()=>{Keyboard.dismiss();setMenuOpen(false);onClose();};
 const open=async(href:string)=>{try{const url=new URL(href,baseUrl);if(url.protocol!=='https:'||url.username||url.password)return;await Linking.openURL(url.toString());}catch{setLinkError('Cannot open this link.');}};
 const selectedMapped=!!(selected&&options?.groups.some(g=>g.id===selected.groupId&&g.rules.some(r=>r.id===selected.ruleId)));
 const projected=options?reportCards(options,draft?.showAll??false):{cards:[],hasHidden:false};
 const uncertain=<>{state.uncertain&&<View style={styles.section}><Text style={styles.meta}>Your report may have been sent. Check its status before submitting again.</Text><Action label="Check report status" disabled={state.sending||state.checking} onPress={store.retry}/></View>}</>;
 const pending=state.pendingInput;
 const segment=pending?rangeText(pending.reportedStartSeconds,pending.reportedEndSeconds):own?rangeText(own.reportedStartSeconds,own.reportedEndSeconds):draftRange(draft?.start??'',draft?.end??'');
 const errorText=state.error&&(!selected?state.error.replace('Go Back and review','Review'):state.error);
 return <SafeAreaView accessibilityViewIsModal style={[styles.screen,blocked&&!anonymous?styles.blocked:styles.scrim]} edges={['top','bottom']}>
  <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS==='ios'?'padding':undefined}>
   <View style={styles.header}>
    <View style={styles.close}>{selected&&!blocked?<Pressable accessibilityRole="button" accessibilityLabel="Back to reporting reasons" onPress={back} style={styles.back}><Text style={styles.backText}>Back</Text></Pressable>:<IconButton icon="close" label="Close report" onPress={close}/>}</View>
    {selected&&!blocked?<ScrollView style={styles.headerTitle}><Text ref={heading} accessibilityRole="header" style={styles.title}>{detail?.title??selected.title}</Text></ScrollView>:<Text ref={heading} accessibilityRole="header" style={styles.title}>{own?'Report sent':'Report video'}</Text>}
   </View>
   {anonymous?<ScrollView contentContainerStyle={styles.content}><Text style={styles.heading}>Sign in to report</Text><Text style={styles.text}>Sign in to send a report about this video.</Text><Action label="Sign in" onPress={onSignIn}/></ScrollView>:
    blocked?<Message title={state.checking?'Loading reporting choices':snapshot.status==='unavailable'?'Cannot verify sign-in':'Reporting unavailable'} message={state.error??undefined} busy={state.checking} onRetry={state.checking?undefined:()=>{if(snapshot.status==='unavailable')void auth.retryValidation();else store.retry();}}/>:
    selected?<>
     <ScrollView ref={ruleScroll} testID="report-rule-body" style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {state.loadingDetail&&<Text style={styles.text}>Loading explanation…</Text>}
      {detail?<>
       <RuleSectionMenu value={section} open={menuOpen} disabled={state.sending} onOpen={setMenuOpen} onSelect={value=>{setSection(value);setMenuOpen(false);}}/>
       {!menuOpen&&<RuleDocument blocks={detail[section]} onOpen={open}/>}
       {linkError&&<Text style={styles.error}>{linkError}</Text>}
      </>:!state.loadingDetail&&<View style={styles.section}><Text style={styles.text}>Rule explanation unavailable.</Text>{selectedMapped&&<Action label="Retry explanation" disabled={state.sending} onPress={store.retryDetail}/>}</View>}
     </ScrollView>
     <View testID="report-rule-footer" style={styles.footer}>
      <ScrollView style={styles.footerInfo} contentContainerStyle={styles.section} keyboardShouldPersistTaps="handled">
      {errorText&&<Text accessibilityRole="alert" style={styles.error}>{errorText}</Text>}{uncertain}
      <Text style={styles.meta}>{segment}</Text></ScrollView>
      {!own&&<Action label={state.sending?'Sending report…':'Submit report'} disabled={!store.canSubmit()||menuOpen} onPress={()=>{void store.sendSelected();}}/>}
     </View>
    </>:<ScrollView ref={list} testID="report-reasons-list" style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
      scrollEventThrottle={16} onScroll={event=>{if(!store.getSnapshot().selected&&store.getSnapshot().authorized)listState.current.offset=event.nativeEvent.contentOffset.y;}}
      onLayout={event=>{listState.current.height=event.nativeEvent.layout.height;restoreList();}}
      onContentSizeChange={(_width,height)=>{listState.current.content=height;listState.current.contentReady=true;restoreList();}}>
     {errorText&&<Text accessibilityRole="alert" style={styles.error}>{errorText}</Text>}{uncertain}
     {state.sending&&<View style={styles.section}><Text accessibilityRole="alert" style={styles.text}>Sending report…</Text><Text style={styles.meta}>{segment}</Text></View>}
     {own?<View style={styles.section}>
      <Text style={styles.text}>Your report was sent.</Text><Text style={styles.heading}>{own.userFacingRuleLabel??own.ruleTitle??'Reported reason'}</Text>
      {own.ruleTitle&&<Text style={styles.text}>{own.ruleTitle}</Text>}<Text style={styles.text}>{segment}</Text>
      <Text style={styles.meta}>{new Date(own.createdAt.replace(' ','T')+(/(?:Z|[+-]\d\d:\d\d)$/.test(own.createdAt)?'':'Z')).toLocaleString()}</Text>
      {own.userFacingRuleId&&options.groups.find(g=>g.id===own.userFacingRuleId)?.rules.some(r=>r.id===own.ruleId)&&<Action label="Read reported rule" onPress={()=>openRule(own.userFacingRuleId!,own.ruleId,'sent')}/>}
     </View>:draft&&options&&<>
      <View style={styles.section}><Text style={styles.heading}>Video segment (optional)</Text><Text style={styles.meta}>Leave both times empty to report the whole video. Use minutes:seconds or hours:minutes:seconds.</Text>
       <Text style={[styles.text,styles.flaggedTime]}>{`Current video time: ${formatReportTime(capturedSeconds)}`}</Text>
       {(['start','end'] as const).map(field=><View style={styles.section} key={field}><Text style={styles.text}>{field==='start'?'Start':'End'}</Text>
        <View style={styles.timeRow}><TextInput accessibilityLabel={`Report ${field} time`} value={draft[field]} onChangeText={value=>store.edit({[field]:value})} editable={!state.sending} maxLength={20} autoCorrect={false} autoCapitalize="none" placeholder="mm:ss" placeholderTextColor="#aaa" style={[styles.input,styles.timeInput]}/>
         <View style={styles.timeButton}><IconButton icon="stopwatch" label={`Use flagged time for ${field==='start'?'Start':'End'}`} disabled={state.sending} onPress={()=>store.edit({[field]:formatReportTime(capturedSeconds)})}/></View>
        </View></View>)}
       <Action label="Clear times — whole video" disabled={state.sending} onPress={()=>store.edit({start:'',end:''})}/>
      </View>
      <Text accessibilityRole="header" style={styles.exploreHeading}>Explore reasons to report</Text>
      {projected.cards.map(card=><RuleCard key={card.key} card={card} disabled={state.sending} onMore={()=>openRule(card.groupId,card.ruleId,card.key)} controlRef={node=>{if(node)more.current.set(card.key,node);else more.current.delete(card.key);}}/>)}
      {!projected.cards.length&&<Text style={styles.text}>{projected.hasHidden?'Choose Show all reasons to see available rules.':'No reporting reasons are currently available.'}</Text>}
      {projected.hasHidden&&<Action label="Show all reasons" disabled={state.sending} onPress={()=>store.edit({showAll:true})}/>}
     </>}
    </ScrollView>}
  </KeyboardAvoidingView>
 </SafeAreaView>;
}
function RuleCard({card,disabled,onMore,controlRef}:{card:ReportCard;disabled:boolean;onMore:()=>void;controlRef:(node:View|null)=>void}) {
 return <View style={styles.card}><Text style={styles.heading}>{card.title}</Text>{card.contextLabel&&<Text style={styles.meta}>{card.contextLabel}</Text>}{card.shortDescription&&<Text style={styles.text}>{card.shortDescription}</Text>}
  <Pressable ref={controlRef} accessibilityRole="button" accessibilityLabel={`More about ${card.title}${card.contextLabel?` — ${card.contextLabel}`:''}`} accessibilityHint="Opens this rule and its reporting action" accessibilityState={{disabled}} disabled={disabled} onPress={onMore} style={styles.more}><Text style={styles.moreText}>More</Text></Pressable>
 </View>;
}
function draftRange(start:string,end:string){return !start.trim()&&!end.trim()?'Whole video':`Start: ${start.trim()||'Not specified'} · End: ${end.trim()||'Not specified'}`;}
function rangeText(start:number|null,end:number|null){return draftRange(start===null?'':formatReportTime(start),end===null?'':formatReportTime(end));}
function RuleDocument({blocks,onOpen}:{blocks:ReportBlock[];onOpen:(href:string)=>void}) {
 return <View style={styles.section}>{blocks.length?blocks.map((b,i)=><View key={i} style={styles.section}><Text selectable style={[styles.text,b.kind==='heading'&&styles.heading,b.kind==='code'&&styles.code]}>{b.kind==='list'?'• ':b.kind==='quote'?'“ ':''}{b.text}</Text>{b.links.map((l,j)=><Action key={j} label={`Open link: ${l.label}`} onPress={()=>onOpen(l.href)}/>)}</View>):<Text style={styles.meta}>No examples or additional explanation provided.</Text>}</View>;
}
const styles=StyleSheet.create({screen:{flex:1},scrim:{backgroundColor:'rgba(0,0,0,0.8)'},blocked:{backgroundColor:'#000'},header:{padding:16,gap:8,maxHeight:'35%'},headerTitle:{flexGrow:0,flexShrink:1},close:{alignItems:'flex-end'},title:{color:'#fff',fontSize:24,fontWeight:'700'},content:{padding:16,paddingBottom:32,gap:20},section:{gap:12},exploreHeading:{color:'#fff',fontSize:22,fontWeight:'700'},heading:{color:'#fff',fontSize:18,fontWeight:'700'},text:{color:'#fff',fontSize:17,lineHeight:25},meta:{color:'#bfc0c8',fontSize:15,lineHeight:22},input:{minHeight:48,color:'#fff',fontSize:17,padding:12,borderRadius:10,borderWidth:1,borderColor:'#777',backgroundColor:'#17171c'},flaggedTime:{textAlign:'center'},timeRow:{flexDirection:'row',alignItems:'center',gap:12},timeInput:{flex:3,minWidth:0},timeButton:{flex:1,minWidth:44,alignItems:'center'},card:{padding:12,gap:8,borderBottomWidth:1,borderColor:'#555'},more:{minHeight:44,minWidth:44,paddingVertical:10,paddingRight:12,alignSelf:'flex-start',justifyContent:'center'},moreText:{color:'#fff',fontSize:16,textDecorationLine:'underline'},back:{minHeight:44,minWidth:64,padding:10,justifyContent:'center',alignItems:'center'},backText:{color:'#fff',fontSize:17},footerInfo:{flexGrow:0,flexShrink:1},footer:{maxHeight:'50%',paddingHorizontal:16,paddingTop:12,paddingBottom:12,gap:12,borderTopWidth:1,borderColor:'#555'},error:{color:'#ffb4b4',fontSize:16},code:{fontFamily:Platform.OS==='ios'?'Menlo':'monospace'}});
