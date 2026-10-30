import React,{useEffect,useState} from 'react';
import {request} from './api';
import {PolicyDocument} from './Discovery';
import './discovery.css';

export default function DiscoveryEditor() {
  const key=/\/spaces\/(\d+)\/admin\/discovery/.exec(window.location.pathname)?.[1]||'global';
  const [data,setData]=useState<any>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[preview,setPreview]=useState(false);
  const [text,setText]=useState(''),[listed,setListed]=useState(false),[enabled,setEnabled]=useState(false),[art,setArt]=useState(''),[genres,setGenres]=useState<number[]>([]);
  const [entryMode,setEntryMode]=useState('existing'),[amount,setAmount]=useState(''),[currency,setCurrency]=useState('USD'),[interval,setInterval]=useState('month');
  const [genreName,setGenreName]=useState(''),[genreSlug,setGenreSlug]=useState(''),[genreOrder,setGenreOrder]=useState(0),[genrePublished,setGenrePublished]=useState(true);
  const receive=(value:any)=>{setData(value);setText(value.draft);setListed(value.listed);setEnabled(value.entryEnabled);setArt(value.artworkUrl);setGenres(value.genreIds);setEntryMode(value.viewerEntry?.mode||'existing');setAmount(value.viewerEntry?.price?String(value.viewerEntry.price.amountCents/100):'');setCurrency(value.viewerEntry?.price?.currency||'USD');setInterval(value.viewerEntry?.price?.interval||'month');};
  useEffect(()=>{const controller=new AbortController();void request(`/spaces/${key}/editor`,undefined,controller.signal).then(receive).catch(e=>{if(!controller.signal.aborted)setError(e.message)});return()=>controller.abort();},[key]);
  const save=async(action:string)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{receive(await request(`/spaces/${key}/editor`,{action,...(action==='entry_options'?{mode:entryMode,price:entryMode==='paid_channel'&&amount?{amountCents:Math.round(Number(amount)*100),currency,interval}:null}:{}),text,entryEnabled:enabled,listed,artworkUrl:art,genreIds:genres}));setNotice(action==='draft'?'Draft saved.':action==='publish'?'Welcome published.':action==='entry_options'?'Entry options saved.':'Directory placement saved.');}catch(e:any){setError(e.message==='space_editorial_incomplete'?'Publish a welcome and an authored summary for each assigned culture before enabling acknowledgment.':e.message)}finally{setBusy(false)}};
  return <div className="discovery"><main><a href="/admin">Administration</a><h1>Discovery and welcome{data?`: ${data.space.name}`:''}</h1>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{!data?<p>Loading…</p>:<>
    <h2>Entry options</h2><p>Saving a shortcut never enrolls or subscribes a viewer. Changing these requirements affects access; existing owner/member/subscriber access is retained. New purchases are deferred.</p>
    <label>Entry policy <select value={entryMode} onChange={e=>setEntryMode(e.target.value)}><option value="existing">Keep existing access policy</option>{data.policy.space.type==='group'?<option value="open_group">Allow self-service group joining</option>:data.policy.space.type==='channel'&&!data.policy.space.global?<><option value="free_channel">Free channel subscription</option><option value="paid_channel">Paid channel — information only</option></>:null}<option value="invitation">Invitation required</option></select></label>
    {entryMode==='paid_channel'&&<fieldset><legend>Published price (information only)</legend><label>Amount <input aria-label="Subscription amount" type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label>Currency <input value={currency} maxLength={3} onChange={e=>setCurrency(e.target.value.toUpperCase())}/></label><select aria-label="Billing interval" value={interval} onChange={e=>setInterval(e.target.value)}><option value="month">Month</option><option value="year">Year</option></select></fieldset>}
    <p><button disabled={busy||data.policy.space.global||data.policy.space.type==='personal'} onClick={()=>void save('entry_options')}>Save entry options</button></p>
    <h2>Space welcome</h2><p>The introduction uses the space’s existing description, assigned cultures and applicable rules. Manage culture definitions and assignments in the existing culture/space editors.</p>
    <label>Welcome text<textarea value={text} maxLength={12000} onChange={e=>setText(e.target.value)} rows={12} style={{display:'block',width:'100%',maxWidth:780}}/></label>
    <p><button disabled={busy} onClick={()=>void save('draft')}>Save draft</button> <button onClick={()=>setPreview(v=>!v)}>{preview?'Close preview':'Preview welcome'}</button></p>
    {preview&&<PolicyDocument document={{...data.policy.document,welcome:text}}/>}
    {data.curator&&<p><label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Require acknowledgment (enable after both clients qualify)</label></p>}
    <button disabled={busy} onClick={()=>void save('publish')}>Publish welcome</button>
    {data.curator&&<><h2>Directory placement</h2><label><input type="checkbox" checked={listed} onChange={e=>setListed(e.target.checked)}/> Listed in public discovery</label>
      <p>Listing publishes this space’s name, introduction and artwork. It does not grant access to videos.</p>
      <label>Public artwork path<input value={art} onChange={e=>setArt(e.target.value)} placeholder="/images/space-cover.jpg"/></label>
      <fieldset><legend>Genres</legend>{data.genres.map((g:any)=><label key={g.id} style={{display:'block',padding:8}}><input type="checkbox" checked={genres.includes(g.id)} onChange={e=>setGenres(e.target.checked?[...genres,g.id]:genres.filter(id=>id!==g.id))}/>{g.name}{g.published?'':' (unpublished)'}</label>)}</fieldset>
      <button disabled={busy} onClick={()=>void save('placement')}>Save directory placement</button>
      <h2>Home rollout</h2><p>Keep the root cutover off until browser and phone qualification. Entry enforcement is a separate per-space control.</p>
      <p><label><input type="checkbox" checked={data.config.homeEnabled} onChange={e=>setData({...data,config:{...data.config,homeEnabled:e.target.checked}})}/> Use Home at /</label></p>
      <p><label><input type="checkbox" checked={data.config.nativeHomeEnabled} onChange={e=>setData({...data,config:{...data.config,nativeHomeEnabled:e.target.checked}})}/> Use Home on supported iPhone builds</label></p>
      <button disabled={busy} onClick={async()=>{setBusy(true);try{const config=await request('/config',{homeEnabled:data.config.homeEnabled,nativeHomeEnabled:data.config.nativeHomeEnabled});setData({...data,config});setNotice('Home rollout saved.');}catch(e:any){setError(e.message)}finally{setBusy(false)}}}>Save Home rollout</button>
      <h2>Manage genres</h2><p>Select a genre to edit it, or enter a new name and slug. Changing its slug creates a separate genre.</p>
      <select aria-label="Edit genre" onChange={e=>{const g=data.genres.find((g:any)=>g.slug===e.target.value);if(g){setGenreName(g.name);setGenreSlug(g.slug);setGenreOrder(g.sort_order);setGenrePublished(!!g.published)}}}><option value="">New genre</option>{data.genres.map((g:any)=><option key={g.id} value={g.slug}>{g.name}</option>)}</select>
      <p><label>Name <input value={genreName} maxLength={100} onChange={e=>setGenreName(e.target.value)}/></label></p><p><label>Slug <input value={genreSlug} maxLength={80} onChange={e=>setGenreSlug(e.target.value)}/></label></p><p><label>Order <input type="number" value={genreOrder} onChange={e=>setGenreOrder(Number(e.target.value))}/></label></p>
      <label><input type="checkbox" checked={genrePublished} onChange={e=>setGenrePublished(e.target.checked)}/> Published genre</label>
      <p><button disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await request('/genres',{slug:genreSlug,name:genreName,published:genrePublished,sortOrder:genreOrder});receive(await request(`/spaces/${key}/editor`));setNotice('Genre saved.');}catch(e:any){setError(e.message)}finally{setBusy(false)}}}>Save genre</button></p>
    </>}
  </>}</main></div>;
}
