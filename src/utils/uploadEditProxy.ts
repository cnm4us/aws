export function buildUploadEditProxyKey(uploadId: number): string {
  const id = Number(uploadId)
  return `proxies/uploads/${id}/edit_proxy.mp4`
}

