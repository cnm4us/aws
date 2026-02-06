import { spawnSync } from 'child_process'
import path from 'path'

export type ScreenTitleFontVariant = {
  key: string
  label: string
  family: string
  style: string
}

export type ScreenTitleFontFamily = {
  familyKey: string
  label: string
  variants: Array<{ key: string; label: string }>
}

type Cache = {
  loadedAtMs: number
  families: ScreenTitleFontFamily[]
  allowedKeys: Set<string>
}

function normalizeFontStyleLabel(raw: string): string {
  const parts = String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return String(raw || '').trim()
  const dedup: string[] = []
  for (const p of parts) {
    if (!dedup.some((d) => d.toLowerCase() === p.toLowerCase())) dedup.push(p)
  }
  let filtered = dedup.slice()
  if (filtered.length > 1) {
    // Drop "Regular" and any style token that is already contained in a longer token.
    filtered = filtered.filter((p) => p.toLowerCase() !== 'regular')
    filtered = filtered.filter((p) => {
      const pLower = p.toLowerCase()
      return !filtered.some((q) => q !== p && q.toLowerCase().includes(pLower))
    })
  }
  return filtered.join(' ')
}

let cache: Cache | null = null

const BUILT_IN_FAMILIES: ScreenTitleFontFamily[] = [
  {
    familyKey: 'dejavu_sans',
    label: 'DejaVu Sans',
    variants: [
      { key: 'dejavu_sans_regular', label: 'Regular' },
      { key: 'dejavu_sans_bold', label: 'Bold' },
      { key: 'dejavu_sans_italic', label: 'Italic' },
      { key: 'dejavu_sans_bold_italic', label: 'Bold Italic' },
    ],
  },
  {
    familyKey: 'caveat',
    label: 'Caveat',
    variants: [
      { key: 'caveat_regular', label: 'Regular' },
      { key: 'caveat_medium', label: 'Medium' },
      { key: 'caveat_semibold', label: 'SemiBold' },
      { key: 'caveat_bold', label: 'Bold' },
    ],
  },
]

export function isFontKeyAllowed(fontKey: string): boolean {
  const c = getScreenTitleFontsCached()
  if (c.allowedKeys.has(fontKey)) return true
  return false
}

export function listScreenTitleFontFamilies(): ScreenTitleFontFamily[] {
  return getScreenTitleFontsCached().families
}

export function resolveFamilyKeyForFontKey(fontKey: string): string | null {
  const k = String(fontKey || '').trim()
  if (!k) return null
  const c = getScreenTitleFontsCached()
  for (const fam of c.families) {
    if (fam.variants.some((v) => String(v.key) === k)) return String(fam.familyKey)
  }
  return null
}

function getScreenTitleFontsCached(): Cache {
  // Fonts only change when the repo changes; cache for the process lifetime.
  if (cache) return cache
  cache = loadFromFontconfig()
  return cache
}

function loadFromFontconfig(): Cache {
  const cwd = process.cwd()
  const fontDir = path.resolve(cwd, 'assets', 'fonts')
  const fontConfigFile = path.resolve(cwd, 'assets', 'fonts', 'fonts.conf')

  const builtInFamilyNames = new Set(BUILT_IN_FAMILIES.map((f) => f.label))

  // We ask fc-list for file, family, style. Then we filter to only files under assets/fonts.
  const args = ['-f', '%{file}\t%{family[0]}\t%{style}\n']
  const out = spawnSync('fc-list', args, {
    env: {
      ...process.env,
      FONTCONFIG_FILE: fontConfigFile,
    },
    encoding: 'utf8',
  })

  const lines = String(out.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean)

  const variants: ScreenTitleFontVariant[] = []
  for (const line of lines) {
    const parts = line.split('\t')
    if (parts.length < 3) continue
    const file = String(parts[0] || '').trim()
    const family = String(parts[1] || '').trim()
    const style = String(parts.slice(2).join('\t') || '').trim()
    const label = normalizeFontStyleLabel(style)
    if (!file || !family || !style) continue
    const resolved = path.resolve(file)
    if (!resolved.startsWith(fontDir + path.sep)) continue
    if (builtInFamilyNames.has(family)) continue
    const key = `fc:${encodeURIComponent(family)}:${encodeURIComponent(style)}`
    variants.push({
      key,
      label,
      family,
      style,
    })
  }

  // Group by family, sort families and variants for stable UI.
  const byFamily = new Map<string, ScreenTitleFontVariant[]>()
  for (const v of variants) {
    const arr = byFamily.get(v.family) || []
    arr.push(v)
    byFamily.set(v.family, arr)
  }

  const families: ScreenTitleFontFamily[] = Array.from(byFamily.entries())
    .map(([family, vars]) => {
      const sorted = vars.slice().sort((a, b) => a.label.localeCompare(b.label))
      return {
        familyKey: String(family).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'font',
        label: family,
        variants: sorted.map((v) => ({ key: v.key, label: v.label })),
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))

  const allowedKeys = new Set<string>()
  for (const fam of BUILT_IN_FAMILIES) {
    for (const v of fam.variants) allowedKeys.add(v.key)
  }
  for (const fam of families) {
    for (const v of fam.variants) allowedKeys.add(v.key)
  }

  return {
    loadedAtMs: Date.now(),
    families: [...BUILT_IN_FAMILIES, ...families],
    allowedKeys,
  }
}
