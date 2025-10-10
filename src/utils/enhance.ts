import { AWS_REGION, CLOUDFRONT_DOMAIN, OUTPUT_BUCKET } from '../config';

function baseNameWithoutExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

export function enhanceUploadRow(u: any) {
  const out: any = { ...u };
  // Derive base from the sanitized S3 key filename to avoid spaces/mismatch
  const leaf = String(u.s3_key || '').split('/').pop() || '';
  const baseFromKey = baseNameWithoutExt(leaf) || baseNameWithoutExt(u.original_filename || 'video');
  if (CLOUDFRONT_DOMAIN && u.output_prefix) {
    const cdnPrefix = `https://${CLOUDFRONT_DOMAIN}/${u.output_prefix}`;
    out.cdn_prefix = cdnPrefix;
    out.cdn_master = `${cdnPrefix}${baseFromKey}.m3u8`;
  }
  if (u.output_prefix) {
    const base = baseFromKey;
    const region = AWS_REGION;
    out.s3_master = `https://${OUTPUT_BUCKET}.s3.${region}.amazonaws.com/${u.output_prefix}${base}.m3u8`;
  }
  return out;
}

export function parseFromKey(key: string): { date: string; uuid: string } | null {
  try {
    const parts = (key || '').split('/');
    for (let i = 0; i < parts.length - 2; i++) {
      const a = parts[i];
      const b = parts[i + 1];
      const c = parts[i + 2];
      // Old pattern: YYYY-MM-DD/UUID/...
      if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^[0-9a-fA-F-]{36}$/.test(b)) {
        return { date: a, uuid: b };
      }
      // New pattern: YYYY-MM/DD/UUID/...
      if (/^\d{4}-\d{2}$/.test(a) && /^\d{2}$/.test(b) && /^[0-9a-fA-F-]{36}$/.test(c)) {
        return { date: `${a}-${b}`, uuid: c };
      }
    }
    const last = parts[parts.length - 1] || '';
    const m = last.match(/^([0-9a-fA-F-]{36})-/);
    if (m) {
      // No explicit date; use today
      const today = new Date().toISOString().slice(0, 10);
      return { date: today, uuid: m[1] };
    }
  } catch {}
  return null;
}

