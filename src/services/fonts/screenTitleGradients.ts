import fs from 'fs'
import path from 'path'

export type ScreenTitleGradient = {
  key: string
  label: string
}

type Cache = {
  loadedAtMs: number
  gradients: ScreenTitleGradient[]
  allowedKeys: Set<string>
}

let cache: Cache | null = null

export function listScreenTitleGradients(): ScreenTitleGradient[] {
  return getCache().gradients
}

export function isGradientKeyAllowed(key: string): boolean {
  return getCache().allowedKeys.has(key)
}

export function resolveGradientPath(key: string): string | null {
  if (!isGradientKeyAllowed(key)) return null
  const cwd = process.cwd()
  const dir = path.resolve(cwd, 'assets', 'font_gradients')
  return path.resolve(dir, key)
}

function getCache(): Cache {
  if (cache) return cache
  cache = loadGradients()
  return cache
}

function loadGradients(): Cache {
  const cwd = process.cwd()
  const dir = path.resolve(cwd, 'assets', 'font_gradients')
  const gradients: ScreenTitleGradient[] = []
  const allowedKeys = new Set<string>()
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const ent of entries) {
      if (!ent.isFile()) continue
      const name = ent.name
      if (!name.toLowerCase().endsWith('.png')) continue
      // Prevent path traversal; allow simple filenames only.
      if (name.includes('/') || name.includes('\\') || name.includes('..')) continue
      gradients.push({ key: name, label: name.replace(/\\.png$/i, '') })
      allowedKeys.add(name)
    }
  } catch {
    // No gradients directory: treat as empty list.
  }
  gradients.sort((a, b) => a.label.localeCompare(b.label))
  return { loadedAtMs: Date.now(), gradients, allowedKeys }
}

