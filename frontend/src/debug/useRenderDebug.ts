import { useEffect, useRef } from 'react'
import debug from './index'

type KeySnapshot = Record<string, any>

function diffKeys(prev: KeySnapshot | null, next: KeySnapshot | null): string[] | undefined {
  const p = prev || {}
  const n = next || {}
  const keys = new Set<string>([...Object.keys(p), ...Object.keys(n)])
  const changed: string[] = []
  for (const k of keys) {
    if (p[k] !== n[k]) changed.push(k)
  }
  return changed.length ? changed : undefined
}

/**
 * useRenderDebug
 *
 * Lightweight per-component render tracing, gated by DEBUG_RENDER/`render` namespace.
 *
 * Example:
 *   useRenderDebug('Feed', { index, itemsLen: items.length, mode: feedMode.kind })
 */
export function useRenderDebug(label: string, keys?: KeySnapshot) {
  const countRef = useRef(0)
  const firstRef = useRef(true)
  const prevKeysRef = useRef<KeySnapshot | null>(null)

  // Log mount/update on every committed render
  useEffect(() => {
    if (!debug.enabled('render')) return
    const phase = firstRef.current ? 'mount' : 'update'
    countRef.current += 1
    const prev = prevKeysRef.current
    const next = keys || {}
    const changed = phase === 'update' ? diffKeys(prev, next) : undefined
    debug.log(
      'render',
      `${label} ${phase}`,
      {
        label,
        phase,
        count: countRef.current,
        keys: next,
        changed,
      },
      { ctx: 'component' }
    )
    prevKeysRef.current = next
    firstRef.current = false
  })

  // Log unmount
  useEffect(() => {
    return () => {
      if (!debug.enabled('render')) return
      debug.log('render', `${label} unmount`, { label }, { ctx: 'component' })
    }
  }, [label])
}

export default useRenderDebug

