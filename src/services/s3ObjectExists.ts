import { HeadObjectCommand } from '@aws-sdk/client-s3'
import { trace } from '@opentelemetry/api'

type AttrValue = string | number | boolean
type AttrRecord = Record<string, AttrValue | null | undefined>

function cleanAttrs(input: AttrRecord): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {}
  for (const [k, v] of Object.entries(input || {})) {
    if (v == null) continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v
  }
  return out
}

function annotateActiveSpan(attrs: AttrRecord) {
  const span = trace.getActiveSpan()
  if (!span) return
  span.setAttributes(cleanAttrs(attrs))
}

function isMissingObjectError(err: any): boolean {
  const status = Number(err?.$metadata?.httpStatusCode || 0)
  const name = String(err?.name || err?.Code || '')
  return status === 404 || name === 'NotFound' || name === 'NoSuchKey'
}

export async function s3ObjectExists(input: {
  s3: { send: (command: any) => Promise<any> }
  bucket: string
  key: string
  objectKind?: string
  attrs?: AttrRecord
}): Promise<{ exists: boolean; missingExpected: boolean }> {
  const bucket = String(input.bucket || '').trim()
  const key = String(input.key || '').trim()
  if (!bucket || !key) throw new Error('missing_s3_pointer')

  const baseAttrs: AttrRecord = {
    storage_backend: 's3',
    storage_check: 'head_object',
    storage_object_kind: input.objectKind || undefined,
    storage_bucket: bucket,
    ...(input.attrs || {}),
  }

  try {
    await input.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
    annotateActiveSpan({
      ...baseAttrs,
      storage_exists: true,
      storage_missing_expected: false,
      storage_lookup_result: 'exists',
    })
    return { exists: true, missingExpected: false }
  } catch (err: any) {
    if (isMissingObjectError(err)) {
      annotateActiveSpan({
        ...baseAttrs,
        storage_exists: false,
        storage_missing_expected: true,
        storage_lookup_result: 'missing_expected',
      })
      return { exists: false, missingExpected: true }
    }
    annotateActiveSpan({
      ...baseAttrs,
      storage_exists: false,
      storage_missing_expected: false,
      storage_lookup_result: 'error_unexpected',
    })
    throw err
  }
}

