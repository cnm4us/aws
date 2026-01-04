export function buildUploadThumbKey(uploadId: number): string {
  const id = Number(uploadId)
  return `thumbs/uploads/${id}/thumb.jpg`
}

