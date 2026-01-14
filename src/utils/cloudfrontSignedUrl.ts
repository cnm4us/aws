import crypto from 'crypto'

export function cloudFrontSafeBase64(rawB64: string): string {
  // CloudFront expects URL-safe base64 substitutions:
  // + => -, = => _, / => ~
  return String(rawB64 || '')
    .replace(/\+/g, '-')
    .replace(/=/g, '_')
    .replace(/\//g, '~')
}

function normalizePem(pem: string): string {
  // Keep the exact PEM boundaries; strip leading/trailing whitespace only.
  return String(pem || '').trim() + '\n'
}

export function buildCloudFrontSignedUrl(opts: {
  url: string
  keyPairId: string
  privateKeyPem: string
  expiresEpochSeconds: number
}): string {
  const url = String(opts.url || '').trim()
  const keyPairId = String(opts.keyPairId || '').trim()
  const privateKeyPem = normalizePem(String(opts.privateKeyPem || ''))
  const expires = Number(opts.expiresEpochSeconds)
  if (!url || !keyPairId || !privateKeyPem) throw new Error('missing_signing_config')
  if (!Number.isFinite(expires) || expires <= 0) throw new Error('bad_expires')

  const policy = JSON.stringify({
    Statement: [
      {
        Resource: url,
        Condition: { DateLessThan: { 'AWS:EpochTime': expires } },
      },
    ],
  })

  const signer = crypto.createSign('RSA-SHA1')
  signer.update(policy)
  signer.end()
  const signatureB64 = signer.sign(privateKeyPem, 'base64')
  const signature = cloudFrontSafeBase64(signatureB64)

  const u = new URL(url)
  u.searchParams.set('Expires', String(expires))
  u.searchParams.set('Signature', signature)
  u.searchParams.set('Key-Pair-Id', keyPairId)
  return u.toString()
}

