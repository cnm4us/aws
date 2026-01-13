export function buildUploadAudioEnvelopeKey(uploadId: number): string {
  const id = Number(uploadId)
  return `proxies/uploads/${id}/audio/audio_envelope_v2.json`
}
