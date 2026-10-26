import type { AccessProof } from './accessProof';
export type Viewer = { id: number; displayName: string | null };
export type NativeSession = { confirmation?:AccessProof; token: string; expiresAt: string; viewer: Viewer };
export type StoredSession = { version: 1; origin: string; token: string; expiresAt: string };
export interface SessionStorage {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}
export interface NativeSessionApi {
  login(email: string, password: string, signal: AbortSignal): Promise<NativeSession>;
  validate(token: string, signal: AbortSignal): Promise<Omit<NativeSession,'token'>>;
  revoke(token: string): Promise<void>;
}
export const isSessionRecord = (v: unknown): v is StoredSession => {
  const s=v as StoredSession | null;
  return !!s && s.version===1 && typeof s.origin==='string' && /^nv1_[a-f0-9]{64}$/.test(s.token)
    && typeof s.expiresAt==='string' && Number.isFinite(Date.parse(s.expiresAt));
};
