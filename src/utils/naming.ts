export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200);
}

export function pickExtension(contentType?: string, originalName?: string): string {
  const lowerCt = String(contentType || '').toLowerCase();
  const extFromName = ((originalName || '').match(/\.[^.]+$/) || [''])[0].toLowerCase();
  return lowerCt.includes('mp4')
    ? '.mp4'
    : lowerCt.includes('webm')
    ? '.webm'
    : lowerCt.includes('quicktime') || lowerCt.includes('mov')
    ? '.mov'
    : extFromName || '.mp4';
}

export function nowDateYmd(): { ymd: string; folder: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return { ymd: `${y}-${m}-${d}`, folder: `${y}-${m}/${d}` };
}

export function dateYmdToFolder(ymd: string): string {
  const m = ymd.match(/^(\d{4}-\d{2})-(\d{2})$/);
  return m ? `${m[1]}/${m[2]}` : ymd;
}

export function buildUploadKey(basePrefix: string, dateFolder: string, uuid: string, ext: string): string {
  const prefix = basePrefix ? (basePrefix.endsWith('/') ? basePrefix : basePrefix + '/') : '';
  return `${prefix}${dateFolder}/${uuid}/video${ext}`;
}

export function baseFromS3Key(key: string, fallbackName = 'video'): string {
  const leaf = String(key || '').split('/').pop() || '';
  const i = leaf.lastIndexOf('.');
  return i > 0 ? leaf.slice(0, i) : fallbackName;
}

export function outputPrefix(dateYmd: string, uuid: string, orientation: 'portrait' | 'landscape'): string {
  const dateFolder = dateYmdToFolder(dateYmd);
  return `${dateFolder}/${uuid}/${orientation}/`;
}

