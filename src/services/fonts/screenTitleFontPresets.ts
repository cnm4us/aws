import path from 'path'

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

