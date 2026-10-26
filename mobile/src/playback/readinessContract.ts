import type { NativeReadinessEvidence } from './readinessEvidence';

export function matchesReadinessEvidence(native:NativeReadinessEvidence,attempt:string,target:number){
  return native?.attempt===attempt&&native.kind==='target_decoded'&&native.targetSeconds===target&&
    [native.timelineSeconds,native.decodedFrameSeconds,native.seekCompletedMs,native.decodedFrameMs].every(Number.isFinite)&&
    Math.abs(native.decodedFrameSeconds-target)<=.1&&Math.abs(native.timelineSeconds-target)<=.1&&
    native.seekCompletedMs>=0&&native.decodedFrameMs>=native.seekCompletedMs&&
    Number.isSafeInteger(native.width)&&Number.isSafeInteger(native.height)&&native.width>0&&native.height>0&&native.muted===true&&native.rate===0;
}
