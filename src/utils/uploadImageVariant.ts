import { IMAGE_VARIANTS_STORAGE_PREFIX, type ImageVariantFormat } from '../config'

function normalizePrefix(raw: string): string {
  const clean = String(raw || '').replace(/^\/+/, '').replace(/\/+/g, '/')
  if (!clean) return ''
  return clean.endsWith('/') ? clean : `${clean}/`
}

export function buildUploadImageVariantKey(uploadId: number, profileKey: string, format: ImageVariantFormat): string {
  const id = Math.max(1, Math.round(Number(uploadId) || 0))
  const key = String(profileKey || '').trim()
  if (!key) throw new Error('invalid_profile_key')
  const ext = format === 'png' ? 'png' : 'webp'
  return `${normalizePrefix(IMAGE_VARIANTS_STORAGE_PREFIX)}${id}/${key}.${ext}`
}
