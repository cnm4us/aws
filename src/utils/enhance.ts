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
  // Orientation heuristic: prefer dimensions, fallback to profile keyword
  let orientation: 'portrait' | 'landscape' | null = null;
  const w = Number(u.width || 0);
  const h = Number(u.height || 0);
  if (w > 0 && h > 0) {
    orientation = h > w ? 'portrait' : 'landscape';
  } else if (typeof u.profile === 'string') {
    const p = u.profile.toLowerCase();
    if (p.includes('portrait')) orientation = 'portrait';
    else if (p.includes('landscape')) orientation = 'landscape';
  }
  out.orientation = orientation;
  if (CLOUDFRONT_DOMAIN && u.output_prefix) {
    const cdnPrefix = `https://${CLOUDFRONT_DOMAIN}/${u.output_prefix}`;
    out.cdn_prefix = cdnPrefix;
    out.cdn_master = `${cdnPrefix}${baseFromKey}.m3u8`;
    out.poster_cdn = `${cdnPrefix}${baseFromKey}_poster.0000000.jpg`;
    // Explicit portrait/landscape poster URLs
    try {
      const hasPortraitSeg = String(u.output_prefix).includes('/portrait/');
      const portraitPrefix = hasPortraitSeg
        ? `https://${CLOUDFRONT_DOMAIN}/${String(u.output_prefix)}`
        : `https://${CLOUDFRONT_DOMAIN}/${String(u.output_prefix).replace('/landscape/', '/portrait/')}`;
      const landscapePrefix = hasPortraitSeg
        ? `https://${CLOUDFRONT_DOMAIN}/${String(u.output_prefix).replace('/portrait/', '/landscape/')}`
        : `https://${CLOUDFRONT_DOMAIN}/${String(u.output_prefix)}`;
      out.poster_portrait_cdn = `${portraitPrefix}${baseFromKey}_poster.0000000.jpg`;
      if (orientation === 'landscape') {
        out.poster_landscape_cdn = `${landscapePrefix}${baseFromKey}_poster.0000000.jpg`;
      }
    } catch {}
  }
  if (u.output_prefix) {
    const base = baseFromKey;
    const region = AWS_REGION;
    out.s3_master = `https://${OUTPUT_BUCKET}.s3.${region}.amazonaws.com/${u.output_prefix}${base}.m3u8`;
    out.poster_s3 = `https://${OUTPUT_BUCKET}.s3.${region}.amazonaws.com/${u.output_prefix}${base}_poster.0000000.jpg`;
    try {
      const hasPortraitSeg = String(u.output_prefix).includes('/portrait/');
      const portraitPrefix = hasPortraitSeg
        ? `${String(u.output_prefix)}`
        : `${String(u.output_prefix).replace('/landscape/', '/portrait/')}`;
      const landscapePrefix = hasPortraitSeg
        ? `${String(u.output_prefix).replace('/portrait/', '/landscape/')}`
        : `${String(u.output_prefix)}`;
      out.poster_portrait_s3 = `https://${OUTPUT_BUCKET}.s3.${region}.amazonaws.com/${portraitPrefix}${base}_poster.0000000.jpg`;
      if (orientation === 'landscape') {
        out.poster_landscape_s3 = `https://${OUTPUT_BUCKET}.s3.${region}.amazonaws.com/${landscapePrefix}${base}_poster.0000000.jpg`;
      }
    } catch {}
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
