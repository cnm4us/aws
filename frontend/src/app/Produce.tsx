import React, { useEffect, useMemo, useState } from 'react'
import CompactAudioPlayer from '../components/CompactAudioPlayer'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
  isSiteAdmin?: boolean
}

async function ensureLoggedIn(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' })
    if (!res.ok) throw new Error('not_authenticated')
    const data = (await res.json()) as MeResponse
    if (!data || !data.userId) return null
    return data
  } catch {
    return null
  }
}

type UploadDetail = {
  id: number
  original_filename: string
  modified_filename?: string | null
  description?: string | null
  status: string
  size_bytes?: number | null
  width?: number | null
  height?: number | null
  created_at?: string | null
  source_deleted_at?: string | null
  poster_portrait_cdn?: string | null
  poster_landscape_cdn?: string | null
  poster_cdn?: string | null
  poster_portrait_s3?: string | null
  poster_landscape_s3?: string | null
  poster_s3?: string | null
}

type AssetItem = {
  id: number
  original_filename: string
  modified_filename: string | null
  description?: string | null
  content_type?: string | null
  size_bytes?: number | null
  width?: number | null
  height?: number | null
  created_at?: string | null
}

type InsetPreset = 'small' | 'medium' | 'large'

type LogoConfig = {
  id: number
  name: string
  description?: string | null
  position: string
  sizePctWidth: number
  opacityPct: number
  timingRule: string
  timingSeconds: number | null
  fade: string
  insetXPreset?: InsetPreset | null
  insetYPreset?: InsetPreset | null
}

type AudioConfig = {
  id: number
  name: string
  description?: string | null
  mode: 'replace' | 'mix'
  videoGainDb: number
  musicGainDb: number
  duckingEnabled: boolean
  duckingAmountDb: number
  audioDurationSeconds?: number | null
  audioFadeEnabled?: boolean
  createdAt?: string
  updatedAt?: string
  archivedAt?: string | null
}

type LowerThirdConfig = {
  id: number
  name: string
  description?: string | null
  position: 'bottom_center'
  sizeMode?: 'pct' | 'match_image'
  baselineWidth?: 1080 | 1920
  sizePctWidth: number
  opacityPct: number
  timingRule: 'first_only' | 'entire'
  timingSeconds: number | null
  fade: string
  insetYPreset?: 'small' | 'medium' | 'large' | null
  createdAt?: string
  updatedAt?: string
  archivedAt?: string | null
}

type ScreenTitlePreset = {
  id: number
  name: string
  description?: string | null
  style: 'pill' | 'outline' | 'strip'
  fontKey: string
  fontSizePct?: number
  fontColor?: string
  position: 'top_left' | 'top_center' | 'top_right'
  maxWidthPct: number
  insetXPreset?: InsetPreset | null
  insetYPreset?: InsetPreset | null
  timingRule: 'entire' | 'first_only'
  timingSeconds: number | null
  fade: 'none' | 'in' | 'out' | 'in_out'
  createdAt?: string
  updatedAt?: string
  archivedAt?: string | null
}

function parseUploadId(): number | null {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('upload')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function parsePick(): 'audio' | 'audioConfig' | 'logo' | 'logoConfig' | 'titlePage' | 'lowerThirdImage' | 'lowerThirdConfig' | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('pick') || '').toLowerCase()
    if (raw === 'audio') return 'audio'
    if (raw === 'audioconfig') return 'audioConfig'
    if (raw === 'logo') return 'logo'
    if (raw === 'logoconfig') return 'logoConfig'
    if (raw === 'titlepage') return 'titlePage'
    if (raw === 'lowerthirdimage' || raw === 'lowerthird') return 'lowerThirdImage'
    if (raw === 'lowerthirdconfig') return 'lowerThirdConfig'
  } catch {}
  return null
}

function parseMusicUploadId(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('musicUploadId')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function parseLogoUploadId(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('logoUploadId')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function parseTitleUploadId(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('titleUploadId')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function parseTitleHoldSeconds(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('titleHoldSeconds')
    if (raw == null || raw === '') return null
    const n = Number(raw)
    const rounded = Math.round(n)
    if (!Number.isFinite(rounded) || rounded < 0) return null
    if (![0, 2, 3, 4, 5].includes(rounded)) return null
    return rounded
  } catch {
    return null
  }
}

function parseLogoConfigId(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('logoConfigId')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function parseAudioConfigId(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('audioConfigId')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function parseLowerThirdConfigId(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('lowerThirdConfigId')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function parseLowerThirdUploadId(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('lowerThirdUploadId')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function parseScreenTitlePresetId(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('screenTitlePresetId')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function parseIntroSeconds(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('introSeconds')
    if (!raw) return null
    const n = Number(raw)
    const rounded = Math.round(n)
    if (!Number.isFinite(rounded) || rounded <= 0) return null
    if (![2, 3, 4, 5].includes(rounded)) return null
    return rounded
  } catch {
    return null
  }
}

function pushQueryParams(updates: Record<string, string | null>, state: any = {}) {
  const params = new URLSearchParams(window.location.search)
  for (const [k, v] of Object.entries(updates)) {
    if (v == null || v === '') params.delete(k)
    else params.set(k, v)
  }
  const qs = params.toString()
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  window.history.pushState(state, '', next)
}

function replaceQueryParams(updates: Record<string, string | null>, state: any = window.history.state || {}) {
  const params = new URLSearchParams(window.location.search)
  for (const [k, v] of Object.entries(updates)) {
    if (v == null || v === '') params.delete(k)
    else params.set(k, v)
  }
  const qs = params.toString()
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  window.history.replaceState(state, '', next)
}

function pickPoster(upload: UploadDetail): string | null {
  return (
    upload.poster_portrait_cdn ||
    upload.poster_landscape_cdn ||
    upload.poster_cdn ||
    upload.poster_portrait_s3 ||
    upload.poster_landscape_s3 ||
    upload.poster_s3 ||
    null
  )
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function formatDate(input: string | null | undefined): string {
  if (!input) return ''
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return String(input)
  return d.toISOString().slice(0, 10)
}

function formatLogoPosition(pos: string | null | undefined): string {
  if (!pos) return ''
  const p = String(pos)
  const labels: Record<string, string> = {
    top_left: 'Top-left',
    top_center: 'Top-center',
    top_right: 'Top-right',
    middle_left: 'Middle-left',
    middle_center: 'Middle-center',
    middle_right: 'Middle-right',
    bottom_left: 'Bottom-left',
    bottom_center: 'Bottom-center',
    bottom_right: 'Bottom-right',
    center: 'Middle-center',
  }
  if (labels[p]) return labels[p]
  const words = p.split('_').filter(Boolean)
  if (!words.length) return p
  const titled = words.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
  return titled.join(' ')
}

function normalizeLegacyPosition(pos: string): string {
  return pos === 'center' ? 'middle_center' : pos
}

function insetPctForPreset(preset: InsetPreset | string | null | undefined): number {
  const p = String(preset || '').toLowerCase()
  if (p === 'small') return 0.06
  if (p === 'large') return 0.14
  return 0.10
}

function clampNumber(n: any, min: number, max: number): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return min
  return Math.min(Math.max(v, min), max)
}

function computeOverlayCss(cfg: {
  position?: string | null
  sizePctWidth?: number | null
  opacityPct?: number | null
  insetXPreset?: InsetPreset | string | null
  insetYPreset?: InsetPreset | string | null
}): React.CSSProperties {
  const sizePctWidth = clampNumber(cfg.sizePctWidth ?? 15, 1, 100)
  const opacityPct = clampNumber(cfg.opacityPct ?? 100, 0, 100)

  const posRaw = String(cfg.position || 'bottom_right')
  const pos = normalizeLegacyPosition(posRaw)
  const [rowRaw, colRaw] = String(pos).split('_') as [string, string]
  const row = rowRaw || 'bottom'
  const col = colRaw || 'right'
  const yMode = row === 'top' ? 'top' : row === 'bottom' ? 'bottom' : 'middle'
  const xMode = col === 'left' ? 'left' : col === 'right' ? 'right' : 'center'

  const insetXPct = insetPctForPreset(cfg.insetXPreset) * 100
  const insetYPct = insetPctForPreset(cfg.insetYPreset) * 100
  const marginXPct = xMode === 'center' ? 0 : insetXPct
  const marginYPct = yMode === 'middle' ? 0 : insetYPct

  const style: React.CSSProperties = {
    position: 'absolute',
    width: `${sizePctWidth}%`,
    height: 'auto',
    opacity: opacityPct / 100,
    pointerEvents: 'none',
  }

  let transform = ''
  if (xMode === 'left') style.left = `${marginXPct}%`
  else if (xMode === 'right') style.right = `${marginXPct}%`
  else {
    style.left = '50%'
    transform += ' translateX(-50%)'
  }

  if (yMode === 'top') style.top = `${marginYPct}%`
  else if (yMode === 'bottom') style.bottom = `${marginYPct}%`
  else {
    style.top = '50%'
    transform += ' translateY(-50%)'
  }

  if (transform.trim()) style.transform = transform.trim()
  return style
}

function computeLowerThirdPreviewSizePct(cfg: LowerThirdConfig | null, image: AssetItem | null): number {
  const sizeMode = String(cfg?.sizeMode || 'pct').toLowerCase()
  if (sizeMode === 'match_image') {
    const base = cfg?.baselineWidth === 1920 ? 1920 : 1080
    const w = image?.width != null ? Number(image.width) : null
    if (w != null && Number.isFinite(w) && w > 0) return clampNumber((w / base) * 100, 1, 100)
  }
  return clampNumber(cfg?.sizePctWidth ?? 82, 1, 100)
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

type AudioSortMode = 'recent' | 'alpha'
type AudioConfigSortMode = 'recent' | 'alpha'
type LogoConfigSortMode = 'recent' | 'alpha'
type LogoSortMode = 'recent' | 'alpha'
type TitlePageSortMode = 'recent' | 'alpha'

export default function ProducePage() {
  const uploadId = useMemo(() => parseUploadId(), [])
  const [me, setMe] = useState<MeResponse | null | undefined>(undefined)
  const [authChecked, setAuthChecked] = useState(false)
  const [upload, setUpload] = useState<UploadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [productionName, setProductionName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [logos, setLogos] = useState<AssetItem[]>([])
  const [titlePages, setTitlePages] = useState<AssetItem[]>([])
  const [lowerThirdImages, setLowerThirdImages] = useState<AssetItem[]>([])
  const [audios, setAudios] = useState<AssetItem[]>([])
  const [logoConfigs, setLogoConfigs] = useState<LogoConfig[]>([])
  const [audioConfigs, setAudioConfigs] = useState<AudioConfig[]>([])
  const [lowerThirdConfigs, setLowerThirdConfigs] = useState<LowerThirdConfig[]>([])
  const [screenTitlePresets, setScreenTitlePresets] = useState<ScreenTitlePreset[]>([])
  const [assetsLoading, setAssetsLoading] = useState(false)
  const [assetsError, setAssetsError] = useState<string | null>(null)
  const [selectedLogoId, setSelectedLogoId] = useState<number | null>(() => parseLogoUploadId())
  const [selectedTitleUploadId, setSelectedTitleUploadId] = useState<number | null>(() => parseTitleUploadId())
  const [titleHoldSeconds, setTitleHoldSeconds] = useState<number>(() => parseTitleHoldSeconds() ?? 0)
  const [selectedAudioId, setSelectedAudioId] = useState<number | null>(() => parseMusicUploadId())
  const [selectedLogoConfigId, setSelectedLogoConfigId] = useState<number | null>(() => parseLogoConfigId())
  const [selectedAudioConfigId, setSelectedAudioConfigId] = useState<number | null>(() => parseAudioConfigId())
  const [selectedLowerThirdUploadId, setSelectedLowerThirdUploadId] = useState<number | null>(() => parseLowerThirdUploadId())
  const [selectedLowerThirdConfigId, setSelectedLowerThirdConfigId] = useState<number | null>(() => parseLowerThirdConfigId())
  const [selectedScreenTitlePresetId, setSelectedScreenTitlePresetId] = useState<number | null>(() => parseScreenTitlePresetId())
  const [screenTitleText, setScreenTitleText] = useState<string>(() => {
    if (!uploadId) return ''
    try {
      return sessionStorage.getItem(`produce:screenTitleText:${uploadId}`) || ''
    } catch {
      return ''
    }
  })
  const [introSeconds, setIntroSeconds] = useState<number | null>(() => parseIntroSeconds())
  const [pick, setPick] = useState<'audio' | 'audioConfig' | 'logo' | 'logoConfig' | 'titlePage' | 'lowerThirdImage' | 'lowerThirdConfig' | null>(() => parsePick())
  const [audioSort, setAudioSort] = useState<AudioSortMode>('recent')
  const [audioConfigSort, setAudioConfigSort] = useState<AudioConfigSortMode>('recent')
  const [logoConfigSort, setLogoConfigSort] = useState<LogoConfigSortMode>('recent')
  const [logoSort, setLogoSort] = useState<LogoSortMode>('recent')
  const [titlePageSort, setTitlePageSort] = useState<TitlePageSortMode>('recent')
  const [audioConfigAbout, setAudioConfigAbout] = useState<{ title: string; description: string | null } | null>(null)
  const [logoAbout, setLogoAbout] = useState<{ title: string; description: string | null } | null>(null)
  const [logoConfigAbout, setLogoConfigAbout] = useState<{ title: string; description: string | null } | null>(null)
  const [audioAbout, setAudioAbout] = useState<{ title: string; description: string | null } | null>(null)
  const [lowerThirdAbout, setLowerThirdAbout] = useState<{ title: string; description: string | null } | null>(null)
  const [lowerThirdConfigAbout, setLowerThirdConfigAbout] = useState<{ title: string; description: string | null } | null>(null)
  const [uploadPreviewMode, setUploadPreviewMode] = useState<'thumb' | 'poster' | 'none'>('thumb')
  const [uploadThumbRetryNonce, setUploadThumbRetryNonce] = useState(0)
  const fromHere = encodeURIComponent(window.location.pathname + window.location.search)

  useEffect(() => {
    let cancelled = false
    if (!uploadId) {
      setError('Missing upload id.')
      setLoading(false)
      return
    }
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const user = await ensureLoggedIn()
        if (!cancelled) {
          setMe(user)
          setAuthChecked(true)
        }
        const res = await fetch(`/api/uploads/${uploadId}`, { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Failed to load upload')
        if (!cancelled) setUpload(data)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load upload')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uploadId])

  useEffect(() => {
    setUploadPreviewMode('thumb')
    setUploadThumbRetryNonce(0)
    try {
      const stored = uploadId ? sessionStorage.getItem(`produce:screenTitleText:${uploadId}`) : null
      setScreenTitleText(stored || '')
    } catch {
      setScreenTitleText('')
    }
  }, [uploadId])

  useEffect(() => {
    if (!uploadId) return
    try {
      sessionStorage.setItem(`produce:screenTitleText:${uploadId}`, screenTitleText || '')
    } catch {}
  }, [uploadId, screenTitleText])

  useEffect(() => {
    const applyFromLocation = () => {
      setPick(parsePick())
      // If we came back from a picker selection, prefer the pending selection.
      try {
        const pendingRaw = sessionStorage.getItem('produce:pendingMusicUploadId')
        if (pendingRaw !== null) {
          sessionStorage.removeItem('produce:pendingMusicUploadId')
          const pending = pendingRaw === '' ? null : Number(pendingRaw)
          const nextId = pending != null && Number.isFinite(pending) && pending > 0 ? pending : null
          setSelectedAudioId(nextId)
          replaceQueryParams({ musicUploadId: nextId == null ? null : String(nextId), pick: null }, { ...(window.history.state || {}), modal: null })
          return
        }
      } catch {}
      try {
        const pendingRaw = sessionStorage.getItem('produce:pendingAudioConfigId')
        if (pendingRaw !== null) {
          sessionStorage.removeItem('produce:pendingAudioConfigId')
          const pending = pendingRaw === '' ? null : Number(pendingRaw)
          const nextId = pending != null && Number.isFinite(pending) && pending > 0 ? pending : null
          setSelectedAudioConfigId(nextId)
          replaceQueryParams({ audioConfigId: nextId == null ? null : String(nextId), pick: null }, { ...(window.history.state || {}), modal: null })
          return
        }
      } catch {}
      try {
        const pendingRaw = sessionStorage.getItem('produce:pendingLogoConfigId')
        if (pendingRaw !== null) {
          sessionStorage.removeItem('produce:pendingLogoConfigId')
          const pending = pendingRaw === '' ? null : Number(pendingRaw)
          const nextId = pending != null && Number.isFinite(pending) && pending > 0 ? pending : null
          setSelectedLogoConfigId(nextId)
          replaceQueryParams({ logoConfigId: nextId == null ? null : String(nextId), pick: null }, { ...(window.history.state || {}), modal: null })
          return
        }
      } catch {}
      try {
        const pendingRaw = sessionStorage.getItem('produce:pendingLowerThirdUploadId')
        if (pendingRaw !== null) {
          sessionStorage.removeItem('produce:pendingLowerThirdUploadId')
          const pending = pendingRaw === '' ? null : Number(pendingRaw)
          const nextId = pending != null && Number.isFinite(pending) && pending > 0 ? pending : null
          setSelectedLowerThirdUploadId(nextId)
          replaceQueryParams(
            { lowerThirdUploadId: nextId == null ? null : String(nextId), pick: null },
            { ...(window.history.state || {}), modal: null }
          )
          return
        }
      } catch {}
      try {
        const pendingRaw = sessionStorage.getItem('produce:pendingLowerThirdConfigId')
        if (pendingRaw !== null) {
          sessionStorage.removeItem('produce:pendingLowerThirdConfigId')
          const pending = pendingRaw === '' ? null : Number(pendingRaw)
          const nextId = pending != null && Number.isFinite(pending) && pending > 0 ? pending : null
          setSelectedLowerThirdConfigId(nextId)
          replaceQueryParams(
            { lowerThirdConfigId: nextId == null ? null : String(nextId), pick: null },
            { ...(window.history.state || {}), modal: null }
          )
          return
        }
      } catch {}
      try {
        const pendingRaw = sessionStorage.getItem('produce:pendingLogoUploadId')
        if (pendingRaw !== null) {
          sessionStorage.removeItem('produce:pendingLogoUploadId')
          const pending = pendingRaw === '' ? null : Number(pendingRaw)
          const nextId = pending != null && Number.isFinite(pending) && pending > 0 ? pending : null
          setSelectedLogoId(nextId)
          replaceQueryParams({ logoUploadId: nextId == null ? null : String(nextId), pick: null }, { ...(window.history.state || {}), modal: null })
          return
        }
      } catch {}
      try {
        const pendingRaw = sessionStorage.getItem('produce:pendingTitleUploadId')
        if (pendingRaw !== null) {
          sessionStorage.removeItem('produce:pendingTitleUploadId')
          const pending = pendingRaw === '' ? null : Number(pendingRaw)
          const nextId = pending != null && Number.isFinite(pending) && pending > 0 ? pending : null
          setSelectedTitleUploadId(nextId)
          replaceQueryParams(
            { titleUploadId: nextId == null ? null : String(nextId), pick: null, introSeconds: null },
            { ...(window.history.state || {}), modal: null }
          )
          if (nextId == null) setTitleHoldSeconds(0)
          return
        }
      } catch {}
      setSelectedAudioId(parseMusicUploadId())
      setSelectedLogoId(parseLogoUploadId())
      setSelectedTitleUploadId(parseTitleUploadId())
      setTitleHoldSeconds(parseTitleHoldSeconds() ?? 0)
      setSelectedLogoConfigId(parseLogoConfigId())
      setSelectedAudioConfigId(parseAudioConfigId())
      setSelectedLowerThirdUploadId(parseLowerThirdUploadId())
      setSelectedLowerThirdConfigId(parseLowerThirdConfigId())
      setSelectedScreenTitlePresetId(parseScreenTitlePresetId())
    }
    window.addEventListener('popstate', applyFromLocation)
    return () => window.removeEventListener('popstate', applyFromLocation)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!authChecked || !me?.userId) return
    ;(async () => {
      setAssetsLoading(true)
      setAssetsError(null)
      try {
			        const base = new URLSearchParams({ user_id: String(me.userId), limit: '200', status: 'uploaded,completed' })
	        const logoParams = new URLSearchParams(base)
	        logoParams.set('kind', 'logo')
	        const titleParams = new URLSearchParams(base)
	        titleParams.set('kind', 'image')
	        titleParams.set('image_role', 'title_page')
	        const lowerThirdImageParams = new URLSearchParams(base)
	        lowerThirdImageParams.set('kind', 'image')
	        lowerThirdImageParams.set('image_role', 'lower_third')
	        const [logoRes, titleRes, lowerThirdImageRes, audioRes, cfgRes, audioCfgRes, ltCfgRes, stRes] = await Promise.all([
	          fetch(`/api/uploads?${logoParams.toString()}`, { credentials: 'same-origin' }),
	          fetch(`/api/uploads?${titleParams.toString()}`, { credentials: 'same-origin' }),
	          fetch(`/api/uploads?${lowerThirdImageParams.toString()}`, { credentials: 'same-origin' }),
	          fetch(`/api/system-audio?limit=200`, { credentials: 'same-origin' }),
	          fetch(`/api/logo-configs`, { credentials: 'same-origin' }),
	          fetch(`/api/audio-configs?limit=200`, { credentials: 'same-origin' }),
	          fetch(`/api/lower-third-configs?limit=200`, { credentials: 'same-origin' }),
	          fetch(`/api/screen-title-presets`, { credentials: 'same-origin' }),
	        ])
	        const logoJson = await logoRes.json().catch(() => [])
	        const titleJson = await titleRes.json().catch(() => [])
	        const lowerThirdImageJson = await lowerThirdImageRes.json().catch(() => [])
	        const audioJson = await audioRes.json().catch(() => [])
	        const cfgJson = await cfgRes.json().catch(() => [])
	        const audioCfgJson = await audioCfgRes.json().catch(() => ({}))
	        const ltCfgJson = await ltCfgRes.json().catch(() => ({}))
	        const stJson = await stRes.json().catch(() => [])
	        if (!logoRes.ok) throw new Error('Failed to load logos')
	        if (!titleRes.ok) throw new Error('Failed to load title pages')
	        if (!lowerThirdImageRes.ok) throw new Error('Failed to load lower third images')
	        if (!audioRes.ok) throw new Error('Failed to load system audio')
	        if (!cfgRes.ok) throw new Error('Failed to load logo configurations')
	        if (!audioCfgRes.ok) throw new Error('Failed to load audio configurations')
	        if (!ltCfgRes.ok) throw new Error('Failed to load lower third configs')
	        if (!stRes.ok) throw new Error('Failed to load screen title presets')
	        if (cancelled) return
	        setLogos(Array.isArray(logoJson) ? logoJson : [])
	        setTitlePages(Array.isArray(titleJson) ? titleJson : [])
	        setLowerThirdImages(Array.isArray(lowerThirdImageJson) ? lowerThirdImageJson : [])
	        setAudios(Array.isArray(audioJson) ? audioJson : [])
        const cfgs = Array.isArray(cfgJson) ? (cfgJson as any[]) : []
        setLogoConfigs(cfgs as any)
        const audioCfgItems = Array.isArray(audioCfgJson)
          ? (audioCfgJson as any[])
          : Array.isArray((audioCfgJson as any)?.items)
            ? ((audioCfgJson as any).items as any[])
            : []
        setAudioConfigs(audioCfgItems as any)
	        const ltCfgItems = Array.isArray((ltCfgJson as any)?.items)
	          ? ((ltCfgJson as any).items as any[])
	          : Array.isArray(ltCfgJson)
	            ? (ltCfgJson as any[])
	            : []
	        setLowerThirdConfigs(ltCfgItems as any)
	        setScreenTitlePresets(Array.isArray(stJson) ? (stJson as any) : [])
      } catch (e: any) {
        if (!cancelled) setAssetsError(e?.message || 'Failed to load assets')
      } finally {
        if (!cancelled) setAssetsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [authChecked, me?.userId])

  const selectedAudio = useMemo(() => {
    if (selectedAudioId == null) return null
    return audios.find((a) => a.id === selectedAudioId) || null
  }, [audios, selectedAudioId])

  const sortedAudios = useMemo(() => {
    const items = Array.isArray(audios) ? [...audios] : []
    const nameFor = (a: AssetItem) => String((a.modified_filename || a.original_filename || '')).trim().toLowerCase()
    if (audioSort === 'alpha') {
      items.sort((a, b) => nameFor(a).localeCompare(nameFor(b)))
      return items
    }
    items.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })
    return items
  }, [audios, audioSort])

  const selectedAudioConfig = useMemo(() => {
    if (selectedAudioConfigId == null) return null
    return audioConfigs.find((c) => c.id === selectedAudioConfigId) || null
  }, [audioConfigs, selectedAudioConfigId])

  const defaultAudioConfig = useMemo(() => {
    const preferred = audioConfigs.find((c) => String(c.name || '').trim().toLowerCase() === 'mix (medium)')
    return preferred || audioConfigs[0] || null
  }, [audioConfigs])

  const sortedAudioConfigs = useMemo(() => {
    const items = Array.isArray(audioConfigs) ? [...audioConfigs] : []
    const nameFor = (c: AudioConfig) => String(c.name || '').trim().toLowerCase()
    if (audioConfigSort === 'alpha') {
      items.sort((a, b) => nameFor(a).localeCompare(nameFor(b)))
      return items
    }
    items.sort((a, b) => Number(b.id) - Number(a.id))
    return items
  }, [audioConfigs, audioConfigSort])

  const sortedLogoConfigs = useMemo(() => {
    const items = Array.isArray(logoConfigs) ? [...logoConfigs] : []
    const nameFor = (c: LogoConfig) => String(c.name || '').trim().toLowerCase()
    if (logoConfigSort === 'alpha') {
      items.sort((a, b) => nameFor(a).localeCompare(nameFor(b)))
      return items
    }
    items.sort((a, b) => Number(b.id) - Number(a.id))
    return items
  }, [logoConfigs, logoConfigSort])

  const sortedLogos = useMemo(() => {
    const items = Array.isArray(logos) ? [...logos] : []
    const nameFor = (l: AssetItem) => String((l.modified_filename || l.original_filename || '')).trim().toLowerCase()
    if (logoSort === 'alpha') {
      items.sort((a, b) => nameFor(a).localeCompare(nameFor(b)))
      return items
    }
    items.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })
    return items
  }, [logos, logoSort])

  const selectedTitlePage = useMemo(() => {
    if (selectedTitleUploadId == null) return null
    return titlePages.find((t) => t.id === selectedTitleUploadId) || null
  }, [titlePages, selectedTitleUploadId])

  const sortedTitlePages = useMemo(() => {
    const items = Array.isArray(titlePages) ? [...titlePages] : []
    const nameFor = (t: AssetItem) => String((t.modified_filename || t.original_filename || '')).trim().toLowerCase()
    if (titlePageSort === 'alpha') {
      items.sort((a, b) => nameFor(a).localeCompare(nameFor(b)))
      return items
    }
    items.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })
    return items
  }, [titlePages, titlePageSort])

  const selectedLowerThirdImage = useMemo(() => {
    if (selectedLowerThirdUploadId == null) return null
    return lowerThirdImages.find((t) => t.id === selectedLowerThirdUploadId) || null
  }, [lowerThirdImages, selectedLowerThirdUploadId])

  const selectedScreenTitlePreset = useMemo(() => {
    if (selectedScreenTitlePresetId == null) return null
    return screenTitlePresets.find((p) => p.id === selectedScreenTitlePresetId) || null
  }, [screenTitlePresets, selectedScreenTitlePresetId])

  const sortedLowerThirdImages = useMemo(() => {
    const items = Array.isArray(lowerThirdImages) ? [...lowerThirdImages] : []
    items.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })
    return items
  }, [lowerThirdImages])

  const selectedLogoConfig = useMemo(() => {
    if (selectedLogoConfigId == null) return null
    return logoConfigs.find((c) => c.id === selectedLogoConfigId) || null
  }, [logoConfigs, selectedLogoConfigId])

  const selectedLowerThirdConfig = useMemo(() => {
    if (selectedLowerThirdConfigId == null) return null
    return lowerThirdConfigs.find((c) => c.id === selectedLowerThirdConfigId) || null
  }, [lowerThirdConfigs, selectedLowerThirdConfigId])

  const selectedLogo = useMemo(() => {
    if (selectedLogoId == null) return null
    return logos.find((l) => l.id === selectedLogoId) || null
  }, [logos, selectedLogoId])

  const formatLogoConfigSummary = (c: LogoConfig | null): string => {
    if (!c) return ''
    const timingRuleLabel = String(c.timingRule).split('_').join(' ')
    const timing =
      c.timingRule === 'entire'
        ? 'entire'
        : c.timingSeconds != null
          ? `${timingRuleLabel} @ ${c.timingSeconds}s`
          : timingRuleLabel
    return [
      c.position ? formatLogoPosition(c.position) : null,
      c.sizePctWidth != null ? `${c.sizePctWidth}%` : null,
      c.opacityPct != null ? `${c.opacityPct}%` : null,
      timing || null,
      c.fade ? String(c.fade).split('_').join(' ') : null,
    ].filter(Boolean).join(' • ')
  }

  const formatLowerThirdConfigSummary = (c: LowerThirdConfig | null): string => {
    if (!c) return ''
    const sizeMode = String(c.sizeMode || 'pct').toLowerCase()
    const base = c.baselineWidth === 1920 ? 1920 : 1080
    const timing =
      c.timingRule === 'entire'
        ? 'Till end'
        : c.timingSeconds != null
          ? `First ${c.timingSeconds}s`
          : 'First 10s'
    const fadeLabel = c.fade && c.fade !== 'none' ? `Fade ${String(c.fade).split('_').join(' ')}` : null
    const insetY = c.insetYPreset ? `Inset ${String(c.insetYPreset)}` : null
    const sizeLabel =
      sizeMode === 'match_image'
        ? (() => {
            const w = selectedLowerThirdImage?.width != null ? Number(selectedLowerThirdImage.width) : null
            if (w != null && Number.isFinite(w) && w > 0) {
              const pct = (w / base) * 100
              const pctLabel = pct >= 10 ? pct.toFixed(0) : pct.toFixed(1)
              return `Match image @ ${base} (~${pctLabel}%)`
            }
            return `Match image @ ${base}`
          })()
        : c.sizePctWidth != null
          ? `${c.sizePctWidth}%`
          : null
    return [
      sizeLabel,
      c.opacityPct != null ? `${c.opacityPct}%` : null,
      timing,
      fadeLabel,
      insetY,
    ].filter(Boolean).join(' • ')
  }

  const formatAudioConfigSummary = (c: AudioConfig | null): string => {
    const mode = c?.mode ? String(c.mode) : 'mix'
    const musicDb = c?.musicGainDb != null && Number.isFinite(c.musicGainDb) ? Math.round(Number(c.musicGainDb)) : -18
    const duck = Boolean(c && c.duckingEnabled)
    const duckAmt = c?.duckingAmountDb != null && Number.isFinite(c.duckingAmountDb) ? Math.round(Number(c.duckingAmountDb)) : 12

    const durRaw = c?.audioDurationSeconds != null ? Number(c.audioDurationSeconds) : null
    const dur = durRaw != null && Number.isFinite(durRaw) ? Math.max(2, Math.min(20, Math.round(durRaw))) : null
    const fade = Boolean(c?.audioFadeEnabled ?? true)
    const durLabel = dur != null ? `Duration ${dur}s` : null
    const fadeLabel = dur != null && fade ? 'Fade' : null

    if (mode === 'replace') {
      return ['Replace', `Music ${musicDb} dB`, durLabel, fadeLabel].filter(Boolean).join(' • ')
    }
    return [
      `Mix • Music ${musicDb} dB${duck ? ` • Ducking ${duckAmt} dB` : ''}`,
      durLabel,
      fadeLabel,
    ].filter(Boolean).join(' • ')
  }

  const openAudioPicker = () => {
    setPick('audio')
    pushQueryParams({ pick: 'audio' }, { ...(window.history.state || {}), modal: 'audioPicker' })
  }

  const openAudioConfigPicker = () => {
    setPick('audioConfig')
    pushQueryParams({ pick: 'audioConfig' }, { ...(window.history.state || {}), modal: 'audioConfigPicker' })
  }

  const openAudioConfigAbout = (cfg: AudioConfig | null) => {
    const title = (cfg?.name || '').trim() || 'Audio Preset'
    const description = cfg?.description != null ? String(cfg.description) : null
    setAudioConfigAbout({ title, description })
  }

  const openLogoAbout = (logo: AssetItem | null) => {
    const title = logo ? ((logo.modified_filename || logo.original_filename || `Logo ${logo.id}`).trim()) : 'Logo'
    const description = logo?.description != null ? String(logo.description) : null
    setLogoAbout({ title, description })
  }

  const openLogoConfigAbout = (cfg: LogoConfig | null) => {
    const title = (cfg?.name || '').trim() || 'Logo Config'
    const description = cfg?.description != null ? String(cfg.description) : null
    setLogoConfigAbout({ title, description })
  }

  const openAudioAbout = (audio: AssetItem | null) => {
    const title = audio ? ((audio.modified_filename || audio.original_filename || `Audio ${audio.id}`).trim()) : 'Audio'
    const description = audio?.description != null ? String(audio.description) : null
    setAudioAbout({ title, description })
  }

  const openLowerThirdAbout = (image: AssetItem | null) => {
    const title = image ? ((image.modified_filename || image.original_filename || `Image ${image.id}`).trim()) : 'Lower Third Image'
    const description = image?.description != null ? String(image.description) : null
    setLowerThirdAbout({ title, description })
  }

  const openLowerThirdConfigAbout = (cfg: LowerThirdConfig | null) => {
    const title = (cfg?.name || '').trim() || 'Lower Third Config'
    const description = cfg?.description != null ? String(cfg.description) : null
    setLowerThirdConfigAbout({ title, description })
  }

  const openLogoPicker = () => {
    setPick('logo')
    pushQueryParams({ pick: 'logo' }, { ...(window.history.state || {}), modal: 'logoPicker' })
  }

  const openLogoConfigPicker = () => {
    setPick('logoConfig')
    pushQueryParams({ pick: 'logoConfig' }, { ...(window.history.state || {}), modal: 'logoConfigPicker' })
  }

  const openTitlePagePicker = () => {
    setPick('titlePage')
    pushQueryParams({ pick: 'titlePage' }, { ...(window.history.state || {}), modal: 'titlePagePicker' })
  }

  const openLowerThirdImagePicker = () => {
    setPick('lowerThirdImage')
    pushQueryParams({ pick: 'lowerThirdImage' }, { ...(window.history.state || {}), modal: 'lowerThirdImagePicker' })
  }

  const openLowerThirdConfigPicker = () => {
    setPick('lowerThirdConfig')
    pushQueryParams({ pick: 'lowerThirdConfig' }, { ...(window.history.state || {}), modal: 'lowerThirdConfigPicker' })
  }

  const closePicker = () => {
    setPick(null)
    replaceQueryParams({ pick: null }, { ...(window.history.state || {}), modal: null })
  }

  const applyMusicSelection = (id: number | null) => {
    setSelectedAudioId(id)
    if (id == null) {
      setSelectedAudioConfigId(null)
      replaceQueryParams({ musicUploadId: null, audioConfigId: null }, { ...(window.history.state || {}), modal: null })
      return
    }
    replaceQueryParams({ musicUploadId: String(id) }, { ...(window.history.state || {}), modal: null })
  }

  const applyLogoSelection = (id: number | null) => {
    setSelectedLogoId(id)
    replaceQueryParams({ logoUploadId: id == null ? null : String(id) }, { ...(window.history.state || {}), modal: null })
  }

  const applyLowerThirdImageSelection = (id: number | null) => {
    setSelectedLowerThirdUploadId(id)
    replaceQueryParams({ lowerThirdUploadId: id == null ? null : String(id) }, { ...(window.history.state || {}), modal: null })
  }

  const applyTitlePageSelection = (id: number | null) => {
    setSelectedTitleUploadId(id)
    setIntroSeconds(null)
    if (id == null) {
      setTitleHoldSeconds(0)
      replaceQueryParams(
        { titleUploadId: null, titleHoldSeconds: null, introSeconds: null },
        { ...(window.history.state || {}), modal: null }
      )
      return
    }
    replaceQueryParams(
      { titleUploadId: String(id), titleHoldSeconds: String(titleHoldSeconds || 0), introSeconds: null },
      { ...(window.history.state || {}), modal: null }
    )
  }

  const applyAudioConfigSelection = (id: number | null) => {
    setSelectedAudioConfigId(id)
    replaceQueryParams({ audioConfigId: id == null ? null : String(id) }, { ...(window.history.state || {}), modal: null })
  }

  const applyLogoConfigSelection = (id: number | null) => {
    setSelectedLogoConfigId(id)
    replaceQueryParams({ logoConfigId: id == null ? null : String(id) }, { ...(window.history.state || {}), modal: null })
  }

  const applyLowerThirdConfigSelection = (id: number | null) => {
    setSelectedLowerThirdConfigId(id)
    replaceQueryParams({ lowerThirdConfigId: id == null ? null : String(id) }, { ...(window.history.state || {}), modal: null })
  }

  const chooseAudio = (id: number | null) => {
    // Called from the main /produce screen (not the picker).
    applyMusicSelection(id)
  }

  const chooseAudioFromPicker = (id: number | null) => {
    setPick(null)
    const modal = (window.history.state as any)?.modal
    if (modal === 'audioPicker') {
      try {
        sessionStorage.setItem('produce:pendingMusicUploadId', id == null ? '' : String(id))
      } catch {}
      try {
        window.history.back()
        return
      } catch {}
    }
    // Direct-entry into ?pick=audio (no modal history state): just close in-place.
    applyMusicSelection(id)
    closePicker()
  }

  const chooseAudioConfigFromPicker = (id: number | null) => {
    setPick(null)
    const modal = (window.history.state as any)?.modal
    if (modal === 'audioConfigPicker') {
      try {
        sessionStorage.setItem('produce:pendingAudioConfigId', id == null ? '' : String(id))
      } catch {}
      try {
        window.history.back()
        return
      } catch {}
    }
    applyAudioConfigSelection(id)
    closePicker()
  }

  const chooseLogoConfigFromPicker = (id: number | null) => {
    setPick(null)
    const modal = (window.history.state as any)?.modal
    if (modal === 'logoConfigPicker') {
      try {
        sessionStorage.setItem('produce:pendingLogoConfigId', id == null ? '' : String(id))
      } catch {}
      try {
        window.history.back()
        return
      } catch {}
    }
    // Direct-entry into ?pick=logoConfig (no modal history state): just close in-place.
    applyLogoConfigSelection(id)
    closePicker()
  }

  const chooseLogoFromPicker = (id: number | null) => {
    setPick(null)
    const modal = (window.history.state as any)?.modal
    if (modal === 'logoPicker') {
      try {
        sessionStorage.setItem('produce:pendingLogoUploadId', id == null ? '' : String(id))
      } catch {}
      try {
        window.history.back()
        return
      } catch {}
    }
    // Direct-entry into ?pick=logo (no modal history state): just close in-place.
    applyLogoSelection(id)
    closePicker()
  }

  const chooseLowerThirdImageFromPicker = (id: number | null) => {
    setPick(null)
    const modal = (window.history.state as any)?.modal
    if (modal === 'lowerThirdImagePicker') {
      try {
        sessionStorage.setItem('produce:pendingLowerThirdUploadId', id == null ? '' : String(id))
      } catch {}
      try {
        window.history.back()
        return
      } catch {}
    }
    applyLowerThirdImageSelection(id)
    closePicker()
  }

  const chooseLowerThirdConfigFromPicker = (id: number | null) => {
    setPick(null)
    const modal = (window.history.state as any)?.modal
    if (modal === 'lowerThirdConfigPicker') {
      try {
        sessionStorage.setItem('produce:pendingLowerThirdConfigId', id == null ? '' : String(id))
      } catch {}
      try {
        window.history.back()
        return
      } catch {}
    }
    applyLowerThirdConfigSelection(id)
    closePicker()
  }

  const chooseTitlePageFromPicker = (id: number | null) => {
    setPick(null)
    const modal = (window.history.state as any)?.modal
    if (modal === 'titlePagePicker') {
      try {
        sessionStorage.setItem('produce:pendingTitleUploadId', id == null ? '' : String(id))
      } catch {}
      try {
        window.history.back()
        return
      } catch {}
    }
    applyTitlePageSelection(id)
    closePicker()
  }

  const backHref = uploadId ? `/productions?upload=${encodeURIComponent(String(uploadId))}` : '/productions'

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
          <h1 style={{ margin: '12px 0 0', fontSize: 28 }}>Build Production</h1>
          <p style={{ marginTop: 16, color: '#bbb' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (error || !upload) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
          <h1 style={{ margin: '12px 0 0', fontSize: 28 }}>Build Production</h1>
          <p style={{ marginTop: 16, color: '#ff9b9b' }}>{error || 'Upload not found.'}</p>
        </div>
      </div>
    )
  }

  const displayName = upload.modified_filename || upload.original_filename || `Upload ${upload.id}`
  const poster = pickPoster(upload)
  const uploadThumbSrc = uploadId ? `/api/uploads/${encodeURIComponent(String(uploadId))}/thumb?b=${uploadThumbRetryNonce}` : null
  const uploadPreviewSrc = uploadPreviewMode === 'thumb' ? uploadThumbSrc : uploadPreviewMode === 'poster' ? poster : null
  const sourceDeleted = !!upload.source_deleted_at

	  const onProduce = async () => {
    if (!uploadId) return
    if (creating) return
    if (sourceDeleted) {
      setCreateError('Source video was deleted for this upload. Existing productions still work, but you cannot produce again from this upload.')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf

	      const body: any = {
	        uploadId,
	        musicUploadId: selectedAudioId ?? null,
	        audioConfigId: selectedAudioConfigId ?? null,
	        logoUploadId: selectedLogoId ?? null,
	        logoConfigId: selectedLogoConfigId ?? null,
	        lowerThirdUploadId: selectedLowerThirdUploadId ?? null,
	        lowerThirdConfigId: selectedLowerThirdConfigId ?? null,
	        screenTitlePresetId: selectedScreenTitlePresetId ?? null,
	        screenTitleText: (screenTitleText || '').trim() ? screenTitleText : null,
	      }
	      if (selectedTitleUploadId != null) {
	        body.config = { intro: { kind: 'title_image', uploadId: selectedTitleUploadId, holdSeconds: titleHoldSeconds || 0 } }
	      } else if (introSeconds != null) {
	        body.config = { intro: { kind: 'freeze_first_frame', seconds: introSeconds } }
	      }
	      const trimmedName = productionName.trim()
	      if (trimmedName) body.name = trimmedName

      const res = await fetch('/api/productions', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const code = data?.error ? String(data.error) : null
        if (code === 'source_deleted') {
          throw new Error('Source video was deleted for this upload. Existing productions still work, but you cannot produce again from this upload.')
        }
        throw new Error(code || 'Failed to create production')
      }
      const id = Number(data?.production?.id)
      if (!Number.isFinite(id) || id <= 0) throw new Error('Missing production id')
      window.location.href = `/productions?id=${encodeURIComponent(String(id))}`
    } catch (e: any) {
      setCreateError(e?.message || 'Failed to create production')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
        <header style={{ margin: '12px 0 18px' }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 28 }}>Build Production</h1>
          <div style={{ color: '#bbb' }}>{displayName}</div>
        </header>

	        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
	          <div>
	            {uploadPreviewSrc ? (
	              <div style={{ width: 280, borderRadius: 12, background: '#111', overflow: 'hidden', position: 'relative' }}>
	                <img
	                  src={uploadPreviewSrc}
	                  alt="poster"
	                  style={{ width: '100%', display: 'block', objectFit: 'cover' }}
	                  onError={() => {
	                    if (uploadPreviewMode === 'thumb') {
	                      if (poster) {
	                        setUploadPreviewMode('poster')
	                        return
	                      }
	                      if (uploadThumbRetryNonce < 8) {
	                        window.setTimeout(() => setUploadThumbRetryNonce((n) => n + 1), 1500)
	                        return
	                      }
	                      setUploadPreviewMode('none')
	                      return
	                    }
	                    setUploadPreviewMode('none')
	                  }}
	                />

	                {selectedScreenTitlePreset && (screenTitleText || '').trim() ? (
	                  <div
	                    style={{
	                      ...computeOverlayCss({
	                        position: selectedScreenTitlePreset.position,
	                        sizePctWidth: selectedScreenTitlePreset.maxWidthPct,
	                        opacityPct: 100,
	                        insetXPreset: selectedScreenTitlePreset.insetXPreset ?? null,
	                        insetYPreset: selectedScreenTitlePreset.insetYPreset ?? null,
	                      }),
	                      width: 'auto',
	                      maxWidth: `${(() => {
	                        const pos = String(selectedScreenTitlePreset.position || 'top_left')
	                        const xInsetPct = pos.endsWith('_center')
	                          ? 0
	                          : insetPctForPreset((selectedScreenTitlePreset.insetXPreset ?? null) as any) * 100
	                        const rawMax = clampNumber(selectedScreenTitlePreset.maxWidthPct ?? 90, 10, 100)
	                        const capped = Math.min(rawMax, 100 - 2 * xInsetPct)
	                        return clampNumber(capped, 10, 100).toFixed(2)
	                      })()}%`,
	                      zIndex: 2,
	                      boxSizing: 'border-box',
	                      padding:
	                        selectedScreenTitlePreset.style === 'strip'
	                          ? '10px 12px'
	                          : selectedScreenTitlePreset.style === 'pill'
	                            ? '8px 10px'
	                            : '0px',
	                      borderRadius: selectedScreenTitlePreset.style === 'pill' ? 12 : 0,
	                      background:
	                        selectedScreenTitlePreset.style === 'strip'
	                          ? 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.0) 100%)'
	                          : selectedScreenTitlePreset.style === 'pill'
	                            ? 'rgba(0,0,0,0.55)'
	                            : 'transparent',
	                      color: selectedScreenTitlePreset.fontColor || '#ffffff',
	                      fontWeight: 850,
	                      fontSize: Math.round(
	                        14 * clampNumber((selectedScreenTitlePreset.fontSizePct ?? 4.5) / 4.5, 0.6, 1.8)
	                      ),
	                      lineHeight: 1.2,
	                      whiteSpace: 'pre-wrap',
	                      overflowWrap: 'anywhere',
	                      wordBreak: 'break-word',
	                      textShadow:
	                        selectedScreenTitlePreset.style === 'outline'
	                          ? '0 1px 2px rgba(0,0,0,0.95), 0 0 1px rgba(0,0,0,0.95)'
	                          : '0 1px 2px rgba(0,0,0,0.75)',
	                      pointerEvents: 'none',
	                    }}
	                  >
	                    {screenTitleText}
	                  </div>
	                ) : null}

	                {selectedLowerThirdImage ? (
	                  <img
	                    src={`/api/uploads/${encodeURIComponent(String(selectedLowerThirdImage.id))}/file`}
	                    alt=""
	                    style={{
	                      ...computeOverlayCss({
	                        position: 'bottom_center',
	                        sizePctWidth: computeLowerThirdPreviewSizePct(selectedLowerThirdConfig, selectedLowerThirdImage),
	                        opacityPct: selectedLowerThirdConfig?.opacityPct ?? 100,
	                        insetXPreset: null,
	                        insetYPreset: selectedLowerThirdConfig?.insetYPreset ?? 'medium',
	                      }),
	                      zIndex: 1,
	                      objectFit: 'contain',
	                      maxWidth: '100%',
	                      maxHeight: '100%',
	                    }}
	                  />
	                ) : null}

	                {selectedLogo && selectedLogoConfig ? (
	                  <img
	                    src={`/api/uploads/${encodeURIComponent(String(selectedLogo.id))}/file`}
	                    alt=""
	                    style={{
	                      ...computeOverlayCss({
	                        position: selectedLogoConfig.position,
	                        sizePctWidth: selectedLogoConfig.sizePctWidth,
	                        opacityPct: selectedLogoConfig.opacityPct,
	                        insetXPreset: selectedLogoConfig.insetXPreset ?? null,
	                        insetYPreset: selectedLogoConfig.insetYPreset ?? null,
	                      }),
	                      zIndex: 3,
	                      objectFit: 'contain',
	                      maxWidth: '100%',
	                      maxHeight: '100%',
	                    }}
	                  />
	                ) : null}
	              </div>
	            ) : (
	              <div style={{ width: 280, height: 158, borderRadius: 12, background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12, color: '#888', fontSize: 13, textAlign: 'center', lineHeight: 1.3 }}>
	                Preview generating…
	              </div>
	            )}
	            <div style={{ marginTop: 10, color: '#888', fontSize: 13 }}>
	              {upload.status}
	              {upload.size_bytes != null ? ` • ${formatBytes(upload.size_bytes)}` : ''}
	              {upload.width && upload.height ? ` • ${upload.width}×${upload.height}` : ''}
            </div>
          </div>

	          <div style={{ flex: 1, minWidth: 260 }}>
	            <section style={{ padding: 14, borderRadius: 12, background: '#0e0e0e', border: '1px solid #1f1f1f' }}>
	              <div style={{ fontSize: 13, fontWeight: 650, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.8, marginBottom: 10 }}>
	                Optional Enhancements
	              </div>

              {authChecked && !me?.userId ? (
                <div style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)', color: '#bbb', marginBottom: 12 }}>
                  Sign in to select logos and audio for this production.
                </div>
              ) : null}

	              <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
	                <div style={{ color: '#bbb' }}>Production Name (optional)</div>
                <input
                  value={productionName}
                  onChange={(e) => setProductionName(e.target.value)}
                  placeholder="Name this production"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid #2a2a2a',
                    background: '#0c0c0c',
                    color: '#fff',
                    outline: 'none',
                  }}
                />
	              </label>

                <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ color: '#bbb' }}>Screen Title (per production)</div>
                    <a
                      href={`/screen-title-presets?from=${fromHere}`}
                      style={{ color: '#9cf', textDecoration: 'none', fontSize: 13, marginLeft: 'auto' }}
                    >
                      Manage presets
                    </a>
                  </div>

                  <select
                    value={selectedScreenTitlePresetId == null ? '' : String(selectedScreenTitlePresetId)}
                    onChange={(e) => {
                      const raw = e.target.value
                      const next = raw ? Number(raw) : null
                      const id = next != null && Number.isFinite(next) && next > 0 ? next : null
                      setSelectedScreenTitlePresetId(id)
                      pushQueryParams({ screenTitlePresetId: id == null ? null : String(id) })
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #2a2a2a',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                    }}
                  >
                    <option value="">None</option>
                    {screenTitlePresets.map((p) => (
                      <option key={p.id} value={String(p.id)}>{p.name}</option>
                    ))}
                  </select>

                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ color: '#777', fontSize: 13 }}>
                      Max 140 chars • max 2 lines
                    </div>
                    <div style={{ color: '#777', fontSize: 13 }}>
                      {(screenTitleText || '').length}/140
                    </div>
                  </div>

                  <textarea
                    value={screenTitleText}
                    onChange={(e) => {
                      let v = String(e.target.value || '')
                      v = v.replace(/\r\n/g, '\n')
                      const lines = v.split('\n')
                      if (lines.length > 2) v = `${lines[0]}\n${lines[1]}`
                      if (v.length > 140) v = v.slice(0, 140)
                      setScreenTitleText(v)
                    }}
                    rows={2}
                    placeholder={selectedScreenTitlePresetId ? 'Enter a short title (optional)' : 'Select a preset to enable a screen title'}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid #2a2a2a',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      resize: 'vertical',
                      opacity: selectedScreenTitlePresetId == null ? 0.75 : 1,
                    }}
                  />

                  {(selectedScreenTitlePresetId != null || screenTitleText.trim()) ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedScreenTitlePresetId(null)
                          setScreenTitleText('')
                          pushQueryParams({ screenTitlePresetId: null })
                        }}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: '1px solid rgba(212,175,55,0.65)',
                          background: 'rgba(212,175,55,0.10)',
                          color: '#d4af37',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  ) : null}

                  {selectedScreenTitlePreset ? (
                    <div style={{ color: '#888', fontSize: 13, lineHeight: 1.35 }}>
                      Preset: <span style={{ color: '#d4af37', fontWeight: 800 }}>{selectedScreenTitlePreset.name}</span>
                    </div>
                  ) : null}
                </div>

                <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ color: '#bbb' }}>Title Page (optional)</div>
                    <a
                      href="/uploads?kind=image&image_role=title_page"
                      style={{ color: '#9cf', textDecoration: 'none', fontSize: 13, marginLeft: 'auto' }}
                    >
                      Manage title pages
                    </a>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ color: '#d4af37', fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {selectedTitlePage ? (selectedTitlePage.modified_filename || selectedTitlePage.original_filename || `Title ${selectedTitlePage.id}`) : 'None'}
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={openTitlePagePicker}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: '1px solid rgba(212,175,55,0.85)',
                          background: 'rgba(212,175,55,0.14)',
                          color: '#d4af37',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        Choose
                      </button>
                      {selectedTitleUploadId != null ? (
                        <button
                          type="button"
                          onClick={() => applyTitlePageSelection(null)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(212,175,55,0.65)',
                            background: 'rgba(212,175,55,0.10)',
                            color: '#d4af37',
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {selectedTitlePage ? (
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <img
                        src={`/api/uploads/${encodeURIComponent(String(selectedTitlePage.id))}/file`}
                        alt="title page"
                        style={{ width: 96, height: 54, objectFit: 'cover', background: '#111', borderRadius: 10 }}
                      />
                      <div style={{ color: '#888', fontSize: 13, lineHeight: 1.35 }}>
                        {formatBytes(selectedTitlePage.size_bytes)}{selectedTitlePage.created_at ? ` • ${formatDate(selectedTitlePage.created_at)}` : ''}
                      </div>
                    </div>
                  ) : (
                    <div style={{ color: '#777', fontSize: 13 }}>
                      Optional image that becomes frame 0 (poster). You can hold it before the video starts.
                    </div>
                  )}

                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: '#bbb' }}>Title Hold</div>
                    <select
                      value={String(titleHoldSeconds || 0)}
                      disabled={selectedTitleUploadId == null}
                      onChange={(e) => {
                        const raw = e.target.value
                        const next = raw ? Math.round(Number(raw)) : 0
                        const final = [0, 2, 3, 4, 5].includes(next) ? next : 0
                        setTitleHoldSeconds(final)
                        pushQueryParams({ titleHoldSeconds: selectedTitleUploadId == null ? null : String(final) })
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid #2a2a2a',
                        background: '#0c0c0c',
                        color: '#fff',
                        outline: 'none',
                        opacity: selectedTitleUploadId == null ? 0.6 : 1,
                      }}
                    >
                      <option value="0">None</option>
                      <option value="2">2 seconds</option>
                      <option value="3">3 seconds</option>
                      <option value="4">4 seconds</option>
                      <option value="5">5 seconds</option>
                    </select>
                    <div style={{ color: '#777', fontSize: 13 }}>
                      Holds the title page before playback begins.
                    </div>
                  </div>
                </div>

	              <label style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
	                <div style={{ color: '#bbb' }}>Freeze first frame (optional)</div>
	                <select
	                  value={introSeconds == null ? '' : String(introSeconds)}
                    disabled={selectedTitleUploadId != null}
	                  onChange={(e) => {
	                    const raw = e.target.value
	                    const next = raw ? Number(raw) : null
	                    const normalized = next != null && Number.isFinite(next) ? Math.round(next) : null
	                    const final = normalized != null && [2, 3, 4, 5].includes(normalized) ? normalized : null
	                    setIntroSeconds(final)
                      if (final != null) {
                        setSelectedTitleUploadId(null)
                        setTitleHoldSeconds(0)
                        pushQueryParams({ introSeconds: String(final), titleUploadId: null, titleHoldSeconds: null })
                      } else {
	                      pushQueryParams({ introSeconds: null })
                      }
	                  }}
	                  style={{
	                    padding: '10px 12px',
	                    borderRadius: 10,
	                    border: '1px solid #2a2a2a',
	                    background: '#0c0c0c',
	                    color: '#fff',
	                    outline: 'none',
                      opacity: selectedTitleUploadId != null ? 0.6 : 1,
	                  }}
	                >
	                  <option value="">None</option>
	                  <option value="2">2 seconds</option>
	                  <option value="3">3 seconds</option>
	                  <option value="4">4 seconds</option>
	                  <option value="5">5 seconds</option>
	                </select>
	                <div style={{ color: '#777', fontSize: 13 }}>
	                  Extends the production with a frozen first frame. Audio/video start after this intro.
	                </div>
	              </label>

		              <div style={{ display: 'grid', gap: 10 }}>
		                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
		                  <div style={{ color: '#bbb', fontWeight: 650 }}>Audio</div>
		                </div>
	                {assetsLoading ? (
	                  <div style={{ color: '#777' }}>Loading audio…</div>
	                ) : assetsError ? (
	                  <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
	                ) : audios.length === 0 ? (
	                  <div style={{ color: '#777' }}>
	                    No system audio available yet.
	                  </div>
	                ) : (
	                  <div style={{ display: 'grid', gap: 8, padding: '8px 10px 10px', borderRadius: 12, border: '1px solid rgba(212,175,55,0.75)', background: 'rgba(255,255,255,0.03)' }}>
	                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', alignItems: 'baseline' }}>
	                      <div style={{ gridColumn: '2', gridRow: 1, justifySelf: 'end', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            onClick={() => openAudioAbout(selectedAudio)}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(255,255,255,0.18)',
                              background: '#0c0c0c',
                              color: '#fff',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            About
                          </button>
	                        <button
	                          type="button"
	                          onClick={openAudioPicker}
	                          style={{
	                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(212,175,55,0.85)',
                            background: 'rgba(212,175,55,0.14)',
                            color: '#d4af37',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Choose
                        </button>
                        {selectedAudioId != null ? (
                          <button
                            type="button"
                            onClick={() => chooseAudio(null)}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(212,175,55,0.65)',
                              background: 'rgba(212,175,55,0.10)',
                              color: '#d4af37',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                        <div style={{ gridColumn: '1 / -1', gridRow: 2, color: '#d4af37', fontWeight: 800, wordBreak: 'break-word', lineHeight: 1.2 }}>
                          {selectedAudio ? (selectedAudio.modified_filename || selectedAudio.original_filename || `Audio ${selectedAudio.id}`) : 'None'}
                        </div>
                    </div>
	                    {selectedAudioId != null ? (
	                      <CompactAudioPlayer src={`/api/uploads/${encodeURIComponent(String(selectedAudioId))}/file`} />
	                    ) : (
	                      <div style={{ color: '#777', fontSize: 13 }}>Select a system audio track to mix into the production audio (optional).</div>
	                    )}
	                  </div>
	                )}

	                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />

	                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
	                  <div style={{ color: '#bbb', fontWeight: 650 }}>Audio Config</div>
	                  {me?.isSiteAdmin ? (
	                    <a href="/admin/audio-configs" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13 }}>Manage presets</a>
	                  ) : null}
	                </div>
	                {assetsLoading ? (
	                  <div style={{ color: '#777' }}>Loading audio presets…</div>
	                ) : assetsError ? (
	                  <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
	                ) : audioConfigs.length === 0 ? (
	                  <div style={{ color: '#777' }}>No audio presets available yet.</div>
	                ) : (
	                  <div style={{ display: 'grid', gap: 8, padding: '8px 10px 10px', borderRadius: 12, border: '1px solid rgba(212,175,55,0.75)', background: 'rgba(255,255,255,0.03)' }}>
	                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', alignItems: 'baseline' }}>
		                      <div style={{ gridColumn: '2', gridRow: 1, justifySelf: 'end', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
		                        <button
		                          type="button"
		                          onClick={() => openAudioConfigAbout(selectedAudioConfig || defaultAudioConfig)}
		                          style={{
		                            padding: '10px 12px',
		                            borderRadius: 10,
		                            border: '1px solid rgba(255,255,255,0.18)',
		                            background: '#0c0c0c',
		                            color: '#fff',
		                            fontWeight: 700,
		                            cursor: 'pointer',
		                          }}
		                        >
		                          About
		                        </button>
		                        <button
		                          type="button"
		                          onClick={openAudioConfigPicker}
		                          style={{
	                            padding: '10px 12px',
	                            borderRadius: 10,
	                            border: '1px solid rgba(212,175,55,0.85)',
	                            background: 'rgba(212,175,55,0.14)',
	                            color: '#d4af37',
	                            fontWeight: 700,
	                            cursor: 'pointer',
	                          }}
	                        >
	                          Choose
	                        </button>
	                        {selectedAudioConfigId != null ? (
	                          <button
	                            type="button"
	                            onClick={() => applyAudioConfigSelection(null)}
	                            style={{
	                              padding: '10px 12px',
	                              borderRadius: 10,
	                              border: '1px solid rgba(212,175,55,0.65)',
	                              background: 'rgba(212,175,55,0.10)',
	                              color: '#d4af37',
	                              fontWeight: 800,
	                              cursor: 'pointer',
	                            }}
	                          >
	                            Clear
	                          </button>
	                        ) : null}
	                      </div>
	                      <div style={{ gridColumn: '1 / -1', gridRow: 2, color: '#d4af37', fontWeight: 800, wordBreak: 'break-word', lineHeight: 1.2 }}>
	                        {selectedAudioConfig ? (selectedAudioConfig.name || `Preset ${selectedAudioConfig.id}`) : 'Default (Mix Medium)'}
	                      </div>
	                    </div>
	                    <div style={{ color: '#888', fontSize: 13, lineHeight: 1.35 }}>
	                      {selectedAudioConfig ? formatAudioConfigSummary(selectedAudioConfig) : 'Default: Mix • Video 0 dB • Music -18 dB'}
	                    </div>
	                  </div>
	                )}

	                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />

                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ color: '#bbb', fontWeight: 650 }}>Logo</div>
                  <a href="/uploads?kind=logo" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13 }}>Manage logos</a>
                </div>
                {assetsLoading ? (
                  <div style={{ color: '#777' }}>Loading logos…</div>
                ) : assetsError ? (
                  <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
                ) : logos.length === 0 ? (
                  <div style={{ color: '#777' }}>
                    No logo uploaded yet. <a href="/uploads/new?kind=logo" style={{ color: '#9cf' }}>Upload a logo</a>.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8, padding: '8px 10px 10px', borderRadius: 12, border: '1px solid rgba(212,175,55,0.75)', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', alignItems: 'baseline' }}>
                      <div style={{ gridColumn: '2', gridRow: 1, justifySelf: 'end', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => openLogoAbout(selectedLogo)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.18)',
                            background: '#0c0c0c',
                            color: '#fff',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          About
                        </button>
                        <button
                          type="button"
                          onClick={openLogoPicker}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(212,175,55,0.85)',
                            background: 'rgba(212,175,55,0.14)',
                            color: '#d4af37',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Choose
                        </button>
                        {selectedLogoId != null ? (
                          <button
                            type="button"
                            onClick={() => applyLogoSelection(null)}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(212,175,55,0.65)',
                              background: 'rgba(212,175,55,0.10)',
                              color: '#d4af37',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                      <div style={{ gridColumn: '1 / -1', gridRow: 2, color: '#d4af37', fontWeight: 800, wordBreak: 'break-word', lineHeight: 1.2 }}>
                        {selectedLogo ? (selectedLogo.modified_filename || selectedLogo.original_filename || `Logo ${selectedLogo.id}`) : 'None'}
                      </div>
                    </div>
                    {selectedLogo ? (
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <img
                          src={`/api/uploads/${encodeURIComponent(String(selectedLogo.id))}/file`}
                          alt="logo"
                          style={{ width: 72, height: 72, objectFit: 'contain', background: '#111', borderRadius: 10 }}
                        />
                        <div style={{ color: '#888', fontSize: 13, lineHeight: 1.35 }}>
                          {formatBytes(selectedLogo.size_bytes)}{selectedLogo.created_at ? ` • ${formatDate(selectedLogo.created_at)}` : ''}
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: '#777', fontSize: 13 }}>
                        Select a logo to watermark the video (optional).
                      </div>
                    )}
                  </div>
                )}

                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />

		                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
		                  <div style={{ color: '#bbb', fontWeight: 650 }}>Logo Config</div>
		                  <a href={`/logo-configs?from=${fromHere}`} style={{ color: '#9cf', textDecoration: 'none', fontSize: 13 }}>Manage configs</a>
		                </div>
		                {assetsLoading ? (
		                  <div style={{ color: '#777' }}>Loading logo configurations…</div>
		                ) : assetsError ? (
		                  <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
		                ) : logoConfigs.length === 0 ? (
		                  <div style={{ color: '#777' }}>
		                    No logo configurations yet. <a href={`/logo-configs?from=${fromHere}`} style={{ color: '#9cf' }}>Create a preset</a>.
		                  </div>
		                ) : (
		                  <div style={{ display: 'grid', gap: 8, padding: '8px 10px 10px', borderRadius: 12, border: '1px solid rgba(212,175,55,0.75)', background: 'rgba(255,255,255,0.03)' }}>
		                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', alignItems: 'baseline' }}>
		                      <div style={{ gridColumn: '2', gridRow: 1, justifySelf: 'end', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            <button
                              type="button"
                              onClick={() => openLogoConfigAbout(selectedLogoConfig)}
                              style={{
                                padding: '10px 12px',
                                borderRadius: 10,
                                border: '1px solid rgba(255,255,255,0.18)',
                                background: '#0c0c0c',
                                color: '#fff',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              About
                            </button>
		                        <button
		                          type="button"
		                          onClick={openLogoConfigPicker}
		                          style={{
		                            padding: '10px 12px',
		                            borderRadius: 10,
		                            border: '1px solid rgba(212,175,55,0.85)',
		                            background: 'rgba(212,175,55,0.14)',
		                            color: '#d4af37',
		                            fontWeight: 700,
		                            cursor: 'pointer',
		                          }}
		                        >
		                          Choose
		                        </button>
		                        {selectedLogoConfigId != null ? (
		                          <button
		                            type="button"
		                            onClick={() => applyLogoConfigSelection(null)}
		                            style={{
		                              padding: '10px 12px',
		                              borderRadius: 10,
		                              border: '1px solid rgba(212,175,55,0.65)',
		                              background: 'rgba(212,175,55,0.10)',
		                              color: '#d4af37',
		                              fontWeight: 800,
		                              cursor: 'pointer',
		                            }}
		                          >
		                            Clear
		                          </button>
		                        ) : null}
		                      </div>
		                      <div style={{ gridColumn: '1 / -1', gridRow: 2, color: '#d4af37', fontWeight: 800, wordBreak: 'break-word', lineHeight: 1.2 }}>
		                        {selectedLogoConfig ? (selectedLogoConfig.name || `Config ${selectedLogoConfig.id}`) : 'None'}
		                      </div>
		                    </div>
		                    {selectedLogoConfig ? (
		                      <div style={{ color: '#888', fontSize: 13, lineHeight: 1.35 }}>
		                        {formatLogoConfigSummary(selectedLogoConfig)}
		                      </div>
		                    ) : (
		                      <div style={{ color: '#777', fontSize: 13 }}>
		                        Select a logo config preset for watermarking (optional).
		                      </div>
		                    )}
		                  </div>
		                )}

                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />

                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ color: '#bbb', fontWeight: 650 }}>Lower Third Image</div>
                  <a href="/uploads?kind=image&image_role=lower_third" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13 }}>Manage images</a>
                </div>
                {assetsLoading ? (
                  <div style={{ color: '#777' }}>Loading lower third images…</div>
                ) : assetsError ? (
                  <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
                ) : lowerThirdImages.length === 0 ? (
                  <div style={{ color: '#777' }}>
                    No lower third images uploaded yet. <a href="/uploads/new?kind=image&image_role=lower_third" style={{ color: '#9cf' }}>Upload a PNG</a>.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8, padding: '8px 10px 10px', borderRadius: 12, border: '1px solid rgba(212,175,55,0.75)', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', alignItems: 'baseline' }}>
                      <div style={{ gridColumn: '2', gridRow: 1, justifySelf: 'end', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => openLowerThirdAbout(selectedLowerThirdImage)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.18)',
                            background: '#0c0c0c',
                            color: '#fff',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          About
                        </button>
                        <button
                          type="button"
                          onClick={openLowerThirdImagePicker}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(212,175,55,0.85)',
                            background: 'rgba(212,175,55,0.14)',
                            color: '#d4af37',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Choose
                        </button>
                        {selectedLowerThirdUploadId != null ? (
                          <button
                            type="button"
                            onClick={() => applyLowerThirdImageSelection(null)}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(212,175,55,0.65)',
                              background: 'rgba(212,175,55,0.10)',
                              color: '#d4af37',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                      <div style={{ gridColumn: '1 / -1', gridRow: 2, color: '#d4af37', fontWeight: 800, wordBreak: 'break-word', lineHeight: 1.2 }}>
                        {selectedLowerThirdImage ? (selectedLowerThirdImage.modified_filename || selectedLowerThirdImage.original_filename || `Image ${selectedLowerThirdImage.id}`) : 'None'}
                      </div>
                    </div>
                    {selectedLowerThirdImage ? (
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <img
                          src={`/api/uploads/${encodeURIComponent(String(selectedLowerThirdImage.id))}/file`}
                          alt="lower third"
                          style={{ width: 160, height: 44, objectFit: 'cover', background: '#111', borderRadius: 10 }}
                        />
                        <div style={{ color: '#888', fontSize: 13, lineHeight: 1.35 }}>
                          {formatBytes(selectedLowerThirdImage.size_bytes)}{selectedLowerThirdImage.created_at ? ` • ${formatDate(selectedLowerThirdImage.created_at)}` : ''}
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: '#777', fontSize: 13 }}>
                        Upload a PNG lower third graphic (recommended with transparent background).
                      </div>
                    )}
                  </div>
                )}

                <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '6px 0' }} />

                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ color: '#bbb', fontWeight: 650 }}>Lower Third Config</div>
                  <a href={`/lower-thirds?from=${fromHere}`} style={{ color: '#9cf', textDecoration: 'none', fontSize: 13 }}>Manage configs</a>
                </div>
                {assetsLoading ? (
                  <div style={{ color: '#777' }}>Loading lower third configs…</div>
                ) : assetsError ? (
                  <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
                ) : lowerThirdConfigs.length === 0 ? (
                  <div style={{ color: '#777' }}>
                    No lower third configs yet. <a href={`/lower-thirds?from=${fromHere}`} style={{ color: '#9cf' }}>Create a preset</a>.
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 8, padding: '8px 10px 10px', borderRadius: 12, border: '1px solid rgba(212,175,55,0.75)', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 12px', alignItems: 'baseline' }}>
                      <div style={{ gridColumn: '2', gridRow: 1, justifySelf: 'end', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => openLowerThirdConfigAbout(selectedLowerThirdConfig)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.18)',
                            background: '#0c0c0c',
                            color: '#fff',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          About
                        </button>
                        <button
                          type="button"
                          onClick={openLowerThirdConfigPicker}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(212,175,55,0.85)',
                            background: 'rgba(212,175,55,0.14)',
                            color: '#d4af37',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          Choose
                        </button>
                        {selectedLowerThirdConfigId != null ? (
                          <button
                            type="button"
                            onClick={() => applyLowerThirdConfigSelection(null)}
                            style={{
                              padding: '10px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(212,175,55,0.65)',
                              background: 'rgba(212,175,55,0.10)',
                              color: '#d4af37',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            Clear
                          </button>
                        ) : null}
                      </div>
                      <div style={{ gridColumn: '1 / -1', gridRow: 2, color: '#d4af37', fontWeight: 800, wordBreak: 'break-word', lineHeight: 1.2 }}>
                        {selectedLowerThirdConfig ? (selectedLowerThirdConfig.name || `Config ${selectedLowerThirdConfig.id}`) : 'None'}
                      </div>
                    </div>
                    {selectedLowerThirdConfig ? (
                      <>
                        <div style={{ color: '#888', fontSize: 13, lineHeight: 1.35 }}>
                          {formatLowerThirdConfigSummary(selectedLowerThirdConfig)}
                        </div>
                        {(() => {
                          const cfg = selectedLowerThirdConfig
                          const sizeMode = String(cfg.sizeMode || 'pct').toLowerCase()
                          if (sizeMode !== 'pct') return null
                          const imgW = selectedLowerThirdImage?.width != null ? Number(selectedLowerThirdImage.width) : null
                          if (imgW == null || !Number.isFinite(imgW) || imgW <= 0) return null
                          const pct = cfg.sizePctWidth != null ? Number(cfg.sizePctWidth) : null
                          if (pct == null || !Number.isFinite(pct) || pct <= 0) return null
                          const baseline = upload.width != null && upload.height != null && Number(upload.width) > Number(upload.height) ? 1920 : 1080
                          const required = (pct / 100) * baseline
                          if (!Number.isFinite(required) || required <= 0) return null
                          if (required <= imgW + 1) return null
                          return (
                            <div style={{ color: '#ffcf8a', fontSize: 13, lineHeight: 1.35 }}>
                              Warning: this may upscale your PNG (needs ~{Math.round(required)}px at {baseline}-wide; image is {Math.round(imgW)}px).
                            </div>
                          )
                        })()}
                      </>
                    ) : (
                      <div style={{ color: '#777', fontSize: 13 }}>
                        Select a config preset for sizing/timing (optional).
                      </div>
                    )}
                  </div>
                )}

              </div>
            </section>

	            <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
	              <button
	                onClick={onProduce}
	                disabled={creating || sourceDeleted}
	                style={{
	                  background: '#0a84ff',
	                  color: '#fff',
	                  border: 'none',
	                  borderRadius: 10,
	                  padding: '10px 18px',
	                  fontWeight: 700,
	                  opacity: creating || sourceDeleted ? 0.7 : 1,
	                  cursor: creating || sourceDeleted ? 'default' : 'pointer',
	                }}
	              >
	                {sourceDeleted ? 'Source Deleted' : creating ? 'Starting…' : 'Produce'}
	              </button>
	              {createError ? (
	                <div style={{ color: '#ff9b9b', fontSize: 13 }}>{createError}</div>
	              ) : sourceDeleted ? (
	                <div style={{ color: '#ff9b9b', fontSize: 13 }}>
	                  Source video was deleted for this upload. Existing productions still work, but you can’t produce again from this upload.
	                </div>
	              ) : (
	                <div style={{ color: '#888', fontSize: 13 }}>Selections are saved to the production for future rendering.</div>
	              )}
	            </div>
          </div>
        </div>
      </div>

      {pick === 'audio' ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: '#050505',
            color: '#fff',
            zIndex: 10050,
            overflow: 'auto',
          }}
        >
          <div style={{ maxWidth: 960, margin: '0 auto', padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px max(24px, env(safe-area-inset-bottom, 0px))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => {
                  const modal = (window.history.state as any)?.modal
                  if (modal === 'audioPicker') {
                    try { window.history.back(); return } catch {}
                  }
                  closePicker()
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Choose Audio</div>
              <div style={{ width: 84 }} />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ color: '#bbb', fontWeight: 700 }}>Sort</div>
              <button
                type="button"
                onClick={() => setAudioSort('recent')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: audioSort === 'recent' ? '#0a84ff' : '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Recent
              </button>
	              <button
	                type="button"
	                onClick={() => setAudioSort('alpha')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: audioSort === 'alpha' ? '#0a84ff' : '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
	              >
	                Alphabetical
	              </button>
	            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <button
                type="button"
                onClick={() => chooseAudioFromPicker(null)}
                style={{
                  textAlign: 'left',
                  padding: 12,
                  borderRadius: 12,
                  border: selectedAudioId == null ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
                  background: selectedAudioId == null ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.03)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                None
              </button>

              {assetsLoading ? (
                <div style={{ color: '#888' }}>Loading audio…</div>
              ) : assetsError ? (
                <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
              ) : sortedAudios.length === 0 ? (
                <div style={{ color: '#bbb' }}>
                  No system audio available yet.
                </div>
              ) : (
		                sortedAudios.map((a) => {
	                  const name = (a.modified_filename || a.original_filename || `Audio ${a.id}`).trim()
	                  const src = `/api/uploads/${encodeURIComponent(String(a.id))}/file`
	                  const selected = selectedAudioId === a.id
	                  return (
                    <div
                      key={a.id}
                      style={{
                        padding: '8px 12px 12px',
                        borderRadius: 12,
                        border: selected ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
                        background: selected ? 'rgba(10,132,255,0.30)' : 'rgba(255,255,255,0.03)',
	                      }}
	                    >
	                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
	                        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', minWidth: 0 }}>
	                          <div style={{ fontWeight: 800, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
	                        </div>
	                        <button
	                          type="button"
	                          onClick={() => chooseAudioFromPicker(a.id)}
	                          style={{
                            padding: '8px 12px',
                            borderRadius: 10,
                            border: selected ? '1px solid rgba(255,255,255,0.85)' : '1px solid rgba(212,175,55,0.55)',
                            background: selected ? 'transparent' : 'rgba(212,175,55,0.10)',
                            color: selected ? '#fff' : '#d4af37',
                            fontWeight: 800,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {selected ? 'Selected' : 'Select'}
                        </button>
                      </div>
                      <div style={{ color: '#888', fontSize: 13, marginBottom: 8 }}>
                        {formatBytes(a.size_bytes)}{a.created_at ? ` • ${String(a.created_at).slice(0, 10)}` : ''}
                      </div>
                      <CompactAudioPlayer src={src} />
                    </div>
                  )
                })
              )}
	            </div>
	          </div>
	        </div>
	      ) : pick === 'audioConfig' ? (
	        <div
	          role="dialog"
	          aria-modal="true"
	          style={{
	            position: 'fixed',
	            inset: 0,
	            background: '#050505',
	            color: '#fff',
	            zIndex: 10050,
	            overflow: 'auto',
	          }}
	        >
	          <div style={{ maxWidth: 960, margin: '0 auto', padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px max(24px, env(safe-area-inset-bottom, 0px))' }}>
	            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
	              <button
	                type="button"
	                onClick={() => {
	                  const modal = (window.history.state as any)?.modal
	                  if (modal === 'audioConfigPicker') {
	                    try { window.history.back(); return } catch {}
	                  }
	                  closePicker()
	                }}
	                style={{
	                  padding: '10px 12px',
	                  borderRadius: 10,
	                  border: '1px solid rgba(255,255,255,0.18)',
	                  background: '#0c0c0c',
	                  color: '#fff',
	                  fontWeight: 700,
	                  cursor: 'pointer',
	                }}
	              >
	                ← Back
	              </button>
	              <div style={{ fontSize: 18, fontWeight: 800 }}>Choose Audio Preset</div>
	              <div style={{ width: 84 }} />
	            </div>

	            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
	              <div style={{ color: '#bbb', fontWeight: 700 }}>Sort</div>
	              <button
	                type="button"
	                onClick={() => setAudioConfigSort('recent')}
	                style={{
	                  padding: '8px 12px',
	                  borderRadius: 999,
	                  border: '1px solid rgba(255,255,255,0.18)',
	                  background: audioConfigSort === 'recent' ? '#0a84ff' : '#0c0c0c',
	                  color: '#fff',
	                  fontWeight: 800,
	                  cursor: 'pointer',
	                }}
	              >
	                Recent
	              </button>
	              <button
	                type="button"
	                onClick={() => setAudioConfigSort('alpha')}
	                style={{
	                  padding: '8px 12px',
	                  borderRadius: 999,
	                  border: '1px solid rgba(255,255,255,0.18)',
	                  background: audioConfigSort === 'alpha' ? '#0a84ff' : '#0c0c0c',
	                  color: '#fff',
	                  fontWeight: 800,
	                  cursor: 'pointer',
	                }}
	              >
	                Alphabetical
	              </button>
	              {me?.isSiteAdmin ? (
	                <a href="/admin/audio-configs" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13, marginLeft: 'auto' }}>Manage presets</a>
	              ) : null}
	            </div>

	            <div style={{ display: 'grid', gap: 10 }}>
	              <button
	                type="button"
	                onClick={() => chooseAudioConfigFromPicker(null)}
	                style={{
	                  textAlign: 'left',
	                  padding: 12,
	                  borderRadius: 12,
	                  border: selectedAudioConfigId == null ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
	                  background: selectedAudioConfigId == null ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.03)',
	                  color: '#fff',
	                  cursor: 'pointer',
	                }}
	              >
	                Default (Mix Medium)
	              </button>

	              {assetsLoading ? (
	                <div style={{ color: '#888' }}>Loading audio presets…</div>
	              ) : assetsError ? (
	                <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
	              ) : sortedAudioConfigs.length === 0 ? (
	                <div style={{ color: '#bbb' }}>
	                  No audio presets available yet.
	                </div>
	              ) : (
	                sortedAudioConfigs.map((c) => {
	                  const selected = selectedAudioConfigId === c.id
	                  const name = (c.name || `Preset ${c.id}`).trim()
	                  const summary = formatAudioConfigSummary(c)
	                  return (
	                    <div
	                      key={c.id}
	                      style={{
	                        padding: '10px 12px 12px',
	                        borderRadius: 12,
	                        border: selected ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
	                        background: selected ? 'rgba(10,132,255,0.30)' : 'rgba(255,255,255,0.03)',
	                        display: 'grid',
	                        gap: 6,
	                      }}
	                    >
	                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
	                        <div style={{ minWidth: 0 }}>
	                          <div style={{ fontWeight: 800, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
	                            {name}
	                          </div>
	                          {summary ? <div style={{ marginTop: 2, color: '#888', fontSize: 13, lineHeight: 1.25 }}>{summary}</div> : null}
	                        </div>
	                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
	                          <button
	                            type="button"
	                            onClick={() => openAudioConfigAbout(c)}
	                            style={{
	                              padding: '8px 12px',
	                              borderRadius: 10,
	                              border: '1px solid rgba(255,255,255,0.18)',
	                              background: '#0c0c0c',
	                              color: '#fff',
	                              fontWeight: 800,
	                              cursor: 'pointer',
	                            }}
	                          >
	                            About
	                          </button>
	                          <button
	                            type="button"
	                            onClick={() => chooseAudioConfigFromPicker(c.id)}
	                            style={{
	                              padding: '8px 12px',
	                              borderRadius: 10,
	                              border: selected ? '1px solid rgba(255,255,255,0.85)' : '1px solid rgba(212,175,55,0.55)',
	                              background: selected ? 'transparent' : 'rgba(212,175,55,0.10)',
	                              color: selected ? '#fff' : '#d4af37',
	                              fontWeight: 800,
	                              cursor: 'pointer',
	                            }}
	                          >
	                            {selected ? 'Selected' : 'Select'}
	                          </button>
	                        </div>
	                      </div>
	                    </div>
	                  )
	                })
	              )}
	            </div>
	          </div>
	        </div>
	      ) : pick === 'titlePage' ? (
	        <div
	          role="dialog"
	          aria-modal="true"
	          style={{
	            position: 'fixed',
	            inset: 0,
	            background: '#050505',
	            color: '#fff',
	            zIndex: 10050,
	            overflow: 'auto',
	          }}
	        >
	          <div style={{ maxWidth: 960, margin: '0 auto', padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px max(24px, env(safe-area-inset-bottom, 0px))' }}>
	            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
	              <button
	                type="button"
	                onClick={() => {
	                  const modal = (window.history.state as any)?.modal
	                  if (modal === 'titlePagePicker') {
	                    try { window.history.back(); return } catch {}
	                  }
	                  closePicker()
	                }}
	                style={{
	                  padding: '10px 12px',
	                  borderRadius: 10,
	                  border: '1px solid rgba(255,255,255,0.18)',
	                  background: '#0c0c0c',
	                  color: '#fff',
	                  fontWeight: 700,
	                  cursor: 'pointer',
	                }}
	              >
	                ← Back
	              </button>
	              <div style={{ fontSize: 18, fontWeight: 800 }}>Choose Title Page</div>
	              <div style={{ width: 84 }} />
	            </div>

	            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
	              <div style={{ color: '#bbb', fontWeight: 700 }}>Sort</div>
	              <button
	                type="button"
	                onClick={() => setTitlePageSort('recent')}
	                style={{
	                  padding: '8px 12px',
	                  borderRadius: 999,
	                  border: '1px solid rgba(255,255,255,0.18)',
	                  background: titlePageSort === 'recent' ? '#0a84ff' : '#0c0c0c',
	                  color: '#fff',
	                  fontWeight: 800,
	                  cursor: 'pointer',
	                }}
	              >
	                Recent
	              </button>
	              <button
	                type="button"
	                onClick={() => setTitlePageSort('alpha')}
	                style={{
	                  padding: '8px 12px',
	                  borderRadius: 999,
	                  border: '1px solid rgba(255,255,255,0.18)',
	                  background: titlePageSort === 'alpha' ? '#0a84ff' : '#0c0c0c',
	                  color: '#fff',
	                  fontWeight: 800,
	                  cursor: 'pointer',
	                }}
	              >
	                Alphabetical
	              </button>
	              <a href="/uploads?kind=image&image_role=title_page" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13, marginLeft: 'auto' }}>Manage title pages</a>
	            </div>

	            <div style={{ display: 'grid', gap: 10 }}>
	              <button
	                type="button"
	                onClick={() => chooseTitlePageFromPicker(null)}
	                style={{
	                  textAlign: 'left',
	                  padding: 12,
	                  borderRadius: 12,
	                  border: selectedTitleUploadId == null ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
	                  background: selectedTitleUploadId == null ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.03)',
	                  color: '#fff',
	                  cursor: 'pointer',
	                }}
	              >
	                None
	              </button>

	              {assetsLoading ? (
	                <div style={{ color: '#888' }}>Loading title pages…</div>
	              ) : assetsError ? (
	                <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
	              ) : sortedTitlePages.length === 0 ? (
	                <div style={{ color: '#bbb' }}>
	                  No title pages uploaded yet. <a href="/uploads/new?kind=image&imageRole=title_page" style={{ color: '#9cf' }}>Upload a title page</a>.
	                </div>
	              ) : (
	                sortedTitlePages.map((t) => {
	                  const selected = selectedTitleUploadId === t.id
	                  const name = (t.modified_filename || t.original_filename || `Title ${t.id}`).trim()
	                  const src = `/api/uploads/${encodeURIComponent(String(t.id))}/file`
	                  const meta = [
	                    t.size_bytes != null ? formatBytes(t.size_bytes) : null,
	                    t.created_at ? formatDate(t.created_at) : null,
	                  ].filter(Boolean).join(' • ')
	                  return (
	                    <div
	                      key={t.id}
	                      style={{
	                        padding: '10px 12px 12px',
	                        borderRadius: 12,
	                        border: selected ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
	                        background: selected ? 'rgba(10,132,255,0.30)' : 'rgba(255,255,255,0.03)',
	                        display: 'grid',
	                        gap: 10,
	                      }}
	                    >
	                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
	                        <div style={{ fontWeight: 800, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
	                          {name}
	                        </div>
	                        <button
	                          type="button"
	                          onClick={() => chooseTitlePageFromPicker(t.id)}
	                          style={{
	                            padding: '8px 12px',
	                            borderRadius: 10,
	                            border: selected ? '1px solid rgba(255,255,255,0.85)' : '1px solid rgba(212,175,55,0.55)',
	                            background: selected ? 'transparent' : 'rgba(212,175,55,0.10)',
	                            color: selected ? '#fff' : '#d4af37',
	                            fontWeight: 800,
	                            cursor: 'pointer',
	                            flexShrink: 0,
	                          }}
	                        >
	                          {selected ? 'Selected' : 'Select'}
	                        </button>
	                      </div>

	                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
	                        <img src={src} alt="title page" style={{ width: 160, height: 90, objectFit: 'cover', background: '#111', borderRadius: 10 }} />
	                        <div style={{ minWidth: 0 }}>
	                          {meta ? <div style={{ color: '#888', fontSize: 13 }}>{meta}</div> : null}
	                          <div style={{ marginTop: 6, color: '#777', fontSize: 13 }}>
	                            Tip: choose a title page and a hold duration to create a title intro.
	                          </div>
	                        </div>
	                      </div>
	                    </div>
	                  )
	                })
	              )}
	            </div>
	          </div>
	        </div>
	      ) : pick === 'lowerThirdImage' ? (
	        <div
	          role="dialog"
	          aria-modal="true"
	          style={{
	            position: 'fixed',
	            inset: 0,
	            background: '#050505',
	            color: '#fff',
	            zIndex: 10050,
	            overflow: 'auto',
	          }}
	        >
	          <div style={{ maxWidth: 960, margin: '0 auto', padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px max(24px, env(safe-area-inset-bottom, 0px))' }}>
	            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
	              <button
	                type="button"
	                onClick={() => {
	                  const modal = (window.history.state as any)?.modal
	                  if (modal === 'lowerThirdImagePicker') {
	                    try { window.history.back(); return } catch {}
	                  }
	                  closePicker()
	                }}
	                style={{
	                  padding: '10px 12px',
	                  borderRadius: 10,
	                  border: '1px solid rgba(255,255,255,0.18)',
	                  background: '#0c0c0c',
	                  color: '#fff',
	                  fontWeight: 700,
	                  cursor: 'pointer',
	                }}
	              >
	                ← Back
	              </button>
	              <div style={{ fontSize: 18, fontWeight: 800 }}>Choose Lower Third Image</div>
	              <div style={{ width: 84 }} />
	            </div>

	            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
	              <a href="/uploads?kind=image&image_role=lower_third" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13, marginLeft: 'auto' }}>Manage images</a>
	            </div>

	            <div style={{ display: 'grid', gap: 10 }}>
	              <button
	                type="button"
	                onClick={() => chooseLowerThirdImageFromPicker(null)}
	                style={{
	                  textAlign: 'left',
	                  padding: 12,
	                  borderRadius: 12,
	                  border: selectedLowerThirdUploadId == null ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
	                  background: selectedLowerThirdUploadId == null ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.03)',
	                  color: '#fff',
	                  cursor: 'pointer',
	                }}
	              >
	                None
	              </button>

	              {assetsLoading ? (
	                <div style={{ color: '#888' }}>Loading lower third images…</div>
	              ) : assetsError ? (
	                <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
	              ) : sortedLowerThirdImages.length === 0 ? (
	                <div style={{ color: '#bbb' }}>
	                  No lower third images yet. <a href="/uploads/new?kind=image&image_role=lower_third" style={{ color: '#9cf' }}>Upload a PNG</a>.
	                </div>
	              ) : (
	                sortedLowerThirdImages.map((img) => {
	                  const selected = selectedLowerThirdUploadId === img.id
	                  const name = (img.modified_filename || img.original_filename || `Image ${img.id}`).trim()
	                  const src = `/api/uploads/${encodeURIComponent(String(img.id))}/file`
	                  const meta = [img.size_bytes != null ? formatBytes(img.size_bytes) : null, img.created_at ? formatDate(img.created_at) : null]
	                    .filter(Boolean)
	                    .join(' • ')
	                  return (
	                    <div
	                      key={img.id}
	                      style={{
	                        padding: '10px 12px 12px',
	                        borderRadius: 12,
	                        border: selected ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
	                        background: selected ? 'rgba(10,132,255,0.30)' : 'rgba(255,255,255,0.03)',
	                        display: 'grid',
	                        gap: 10,
	                      }}
	                    >
	                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
	                        <div style={{ fontWeight: 800, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
	                          {name}
	                        </div>
	                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
	                          <button
	                            type="button"
	                            onClick={() => openLowerThirdAbout(img)}
	                            style={{
	                              padding: '8px 12px',
	                              borderRadius: 10,
	                              border: '1px solid rgba(255,255,255,0.18)',
	                              background: '#0c0c0c',
	                              color: '#fff',
	                              fontWeight: 700,
	                              cursor: 'pointer',
	                            }}
	                          >
	                            About
	                          </button>
	                          <button
	                            type="button"
	                            onClick={() => chooseLowerThirdImageFromPicker(img.id)}
	                            style={{
	                              padding: '8px 12px',
	                              borderRadius: 10,
	                              border: selected ? '1px solid rgba(255,255,255,0.85)' : '1px solid rgba(212,175,55,0.55)',
	                              background: selected ? 'transparent' : 'rgba(212,175,55,0.10)',
	                              color: selected ? '#fff' : '#d4af37',
	                              fontWeight: 800,
	                              cursor: 'pointer',
	                              flexShrink: 0,
	                            }}
	                          >
	                            {selected ? 'Selected' : 'Select'}
	                          </button>
	                        </div>
	                      </div>
	                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
	                        <img src={src} alt="lower third" style={{ width: 220, height: 60, objectFit: 'cover', background: '#111', borderRadius: 10 }} />
	                        <div style={{ color: '#888', fontSize: 13 }}>{meta}</div>
	                      </div>
	                    </div>
	                  )
	                })
	              )}
	            </div>
	          </div>
	        </div>
	      ) : pick === 'lowerThirdConfig' ? (
	        <div
	          role="dialog"
	          aria-modal="true"
	          style={{
	            position: 'fixed',
	            inset: 0,
	            background: '#050505',
	            color: '#fff',
	            zIndex: 10050,
	            overflow: 'auto',
	          }}
	        >
	          <div style={{ maxWidth: 960, margin: '0 auto', padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px max(24px, env(safe-area-inset-bottom, 0px))' }}>
	            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
	              <button
	                type="button"
	                onClick={() => {
	                  const modal = (window.history.state as any)?.modal
	                  if (modal === 'lowerThirdConfigPicker') {
	                    try { window.history.back(); return } catch {}
	                  }
	                  closePicker()
	                }}
	                style={{
	                  padding: '10px 12px',
	                  borderRadius: 10,
	                  border: '1px solid rgba(255,255,255,0.18)',
	                  background: '#0c0c0c',
	                  color: '#fff',
	                  fontWeight: 700,
	                  cursor: 'pointer',
	                }}
	              >
	                ← Back
	              </button>
	              <div style={{ fontSize: 18, fontWeight: 800 }}>Choose Lower Third Config</div>
	              <div style={{ width: 84 }} />
	            </div>

	            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
	              <a href={`/lower-thirds?from=${fromHere}`} style={{ color: '#9cf', textDecoration: 'none', fontSize: 13, marginLeft: 'auto' }}>Manage configs</a>
	            </div>

	            <div style={{ display: 'grid', gap: 10 }}>
	              <button
	                type="button"
	                onClick={() => chooseLowerThirdConfigFromPicker(null)}
	                style={{
	                  textAlign: 'left',
	                  padding: 12,
	                  borderRadius: 12,
	                  border: selectedLowerThirdConfigId == null ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
	                  background: selectedLowerThirdConfigId == null ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.03)',
	                  color: '#fff',
	                  cursor: 'pointer',
	                }}
	              >
	                None
	              </button>

	              {assetsLoading ? (
	                <div style={{ color: '#888' }}>Loading lower third configs…</div>
	              ) : assetsError ? (
	                <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
	              ) : lowerThirdConfigs.length === 0 ? (
	                <div style={{ color: '#bbb' }}>
	                  No lower third configs yet. <a href={`/lower-thirds?from=${fromHere}`} style={{ color: '#9cf' }}>Create a preset</a>.
	                </div>
	              ) : (
	                lowerThirdConfigs.map((c) => {
	                  const selected = selectedLowerThirdConfigId === c.id
	                  const name = (c.name || `Config ${c.id}`).trim()
	                  const meta = formatLowerThirdConfigSummary(c)
	                  return (
	                    <div
	                      key={c.id}
	                      style={{
	                        padding: '10px 12px 12px',
	                        borderRadius: 12,
	                        border: selected ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
	                        background: selected ? 'rgba(10,132,255,0.30)' : 'rgba(255,255,255,0.03)',
	                        display: 'grid',
	                        gap: 6,
	                      }}
	                    >
	                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
	                        <div style={{ minWidth: 0 }}>
	                          <div style={{ fontWeight: 800, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
	                            {name}
	                          </div>
	                        {meta ? (
	                          <div style={{ marginTop: 2, color: '#888', fontSize: 13, lineHeight: 1.25 }}>
	                            {meta}
	                          </div>
	                        ) : null}
	                      </div>
	                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
	                          <button
	                            type="button"
	                            onClick={() => openLowerThirdConfigAbout(c)}
	                            style={{
	                              padding: '8px 12px',
	                              borderRadius: 10,
	                              border: '1px solid rgba(255,255,255,0.18)',
	                              background: '#0c0c0c',
	                              color: '#fff',
	                              fontWeight: 700,
	                              cursor: 'pointer',
	                            }}
	                          >
	                            About
	                          </button>
	                          <button
	                            type="button"
	                            onClick={() => chooseLowerThirdConfigFromPicker(c.id)}
	                            style={{
	                              padding: '8px 12px',
	                              borderRadius: 10,
	                              border: selected ? '1px solid rgba(255,255,255,0.85)' : '1px solid rgba(212,175,55,0.55)',
	                              background: selected ? 'transparent' : 'rgba(212,175,55,0.10)',
	                              color: selected ? '#fff' : '#d4af37',
	                              fontWeight: 800,
	                              cursor: 'pointer',
	                              flexShrink: 0,
	                            }}
	                          >
	                            {selected ? 'Selected' : 'Select'}
	                          </button>
	                        </div>
	                      </div>
	                    </div>
	                  )
	                })
	              )}
	            </div>
	          </div>
	        </div>
	      ) : pick === 'logo' ? (
	        <div
	          role="dialog"
	          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: '#050505',
            color: '#fff',
            zIndex: 10050,
            overflow: 'auto',
          }}
        >
          <div style={{ maxWidth: 960, margin: '0 auto', padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px max(24px, env(safe-area-inset-bottom, 0px))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => {
                  const modal = (window.history.state as any)?.modal
                  if (modal === 'logoPicker') {
                    try { window.history.back(); return } catch {}
                  }
                  closePicker()
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Choose Logo</div>
              <div style={{ width: 84 }} />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ color: '#bbb', fontWeight: 700 }}>Sort</div>
              <button
                type="button"
                onClick={() => setLogoSort('recent')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: logoSort === 'recent' ? '#0a84ff' : '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Recent
              </button>
              <button
                type="button"
                onClick={() => setLogoSort('alpha')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: logoSort === 'alpha' ? '#0a84ff' : '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Alphabetical
              </button>
              <a href="/uploads?kind=logo" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13, marginLeft: 'auto' }}>Manage logos</a>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <button
                type="button"
                onClick={() => chooseLogoFromPicker(null)}
                style={{
                  textAlign: 'left',
                  padding: 12,
                  borderRadius: 12,
                  border: selectedLogoId == null ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
                  background: selectedLogoId == null ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.03)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                None
              </button>

              {assetsLoading ? (
                <div style={{ color: '#888' }}>Loading logos…</div>
              ) : assetsError ? (
                <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
              ) : sortedLogos.length === 0 ? (
                <div style={{ color: '#bbb' }}>
                  No logos uploaded yet. <a href="/uploads/new?kind=logo" style={{ color: '#9cf' }}>Upload a logo</a>.
                </div>
              ) : (
                sortedLogos.map((l) => {
                  const selected = selectedLogoId === l.id
                  const name = (l.modified_filename || l.original_filename || `Logo ${l.id}`).trim()
                  const src = `/api/uploads/${encodeURIComponent(String(l.id))}/file`
                  const meta = [
                    l.size_bytes != null ? formatBytes(l.size_bytes) : null,
                    l.created_at ? formatDate(l.created_at) : null,
                  ].filter(Boolean).join(' • ')
                  return (
                    <div
                      key={l.id}
                      style={{
                        padding: '10px 12px 12px',
                        borderRadius: 12,
                        border: selected ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
                        background: selected ? 'rgba(10,132,255,0.30)' : 'rgba(255,255,255,0.03)',
                        display: 'grid',
                        gap: 10,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ fontWeight: 800, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                          {name}
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => openLogoAbout(l)}
                            style={{
                              padding: '8px 12px',
                              borderRadius: 10,
                              border: '1px solid rgba(255,255,255,0.18)',
                              background: '#0c0c0c',
                              color: '#fff',
                              fontWeight: 700,
                              cursor: 'pointer',
                            }}
                          >
                            About
                          </button>
                          <button
                            type="button"
                            onClick={() => chooseLogoFromPicker(l.id)}
                            style={{
                              padding: '8px 12px',
                              borderRadius: 10,
                              border: selected ? '1px solid rgba(255,255,255,0.85)' : '1px solid rgba(212,175,55,0.55)',
                              background: selected ? 'transparent' : 'rgba(212,175,55,0.10)',
                              color: selected ? '#fff' : '#d4af37',
                              fontWeight: 800,
                              cursor: 'pointer',
                              flexShrink: 0,
                            }}
                          >
                            {selected ? 'Selected' : 'Select'}
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                        <img src={src} alt="logo" style={{ width: 96, height: 96, objectFit: 'contain', background: '#111', borderRadius: 10 }} />
                        <div style={{ minWidth: 0 }}>
                          {meta ? <div style={{ color: '#888', fontSize: 13 }}>{meta}</div> : null}
                          <div style={{ marginTop: 6, color: '#777', fontSize: 13 }}>
                            Tip: choose a logo and a logo config preset to apply a watermark.
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <a href="/uploads/new?kind=logo" style={{ color: '#9cf', textDecoration: 'none', fontWeight: 650 }}>
                              Upload logo
                            </a>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      ) : pick === 'logoConfig' ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: '#050505',
            color: '#fff',
            zIndex: 10050,
            overflow: 'auto',
          }}
        >
          <div style={{ maxWidth: 960, margin: '0 auto', padding: 'max(16px, env(safe-area-inset-top, 0px)) 16px max(24px, env(safe-area-inset-bottom, 0px))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <button
                type="button"
                onClick={() => {
                  const modal = (window.history.state as any)?.modal
                  if (modal === 'logoConfigPicker') {
                    try { window.history.back(); return } catch {}
                  }
                  closePicker()
                }}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              <div style={{ fontSize: 18, fontWeight: 800 }}>Choose Logo Config</div>
              <div style={{ width: 84 }} />
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ color: '#bbb', fontWeight: 700 }}>Sort</div>
              <button
                type="button"
                onClick={() => setLogoConfigSort('recent')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: logoConfigSort === 'recent' ? '#0a84ff' : '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Recent
              </button>
              <button
                type="button"
                onClick={() => setLogoConfigSort('alpha')}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: logoConfigSort === 'alpha' ? '#0a84ff' : '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Alphabetical
              </button>
              <a href={`/logo-configs?from=${fromHere}`} style={{ color: '#9cf', textDecoration: 'none', fontSize: 13, marginLeft: 'auto' }}>Manage configs</a>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <button
                type="button"
                onClick={() => chooseLogoConfigFromPicker(null)}
                style={{
                  textAlign: 'left',
                  padding: 12,
                  borderRadius: 12,
                  border: selectedLogoConfigId == null ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
                  background: selectedLogoConfigId == null ? 'rgba(10,132,255,0.35)' : 'rgba(255,255,255,0.03)',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                None
              </button>

              {assetsLoading ? (
                <div style={{ color: '#888' }}>Loading logo configurations…</div>
              ) : assetsError ? (
                <div style={{ color: '#ff9b9b' }}>{assetsError}</div>
              ) : sortedLogoConfigs.length === 0 ? (
                <div style={{ color: '#bbb' }}>
                  No logo configurations yet. <a href={`/logo-configs?from=${fromHere}`} style={{ color: '#9cf' }}>Create one</a>.
                </div>
              ) : (
                sortedLogoConfigs.map((c) => {
                  const selected = selectedLogoConfigId === c.id
                  const name = (c.name || `Config ${c.id}`).trim()
                  const summary = formatLogoConfigSummary(c)
                  return (
                    <div
                      key={c.id}
                      style={{
                        padding: '10px 12px 12px',
                        borderRadius: 12,
                        border: selected ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(212,175,55,0.65)',
                        background: selected ? 'rgba(10,132,255,0.30)' : 'rgba(255,255,255,0.03)',
                        display: 'grid',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 800, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}
                          </div>
                          {summary ? <div style={{ marginTop: 2, color: '#888', fontSize: 13, lineHeight: 1.25 }}>{summary}</div> : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => chooseLogoConfigFromPicker(c.id)}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 10,
                            border: selected ? '1px solid rgba(255,255,255,0.85)' : '1px solid rgba(212,175,55,0.55)',
                            background: selected ? 'transparent' : 'rgba(212,175,55,0.10)',
                            color: selected ? '#fff' : '#d4af37',
                            fontWeight: 800,
                            cursor: 'pointer',
                            flexShrink: 0,
                          }}
                        >
                          {selected ? 'Selected' : 'Select'}
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
	      ) : null}

      {audioConfigAbout ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.0)',
            zIndex: 10060,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#0b0b0b',
              color: '#fff',
              boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
              <div style={{ fontWeight: 900, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {audioConfigAbout.title}
              </div>
              <button
                type="button"
                onClick={() => setAudioConfigAbout(null)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ padding: 14, color: 'rgba(255,255,255,0.82)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {audioConfigAbout.description && audioConfigAbout.description.trim().length ? audioConfigAbout.description : 'No description.'}
            </div>
          </div>
        </div>
      ) : null}

      {audioAbout ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.0)',
            zIndex: 10063,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#0b0b0b',
              color: '#fff',
              boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
              <div style={{ fontWeight: 900, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {audioAbout.title}
              </div>
              <button
                type="button"
                onClick={() => setAudioAbout(null)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ padding: 14, color: 'rgba(255,255,255,0.82)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {audioAbout.description && audioAbout.description.trim().length ? audioAbout.description : 'No description.'}
            </div>
          </div>
        </div>
      ) : null}

      {lowerThirdAbout ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.0)',
            zIndex: 10064,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#0b0b0b',
              color: '#fff',
              boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
              <div style={{ fontWeight: 900, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lowerThirdAbout.title}
              </div>
              <button
                type="button"
                onClick={() => setLowerThirdAbout(null)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ padding: 14, color: 'rgba(255,255,255,0.82)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {lowerThirdAbout.description && lowerThirdAbout.description.trim().length ? lowerThirdAbout.description : 'No description.'}
            </div>
          </div>
        </div>
      ) : null}

      {lowerThirdConfigAbout ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.0)',
            zIndex: 10065,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#0b0b0b',
              color: '#fff',
              boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
              <div style={{ fontWeight: 900, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {lowerThirdConfigAbout.title}
              </div>
              <button
                type="button"
                onClick={() => setLowerThirdConfigAbout(null)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ padding: 14, color: 'rgba(255,255,255,0.82)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {lowerThirdConfigAbout.description && lowerThirdConfigAbout.description.trim().length ? lowerThirdConfigAbout.description : 'No description.'}
            </div>
          </div>
        </div>
      ) : null}

      {logoConfigAbout ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.0)',
            zIndex: 10062,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#0b0b0b',
              color: '#fff',
              boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
              <div style={{ fontWeight: 900, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {logoConfigAbout.title}
              </div>
              <button
                type="button"
                onClick={() => setLogoConfigAbout(null)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ padding: 14, color: 'rgba(255,255,255,0.82)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {logoConfigAbout.description && logoConfigAbout.description.trim().length ? logoConfigAbout.description : 'No description.'}
            </div>
          </div>
        </div>
      ) : null}

      {logoAbout ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.0)',
            zIndex: 10061,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            style={{
              width: 'min(720px, 100%)',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#0b0b0b',
              color: '#fff',
              boxShadow: '0 20px 60px rgba(0,0,0,0.65)',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.10)' }}>
              <div style={{ fontWeight: 900, color: '#d4af37', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {logoAbout.title}
              </div>
              <button
                type="button"
                onClick={() => setLogoAbout(null)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: '#0c0c0c',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ padding: 14, color: 'rgba(255,255,255,0.82)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {logoAbout.description && logoAbout.description.trim().length ? logoAbout.description : 'No description.'}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
