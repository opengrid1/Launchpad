/**
 * Client-side image → compact data URL.
 *
 * The token's metadata (including its image) is stored on-chain in the token
 * contract, so the encoded image must stay small or the launch transaction's gas
 * exceeds the block limit. We downscale to a logo-sized thumbnail and step the
 * quality down until the data URL fits the byte budget.
 */
export async function compressImage(file: File, maxDim = 128, maxChars = 10_000): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    ctx.drawImage(bitmap, 0, 0, w, h)

    const type = canvas.toDataURL('image/webp', 0.7).startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
    let quality = 0.8
    let url = canvas.toDataURL(type, quality)
    while (url.length > maxChars && quality > 0.28) {
      quality -= 0.12
      url = canvas.toDataURL(type, quality)
    }
    if (url.length > maxChars) throw new Error('Image too detailed — try a simpler logo')
    return url
  } finally {
    bitmap.close()
  }
}
