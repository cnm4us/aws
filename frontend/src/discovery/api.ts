export const prefix='/api/viewer/v1/discovery';
export async function request(path:string,body?:unknown,signal?:AbortSignal) {
  const csrf=document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/)?.[1];
  const response=await fetch(prefix+path,{credentials:'same-origin',signal,method:body===undefined?'GET':'POST',
    headers:body===undefined?{}:{'Content-Type':'application/json',...(csrf?{'X-CSRF-Token':decodeURIComponent(csrf)}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error||'Cannot load this page. Please try again.'),{status:response.status});
  return result;
}
export function keyForPath(path:string):string|null {
  if(/^\/global(?:\/about)?\/?$/.test(path))return 'global';
  if(/^\/personal(?:\/about)?\/?$/.test(path))return 'personal';
  const m=/^\/(groups|channels)\/([^/]+)(?:\/about)?\/?$/.exec(path);
  try{return m?`${m[1]==='groups'?'group':'channel'}:${decodeURIComponent(m[2])}`:null;}catch{return null;}
}
export function navigate(path:string) {
  window.dispatchEvent(new Event('viewer:leaving'));
  window.history.pushState({},'',path);
  window.dispatchEvent(new Event('viewer:navigate'));
}
