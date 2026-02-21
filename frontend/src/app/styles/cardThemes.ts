import type React from 'react'

export type CardThemeVars = Record<`--${string}`, string | number | undefined>

export const cardThemeTokens = {
  base: {
    '--card-list-gap': '12px',
    '--card-border': '1px solid rgba(255,255,255,0.14)',
    '--card-radius': '16px',
    '--card-padding': '14px',
    '--card-bg-solid': 'rgba(255,255,255,0.03)',
    '--card-bg-image': 'none',
    '--card-overlay-start': 'rgba(5,8,12,0.18)',
    '--card-overlay-end': 'rgba(5,8,12,0.28)',
    '--card-title-color': '#fff',
    '--card-meta-color': '#bbb',
    '--card-action-gap': '10px',
    '--card-btn-open-border': '1px solid rgba(10,132,255,0.55)',
    '--card-btn-open-bg': 'rgba(10,132,255,0.16)',
    '--card-btn-edit-border': '1px solid rgba(255,255,255,0.18)',
    '--card-btn-edit-bg': '#0c0c0c',
    '--card-btn-delete-border': '1px solid rgba(255,155,155,0.40)',
    '--card-btn-delete-bg': 'rgba(128,0,0,1)',
  } as CardThemeVars,
  timelines: {
    '--card-list-gap': '12px',
    '--card-overlay-start': 'rgba(5,8,12,0.39)',
    '--card-overlay-end': 'rgba(5,8,12,0.44)',
    '--card-meta-color': '#9a9a9a',
    '--card-btn-open-bg': 'rgba(10,132,255,0.16)',
  } as CardThemeVars,
  assetsGraphic: {
    '--card-list-gap': '14px',
    '--card-bg-solid': 'rgba(28,28,28,0.96)',
    '--card-overlay-start': 'rgba(8,10,14,0.18)',
    '--card-overlay-end': 'rgba(8,10,14,0.26)',
    '--card-meta-color': '#bbb',
    '--card-btn-open-bg': '#0a84ff',
  } as CardThemeVars,
  assetsGlass: {
    '--card-list-gap': '14px',
    '--card-border': '1px solid transparent',
    '--card-bg-solid': 'rgba(6,8,12,0.5)',
    '--card-overlay-start': 'rgba(8,12,18,0.30)',
    '--card-overlay-end': 'rgba(8,12,18,0.48)',
    '--card-meta-color': '#c2c7cf',
    '--card-blur': 'blur(10px)',
    '--card-shadow': '0 18px 32px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.18)',
    '--card-border-gradient': 'linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.18) 45%, rgba(255,255,255,0.08) 100%)',
    '--card-border-gradient-opacity': '1',
    '--card-btn-open-bg': 'rgba(10,132,255,0.24)',
  } as CardThemeVars,
  byType: {
    timeline: {
      '--card-overlay-start': 'rgba(5,8,12,0.39)',
      '--card-overlay-end': 'rgba(5,8,12,0.44)',
    } as CardThemeVars,
    graphic: {
      '--card-overlay-start': 'rgba(8,10,14,0.16)',
      '--card-overlay-end': 'rgba(8,10,14,0.24)',
    } as CardThemeVars,
  },
} as const

export function mergeCardThemeVars(...parts: Array<CardThemeVars | null | undefined>): CardThemeVars {
  const out: CardThemeVars = {}
  for (const part of parts) {
    if (!part) continue
    for (const [k, v] of Object.entries(part)) {
      if (v == null) continue
      out[k as `--${string}`] = v
    }
  }
  return out
}

export function cardThemeStyle(vars: CardThemeVars): React.CSSProperties {
  const style: React.CSSProperties = {}
  for (const [k, v] of Object.entries(vars)) {
    if (v == null) continue
    ;(style as any)[k] = String(v)
  }
  return style
}
