import {useLayoutEffect,useState} from 'react';
import {validMediaSize,type MediaSize} from '../feed/feedGeometry';
import type {NativePlayerPort} from './useFeedPlayback';

// Current-player geometry only. Preloaded neighbors already have a ready item
// when selected; no extra player, seek or per-frame polling is needed.
export function useVideoSize(player:NativePlayerPort|null,key:string,fallback:MediaSize|null,hasFrame:boolean,status:string){
  const [value,setValue]=useState<{key:string;player:NativePlayerPort;size:MediaSize}|null>(null);
  useLayoutEffect(()=>{
    if(!player)return;
    let live=true,serial=0;
    const update=()=>{const request=++serial;void player.presentationSize().then(size=>{
      if(!live||request!==serial||!validMediaSize(size))return;
      setValue(old=>old?.key===key&&old.player===player&&Math.abs(old.size.width/old.size.height-size.width/size.height)<.0001?old:{key,player,size});
    }).catch(()=>{});};
    const subscriptions=[player.native.addListener('sourceLoad',update),player.native.addListener('videoTrackChange',update)];
    update();return()=>{live=false;serial++;subscriptions.forEach(s=>s.remove());};
  },[player,key,hasFrame,status]);
  return value?.key===key&&value.player===player?value.size:validMediaSize(fallback)?fallback:null;
}
