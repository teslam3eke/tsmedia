/** 生活照 AI 審核（上傳前呼叫 /api/verify-life-photo） */

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export type VerifyLifePhotoResult =
  | { ok: true; message: string }
  | { ok: false; message: string }

/** 壓縮後再送審，降低 Vision token 用量（與 uploadPhoto 相同上限） */
async function compressForVerify(file: File, maxPx = 1080, quality = 0.85): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const { naturalWidth: w, naturalHeight: h } = img
      const scale = Math.min(1, maxPx / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file)
            return
          }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
        },
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(file)
    }
    img.src = objectUrl
  })
}

export async function verifyLifePhotoFile(file: File): Promise<VerifyLifePhotoResult> {
  const compressed = await compressForVerify(file)
  return verifyLifePhotoCompressed(compressed)
}

export async function verifyLifePhotoCompressed(file: File): Promise<VerifyLifePhotoResult> {
  try {
    const imageBase64 = await fileToDataUrl(file)
    const res = await fetch('/api/verify-life-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64 }),
    })
    const data = (await res.json()) as { ok?: boolean; message?: string }
    if (!res.ok) {
      return { ok: false, message: data.message ?? '照片審核失敗，請稍後再試' }
    }
    if (!data.ok) {
      return { ok: false, message: data.message ?? '此照片不符合生活照要求，請重新選擇' }
    }
    return { ok: true, message: data.message ?? 'OK' }
  } catch {
    return { ok: false, message: '照片審核失敗，請檢查網路後再試' }
  }
}
