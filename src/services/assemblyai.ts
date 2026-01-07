type AssemblyAiTranscriptStatus = 'queued' | 'processing' | 'completed' | 'error'

type CreateTranscriptResponse = {
  id: string
  status?: AssemblyAiTranscriptStatus
  error?: string | null
}

type TranscriptStatusResponse = {
  id: string
  status: AssemblyAiTranscriptStatus
  error?: string | null
}

const BASE_URL = 'https://api.assemblyai.com/v2'

function getApiKey(): string {
  const key = String(process.env.ASSEMBLYAI_API_KEY || '').trim()
  if (!key) throw new Error('missing_assemblyai_api_key')
  return key
}

async function assemblyFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`
  const headers = new Headers(init?.headers || {})
  headers.set('authorization', getApiKey())
  if (!headers.has('content-type') && init?.body != null) headers.set('content-type', 'application/json')
  return fetch(url, { ...init, headers })
}

export async function createTranscript(audioUrl: string): Promise<{ id: string }> {
  const u = String(audioUrl || '').trim()
  if (!u) throw new Error('missing_audio_url')
  const res = await assemblyFetch('/transcript', {
    method: 'POST',
    body: JSON.stringify({
      audio_url: u,
      punctuate: true,
      format_text: true,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as CreateTranscriptResponse
  if (!res.ok) {
    throw new Error(String((data as any)?.error || (data as any)?.message || 'assemblyai_create_failed'))
  }
  const id = String(data?.id || '').trim()
  if (!id) throw new Error('assemblyai_missing_transcript_id')
  return { id }
}

export async function getTranscriptStatus(id: string): Promise<TranscriptStatusResponse> {
  const tid = String(id || '').trim()
  if (!tid) throw new Error('missing_transcript_id')
  const res = await assemblyFetch(`/transcript/${encodeURIComponent(tid)}`, { method: 'GET' })
  const data = (await res.json().catch(() => ({}))) as TranscriptStatusResponse
  if (!res.ok) {
    throw new Error(String((data as any)?.error || (data as any)?.message || 'assemblyai_status_failed'))
  }
  const status = String((data as any)?.status || '').trim() as AssemblyAiTranscriptStatus
  if (!status) throw new Error('assemblyai_missing_status')
  return {
    id: String((data as any)?.id || tid),
    status,
    error: (data as any)?.error != null ? String((data as any).error) : null,
  }
}

export async function waitForTranscript(
  id: string,
  opts: { pollIntervalMs: number; timeoutSeconds: number }
): Promise<{ status: 'completed' | 'error'; error?: string | null }> {
  const pollIntervalMs = Math.max(250, Math.min(30000, Math.round(Number(opts.pollIntervalMs) || 3000)))
  const timeoutMs = Math.max(1000, Math.min(24 * 3600 * 1000, Math.round(Number(opts.timeoutSeconds) * 1000) || 1800 * 1000))
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const st = await getTranscriptStatus(id)
    if (st.status === 'completed') return { status: 'completed' }
    if (st.status === 'error') return { status: 'error', error: st.error ?? null }
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
  return { status: 'error', error: 'timeout' }
}

export async function fetchVtt(id: string): Promise<string> {
  const tid = String(id || '').trim()
  if (!tid) throw new Error('missing_transcript_id')
  const res = await assemblyFetch(`/transcript/${encodeURIComponent(tid)}/vtt`, { method: 'GET' })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(text.trim() || 'assemblyai_vtt_failed')
  }
  const body = String(text || '')
  if (!body.trim()) throw new Error('assemblyai_empty_vtt')
  return body
}

