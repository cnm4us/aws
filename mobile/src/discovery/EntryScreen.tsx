import {useEffect,useRef,useState} from 'react';
import {AppState,Pressable,ScrollView,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useIsFocused} from '@react-navigation/native';
import {useAuth} from '../auth/useAuth';
import {useViewerClient} from '../feed/useViewerFeed';
import {ApiError} from '../api/client';
import {Action,Message} from '../ui/Message';
import {getEntry,discoveryPrefix,type Entry,type SpaceCard} from './api';
import {loadAnonymousReceipt,saveAnonymousReceipt,clearAnonymousReceipt} from './receipts';
import {styles} from './DiscoveryScreen';
import {ViewerHeader} from '../ui/ViewerHeader';

export function EntryScreen({entryKey,about=false,enhanced=false,onEnter,onClose,onAccount,onMenu}:{entryKey:string;about?:boolean;enhanced?:boolean;onEnter:(space:SpaceCard,fromStart?:boolean)=>Promise<void>;onClose:()=>void;onAccount:()=>void;onMenu?:()=>void}) {
  const {snapshot,baseUrl}=useAuth(),{client,auth,generation}=useViewerClient(),focused=useIsFocused();
  const [entry,setEntry]=useState<Entry|null>(null),[error,setError]=useState(''),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[version,setVersion]=useState(0),[active,setActive]=useState(AppState.currentState==='active');
  const [canStartFresh,setCanStartFresh]=useState(false);
  const [rule,setRule]=useState<Entry['document']['rules'][number]|null>(null),[section,setSection]=useState<'body'|'allowed'|'disallowed'>('body');
  const uncertainAcceptance=useRef(false);
  const menuState=useRef<{revision:string|null;checked:boolean}|null>(null),offsets=useRef({page:0,rule:0});
  const serial=useRef(0),live=useRef({focused,active});live.current={focused,active};
  const current=(visit:number)=>live.current.focused&&live.current.active&&AppState.currentState==='active'&&auth.getSnapshot().generation===generation&&serial.current===visit;
  useEffect(()=>{const sub=AppState.addEventListener('change',s=>{setActive(s==='active');if(s!=='active'){serial.current++;menuState.current=null;}});return()=>sub.remove();},[]);
  useEffect(()=>{const controller=new AbortController(),visit=++serial.current;if(!focused||!active)return;if(snapshot.status==='unavailable'||snapshot.status==='signingOut'){setEntry(null);return;}setBusy(false);setCanStartFresh(false);setError('');setChecked(false);
    const load=async()=>{
      if(snapshot.status==='anonymous')await loadAnonymousReceipt(baseUrl).catch(()=>{});else if(snapshot.status==='authenticated')await clearAnonymousReceipt(baseUrl).catch(()=>{});
      const value=await getEntry(client,entryKey,controller.signal,enhanced);if(!current(visit)||controller.signal.aborted)return;const returningFromMenu=menuState.current!==null;setEntry(value);setRule(old=>old?value.document.rules.find(r=>r.id===old.id)??null:null);if(menuState.current?.revision===value.revision)setChecked(menuState.current.checked);menuState.current=null;
      if(!returningFromMenu&&!about&&!uncertainAcceptance.current&&value.canView&&!value.requiresAcknowledgment){setBusy(true);try{await onEnter(value.space)}finally{if(current(visit))setBusy(false)}}
    };
    void load().catch(e=>{if(current(visit)&&!controller.signal.aborted){setBusy(false);setCanStartFresh(e instanceof ApiError&&e.code==='resume_unavailable');setError(e instanceof Error?e.message:'Cannot load the space introduction.');}});
    return()=>{controller.abort();serial.current++;};
  },[entryKey,client,focused,active,version,about,snapshot.status,enhanced]);
  const enter=async(fromStart=false)=>{
    const visit=serial.current;if(!entry||!current(visit)||busy||entry.requiresAcknowledgment&&!checked)return;setBusy(true);setError('');
    try {
      if(entry.requiresAcknowledgment){
        uncertainAcceptance.current=true;
        const result=await client.postJson(`${discoveryPrefix}/spaces/${encodeURIComponent(entryKey)}/accept`,{revision:entry.revision}) as any;
        if(!current(visit))return;
        if(snapshot.status==='anonymous')await saveAnonymousReceipt(baseUrl,result.receipt);
      }
      if(current(visit)){uncertainAcceptance.current=false;await onEnter(entry.space,fromStart);}
    }catch(e){if(!current(visit))return;setCanStartFresh(e instanceof ApiError&&e.code==='resume_unavailable');setError(e instanceof Error?e.message:'Cannot confirm entry. Please review and try again.');setChecked(false);
      // Reconcile a lost response, but entering again always requires another deliberate action.
      try{const next=await getEntry(client,entryKey,undefined,enhanced);if(current(visit))setEntry(next);}catch{}}
    finally{if(current(visit))setBusy(false);}
  };
  const availability=entry?.space.availability;
  const enrollment=async()=>{const visit=serial.current;if(!entry||!current(visit)||busy||entry.requiresAcknowledgment&&!checked)return;setBusy(true);setError('');try{await client.postJson(`${discoveryPrefix}/enroll/${encodeURIComponent(entryKey)}`,{revision:entry.revision,acknowledge:checked});if(current(visit))setVersion(v=>v+1);}catch(e){if(current(visit)){setError((e as Error).message);setBusy(false);setChecked(false);}}};
  return <SafeAreaView style={styles.screen} edges={['top','bottom','left','right']}>
    <ViewerHeader title={snapshot.status==='unavailable'?'Space introduction':rule?.title||entry?.document.name||'Space introduction'} onMenu={onMenu?()=>{if(!busy){menuState.current={revision:entry?.revision??null,checked};onMenu();}}:undefined} menuDisabled={busy} backLabel={rule?'Back to space rules':'Back'} onBack={()=>{if(!focused)return;if(rule)setRule(null);else onClose();}}/>
    {!focused||!active||snapshot.status==='signingOut'?<View style={{flex:1,backgroundColor:'#000'}}/>:snapshot.status==='unavailable'?<Message title="Cannot verify sign-in" message={snapshot.message??undefined} onRetry={()=>{void auth.retryValidation();}}/>:<>
      <ScrollView contentOffset={{x:0,y:offsets.current.page}} onScroll={event=>{offsets.current.page=event.nativeEvent.contentOffset.y;}} scrollEventThrottle={100} style={rule?{display:'none'}:{flex:1}} contentContainerStyle={styles.content}>
        {error&&<Message scrollable={false} title="Cannot open space" message={error} onRetry={()=>setVersion(v=>v+1)}/>}
        {!entry&&!error?<Message scrollable={false} title="Loading introduction" busy/>:entry?<>
          {!!entry.document.welcome&&<Text style={styles.text}>{entry.document.welcome}</Text>}{!!entry.document.purpose&&<Text style={styles.text}>{entry.document.purpose}</Text>}
          {entry.document.cultures.map(c=><View key={c.id} style={{gap:10}}><Text style={styles.heading} accessibilityRole="header">{c.name}</Text><Text style={styles.text}>{c.summary||'A culture summary has not been published yet.'}</Text>
            {!!c.expectations.length&&<Text style={styles.text}>Expected tone: {c.expectations.join(', ')}.</Text>}{c.boundaries.map(b=><Text key={b} style={styles.text}>{b}</Text>)}</View>)}
          {!!entry.document.rules.length&&<Text style={styles.heading} accessibilityRole="header">Space rules</Text>}{entry.document.rules.map(r=><View key={r.id} style={{gap:8}}><Text style={[styles.text,{fontWeight:'700'}]}>{r.title}</Text>{!!r.description&&<Text style={styles.text}>{r.description}</Text>}<Action label={`Read ${r.title}`} onPress={()=>{setRule(r);offsets.current.rule=0;setSection('body')}}/></View>)}
        </>:null}
      </ScrollView>
      {rule&&<><View style={styles.navigation}>{(['body','allowed','disallowed'] as const).map(s=><Action key={s} label={`${section===s?'✓ ':''}${s==='body'?'Long description':s==='allowed'?'Allowed examples':'Disallowed examples'}`} onPress={()=>{offsets.current.rule=0;setSection(s);}}/>)}</View><ScrollView contentOffset={{x:0,y:offsets.current.rule}} onScroll={event=>{offsets.current.rule=event.nativeEvent.contentOffset.y;}} scrollEventThrottle={100} key={`${rule.id}:${section}`} contentContainerStyle={styles.content}><Text style={styles.text}>{rule[section]||'No examples have been published for this rule.'}</Text></ScrollView></>}
      {entry&&!rule&&<View style={[styles.navigation,{flexDirection:'column'}]}>
        {entry.requiresSignIn?<Action label="Sign in to enter" onPress={onAccount}/>:!entry.canView?<>
          {availability&&<Text style={styles.text}>{availability.label}</Text>}
          {availability?.price&&<Text style={styles.text}>{availability.price.currency} {(availability.price.amountCents/100).toFixed(2)} / {availability.price.interval}</Text>}
          {availability?.action==='purchase_deferred'?<Text style={styles.text}>Purchases are not available in this app yet.</Text>:availability&&['join','subscribe_free','accept_invitation'].includes(availability.action)?<>
           {entry.requiresAcknowledgment&&<Pressable accessibilityRole="checkbox" accessibilityLabel="I’ve read the space rules" accessibilityState={{checked,disabled:busy}} disabled={busy} onPress={()=>setChecked(v=>!v)} style={{minHeight:48,padding:10}}><Text style={styles.text}>{checked?'☑':'☐'} I’ve read the space rules</Text></Pressable>}
           <Action label={busy?'Confirming…':availability.action==='join'?'Join group':availability.action==='subscribe_free'?'Subscribe free':'Accept invitation'} disabled={busy||entry.requiresAcknowledgment&&!checked} onPress={()=>void enrollment()}/>
          </>:<Text style={styles.text}>This space is not currently available to your account.</Text>}
         </>:<>
          {entry.requiresAcknowledgment&&<Pressable accessibilityRole="checkbox" accessibilityState={{checked,disabled:busy}} accessibilityLabel="I’ve read the space rules" disabled={busy} onPress={()=>setChecked(v=>!v)} style={{minHeight:48,padding:10}}><Text style={styles.text}>{checked?'☑':'☐'} I’ve read the space rules</Text></Pressable>}
          <Action label={busy?'Opening space…':canStartFresh?'Start from current feed':'Enter space'} disabled={busy||entry.requiresAcknowledgment&&!checked} onPress={()=>void enter(canStartFresh)}/>
        </>}
      </View>}
    </>}
  </SafeAreaView>;
}
