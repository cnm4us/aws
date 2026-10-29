import type { Request,Response,NextFunction } from 'express';
import { getPool } from '../../db';
import { resolveViewer } from '../native-sessions/service';
import { sendViewerError } from '../../routes/native-session';
import { entryReceipt } from './router';
import { requireEntry } from './service';

/** Gate viewer content on both transports. Editing/moderation and metadata remain separate authorities. */
export async function discoveryContentGuard(req:Request,res:Response,next:NextFunction) {
  const path=req.path;
  const global=/^\/api\/(?:viewer\/v1\/)?feed\/global(?:\/|$)/.test(path);
  const space=/^\/api\/(?:viewer\/v1\/)?spaces\/([1-9]\d*)\/(?:feed|playback-access|publications\/|users\/[1-9]\d*\/follow)/.exec(path);
  const publication=/^\/api\/publications\/([1-9]\d*)(?:\/(?:captions\.vtt|story|reporting\/options|report|likes|comments)(?:\/|$)|\/?$)/.exec(path);
  if(!global&&!space&&!publication)return next();
  // PATCH story and publishing operations are editor operations, not viewer reads.
  if(req.method==='PATCH'||req.method==='POST'&&/\/story\/reset\/?$/.test(path))return next();
  res.set('Cache-Control','no-store');
  try {
    let id=space?Number(space[1]):null;
    if(publication) {
      const [rows]=await getPool().query('SELECT space_id FROM space_publications WHERE id=?',[Number(publication[1])]);
      if(!(rows as any[]).length)return next();id=Number((rows as any[])[0].space_id);
    }
    const principal=await resolveViewer(req,false);
    await requireEntry(id,principal?.viewer.id??null,entryReceipt(req));next();
  }catch(e){sendViewerError(res,e);}
}
