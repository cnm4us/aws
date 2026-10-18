import { Router, type Request, type Response } from 'express';
import * as sessions from '../features/native-sessions/service';

export function sendViewerError(res: Response, error: unknown) {
  const e=error as any;
  const status=e instanceof sessions.ViewerApiError ? e.status : [400,403,404].includes(e?.status) ? e.status : 503;
  const code=e instanceof sessions.ViewerApiError ? e.code : status===403 ? 'forbidden' : status===404 ? 'space_not_found' : status===400 ? 'invalid_query' : 'service_unavailable';
  if (e instanceof sessions.ViewerApiError && e.retryAfter) res.set('Retry-After',String(e.retryAfter));
  return res.status(status).json({error:code});
}
export function createNativeSessionRouter(deps = sessions) {
  const router=Router();
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.use((req,res,next)=>{
    try {
      if (!deps.nativeEnabled()) throw new sessions.ViewerApiError(503,'native_unavailable');
      deps.requireNativeTransport(req); next();
    } catch(e) { sendViewerError(res,e); }
  });
  router.post('/',async(req,res)=>{
    try {
      if (req.headers.authorization || /(?:^|;)\s*sid=/.test(req.headers.cookie || '')) throw new sessions.ViewerApiError(400,'ambiguous_auth');
      const {email,password}=req.body || {};
      if (typeof email!=='string' || typeof password!=='string' || email.length>254 || password.length>1024 || !email.trim() || !password)
        throw new sessions.ViewerApiError(400,'invalid_body');
      await deps.consumeLoginLimit(email.trim().toLowerCase(),deps.requestTransport(req).ip);
      res.status(201).json(await deps.createNativeSession(email.trim().toLowerCase(),password));
    } catch(e) { sendViewerError(res,e); }
  });
  router.get('/',async(req,res)=>{
    try { const p=await deps.resolveNativeSession(deps.readBearer(req)!); res.json({viewer:p.viewer,expiresAt:p.expiresAt}); }
    catch(e) { sendViewerError(res,e); }
  });
  router.delete('/',async(req,res)=>{
    try { await deps.revokeNativeSession(deps.readBearer(req)!); res.sendStatus(204); }
    catch(e) { sendViewerError(res,e); }
  });
  return router;
}
