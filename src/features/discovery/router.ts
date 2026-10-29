import { Router, type Request } from 'express';
import { resolveViewer, ViewerApiError } from '../native-sessions/service';
import { sendViewerError } from '../../routes/native-session';
import { parseCookies } from '../../utils/cookies';
import * as discovery from './service';

const cookie='viewer_global_entry';
export function entryReceipt(req:Request):string|undefined {
  const header=req.get('X-Space-Entry-Receipt');
  // Native uses an explicit receipt, browser uses a same-site cookie. Identity is always independently resolved.
  return header || parseCookies(req.headers.cookie)[cookie];
}
export function createDiscoveryRouter() {
  const router=Router();
  const read=(path:string,required:boolean,run:(req:Request,id:number|null)=>Promise<any>)=>router.get(path,async(req,res)=>{
    try{const principal=await resolveViewer(req,required);res.json(await run(req,principal?.viewer.id??null));}catch(e){sendViewerError(res,e);}
  });
  const write=(path:string,required:boolean,run:(req:Request,id:number|null)=>Promise<any>)=>router.post(path,async(req,res)=>{
    try {
      const principal=await resolveViewer(req,required);
      const origin=req.get('Origin');
      if(origin&&!req.headers.authorization&&new URL(origin).host!==req.get('host'))throw new ViewerApiError(403,'csrf_invalid');
      const result=await run(req,principal?.viewer.id??null);
      if(result.receipt&&!principal)res.cookie(cookie,result.receipt,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:90*86400*1000});
      res.json(result);
    }catch(e){sendViewerError(res,e);}
  });
  read('/discovery/config',false,()=>discovery.config());
  write('/discovery/config',true,(_req,id)=>discovery.updateConfig(id!,_req.body));
  read('/discovery/home',false,(_req,id)=>discovery.home(id));
  read('/discovery/directory',false,(req,id)=>{
    if(Object.keys(req.query).some(k=>!['genre','type','cursor','limit'].includes(k))||Object.values(req.query).some(v=>typeof v!=='string'))throw new ViewerApiError(400,'invalid_query');
    return discovery.directory(id,req.query as any);
  });
  read('/discovery/saved',true,(req,id)=>{
    if(Object.keys(req.query).some(k=>!['type','cursor','limit'].includes(k))||Object.values(req.query).some(v=>typeof v!=='string'))throw new ViewerApiError(400,'invalid_query');
    return Object.keys(req.query).length?discovery.savedDirectory(id!,req.query):discovery.saved(id!);
  });
  read('/discovery/recent',true,async(_req,id)=>({items:await discovery.recent(id!),recentFeeds:await discovery.recentFeeds(id!)}));
  router.delete('/discovery/recent',async(req,res)=>{
    try {const principal=(await resolveViewer(req,true))!;
      const {getPool}=await import('../../db');await getPool().query('DELETE FROM viewer_recent_spaces WHERE user_id=?',[principal.viewer.id]);await getPool().query('DELETE FROM viewer_feed_checkpoints WHERE user_id=?',[principal.viewer.id]);res.json({ok:true});
    }catch(e){sendViewerError(res,e);}
  });
  read('/discovery/spaces/:key/entry',false,(req,id)=>discovery.entry(req.params.key,id,entryReceipt(req)));
  write('/discovery/spaces/:key/accept',false,(req,id)=>discovery.accept(req.params.key,id,req.body?.revision));
  write('/discovery/spaces/:key/save',true,(req,id)=>{
    if(typeof req.body?.saved!=='boolean')throw new ViewerApiError(400,'invalid_body');
    return discovery.save(req.params.key,id!,!req.body.saved);
  });
  read('/discovery/spaces/:key/resume',true,async(req,id)=>{const entry=await discovery.entry(req.params.key,id);if(entry.requiresAcknowledgment)throw new ViewerApiError(428,'space_acknowledgment_required');return discovery.resume(req.params.key,id!);});
  write('/discovery/spaces/:key/visit',true,async(req,id)=>{const entry=await discovery.entry(req.params.key,id);if(entry.requiresAcknowledgment)throw new ViewerApiError(428,'space_acknowledgment_required');return discovery.visit(req.params.key,id!,req.body);});
  read('/discovery/spaces/:key/editor',true,(req,id)=>discovery.editor(req.params.key,id!));
  write('/discovery/spaces/:key/editor',true,(req,id)=>discovery.updateEditor(req.params.key,id!,req.body));
  write('/discovery/genres',true,(_req,id)=>discovery.updateGenre(id!,_req.body));
  return router;
}
