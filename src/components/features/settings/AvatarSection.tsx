'use client'

import { useRef, useState } from 'react'
import { useT } from '@/lib/i18n/client'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { AvatarCropDialog } from '@/components/features/settings/AvatarCropDialog'
import {
  AVATAR_DETECTED_TYPES,
  AVATAR_ENDPOINT,
  AVATAR_FORM_FIELD,
  AVATAR_PICK_ACCEPT,
  AVATAR_PICK_MAX_BYTES,
  AVATAR_PROFILE_EVENT,
} from '@/lib/avatar/avatarConfig'

type AvatarSectionProps = {
  avatarUrl: string | null
  storedAvatarUrl: string | null
  name: string
  onChange: (avatarUrl: string | null) => void
}

type AvatarResponse = {
  success: boolean
  data: { avatar_url: string | null } | null
  error: string | null
}

export function AvatarSection({
  avatarUrl,
  storedAvatarUrl,
  name,
  onChange,
}: AvatarSectionProps): React.JSX.Element {
  const { t } = useT()
  const p = t.settings.avatar
  const errors = p.errors as Record<string, string>
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const messageFor = (code: string | null | undefined): string =>
    (code && errors[code]) || errors.DEFAULT

  const accept = (file: File): boolean => {
    if (!(AVATAR_DETECTED_TYPES as readonly string[]).includes(file.type)) {
      setError(errors.INVALID_FILE_TYPE)
      return false
    }
    if (file.size > AVATAR_PICK_MAX_BYTES) {
      setError(errors.FILE_TOO_LARGE)
      return false
    }
    setError(null)
    return true
  }

  const pick = (file: File): void => {
    setNotice(null)
    if (accept(file)) setPending(file)
  }

  const apply = (next: string | null): void => {
    onChange(next)
    window.dispatchEvent(new CustomEvent(AVATAR_PROFILE_EVENT, { detail: { avatarUrl: next } }))
  }

  const handleSave = async (blob: Blob): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const body = new FormData()
      body.append(AVATAR_FORM_FIELD, blob, 'avatar')
      const res = await fetch(AVATAR_ENDPOINT, { method: 'POST', body })
      const json = (await res.json().catch(() => null)) as AvatarResponse | null
      if (res.ok && json?.success && json.data) {
        apply(json.data.avatar_url)
        setPending(null)
        setNotice(p.updated)
      } else {
        setError(messageFor(json?.error))
      }
    } catch {
      setError(errors.DEFAULT)
    } finally {
      setSaving(false)
    }
  }

  const handleRemove = async (): Promise<void> => {
    setRemoving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(AVATAR_ENDPOINT, { method: 'DELETE' })
      const json = (await res.json().catch(() => null)) as AvatarResponse | null
      if (res.ok && json?.success) {
        apply(null)
        setNotice(p.removed)
      } else {
        setError(messageFor(json?.error))
      }
    } catch {
      setError(errors.DEFAULT)
    } finally {
      setRemoving(false)
    }
  }

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) pick(file)
  }

  const handleDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) pick(file)
  }

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      className={`rounded-xl transition-shadow ${dragOver ? 'ring-2 ring-primary' : ''}`}
    >
      <div className="flex flex-col sm:flex-row items-center gap-6">
        <div className="size-24 rounded-full border-4 border-primary/20 p-1 shrink-0">
          <UserAvatar
            src={avatarUrl}
            name={name}
            alt={t.nav.avatarAlt}
            className="w-full h-full"
            textClassName="text-3xl"
          />
        </div>
        <div className="flex-1 text-center sm:text-left space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">{p.title}</h3>
          </div>
          <div className="flex flex-wrap justify-center sm:justify-start gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="px-5 py-2 bg-primary text-white rounded-lg text-sm font-bold hover:bg-primary/90 transition-all shadow-lg shadow-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            >
              {p.change}
            </button>
            {storedAvatarUrl && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={removing}
                className="px-5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-sm font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {removing ? p.removing : p.remove}
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={AVATAR_PICK_ACCEPT}
              onChange={handleInput}
              className="hidden"
              data-testid="avatar-file-input"
            />
          </div>
          {error && !pending && (
            <p role="alert" className="text-sm text-rose-500">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm text-emerald-500">
              {notice}
            </p>
          )}
        </div>
      </div>

      {pending && (
        <AvatarCropDialog
          file={pending}
          saving={saving}
          error={error}
          onSave={handleSave}
          onCancel={() => {
            setPending(null)
            setError(null)
          }}
          onReplaceFile={pick}
        />
      )}
    </div>
  )
}
