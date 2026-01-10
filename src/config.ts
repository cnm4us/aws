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

// Apply logo watermark to MediaConvert poster frame captures (FILE_GROUP_SETTINGS _poster)
export const MC_WATERMARK_POSTERS = envBool('MC_WATERMARK_POSTERS', true);

// Media jobs worker (Plan 36)
export const MEDIA_JOBS_ENABLED = envBool('MEDIA_JOBS_ENABLED', false);
export const MEDIA_JOBS_WORKER_ENABLED = envBool('MEDIA_JOBS_WORKER_ENABLED', MEDIA_JOBS_ENABLED);
export const MEDIA_JOBS_WORKER_POLL_MS = Number(process.env.MEDIA_JOBS_WORKER_POLL_MS || 2000);
export const MEDIA_JOBS_WORKER_HEARTBEAT_MS = Number(process.env.MEDIA_JOBS_WORKER_HEARTBEAT_MS || 15000);
export const MEDIA_JOBS_STALE_LOCK_MINUTES = Number(process.env.MEDIA_JOBS_STALE_LOCK_MINUTES || 5);
export const MEDIA_JOBS_LOGS_BUCKET = process.env.MEDIA_JOBS_LOGS_BUCKET || UPLOAD_BUCKET;
export const MEDIA_JOBS_LOGS_PREFIX = (process.env.MEDIA_JOBS_LOGS_PREFIX ?? 'media-jobs/logs/').replace(/^\/+/, '').replace(/\/+/g, '/');

// When enabled (default: on when media-jobs are enabled), ffmpeg is the single source of truth for
// all rendering/compositing (audio + overlays), and MediaConvert is used only for packaging.
export const MEDIA_FFMPEG_COMPOSITE_ENABLED = envBool('MEDIA_FFMPEG_COMPOSITE_ENABLED', MEDIA_JOBS_ENABLED);

// Screen title renderer:
// - drawtext (default): ffmpeg drawtext directly on video frames
// - pango: render a PNG overlay with Pango+Cairo, then ffmpeg overlays it (more typographic control)
export const SCREEN_TITLE_RENDERER: 'drawtext' | 'pango' = (() => {
  const raw = String(process.env.SCREEN_TITLE_RENDERER || 'drawtext').trim().toLowerCase()
  return raw === 'pango' ? 'pango' : 'drawtext'
})()

// Optional audio cleanup: gentle high-pass on the video's original audio only (helps wind/rumble).
export const MEDIA_VIDEO_HIGHPASS_ENABLED = envBool('MEDIA_VIDEO_HIGHPASS_ENABLED', false);
export const MEDIA_VIDEO_HIGHPASS_HZ = (() => {
  const raw = process.env.MEDIA_VIDEO_HIGHPASS_HZ
  if (raw == null || String(raw).trim() === '') return 80
  const n = Number(String(raw).trim())
  if (!Number.isFinite(n)) return 80
  const rounded = Math.round(n)
  return Math.max(20, Math.min(250, rounded))
})();

// AssemblyAI (captions/transcripts)
export const ASSEMBLYAI_ENABLED = envBool('ASSEMBLYAI_ENABLED', false);
export const ASSEMBLYAI_AUTOTRANSCRIBE = envBool('ASSEMBLYAI_AUTOTRANSCRIBE', false);
export const ASSEMBLYAI_PRESIGN_TTL_SECONDS = (() => {
  const n = Number(process.env.ASSEMBLYAI_PRESIGN_TTL_SECONDS || 21600)
  if (!Number.isFinite(n)) return 21600
  return Math.max(300, Math.min(86400, Math.round(n)))
})()
export const ASSEMBLYAI_POLL_INTERVAL_MS = (() => {
  const n = Number(process.env.ASSEMBLYAI_POLL_INTERVAL_MS || 3000)
  if (!Number.isFinite(n)) return 3000
  return Math.max(500, Math.min(30000, Math.round(n)))
})()
export const ASSEMBLYAI_POLL_TIMEOUT_SECONDS = (() => {
  const n = Number(process.env.ASSEMBLYAI_POLL_TIMEOUT_SECONDS || 1800)
  if (!Number.isFinite(n)) return 1800
  return Math.max(30, Math.min(7200, Math.round(n)))
})()

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

// Upload terms / rights attestation (Plan 52)
export const TERMS_UPLOAD_KEY = process.env.TERMS_UPLOAD_KEY || 'ugc_upload'
export const TERMS_UPLOAD_VERSION = process.env.TERMS_UPLOAD_VERSION || '2026-01-10'
