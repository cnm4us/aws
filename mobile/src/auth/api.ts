import { createApiClient, ApiError } from '../api/client';
import type { NativeSession, NativeSessionApi, Viewer } from './types';

function identity(value: unknown) {
  const data=value as {expiresAt?: unknown;viewer?: Viewer} | null;
  if (!data?.viewer || !Number.isSafeInteger(data.viewer.id) || data.viewer.id<=0 ||
    !(typeof data.viewer.displayName==='string' || data.viewer.displayName===null) ||
    typeof data.expiresAt!=='string' || !Number.isFinite(Date.parse(data.expiresAt))) throw new ApiError('The server returned an invalid session.');
  return {expiresAt:data.expiresAt,viewer:{id:data.viewer.id,displayName:data.viewer.displayName}};
}
export function createNativeSessionApi(baseUrl: string, fetchImpl?: typeof fetch): NativeSessionApi {
  const client=(token?: string)=>createApiClient(baseUrl,{fetchImpl,getHeaders:():Record<string,string>=>token?{Authorization:`Bearer ${token}`}:{}});
  return {
    login:async(email,password,signal)=>{
      const value=await client().postJson('/api/native/v1/session',{email,password},signal) as NativeSession;
      const data=identity(value);
      if (!/^nv1_[a-f0-9]{64}$/.test(value.token)) throw new ApiError('The server returned an invalid session.');
      return {...data,token:value.token};
    },
    validate:async(token,signal)=>identity(await client(token).getJson('/api/native/v1/session',signal)),
    revoke:async token=>{await client(token).deleteJson('/api/native/v1/session');},
  };
}
