import 'dotenv/config';

export const PORT = Number(process.env.PORT || 3300);
export const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-west-1';

// Upload/input bucket
export const UPLOAD_BUCKET = process.env.UPLOAD_BUCKET || 'bacs-mc-uploads';
export const UPLOAD_PREFIX = (process.env.UPLOAD_PREFIX ?? 'uploads/').replace(/^\/+/, '').replace(/\/+/g, '/');
export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 200);

// Output bucket
export const OUTPUT_BUCKET = process.env.OUTPUT_BUCKET || 'bacs-mc-public-stream';
export const OUTPUT_PREFIX = (process.env.OUTPUT_PREFIX ?? 'hls/').replace(/^\/+/, '').replace(/\/+/g, '/');

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

