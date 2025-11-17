import fs from 'fs';
import path from 'path';

export type TransformCtx = {
  inputUrl: string;
  outputBucket: string;
  assetId: string;
  dateYMD: string;
  productionUlid?: string;
};

export function loadProfileJson(name: string): any {
  const jobsRoot = path.resolve(process.cwd(), 'jobs');
  // Look under profiles first, then root for backward compatibility
  const candidates = [
    path.join(jobsRoot, 'profiles', `${name}.json`),
    path.join(jobsRoot, `${name}.json`),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) throw new Error(`Profile not found: ${name}`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as any;
  const resolved = resolveExtends(raw, jobsRoot);
  return flattenSettings(resolved);
}

function isPlainObject(v: any): v is Record<string, any> {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function replaceString(val: string, ctx: TransformCtx): string {
  // INPUT_URI sentinel
  if (val === 'INPUT_URI') return ctx.inputUrl;

  let out = val;

  // Replace OUTPUT bucket placeholders or hard-coded bucket prefix
  const outPrefixA = 's3://OUTPUT_BUCKET';
  const outPrefixB = 's3://bacs-mc-public-stream';
  if (out.startsWith(outPrefixA)) out = `s3://${ctx.outputBucket}` + out.slice(outPrefixA.length);
  if (out.startsWith(outPrefixB)) out = `s3://${ctx.outputBucket}` + out.slice(outPrefixB.length);

  // Replace token placeholders
  if (out.includes('ASSET_ID')) out = out.split('ASSET_ID').join(ctx.assetId);
  if (out.includes('DATE_YYYY_MM_DD')) {
    const m = ctx.dateYMD.match(/^(\d{4}-\d{2})-(\d{2})$/);
    const ymdFolder = m ? `${m[1]}/${m[2]}` : ctx.dateYMD; // convert to YYYY-MM/DD
    out = out.split('DATE_YYYY_MM_DD').join(ymdFolder);
  }
  if (ctx.productionUlid && out.includes('PRODUCTION_ULID')) {
    out = out.split('PRODUCTION_ULID').join(ctx.productionUlid);
  }

  return out;
}

export function transformSettings(settings: any, ctx: TransformCtx): any {
  if (typeof settings === 'string') return replaceString(settings, ctx);
  if (Array.isArray(settings)) return settings.map((v) => transformSettings(v, ctx));
  if (isPlainObject(settings)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(settings)) {
      out[k] = transformSettings(v, ctx);
    }
    // Normalize HLS manifests: remove AdditionalManifests to keep a single master named base.m3u8
    if (out?.OutputGroupSettings?.HlsGroupSettings?.AdditionalManifests) {
      delete out.OutputGroupSettings.HlsGroupSettings.AdditionalManifests;
    }
    return out;
  }
  return settings;
}

export function getFirstHlsDestinationPrefix(settings: any, outputBucket: string): string | null {
  try {
    const groups = settings?.OutputGroups || [];
    for (const g of groups) {
      const dest = g?.OutputGroupSettings?.HlsGroupSettings?.Destination as string | undefined;
      if (dest && dest.startsWith(`s3://${outputBucket}/`)) {
        return dest.slice((`s3://${outputBucket}/`).length);
      }
    }
  } catch {}
  return null;
}

export function getFirstCmafDestinationPrefix(settings: any, outputBucket: string): string | null {
  try {
    const groups = settings?.OutputGroups || [];
    for (const g of groups) {
      const dest = g?.OutputGroupSettings?.CmafGroupSettings?.Destination as string | undefined;
      if (dest && dest.startsWith(`s3://${outputBucket}/`)) {
        return dest.slice((`s3://${outputBucket}/`).length);
      }
    }
  } catch {}
  return null;
}

function set(obj: any, path: string[], value: any) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    if (!cur[path[i]] || typeof cur[path[i]] !== 'object') cur[path[i]] = {};
    cur = cur[path[i]];
  }
  cur[path[path.length - 1]] = value;
}

function hqMaxBitrateForName(name: string | undefined): number | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase();
  if (n.includes('1080')) return 6500000;
  if (n.includes('720')) return 3500000;
  if (n.includes('540')) return 1800000;
  if (n.includes('480')) return 1500000;
  if (n.includes('360')) return 1000000;
  return undefined;
}

export function applyHqTuning(settings: any) {
  try {
    // Inputs: add light denoise if not present
    const inputs = settings?.Inputs;
    if (Array.isArray(inputs) && inputs[0] && !inputs[0].NoiseReducer) {
      inputs[0].NoiseReducer = {
        Filter: 'TEMPORAL',
        TemporalFilterSettings: { Strength: 2, Speed: 8 },
      };
    }

    const groups = settings?.OutputGroups;
    if (!Array.isArray(groups)) return;
    for (const g of groups) {
      // Only tune HLS groups
      const ogType = g?.OutputGroupSettings?.Type;
      if (ogType && ogType !== 'HLS_GROUP_SETTINGS') continue;
      const outs = g?.Outputs;
      if (!Array.isArray(outs)) continue;
      for (const o of outs) {
        // Skip non-HLS/non-MP4 file groups (e.g., FRAME_CAPTURE for posters)
        const container = o?.ContainerSettings?.Container;
        if (container && container !== 'M3U8' && container !== 'MP4' && container !== 'CMFC') continue;
        const vd = o?.VideoDescription;
        const cs = vd?.CodecSettings;
        const h264 = cs?.H264Settings;
        // Skip frame capture outputs explicitly
        if (cs && cs.Codec === 'FRAME_CAPTURE') continue;
        if (!vd || !cs) continue;
        if (!h264) {
          // force H.264 settings block if missing
          set(vd, ['CodecSettings', 'Codec'], 'H_264');
          set(vd, ['CodecSettings', 'H264Settings'], {});
        }
        const nameMod: string | undefined = o?.NameModifier;
        const target = vd.CodecSettings.H264Settings;
        // Remove fixed bitrate if exists and switch to QVBR
        if ('Bitrate' in target) delete target.Bitrate;
        Object.assign(target, {
          RateControlMode: 'QVBR',
          QvbrSettings: { QvbrQualityLevel: 9 },
          QualityTuningLevel: 'SINGLE_PASS_HQ',
          AdaptiveQuantization: 'HIGH',
          SpatialAdaptiveQuantization: 'ENABLED',
          TemporalAdaptiveQuantization: 'ENABLED',
          FlickerAdaptiveQuantization: 'ENABLED',
          GopSizeUnits: 'SECONDS',
          GopSize: 2,
          GopClosedCadence: 1,
          NumberBFramesBetweenReferenceFrames: 2,
          CodecProfile: 'HIGH',
          CodecLevel: 'AUTO',
          FramerateControl: 'INITIALIZE_FROM_SOURCE',
        });
        const mb = hqMaxBitrateForName(nameMod);
        if (mb) target.MaxBitrate = mb;
        else if (!target.MaxBitrate) target.MaxBitrate = 5000000;
      }
    }
  } catch {
    // best effort tuning
  }
}

// Ensure a valid QVBR configuration across outputs (HLS or CMAF):
// - Remove fixed Bitrate (incompatible with QVBR)
// - Set RateControlMode = QVBR and provide a default QvbrQualityLevel
// - Ensure MaxBitrate exists (MediaConvert requires it for QVBR)
export function enforceQvbr(settings: any) {
  try {
    const groups = settings?.OutputGroups;
    if (!Array.isArray(groups)) return;
    for (const g of groups) {
      const ogType = g?.OutputGroupSettings?.Type;
      if (ogType !== 'HLS_GROUP_SETTINGS' && ogType !== 'CMAF_GROUP_SETTINGS') continue;
      const outs = g?.Outputs;
      if (!Array.isArray(outs)) continue;
      for (const o of outs) {
        const vd = o?.VideoDescription;
        const cs = vd?.CodecSettings;
        if (!vd || !cs) continue;
        if (cs.Codec !== 'H_264') continue;
        const h264 = cs.H264Settings || (cs.H264Settings = {});
        if ('Bitrate' in h264) delete h264.Bitrate;
        h264.RateControlMode = 'QVBR';
        h264.QvbrSettings = h264.QvbrSettings || { QvbrQualityLevel: 7 };
        if (!h264.MaxBitrate) {
          const nameMod: string | undefined = o?.NameModifier;
          const mb = hqMaxBitrateForName(nameMod) || 5000000;
          h264.MaxBitrate = mb;
        }
      }
    }
  } catch {
    // best effort
  }
}

// --- Composable profile loader helpers ---

type JsonValue = any;

function deepClone<T>(obj: T): T {
  return obj == null ? obj : JSON.parse(JSON.stringify(obj));
}

function mergeArrays(target: any[], source: any[], parentKey?: string): any[] {
  // Match common arrays by stable keys
  const keyByParent: Record<string, string> = {
    OutputGroups: 'Name',
    Outputs: 'NameModifier',
    AudioDescriptions: 'AudioSourceName',
  };
  const k = parentKey && keyByParent[parentKey];
  if (!k) {
    // Default: replace array entirely
    return deepClone(source);
  }

  const out = deepClone(target);
  const indexByKey = new Map<string, number>();
  out.forEach((item: any, idx: number) => {
    if (item && typeof item === 'object' && k in item) indexByKey.set(String(item[k]), idx);
  });

  for (const s of source) {
    if (s && typeof s === 'object' && k in s) {
      const key = String(s[k]);
      const idx = indexByKey.get(key);
      if (idx != null) {
        out[idx] = deepMerge(out[idx], s, parentKey);
      } else {
        out.push(deepClone(s));
      }
    } else {
      out.push(deepClone(s));
    }
  }
  return out;
}

function deepMerge(target: JsonValue, source: JsonValue, parentKey?: string): JsonValue {
  if (Array.isArray(target) && Array.isArray(source)) return mergeArrays(target, source, parentKey);
  if (isPlainObject(target) && isPlainObject(source)) {
    const out: Record<string, any> = { ...deepClone(target) };
    for (const [k, v] of Object.entries(source)) {
      if (k in out) out[k] = deepMerge(out[k], v as any, k);
      else out[k] = deepClone(v);
    }
    return out;
  }
  return deepClone(source);
}

function loadComponent(jobsRoot: string, ref: string): any {
  // ref like "templates/base-hls" or "mixins/output/portrait-..."
  const p = path.join(jobsRoot, `${ref}.json`);
  if (!fs.existsSync(p)) throw new Error(`Component not found: ${ref}`);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as any;
}

function resolveExtends(json: any, jobsRoot: string): any {
  if (!json || typeof json !== 'object') return json;
  const extendsList = json.$extends as undefined | string | string[];
  if (!extendsList) return json;
  const parts = Array.isArray(extendsList) ? extendsList : [extendsList];
  let merged: any = {};
  for (const ref of parts) {
    const comp = resolveExtends(loadComponent(jobsRoot, ref), jobsRoot);
    merged = deepMerge(merged, comp);
  }
  const { $extends, ...rest } = json;
  merged = deepMerge(merged, rest);
  return merged;
}

// Some mixins place content under Settings. Flatten Settings into root so the result
// is a valid MediaConvert Settings object (TimecodeConfig, Inputs, OutputGroups at top-level).
export function flattenSettings(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.Settings && typeof obj.Settings === 'object') {
    const merged = deepMerge(obj, obj.Settings);
    delete merged.Settings;
    return merged;
  }
  return obj;
}

export function applyAudioNormalization(settings: any, opts?: { targetLkfs?: number; aacBitrate?: number }) {
  const target = opts?.targetLkfs ?? -16.0;
  const minBitrate = opts?.aacBitrate ?? 160000;
  try {
    const groups = settings?.OutputGroups;
    if (!Array.isArray(groups)) return;
    for (const g of groups) {
      const outs = g?.Outputs;
      if (!Array.isArray(outs)) continue;
      for (const o of outs) {
        const ads = o?.AudioDescriptions;
        if (!Array.isArray(ads) || ads.length === 0) continue;
        const a0 = ads[0];
        if (!a0.CodecSettings) a0.CodecSettings = {};
        if (a0.CodecSettings.Codec !== 'AAC') {
          a0.CodecSettings.Codec = 'AAC';
          a0.CodecSettings.AacSettings = a0.CodecSettings.AacSettings || {};
        }
        const aac = (a0.CodecSettings.AacSettings = a0.CodecSettings.AacSettings || {});
        if (!aac.Bitrate || aac.Bitrate < minBitrate) aac.Bitrate = minBitrate;
        if (!aac.CodingMode) aac.CodingMode = 'CODING_MODE_2_0';
        if (!aac.SampleRate) aac.SampleRate = 48000;
        if (!aac.CodecProfile) aac.CodecProfile = 'LC';

        a0.AudioNormalizationSettings = {
          Algorithm: 'ITU_BS_1770_4',
          AlgorithmControl: 'CORRECT_AUDIO',
          LoudnessLogging: 'LOG',
          PeakCalculation: 'TRUE_PEAK',
          TargetLkfs: target,
        } as any;
      }
    }
  } catch {
    // noop
  }
}
