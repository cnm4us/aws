import { randomUUID } from 'crypto'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { s3 } from '../../services/s3'
import { AWS_REGION, CLOUDFRONT_DOMAIN, OUTPUT_BUCKET } from '../../config'
import { sanitizeFilename, pickExtension } from '../../utils/naming'
import * as profilesService from './service'

const AVATAR_PREFIX_ROOT = 'profiles/avatars'
const MAX_AVATAR_MB = 5

function buildAvatarKey(userId: number, filename: string, contentType?: string): string {
  const safe = sanitizeFilename(filename)
  const ext = pickExtension(contentType, safe)
  const now = new Date()
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const uuid = randomUUID()
  return `${AVATAR_PREFIX_ROOT}/${userId}/${ym}/${uuid}${ext}`
}

function buildPublicUrl(key: string): string {
  if (CLOUDFRONT_DOMAIN) {
    return `https://${CLOUDFRONT_DOMAIN}/${key}`
  }
  const region = AWS_REGION
  return `https://${OUTPUT_BUCKET}.s3.${region}.amazonaws.com/${key}`
}

export async function createSignedAvatarUpload(userId: number, input: { filename: string; contentType?: string; sizeBytes?: number }) {
  const filename = String(input.filename || '').trim()
  if (!filename) throw new Error('filename_required')
  const contentType = input.contentType
  const maxBytes = Math.max(1, MAX_AVATAR_MB * 1024 * 1024)
  const key = buildAvatarKey(userId, filename, contentType)
  const prefixForUser = `${AVATAR_PREFIX_ROOT}/${userId}/`

  const conditions: any[] = [
    ['content-length-range', 1, maxBytes],
    ['starts-with', '$key', prefixForUser],
  ]
  const fields: Record<string, string> = {
    key,
    success_action_status: '201',
  }
  if (contentType) fields['Content-Type'] = contentType
  fields['x-amz-meta-original-filename'] = filename

  const presigned = await createPresignedPost(s3, {
    Bucket: OUTPUT_BUCKET,
    Key: key,
    Conditions: conditions,
    Fields: fields,
    Expires: 60 * 5,
  })

  const url = buildPublicUrl(key)
  return { bucket: OUTPUT_BUCKET, key, url, post: presigned }
}

export async function finalizeAvatar(userId: number, key: string, fallbackDisplayName?: string | null) {
  const expectedPrefix = `${AVATAR_PREFIX_ROOT}/${userId}/`
  if (!key || !key.startsWith(expectedPrefix)) {
    throw new Error('invalid_avatar_key')
  }
  const url = buildPublicUrl(key)
  const existing = await profilesService.getProfile(userId)
  if (existing) {
    await profilesService.updateProfile(userId, { avatarUrl: url })
  } else {
    const nameFromFallback = (fallbackDisplayName || '').trim()
    const displayName = nameFromFallback || `User ${userId}`
    await profilesService.upsertProfile(userId, { displayName, avatarUrl: url })
  }
  return { ok: true, url }
}
