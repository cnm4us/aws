import React,{useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {keyForPath,navigate,request} from './api';
import './discovery.css';
import {ResumePersistence} from './ResumePersistence';
import {SpaceCard as Tile,type Card} from './SpaceCard';

type Checkpoint={publicationId:number;productionUlid:string;positionSeconds:number;userPaused:boolean};
export function PolicyDocument({document:d}:{document:any}) {
  return <div className="discovery-policy">
    {d.welcome&&<p className="discovery-prose">{d.welcome}</p>}{d.purpose&&<p>{d.purpose}</p>}
    {d.cultures.map((c:any)=><section key={c.id}><h2>{c.name}</h2><p>{c.summary||'A culture summary has not been published yet.'}</p>
      {!!c.expectations.length&&<p>Expected tone: {c.expectations.join(', ')}.</p>}{!!c.boundaries.length&&<ul>{c.boundaries.map((b:string)=><li key={b}>{b}</li>)}</ul>}</section>)}
    {!!d.rules.length&&<h2>Space rules</h2>}{d.rules.map((r:any)=><details key={r.id}><summary>{r.title}</summary><p>{r.description}</p>
      <div className="discovery-prose">{r.body}</div>{r.allowed&&<><h3>Allowed examples</h3><p className="discovery-prose">{r.allowed}</p></>}{r.disallowed&&<><h3>Disallowed examples</h3><p className="discovery-prose">{r.disallowed}</p></>}</details>)}
  </div>;
}
function Shell({children}:{children:React.ReactNode}) {
  return <div className="discovery"><header><a href="/discover" onClick={e=>{e.preventDefault();navigate('/discover');}}>Home</a><nav aria-label="Main"><a href="/global" onClick={e=>{e.preventDefault();navigate('/global');}}>Global</a><a href="/your-spaces" onClick={e=>{e.preventDefault();navigate('/your-spaces');}}>Your Spaces</a><a href="/profile">Account</a></nav></header><main>{children}</main></div>;
}
export default function Discovery({Feed}:{Feed:React.ComponentType<any>}) {
  const [location,setLocation]=useState(()=>window.location.pathname+window.location.search),[reload,setReload]=useState(0);
  const [data,setData]=useState<any>(null),[error,setError]=useState<string|null>(null),[ready,setReady]=useState(false),[read,setRead]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[fallbackPending,setFallbackPending]=useState(false);
  const [resume,setResume]=useState<Checkpoint|null>(null);
  const epoch=useRef(0),latest=useRef<Checkpoint|null>(null);
  const persistence=useRef(new ResumePersistence(request));
  const identity=useRef(false);
  const pending=useRef(new Set<number>()),[saving,setSaving]=useState<Set<number>>(new Set()),[saveErrors,setSaveErrors]=useState<Record<number,string>>({}),[saveStatus,setSaveStatus]=useState('');
  const checkpointMemory=useRef(new Map<string,Checkpoint>());
  const scrollMemory=useRef(new Map<string,{y:number;focus:string|null;focusRow:string|null;rows:Record<string,number>}>());
  const priorLocation=useRef(location);priorLocation.current=location;
  const path=location.split('?')[0].replace(/\/$/,'')||'/',key=keyForPath(path),about=path.endsWith('/about');
  useEffect(()=>{
    const route=()=>{scrollMemory.current.set(priorLocation.current,{y:window.scrollY,focus:document.activeElement?.getAttribute('data-card-focus')||null,focusRow:(document.activeElement?.closest('[data-space-row]') as HTMLElement)?.dataset.spaceRow||null,rows:Object.fromEntries(Array.from(document.querySelectorAll<HTMLElement>('[data-space-row]')).map(row=>[row.dataset.spaceRow!,row.scrollLeft]))});epoch.current++;setReady(false);setData(null);setError(null);setRead(false);setNotice('');setSaveStatus('');setSaveErrors({});setFallbackPending(false);setResume(null);setLocation(window.location.pathname+window.location.search);setReload(v=>v+1);};
    const pop=()=>{window.dispatchEvent(new Event('viewer:leaving'));route();};
    window.addEventListener('viewer:navigate',route);window.addEventListener('popstate',pop);
    return()=>{window.removeEventListener('viewer:navigate',route);window.removeEventListener('popstate',pop);};
  },[]);
  useEffect(()=>{
    const controller=new AbortController(),generation=++epoch.current;setData(null);setReady(false);setError(null);setRead(false);latest.current=null;identity.current=false;
    const open=async()=>{
      if(key) {
        const value=await request(`/spaces/${encodeURIComponent(key)}/entry`,undefined,controller.signal);if(epoch.current!==generation)return;setData(value);
        identity.current=value.signedIn===true;
        if(!about&&value.canView&&!value.requiresAcknowledgment)await prepare(value,generation,controller.signal);
      }else if(path==='/') {
        const flags=await request('/config',undefined,controller.signal);if(epoch.current!==generation)return;
        if(!flags.homeEnabled){window.history.replaceState({},'', '/global'+window.location.search+window.location.hash);window.dispatchEvent(new Event('viewer:navigate'));return;}
        setData(await request('/home',undefined,controller.signal));
      }else if(path==='/discover')setData(await request('/home',undefined,controller.signal));
      else if(path==='/your-spaces')setData(await request('/saved',undefined,controller.signal));
      else if(path==='/recent')setData(await request('/recent',undefined,controller.signal));
      else {
        const genre=/^\/genres\/([^/]+)$/.exec(path),type=path==='/groups'?'group':path==='/channels'?'channel':null;
        if(!genre&&!type)throw new Error('Page not found.');
        setData(await request(`/directory?${genre?`genre=${encodeURIComponent(decodeURIComponent(genre[1]))}`:`type=${type}`}`,undefined,controller.signal));
      }
    };
    const prepare=async(value:any,generation:number,signal:AbortSignal)=>{
      let state:any=null;
      try{if(value.signedIn)state=await persistence.current.read(key!,signal);}catch(e:any){if(e.status!==401&&e.status!==503)throw e;}
      if(epoch.current!==generation||signal.aborted)return;
      const explicit=['pin','publication_id','t','t_end'].some(k=>new URLSearchParams(window.location.search).has(k));
      setResume(explicit?null:checkpointMemory.current.get(key!)??state?.checkpoint??null);
      if(!explicit&&!checkpointMemory.current.has(key!)&&state?.outcome==='unavailable'){setResume(null);setNotice('The saved video or position is no longer available. You can start with the current feed.');setFallbackPending(true);return;}
      setReady(true);
    };
    void open().catch(e=>{if(!controller.signal.aborted&&epoch.current===generation)setError(e.status===401?'Sign in to view your spaces.':e.message);});
    return()=>controller.abort();
  },[location,reload]);
  const record=useCallback((checkpoint:Checkpoint)=>{
    if(!key)return;
    latest.current=checkpoint;checkpointMemory.current.set(key,checkpoint);
    while(checkpointMemory.current.size>30)checkpointMemory.current.delete(checkpointMemory.current.keys().next().value!);
    if(identity.current)void persistence.current.save(key,checkpoint);
  },[key]);
  useEffect(()=>{const leave=()=>{if(key&&latest.current){record(latest.current);}};
    window.addEventListener('viewer:leaving',leave);window.addEventListener('pagehide',leave);document.addEventListener('visibilitychange',leave);
    return()=>{window.removeEventListener('viewer:leaving',leave);window.removeEventListener('pagehide',leave);document.removeEventListener('visibilitychange',leave);};},[key,record]);
  useLayoutEffect(()=>{if(!data||ready)return;const saved=scrollMemory.current.get(location);
    window.scrollTo(0,saved?.y||0);
    document.querySelectorAll<HTMLElement>('[data-space-row]').forEach(row=>{row.scrollLeft=saved?.rows[row.dataset.spaceRow!]||0;});
    if(saved?.focus){const element=Array.from(document.querySelectorAll<HTMLElement>('[data-card-focus]')).find(a=>a.dataset.cardFocus===saved.focus&&((a.closest('[data-space-row]') as HTMLElement)?.dataset.spaceRow||null)===saved.focusRow);element?.focus({preventScroll:true});}
  },[!!data,ready,location]);
  const save=async(space:Card)=>{
    if(pending.current.has(space.id))return;
    const generation=epoch.current;pending.current.add(space.id);setSaving(new Set(pending.current));setSaveErrors(e=>({...e,[space.id]:''}));
    try {
      await request(`/spaces/${space.id}/save`,{saved:!space.saved});if(epoch.current!==generation)return;
      const update=(s:Card)=>s.id===space.id?{...s,saved:!space.saved}:s;
      setData((previous:any)=>previous?{...previous,space:previous.space?update(previous.space):undefined,items:previous.items?.filter((s:Card)=>!(path==='/your-spaces'&&space.saved&&s.id===space.id)).map(update),recent:previous.recent?.map(update),genres:previous.genres?.map((g:any)=>({...g,items:g.items?.map(update)}))}:previous);
      setSaveStatus(`${space.saved?'Removed':'Saved'} ${space.name}${space.saved?' from':' to'} Your Spaces.`);
      if(path==='/your-spaces'&&space.saved)requestAnimationFrame(()=>{document.querySelector<HTMLElement>('.discovery h1')?.focus({preventScroll:true});});
    }catch(e:any){if(epoch.current!==generation)return;
      if(e.status===401){window.location.assign(`/login?return=${encodeURIComponent(window.location.pathname+window.location.search)}`);return;}
      setSaveErrors(errors=>({...errors,[space.id]:'Could not confirm saving. Try the checkbox again, or refresh this page.'}));
    }finally{pending.current.delete(space.id);setSaving(new Set(pending.current));}
  };
  const tile=(space:Card,featured=false)=><Tile key={space.id} space={space} onSave={save} saving={saving.has(space.id)} error={saveErrors[space.id]} featured={featured}/>;
  useEffect(()=>{if(!ready||!key)return;const controller=new AbortController();const generation=epoch.current;
    const verify=()=>{if(document.visibilityState==='hidden')return;void request(`/spaces/${encodeURIComponent(key)}/entry`,undefined,controller.signal).then(value=>{
      if(epoch.current!==generation||controller.signal.aborted)return;
      if(value.requiresAcknowledgment||!value.canView){window.dispatchEvent(new Event('viewer:leaving'));setReady(false);setData(value);setRead(false);setNotice('The space rules or access changed. Review before continuing.');}
    }).catch(e=>{if([401,403,404,428].includes(e.status)&&epoch.current===generation){window.dispatchEvent(new Event('viewer:leaving'));setReady(false);setError('Review current space access before continuing.');}});};
    const timer=setInterval(verify,60000);document.addEventListener('visibilitychange',verify);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',verify);controller.abort();};
  },[ready,key]);
  const accept=async()=>{
    if(!key||!data||busy||!read)return;setBusy(true);const generation=epoch.current;
    try{await request(`/spaces/${encodeURIComponent(key)}/accept`,{revision:data.revision});if(epoch.current===generation){if(about)navigate(data.space.path);else setReload(v=>v+1);}}
    catch(e:any){if(epoch.current!==generation)return;setError(e.message==='space_entry_changed'?'The space rules changed. Review the updated introduction before entering.':'Could not confirm acknowledgment. Please review and try again.');setRead(false);
      try{const current=await request(`/spaces/${encodeURIComponent(key)}/entry`);if(epoch.current===generation)setData(current);}catch{}}
    finally{if(epoch.current===generation)setBusy(false);}
  };
  if(ready&&data&&key&&!about)return <>
    <Feed key={location} destination={data.space} restoreCheckpoint={resume} onCheckpoint={record} onResumeUnavailable={()=>setNotice('The requested video is no longer available. Showing the current feed.')} onSelectDestination={(destination:string)=>navigate(destination)}/>
    <nav className="discovery-feed-links" aria-label="Feed navigation"><button onClick={()=>navigate('/discover')}>Home</button><button onClick={()=>navigate('/your-spaces')}>Your Spaces</button><button onClick={()=>navigate(`${data.space.path}/about`)}>About / Rules</button></nav>
    {notice&&<p role="status" className="discovery-notice">{notice}<button onClick={()=>setNotice('')}>Dismiss</button></p>}</>;
  return <Shell>{saveStatus&&<p role="status" className="discovery-save-status">{saveStatus}</p>}{error&&<p role="alert">{error} <button onClick={()=>setReload(v=>v+1)}>Try again</button></p>}{!data&&!error&&<p role="status">Loading…</p>}
    {data&&key?<><button onClick={()=>{if(window.history.length>1)window.history.back();else navigate('/discover');}}>Back</button><h1>{data.document.name}</h1><PolicyDocument document={data.document}/>{notice&&<p role="status">{notice}</p>}
      <footer className="discovery-entry-footer">{data.requiresSignIn?<a href={`/login?return=${encodeURIComponent(window.location.pathname+window.location.search+window.location.hash)}`}>Sign in to enter</a>:!data.canView?<p>This space is not currently available to your account.</p>:<>
        {data.requiresAcknowledgment&&<label><input type="checkbox" checked={read} onChange={e=>setRead(e.target.checked)}/> I’ve read the space rules</label>}
        <button disabled={busy||data.requiresAcknowledgment&&!read} onClick={()=>data.requiresAcknowledgment?void accept():about?navigate(data.space.path):setReady(true)}>{busy?'Confirming…':fallbackPending?'Start from current feed':'Enter space'}</button></>}
        {!data.space.global&&data.space.type!=='personal'&&<button onClick={()=>void save(data.space)}>{data.space.saved?'Remove from Your Spaces':'Save to Your Spaces'}</button>}
      </footer></>:data?<>
      <h1 tabIndex={-1}>{path==='/your-spaces'?'Your Spaces':path==='/recent'?'Continue':data.genre?.name|| (path==='/groups'?'Groups':path==='/channels'?'Channels':'Find your next space')}</h1>
      {data.global&&<section><h2>Watch Global</h2><div className="discovery-featured-section">{tile(data.global,true)}{data.personal&&tile(data.personal)}</div></section>}
      {data.recent?.length>0&&<section><h2>Continue <a href="/recent" aria-label="See all recently visited spaces" onClick={e=>{e.preventDefault();navigate('/recent');}}>See all</a></h2><div className="discovery-row" data-space-row="recent">{data.recent.slice(0,6).map((s:Card)=>tile(s))}</div></section>}
      {data.genres?.filter((g:any)=>g.items).map((g:any)=><section key={g.slug}><h2>{g.name} <a href={`/genres/${g.slug}`} aria-label={`See all ${g.name} spaces`} onClick={e=>{e.preventDefault();navigate(`/genres/${g.slug}`);}}>See all</a></h2><div className="discovery-row" data-space-row={g.slug}>{g.items.length?g.items.map((s:Card)=>tile(s)):<p>Spaces will appear here as they are added.</p>}</div></section>)}
      {data.items&&<><div className="discovery-grid">{data.items.map((s:Card)=>tile(s))}</div>{!data.items.length&&<p>{path==='/your-spaces'?'Save spaces here for quick access.':'No spaces to show yet.'}</p>}
        {data.nextCursor&&<button onClick={async()=>{try{const genre=/^\/genres\/([^/]+)$/.exec(path);const next=await request(`/directory?${genre?`genre=${genre[1]}&`:path==='/groups'?'type=group&':path==='/channels'?'type=channel&':''}cursor=${data.nextCursor}`);setData({...data,items:[...data.items,...next.items],nextCursor:next.nextCursor});}catch(e:any){setError(e.message);}}}>More spaces</button>}
        {path==='/recent'&&!!data.items.length&&<button onClick={async()=>{const csrf=document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/)?.[1];await fetch('/api/viewer/v1/discovery/recent',{method:'DELETE',headers:csrf?{'X-CSRF-Token':decodeURIComponent(csrf)}:{}});setReload(v=>v+1);}}>Clear history</button>}</>}
    </>:null}</Shell>;
}
