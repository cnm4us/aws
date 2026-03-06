import fs from 'fs';
import path from 'path';
import { REQUEST_LOGS_DIR } from '../config';
import { getLogger } from '../lib/logger';

const requestLogLogger = getLogger({ component: 'utils.request_log' })

function ensureDir(p: string) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function tsString(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}-${m}-${day}_${hh}:${mm}:${ss}`;
}

export function writeRequestLog(nameHint: string, payload: any) {
  try {
    ensureDir(REQUEST_LOGS_DIR);
    const ts = tsString();
    const file = path.join(REQUEST_LOGS_DIR, `${ts}.log`);
    const meta = { name: nameHint, timestamp: ts };
    const body = JSON.stringify({ meta, payload }, null, 2);
    fs.writeFileSync(file, body);
  } catch (e) {
    requestLogLogger.warn({ err: e, name_hint: nameHint }, 'request_log_write_failed')
  }
}
