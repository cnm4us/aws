import { PutObjectCommand } from '@aws-sdk/client-s3'
import fs from 'fs'
import { s3 } from '../s3'

export async function uploadTextToS3(bucket: string, key: string, text: string, contentType = 'text/plain; charset=utf-8') {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: Buffer.from(text || '', 'utf8'),
      ContentType: contentType,
      CacheControl: 'no-store',
    })
  )
  return { bucket, key }
}

export async function uploadFileToS3(bucket: string, key: string, filePath: string, contentType = 'text/plain; charset=utf-8') {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
      CacheControl: 'no-store',
    })
  )
  return { bucket, key }
}

