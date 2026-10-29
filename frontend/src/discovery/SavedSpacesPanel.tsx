import React,{useEffect,useState} from 'react';
import {request} from './api';
export default function SavedSpacesPanel({onSelect}:{onSelect:(path:string)=>void}) {
  const [data,setData]=useState<any>(null),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();void request('/saved',undefined,controller.signal).then(setData).catch(e=>{if(!controller.signal.aborted)setError(e.status===401?'Sign in to save and open your spaces.':'Cannot load Your Spaces. Please try again.');});return()=>controller.abort();},[]);
  return <div style={{display:'grid',gap:12,color:'#fff'}}><button onClick={()=>onSelect('/global')}>Global</button><button onClick={()=>onSelect('/discover')}>Home</button>
    {error&&<p role="alert">{error}</p>}{data?.personal&&<button onClick={()=>onSelect('/personal')}>My Space</button>}
    {data?.items?.map((space:any)=><button key={space.id} onClick={()=>onSelect(space.path)}>{space.name}</button>)}
    <button onClick={()=>onSelect('/your-spaces')}>Manage Your Spaces</button>
  </div>;
}
