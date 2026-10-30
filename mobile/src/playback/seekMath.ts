export const validDuration=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
export const clampTime=(seconds:number,duration:number)=>validDuration(duration)&&Number.isFinite(seconds)?Math.max(0,Math.min(seconds,Math.max(0,duration-.1))):0;
export const timeAt=(x:number,width:number,duration:number)=>width>0&&Number.isFinite(x)&&Number.isFinite(width)?clampTime(x/width*duration,duration):0;
export function formatTime(seconds:number){const n=Number.isFinite(seconds)?Math.max(0,Math.floor(seconds)):0;return n>=3600?`${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`:`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}

export const horizontalScrubIntent=(dx:number,dy:number)=>Number.isFinite(dx)&&Number.isFinite(dy)&&Math.abs(dx)>=6&&Math.abs(dx)>Math.abs(dy)*1.5;
