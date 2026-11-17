'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { useT } from '@/lib/i18n/client'
import {
  AVATAR_PICK_ACCEPT,
  AVATAR_ROTATION_STEP,
  AVATAR_ZOOM_MAX,
  AVATAR_ZOOM_MIN,
  AVATAR_ZOOM_STEP,
} from '@/lib/avatar/avatarConfig'
import { renderCroppedAvatar } from '@/lib/avatar/cropImage'

const FULL_ROTATION = 360
const INITIAL_CROP = { x: 0, y: 0 }
const BUTTON_BASE =
  'px-5 py-2 rounded-lg font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'

type AvatarCropDialogProps = {
  file: File
  saving: boolean
  error: string | null
  onSave: (blob: Blob) => void
  onCancel: () => void
  onReplaceFile: (file: File) => void
}

export function AvatarCropDialog({
  file,
  saving,
  error,
  onSave,
  onCancel,
  onReplaceFile,
}: AvatarCropDialogProps): React.JSX.Element {
  const { t } = useT()
  const p = t.settings.avatar
  const [src, setSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState(INITIAL_CROP)
  const [zoom, setZoom] = useState(AVATAR_ZOOM_MIN)
  const [rotation, setRotation] = useState(0)
  const [area, setArea] = useState<Area | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setSrc(url)
    setCrop(INITIAL_CROP)
    setZoom(AVATAR_ZOOM_MIN)
    setRotation(0)
    setArea(null)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !saving) onCancel()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onCancel, saving])

  const handleComplete = useCallback((_: Area, pixels: Area): void => setArea(pixels), [])

  const handleSave = async (): Promise<void> => {
    if (!src || !area) return
    setRenderError(null)
    try {
      onSave(await renderCroppedAvatar(src, area, rotation))
    } catch {
      setRenderError(p.errors.UNREADABLE)
    }
  }

  const handleDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    setDragOver(false)
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) onReplaceFile(dropped)
  }

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const picked = event.target.files?.[0]
    event.target.value = ''
    if (picked) onReplaceFile(picked)
  }

  const shownError = error ?? renderError

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 p-0 sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-dialog-title"
        tabIndex={-1}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl outline-none max-h-[100dvh] overflow-y-auto ${
          dragOver ? 'ring-2 ring-primary' : ''
        }`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2
            id="avatar-dialog-title"
            className="text-lg font-bold text-slate-900 dark:text-slate-100"
          >
            {p.dialogTitle}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            aria-label={p.close}
            className="size-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div
            role="group"
            aria-label={p.cropArea}
            className="relative w-full aspect-square rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-950"
          >
            {src && (
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                rotation={rotation}
                aspect={1}
                cropShape="round"
                showGrid={false}
                minZoom={AVATAR_ZOOM_MIN}
                maxZoom={AVATAR_ZOOM_MAX}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={handleComplete}
              />
            )}
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="avatar-zoom" className="sr-only">
              {p.zoom}
            </label>
            <span className="material-symbols-outlined text-slate-400" aria-hidden="true">
              zoom_in
            </span>
            <input
              id="avatar-zoom"
              type="range"
              min={AVATAR_ZOOM_MIN}
              max={AVATAR_ZOOM_MAX}
              step={AVATAR_ZOOM_STEP}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              className="flex-1 accent-primary"
            />
            <button
              type="button"
              onClick={() => setRotation((value) => (value + AVATAR_ROTATION_STEP) % FULL_ROTATION)}
              aria-label={p.rotate}
              title={p.rotate}
              className="size-10 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <span className="material-symbols-outlined" aria-hidden="true">
                rotate_right
              </span>
            </button>
          </div>

          <div className="flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span>{p.dropHint}</span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
              className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
            >
              {p.chooseFile}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={AVATAR_PICK_ACCEPT}
              onChange={handleInput}
              className="hidden"
              tabIndex={-1}
            />
          </div>

          {shownError && (
            <p role="alert" className="text-sm text-rose-500">
              {shownError}
            </p>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className={`${BUTTON_BASE} text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700`}
          >
            {p.cancel}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !area}
            className={`${BUTTON_BASE} bg-primary text-white font-bold hover:bg-primary/90 shadow-lg shadow-primary/20`}
          >
            {saving ? p.saving : p.save}
          </button>
        </div>
      </div>
    </div>
  )
}
