import debug from '../debug'

type HelpManifest = {
  version: string
  files: string[]
}

const docs: Record<string, string> = {}
let loaded = false
let loadPromise: Promise<void> | null = null

async function fetchManifest(): Promise<HelpManifest | null> {
  try {
    const res = await fetch('/help/manifest.json', { cache: 'no-store' })
    if (!res.ok) return null
    const data = (await res.json()) as HelpManifest
    if (!data || typeof data.version !== 'string' || !Array.isArray(data.files)) return null
    return data
  } catch {
    return null
  }
}

export function getHelpDoc(path: string): string | null {
  const html = docs[path]
  return typeof html === 'string' && html.length ? html : null
}

export function isHelpLoaded(): boolean {
  return loaded
}

export function preloadHelpDocs(): Promise<void> {
  if (loadPromise) return loadPromise
  try {
    debug.log('network', 'help preload start', undefined, { ctx: 'help' })
  } catch {}
  loadPromise = (async () => {
    try {
      const manifest = await fetchManifest()
      if (!manifest) {
        try {
          debug.warn('network', 'help manifest missing', undefined, { ctx: 'help' })
        } catch {}
        return
      }
      const paths = manifest.files || []
      try {
        debug.log('network', 'help manifest loaded', { count: paths.length, version: manifest.version }, { ctx: 'help' })
      } catch {}
      if (!paths.length) return
      await Promise.all(
        paths.map(async (file) => {
          try {
            const url = `/help/${file}`
            const res = await fetch(url)
            if (!res.ok) return
            const html = await res.text()
            docs[file] = html
            try {
              debug.limit('network', `help-doc:${file}`, 5, 'help doc cached', { file, size: html.length }, { ctx: 'help' })
            } catch {}
          } catch {}
        })
      )
      loaded = true
      try {
        debug.log('network', 'help docs preloaded', { count: Object.keys(docs).length, loaded }, { ctx: 'help' })
      } catch {}
    } catch {}
  })()
  return loadPromise
}
