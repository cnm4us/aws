import 'dotenv/config';

export const PORT = Number(process.env.PORT || 3300);
export const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-1';

function envBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === '') return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return defaultValue;
}

// Upload/input bucket
export const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET || 'bacs-mc-uploads';
export const UPLOAD_PREFIX = (process.env.UPLOAD_PREFIX ?? 'uploads/').replace(/^\/+/, '').replace(/\/+/g, '/');
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);

// Output bucket
export const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || 'bacs-mc-public-stream';
export const OUTPUT_PREFIX = (process.env.OUTPUT_PREFIX ?? 'hls/').replace(/^\/+/, '').replace(/\/+/g, '/');

// MediaConvert audio loudness normalization (integrated loudness across videos)
// Default: enabled unless explicitly set to 0/false/no.
export const MEDIA_CONVERT_NORMALIZE_AUDIO = envBool('MEDIA_CONVERT_NORMALIZE_AUDIO', true);

// MediaConvert job
export const MC_ROLE_ARN = process.env.MC_ROLE_ARN || '';
export const MC_QUEUE_ARN = process.env.MC_QUEUE_ARN || undefined;
export const ACCELERATION_MODE = (process.env.ACCELERATION_MODE || 'PREFERRED') as 'DISABLED'|'ENABLED'|'PREFERRED';
export const MC_PRIORITY = Number(process.env.MC_PRIORITY || 0);

// Status poller
export const STATUS_POLL_MS = Number(process.env.STATUS_POLL_MS || 30000);

// CDN
export const CLOUDFRONT_DOMAIN = process.env.CLOUDFRONT_DOMAIN || '';

// Request logs
import path from 'path';
export const REQUEST_LOGS_DIR = process.env.REQUEST_LOGS_DIR || path.join(process.cwd(), 'logs', 'request');
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN || undefined;
export const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
