import path from 'path'
import { resolveFamilyKeyForFontKey } from './screenTitleFonts'

export type ScreenTitleFontSizeKey = 'x_small' | 'small' | 'medium' | 'large' | 'x_large'

export type ScreenTitleFontSizePreset = {
  fontSizePct: number
  trackingPct: number
  lineSpacingPct: number
}

export type ScreenTitleFontPresetsV1 = {
  schemaVersion: 1
  baselineFrame: { width: number; height: number }
  families: Record<
    string,
    {
      label: string
      sizes: Record<ScreenTitleFontSizeKey, ScreenTitleFontSizePreset>
      variants?: Record<
        string,
        {
          label: string
          sizes?: Partial<Record<ScreenTitleFontSizeKey, ScreenTitleFontSizePreset>>
        }
      >
    }
  >
}

let cached: ScreenTitleFontPresetsV1 | null = null

export function getScreenTitleFontPresets(): ScreenTitleFontPresetsV1 {
  if (cached) return cached
  const cfgPath = path.join(process.cwd(), 'assets', 'fonts', 'fontPresets.js')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const raw = require(cfgPath)
  cached = raw as ScreenTitleFontPresetsV1
  return cached
}

export function resolveScreenTitleFontSizePreset(
  fontKey: string,
  sizeKey: ScreenTitleFontSizeKey
): ScreenTitleFontSizePreset | null {
  const k = String(fontKey || '').trim()
  if (!k) return null
  const familyKey = resolveFamilyKeyForFontKey(k)
  if (!familyKey) return null
  const presets = getScreenTitleFontPresets()
  const fam: any = (presets as any)?.families?.[String(familyKey)]
  if (!fam?.sizes) return null
  const base = fam.sizes[sizeKey]
  if (!base) return null
  const v = fam.variants && fam.variants[String(k)] ? fam.variants[String(k)] : null
  const ov = v?.sizes && v.sizes[sizeKey] ? v.sizes[sizeKey] : null
  const resolved = { ...base, ...(ov || {}) }
  return {
    fontSizePct: Number(resolved.fontSizePct),
    trackingPct: Number(resolved.trackingPct),
    lineSpacingPct: Number(resolved.lineSpacingPct),
  }
}
