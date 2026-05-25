import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, Camera, ImageIcon, Trash2, Upload, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { clickFileInputWithGrace } from '@/lib/resumeHardReload'
import {
  getLifePhotoVerifyFailureStatus,
  verifyAndUploadLifePhoto,
  type LifePhotoFailureStatus,
} from '@/lib/lifePhotoUpload'
import { PROFILE_PHOTO_MAX, PROFILE_PHOTO_MIN } from '@/lib/types'
import { resolvePhotoUrls } from '@/lib/db'
import { LifePhotoPreviewTile } from '@/components/LifePhotoPreviewTile'

export type LifePhotoSlot = {
  id: string
  previewUrl: string
  storagePath: string
}

type Props = {
  userId: string
  photos: LifePhotoSlot[]
  onPhotosChange: (photos: LifePhotoSlot[]) => void
  /** 單張上傳成功後（例如自動儲存個人檔案） */
  onUploadSuccess?: (photos: LifePhotoSlot[]) => void | Promise<void>
}

const UPLOAD_HINT = '必須為露臉之正面獨照，每個帳號每日最多嘗試 10 次'

export function LifePhotoUploadSection({
  userId,
  photos,
  onPhotosChange,
  onUploadSuccess,
}: Props) {
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreview, setPendingPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [failureStatus, setFailureStatus] = useState<LifePhotoFailureStatus | null>(null)
  const [rejectReason, setRejectReason] = useState<string | null>(null)

  const refreshFailureStatus = () => {
    void getLifePhotoVerifyFailureStatus().then(setFailureStatus)
  }

  useEffect(() => {
    refreshFailureStatus()
  }, [])

  useEffect(() => {
    return () => {
      if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    }
  }, [pendingPreview])

  const clearPending = () => {
    if (pendingPreview) URL.revokeObjectURL(pendingPreview)
    setPendingFile(null)
    setPendingPreview(null)
  }

  const onPickPhoto = (files: FileList | null) => {
    if (!files?.length || uploading) return
    if (failureStatus?.limited) {
      setRejectReason(
        `今日生活照審核失敗已達 10 次，請明日再試（每晚 10 點換日）。`,
      )
      return
    }
    if (photos.length >= PROFILE_PHOTO_MAX) return

    const file = files[0]
    if (!file.type.startsWith('image/')) {
      setRejectReason('請選擇圖片檔案（JPG、PNG、HEIC 等）。')
      return
    }

    clearPending()
    setPendingFile(file)
    setPendingPreview(URL.createObjectURL(file))
    setRejectReason(null)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  const handleUpload = async () => {
    if (!pendingFile || uploading) return
    if (failureStatus?.limited) {
      setRejectReason(`今日生活照審核失敗已達 10 次，請明日再試（每晚 10 點換日）。`)
      return
    }

    setUploading(true)
    setRejectReason(null)

    const result = await verifyAndUploadLifePhoto(userId, pendingFile)
    refreshFailureStatus()

    if (!result.ok) {
      setUploading(false)
      setRejectReason(result.error)
      if (result.limited) clearPending()
      return
    }

    let signedPreview = pendingPreview ?? ''
    try {
      const [signed] = await resolvePhotoUrls([result.path])
      if (signed) signedPreview = signed
    } catch {
      /* 沿用 blob 預覽 */
    }

    const next: LifePhotoSlot[] = [
      ...photos,
      {
        id: `uploaded-${Date.now()}`,
        previewUrl: signedPreview,
        storagePath: result.path,
      },
    ].slice(0, PROFILE_PHOTO_MAX)

    clearPending()
    onPhotosChange(next)
    setUploading(false)

    try {
      await onUploadSuccess?.(next)
    } catch {
      /* 上傳已成功；儲存失敗由外層處理 */
    }
  }

  const removePhoto = (id: string) => {
    onPhotosChange(photos.filter((p) => p.id !== id))
  }

  const canPickMore = photos.length < PROFILE_PHOTO_MAX && !pendingFile
  const remaining = failureStatus?.remaining ?? 10

  return (
    <div className="space-y-3">
      <p className="text-xs text-amber-700 bg-amber-50 ring-1 ring-amber-100 rounded-xl px-3 py-2.5 leading-relaxed font-medium">
        {UPLOAD_HINT}
        {failureStatus != null && (
          <span className="block mt-1 text-amber-600/90 font-normal">
            今日剩餘 {remaining} 次審核機會
            {failureStatus.limited ? '（已達上限，請明日再試）' : ''}
          </span>
        )}
      </p>

      <AnimatePresence>
        {rejectReason && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="rounded-2xl bg-rose-50 ring-1 ring-rose-100 p-4 flex gap-3"
            role="alert"
          >
            <AlertCircle className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-rose-800">照片未通過審核</p>
              <p className="text-xs text-rose-700 mt-1 leading-relaxed">{rejectReason}</p>
            </div>
            <button
              type="button"
              onClick={() => setRejectReason(null)}
              className="w-8 h-8 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0"
              aria-label="關閉"
            >
              <X className="w-4 h-4 text-rose-600" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="relative">
              <LifePhotoPreviewTile photoUrl={photo.previewUrl} showUploadedBadge />
              <button
                type="button"
                onClick={() => removePhoto(photo.id)}
                className="absolute top-1.5 right-1.5 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 backdrop-blur"
              >
                <Trash2 className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}

          {canPickMore && !pendingFile && (
            <button
              type="button"
              onClick={() => clickFileInputWithGrace(photoInputRef.current)}
              disabled={failureStatus?.limited}
              className={cn(
                'aspect-square rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1 bg-white transition-colors',
                failureStatus?.limited
                  ? 'border-slate-100 text-slate-200'
                  : 'border-slate-200 hover:border-slate-400',
              )}
            >
              <Camera className="w-5 h-5 text-slate-300" />
              <span className="text-[10px] text-slate-300 font-medium">新增</span>
            </button>
          )}
        </div>
      )}

      {pendingFile && pendingPreview && (
        <div className="bg-white rounded-3xl p-4 shadow-sm ring-1 ring-slate-100 space-y-3">
          <div className="relative aspect-[4/5] max-h-72 mx-auto rounded-2xl overflow-hidden bg-slate-100">
            <img
              src={pendingPreview}
              alt="待上傳預覽"
              className="w-full h-full object-cover scale-110"
              style={{ filter: 'blur(6px)' }}
            />
            <div className="absolute inset-0 bg-black/10" />
            <div className="absolute left-3 right-3 bottom-3 rounded-xl bg-white/85 backdrop-blur-sm px-3 py-2">
              <p className="text-[11px] font-semibold text-slate-700 text-center">確認後按下方上傳</p>
            </div>
            <button
              type="button"
              onClick={clearPending}
              disabled={uploading}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center"
            >
              <X className="w-4 h-4 text-white" />
            </button>
          </div>

          <motion.button
            type="button"
            whileTap={{ scale: uploading ? 1 : 0.98 }}
            onClick={() => void handleUpload()}
            disabled={uploading || failureStatus?.limited}
            className={cn(
              'w-full py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all',
              uploading || failureStatus?.limited
                ? 'bg-slate-100 text-slate-400'
                : 'bg-slate-900 text-white shadow-md shadow-slate-900/15',
            )}
          >
            <Upload className="w-4 h-4" />
            {uploading ? '審核並上傳中…' : '上傳這張照片'}
          </motion.button>
        </div>
      )}

      {photos.length === 0 && !pendingFile && (
        <button
          type="button"
          onClick={() => clickFileInputWithGrace(photoInputRef.current)}
          disabled={failureStatus?.limited}
          className={cn(
            'w-full rounded-3xl p-8 shadow-sm ring-1 flex flex-col items-center gap-3 transition-all',
            failureStatus?.limited
              ? 'bg-slate-50 ring-slate-100 opacity-60'
              : 'bg-white ring-slate-100 hover:ring-slate-300',
          )}
        >
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center">
            <ImageIcon className="w-7 h-7 text-slate-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-700">選擇生活照</p>
            <p className="text-xs text-slate-400 mt-1">
              選擇後按「上傳」 · 至少 {PROFILE_PHOTO_MIN} 張、最多 {PROFILE_PHOTO_MAX} 張
            </p>
          </div>
        </button>
      )}

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPickPhoto(e.target.files)}
      />

      <div className="bg-white rounded-2xl p-4 shadow-sm ring-1 ring-slate-100">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">已上傳</span>
          <span
            className={cn(
              'text-xs font-bold',
              photos.length >= PROFILE_PHOTO_MIN ? 'text-emerald-500' : 'text-slate-400',
            )}
          >
            {photos.length} / {PROFILE_PHOTO_MAX} 張
            {photos.length >= PROFILE_PHOTO_MIN ? ' ✓ 符合要求' : `（需要至少 ${PROFILE_PHOTO_MIN} 張）`}
          </span>
        </div>
        <div className="flex gap-1 mt-2">
          {Array.from({ length: PROFILE_PHOTO_MAX }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              className={cn(
                'flex-1 h-1.5 rounded-full transition-all duration-300',
                n <= photos.length ? 'bg-emerald-400' : 'bg-slate-100',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export { UPLOAD_HINT as LIFE_PHOTO_UPLOAD_HINT }
