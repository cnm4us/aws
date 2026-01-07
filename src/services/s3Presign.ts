import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3 } from './s3'

export async function presignGetObjectUrl(input: { bucket: string; key: string; expiresInSeconds: number }): Promise<string> {
  const bucket = String(input.bucket || '').trim()
  const key = String(input.key || '').trim().replace(/^\/+/, '')
  if (!bucket) throw new Error('missing_bucket')
  if (!key) throw new Error('missing_key')

  const expiresIn = Math.max(1, Math.min(86400, Math.round(Number(input.expiresInSeconds) || 3600)))
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key })
  return getSignedUrl(s3, cmd, { expiresIn })
}

