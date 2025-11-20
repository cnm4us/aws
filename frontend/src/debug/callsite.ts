export type Callsite = {
  file?: string
  functionName?: string
  line?: number
  column?: number
}

const DEBUG_DIR_HINT = '/src/debug/'

export function getCallsite(skipFrames = 0): Callsite | undefined {
  try {
    const err = new Error()
    if (!err.stack) return undefined
    const lines = String(err.stack).split(/\n+/)
    const frames = lines.slice(1) // drop error message line
    // Skip frames belonging to this debug module and any additional caller‑requested frames
    let chosen: string | undefined
    let skip = skipFrames
    for (const l of frames) {
      const line = l.trim()
      const inDebug = line.includes(DEBUG_DIR_HINT) || /\(.*src\/debug\//.test(line)
      if (inDebug) continue
      if (skip > 0) { skip--; continue }
      chosen = line
      break
    }
    if (!chosen) return undefined
    // Chrome/V8 format: at func (file:line:col)
    const m = chosen.match(/at\s+(?:(.*?)\s+\()?(.*?):(\d+):(\d+)\)?$/)
    if (m) {
      const fn = m[1] && m[1] !== 'Object.<anonymous>' ? m[1] : undefined
      const file = m[2]
      const line = Number(m[3])
      const column = Number(m[4])
      return { file, functionName: fn, line, column }
    }
    // Firefox format: func@file:line:col
    const ff = chosen.match(/^(.*?)@(.+):(\d+):(\d+)/)
    if (ff) {
      const fn = ff[1] || undefined
      const file = ff[2]
      const line = Number(ff[3])
      const column = Number(ff[4])
      return { file, functionName: fn, line, column }
    }
  } catch {}
  return undefined
}

