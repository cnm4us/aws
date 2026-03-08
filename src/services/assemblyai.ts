import { withExternalHttpSpan } from '../lib/externalObservability'

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

type ObsAttrValue = string | number | boolean
type ObsAttrs = Record<string, ObsAttrValue | null | undefined>
export type AssemblyAiTelemetryContext = {
  attrs?: ObsAttrs
}

function getApiKey(): string {
  const key = String(process.env.ASSEMBLYAI_API_KEY || '').trim()
  if (!key) throw new Error('missing_assemblyai_api_key')
  return key
}

async function assemblyFetch(
  op: { spanName: string; operation: string; appOperation: string },
  path: string,
  init?: RequestInit,
  telemetry?: AssemblyAiTelemetryContext
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`
  const headers = new Headers(init?.headers || {})
  headers.set('authorization', getApiKey())
  if (!headers.has('content-type') && init?.body != null) headers.set('content-type', 'application/json')
  return withExternalHttpSpan(
    {
      spanName: op.spanName,
      provider: 'assemblyai',
      operation: op.operation,
      attrs: {
        ...(telemetry?.attrs || {}),
        'app.operation': op.appOperation,
      },
    },
    () => fetch(url, { ...init, headers })
  )
}

export async function createTranscript(audioUrl: string, telemetry?: AssemblyAiTelemetryContext): Promise<{ id: string }> {
  const u = String(audioUrl || '').trim()
  if (!u) throw new Error('missing_audio_url')
  const res = await assemblyFetch(
    {
      spanName: 'external.assemblyai.transcript.create',
      operation: 'transcript.create',
      appOperation: 'external.assemblyai.transcript.create',
    },
    '/transcript',
    {
      method: 'POST',
      body: JSON.stringify({
        audio_url: u,
        punctuate: true,
        format_text: true,
      }),
    },
    telemetry
  )
  const data = (await res.json().catch(() => ({}))) as CreateTranscriptResponse
  if (!res.ok) {
    throw new Error(String((data as any)?.error || (data as any)?.message || 'assemblyai_create_failed'))
  }
  const id = String(data?.id || '').trim()
  if (!id) throw new Error('assemblyai_missing_transcript_id')
  return { id }
}

export async function getTranscriptStatus(id: string, telemetry?: AssemblyAiTelemetryContext): Promise<TranscriptStatusResponse> {
  const tid = String(id || '').trim()
  if (!tid) throw new Error('missing_transcript_id')
  const res = await assemblyFetch(
    {
      spanName: 'external.assemblyai.transcript.status.get',
      operation: 'transcript.status.get',
      appOperation: 'external.assemblyai.transcript.status.get',
    },
    `/transcript/${encodeURIComponent(tid)}`,
    { method: 'GET' },
    telemetry
  )
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
  opts: { pollIntervalMs: number; timeoutSeconds: number },
  telemetry?: AssemblyAiTelemetryContext
): Promise<{ status: 'completed' | 'error'; error?: string | null }> {
  const pollIntervalMs = Math.max(250, Math.min(30000, Math.round(Number(opts.pollIntervalMs) || 3000)))
  const timeoutMs = Math.max(1000, Math.min(24 * 3600 * 1000, Math.round(Number(opts.timeoutSeconds) * 1000) || 1800 * 1000))
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const st = await getTranscriptStatus(id, telemetry)
    if (st.status === 'completed') return { status: 'completed' }
    if (st.status === 'error') return { status: 'error', error: st.error ?? null }
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }
  return { status: 'error', error: 'timeout' }
}

export async function fetchVtt(id: string, telemetry?: AssemblyAiTelemetryContext): Promise<string> {
  const tid = String(id || '').trim()
  if (!tid) throw new Error('missing_transcript_id')
  const res = await assemblyFetch(
    {
      spanName: 'external.assemblyai.transcript.vtt.get',
      operation: 'transcript.vtt.get',
      appOperation: 'external.assemblyai.transcript.vtt.get',
    },
    `/transcript/${encodeURIComponent(tid)}/vtt`,
    { method: 'GET' },
    telemetry
  )
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(text.trim() || 'assemblyai_vtt_failed')
  }
  const body = String(text || '')
  if (!body.trim()) throw new Error('assemblyai_empty_vtt')
  return body
}
