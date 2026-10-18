import type { SessionStorage, StoredSession } from './types';
import { isSessionRecord } from './types';

export interface KeyValueStorage { getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>;removeItem(key:string):Promise<void> }
// Secrets and the durable signed-out marker intentionally use separate stores.
export function createSessionStorage(secure: KeyValueStorage, preferences: KeyValueStorage, origin: string): SessionStorage {
  const namespace=Array.from(origin,c=>c.charCodeAt(0).toString(16).padStart(4,'0')).join('');
  const key=`viewer-session-v1.${namespace}`;
  const marker=`${key}:state`;
  return {
    async load() {
      const state=await preferences.getItem(marker);
      if (state!=='signed-in') {
        // A new install or interrupted sign-out must not resurrect an iOS Keychain item.
        await secure.removeItem(key).catch(()=>{});
        return null;
      }
      const raw=await secure.getItem(key);
      if (!raw) return null;
      let value: unknown;
      try { value=JSON.parse(raw); } catch { await secure.removeItem(key);return null; }
      if (!isSessionRecord(value) || value.origin!==origin) {await secure.removeItem(key);return null;}
      return value;
    },
    async save(session: StoredSession) {
      await secure.setItem(key,JSON.stringify(session));
      await preferences.setItem(marker,'signed-in');
    },
    async clear() {
      // If marker persistence fails, deletion can still make sign-out durable.
      let markerSaved=false;
      try {await preferences.setItem(marker,'signed-out');markerSaved=true;}catch{}
      try {await secure.removeItem(key);}catch(e){if(!markerSaved) throw e;}
    },
  };
}
