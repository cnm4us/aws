import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../db';
import { ACCELERATION_MODE, AWS_REGION, MC_PRIORITY, MC_QUEUE_ARN, MC_ROLE_ARN, OUTPUT_BUCKET, OUTPUT_PREFIX } from '../config';
import { getMediaConvertClient } from '../aws/mediaconvert';
import { CreateJobCommand, GetJobCommand } from '@aws-sdk/client-mediaconvert';
import { applyHqTuning, getFirstHlsDestinationPrefix, loadProfileJson, transformSettings, applyAudioNormalization } from '../jobs';
import { writeRequestLog } from '../utils/requestLog';

export const publishRouter = Router();

const publishSchema = z.object({
  id: z.number().int().positive(),
  profile: z.string().optional(),
  quality: z.string().optional(),
  sound: z.string().optional(),
});

publishRouter.post('/api/publish', async (req, res) => {
  try {
    const { id, profile, quality, sound } = publishSchema.parse(req.body || {});
    if (!MC_ROLE_ARN) return res.status(500).json({ error: 'server_not_configured', detail: 'MC_ROLE_ARN not set' });

    const db = getPool();
    const [rows] = await db.query(`SELECT * FROM uploads WHERE id = ?`, [id]);
    const upload = (rows as any)[0];
    if (!upload) return res.status(404).json({ error: 'not_found' });
    if (upload.status !== 'uploaded') return res.status(400).json({ error: 'invalid_state', detail: 'status must be uploaded' });

    const inputUrl = `s3://${upload.s3_bucket}/${upload.s3_key}`;
    let chosenProfile: string = profile || (
      upload.width && upload.height ? (upload.height > upload.width ? 'portrait-hls' : 'landscape-both-hls') : 'simple-hls'
    );
    if (!profile && typeof quality === 'string') {
      if (quality.toLowerCase().startsWith('hq')) {
        if (!chosenProfile.endsWith('-hq')) chosenProfile = `${chosenProfile}-hq`;
      } else {
        chosenProfile = chosenProfile.replace(/-hq$/, '');
      }
    }
    const isHq = chosenProfile.endsWith('-hq');
    // Load chosen profile if it exists; loader already searches profiles/ then root
    let raw: any;
    try {
      raw = loadProfileJson(chosenProfile);
    } catch {
      // fallback to base name
      const baseProfile = isHq ? chosenProfile.replace(/-hq$/, '') : chosenProfile;
      raw = loadProfileJson(baseProfile);
    }
    const createdDate = (upload.created_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
    const keyParts = String(upload.s3_key || '').split('/');
    let assetUuid: string = String(upload.id);
    if (keyParts.length >= 3) {
      assetUuid = keyParts[keyParts.length - 2];
    }
    const settings = transformSettings(raw, {
      inputUrl,
      outputBucket: OUTPUT_BUCKET,
      assetId: assetUuid,
      dateYMD: createdDate,
    });
    if (isHq) applyHqTuning(settings);
    if (typeof sound === 'string' && sound.toLowerCase().startsWith('norm')) {
      applyAudioNormalization(settings, { targetLkfs: -16, aacBitrate: 160000 });
    }

    // Ensure poster file group exists (FRAME_CAPTURE) for the computed destination
    try {
      const outPrefix = getFirstHlsDestinationPrefix(settings, OUTPUT_BUCKET);
      if (outPrefix) {
        const groups: any[] = Array.isArray((settings as any).OutputGroups) ? (settings as any).OutputGroups : [];
        const hasPoster = groups.some((g) => g?.OutputGroupSettings?.Type === 'FILE_GROUP_SETTINGS');
        if (!hasPoster) {
          groups.push({
            Name: 'Posters',
            OutputGroupSettings: {
              Type: 'FILE_GROUP_SETTINGS',
              FileGroupSettings: { Destination: `s3://${OUTPUT_BUCKET}/${outPrefix}` },
            },
            Outputs: [
              {
                NameModifier: '_poster',
                ContainerSettings: { Container: 'RAW' },
                Extension: 'jpg',
                VideoDescription: {
                  CodecSettings: {
                    Codec: 'FRAME_CAPTURE',
                    FrameCaptureSettings: {
                      CaptureIntervalUnits: 'FRAMES',
                      CaptureInterval: 1,
                      MaxCaptures: 1,
                      Quality: 80,
                    },
                  },
                },
              },
            ],
          });
          (settings as any).OutputGroups = groups;
        }
      }
    } catch {}

    // Final normalization: drop malformed groups and ensure required fields
    try {
      const groups: any[] = Array.isArray((settings as any).OutputGroups) ? (settings as any).OutputGroups : [];
      const cleaned: any[] = [];
      for (const g of groups) {
        const t = g?.OutputGroupSettings?.Type;
        if (t === 'HLS_GROUP_SETTINGS' || t === 'FILE_GROUP_SETTINGS') {
          if (!Array.isArray(g.Outputs)) g.Outputs = [];
          for (const o of g.Outputs) {
            if (!o.ContainerSettings) {
              if (t === 'FILE_GROUP_SETTINGS') o.ContainerSettings = { Container: 'RAW' };
              if (t === 'HLS_GROUP_SETTINGS') o.ContainerSettings = { Container: 'M3U8' } as any;
            }
          }
          cleaned.push(g);
        }
      }
      (settings as any).OutputGroups = cleaned;
    } catch {}

    const mc = await getMediaConvertClient(AWS_REGION);
    const params: any = {
      Role: MC_ROLE_ARN,
      Queue: MC_QUEUE_ARN,
      AccelerationSettings: { Mode: ACCELERATION_MODE },
      Priority: MC_PRIORITY,
      UserMetadata: { upload_id: String(upload.id), profile: chosenProfile },
      Settings: settings,
    };

    writeRequestLog(`upload:${upload.id}:${chosenProfile}`, params);
    const resp = await mc.send(new CreateJobCommand(params));
    const jobId = resp.Job?.Id || null;
    const outPrefix = getFirstHlsDestinationPrefix(settings, OUTPUT_BUCKET) || `${OUTPUT_PREFIX}${upload.id}/`;
    await db.query(
      `UPDATE uploads SET status = 'queued', mediaconvert_job_id = ?, output_prefix = ?, profile = ? WHERE id = ?`,
      [jobId, outPrefix, chosenProfile, id]
    );
    res.json({ ok: true, jobId, output: { bucket: OUTPUT_BUCKET, prefix: outPrefix }, profile: chosenProfile });
  } catch (err: any) {
    console.error('publish error', err);
    res.status(400).json({ error: 'failed_to_publish', detail: String(err?.message || err) });
  }
});
