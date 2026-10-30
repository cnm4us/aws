import React from 'react';
import {navigate} from './api';

export type Card={id:number;name:string;type:string;path:string;description:string|null;artworkUrl:string|null;saved:boolean;global:boolean;requiresSignIn:boolean;unavailable?:boolean;availability?:{label:string;canView:boolean;price:{amountCents:number;currency:string;interval:string}|null}};
export function SpaceCard({space,onSave,saving=false,error,featured=false}:{space:Card;onSave?:(space:Card)=>void;saving?:boolean;error?:string;featured?:boolean}) {
  const name=space.type==='personal'?'My Space':space.name;
  const open=(event:React.MouseEvent<HTMLAnchorElement>)=>{
    if(space.unavailable){event.preventDefault();return;}
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    event.preventDefault();navigate(event.currentTarget.getAttribute('href')!);
  };
  return <article className={`discovery-tile${featured?' discovery-featured':''}`} data-space-id={space.id}>
    <a className="discovery-primary" href={space.path} onClick={open} aria-disabled={space.unavailable} aria-label={`Open ${name}`} data-card-focus={`open-${space.id}`}>
      <div className="discovery-art">{space.artworkUrl?<img src={space.artworkUrl} alt="" loading="lazy"/>:<span aria-hidden="true">{name.slice(0,1).toUpperCase()}</span>}</div>
      <h3>{name}</h3>
    </a>
    <div className="discovery-card-meta"><p className="discovery-kind">{space.global?'Public feed':space.type==='personal'?'My Space':space.type==='group'?'Group':'Channel'}</p>
      <a className="discovery-launch" href={space.path} onClick={open} aria-disabled={space.unavailable} aria-label={`Launch ${name}`} data-card-focus={`launch-${space.id}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-10 10M10 5H5v14h14v-5"/></svg></a>
    </div>
    {space.availability&&<p className="discovery-card-restriction">{space.availability.label}</p>}
    {space.availability?.price&&<p>{space.availability.price.currency} {(space.availability.price.amountCents/100).toFixed(2)} / {space.availability.price.interval}</p>}
    {space.requiresSignIn&&<p className="discovery-card-restriction">Sign in to enter</p>}
    {space.description&&<p className="discovery-card-description">{space.description}</p>}
    <footer className="discovery-card-footer">
      <a href={`${space.path}/about`} onClick={open} aria-disabled={space.unavailable} aria-label={`About and rules for ${name}`} data-card-focus={`about-${space.id}`}>About &amp; Rules</a>
      {onSave&&!space.global&&space.type!=='personal'&&<label className="discovery-save">
        <input type="checkbox" checked={space.saved} disabled={saving} aria-busy={saving} aria-label={`Save ${name} to Your Spaces`} data-card-focus={`save-${space.id}`} onChange={()=>onSave(space)}/>
        <span aria-hidden="true">{space.saved?'✓':''}</span>
      </label>}
    </footer>
    {error&&<p role="alert" className="discovery-card-error">{error}</p>}
  </article>;
}
