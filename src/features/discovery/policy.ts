import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { validateCultureDefinitionV1 } from '../cultures/validator';

// Only reader-facing authored fields enter this projection; never spread a source definition.
export function publicCulture(row: any) {
  let raw: unknown;
  try { raw = typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : row.definition_json; } catch {}
  const valid = raw ? validateCultureDefinitionV1(raw) : null;
  const definition = valid?.ok ? valid.value : null;
  return { id:Number(row.id),name:String(row.name),summary:definition?.summary?.trim() || String(row.description || '').trim() || null,
    expectations:definition ? definition.tone_expectations.map(t=>t.replace(/_/g,' ')) : [],
    boundaries:definition ? Object.entries(definition.content_boundaries).map(([name,level])=>`${name.replace(/_/g,' ')}: ${level}`) : [],
    configured:!!definition };
}
export function readerText(value: unknown): string {
  return String(value || '').normalize('NFC').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim();
}
export function readerRevision(document: unknown): string {
  // Whitespace/Markdown-only edits do not invalidate an acknowledgment. Word/punctuation/order changes do.
  const normalized=JSON.stringify(document,(_key,value)=>typeof value==='string'
    ? readerText(value).replace(/(?:^|\n)\s*[#>*-]+\s*/g,' ').replace(/[*_`]/g,'').replace(/\s+/g,' ').trim() : value);
  return createHash('sha256').update(normalized).digest('hex');
}
export const ANONYMOUS_RECEIPT_AGE=90*24*60*60*1000;
export function issueReceipt(secret:Buffer,spaceId:number,revision:string,now=Date.now()):string {
  const payload=Buffer.from(JSON.stringify({v:1,s:spaceId,r:revision,e:now+ANONYMOUS_RECEIPT_AGE})).toString('base64url');
  return `${payload}.${createHmac('sha256',secret).update(payload).digest('base64url')}`;
}
export function validReceipt(token:unknown,secret:Buffer,spaceId:number,revision:string,now=Date.now()):boolean {
  if(typeof token!=='string'||token.length>512)return false;
  try {
    const [payload,sig,...extra]=token.split('.');if(extra.length||!payload||!sig)return false;
    const expected=createHmac('sha256',secret).update(payload).digest(),supplied=Buffer.from(sig,'base64url');
    if(supplied.length!==expected.length||!timingSafeEqual(expected,supplied))return false;
    const data=JSON.parse(Buffer.from(payload,'base64url').toString());
    return data.v===1&&data.s===spaceId&&data.r===revision&&Number.isFinite(data.e)&&data.e>now&&data.e<=now+ANONYMOUS_RECEIPT_AGE;
  }catch{return false;}
}
