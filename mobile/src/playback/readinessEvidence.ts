import { requireOptionalNativeModule } from 'expo-modules-core';
import type { VideoPlayer } from 'expo-video';

export type NativeReadinessEvidence = {
  attempt: string; kind: 'target_decoded'; targetSeconds: number; timelineSeconds: number;
  decodedFrameSeconds: number; seekCompletedMs: number; decodedFrameMs: number;
  width: number; height: number; muted: boolean; rate: number;
};
type Adapter = {
  prepareAsync(player: VideoPlayer, attempt: string, seconds: number): Promise<NativeReadinessEvidence>;
  cancelAsync(attempt: string): Promise<void>;
};
const adapter = requireOptionalNativeModule<Adapter>('ViewerReadiness');
export const readinessEvidenceAvailable = !!adapter;
export const prepareReadinessEvidence = (player: VideoPlayer, attempt: string, seconds: number) => {
  if (!adapter) return Promise.reject(new Error('Native readiness adapter unavailable'));
  return adapter.prepareAsync(player, attempt, seconds);
};
export const cancelReadinessEvidence = (attempt: string) => { try{void adapter?.cancelAsync(attempt).catch(() => {});}catch{} };
