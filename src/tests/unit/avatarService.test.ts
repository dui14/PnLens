import { beforeEach, describe, expect, it, vi } from 'vitest'

const upload = vi.fn()
const list = vi.fn()
const remove = vi.fn()
const getPublicUrl = vi.fn()
const updateUser = vi.fn()

vi.mock('@/lib/db/supabase-server', () => ({
  createSupabaseServiceClient: () => ({
    storage: { from: () => ({ upload, list, remove, getPublicUrl }) },
  }),
}))
vi.mock('@/lib/db/usersDb', () => ({ updateUser: (...args: unknown[]) => updateUser(...args) }))

import { removeAvatar, uploadAvatar } from '@/lib/services/avatarService'
import { AVATAR_MAX_BYTES } from '@/lib/avatar/avatarConfig'
import {
  buildAvatarPath,
  detectImageType,
  selectStaleAvatarPaths,
} from '@/lib/avatar/avatarFile'

const USER_ID = 'user-1'
const NOW = 1700000000000
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
const PUBLIC_URL = 'https://x.supabase.co/storage/v1/object/public/avatars/user-1/avatar-1700000000000.webp'

function fileOf(bytes: number[], type = 'image/webp'): File {
  return new File([new Uint8Array(bytes)], 'a', { type })
}

describe('avatarFile', () => {
  it('detects png, jpeg and webp by magic bytes', () => {
    expect(detectImageType(new Uint8Array(PNG))).toBe('image/png')
    expect(detectImageType(new Uint8Array(JPEG))).toBe('image/jpeg')
    expect(detectImageType(new Uint8Array(WEBP))).toBe('image/webp')
  })

  it('rejects other content including a spoofed type', () => {
    expect(detectImageType(new TextEncoder().encode('<svg></svg>'))).toBeNull()
    expect(detectImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x41, 0x56, 0x49, 0x20]))).toBeNull()
    expect(detectImageType(new Uint8Array([]))).toBeNull()
  })

  it('builds a per-user timestamped webp path', () => {
    expect(buildAvatarPath(USER_ID, NOW)).toBe(`${USER_ID}/avatar-${NOW}.webp`)
  })

  it('selects every stored object except the kept path', () => {
    const keep = buildAvatarPath(USER_ID, NOW)
    expect(selectStaleAvatarPaths(USER_ID, ['avatar-1.webp', `avatar-${NOW}.webp`], keep)).toEqual([
      `${USER_ID}/avatar-1.webp`,
    ])
    expect(selectStaleAvatarPaths(USER_ID, ['a.png'], null)).toEqual([`${USER_ID}/a.png`])
  })
})

describe('uploadAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    upload.mockResolvedValue({ error: null })
    list.mockResolvedValue({ data: [{ name: 'avatar-1.webp' }, { name: `avatar-${NOW}.webp` }], error: null })
    remove.mockResolvedValue({ error: null })
    getPublicUrl.mockReturnValue({ data: { publicUrl: PUBLIC_URL } })
    updateUser.mockResolvedValue({ id: USER_ID })
  })

  it('rejects files over the size limit before touching storage', async () => {
    const big = new File([new Uint8Array(AVATAR_MAX_BYTES + 1)], 'a', { type: 'image/webp' })
    const result = await uploadAvatar({} as never, USER_ID, big, NOW)
    expect(result).toEqual({ success: false, error: 'FILE_TOO_LARGE' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('rejects content that is not an allowed image even with an image mime type', async () => {
    const result = await uploadAvatar({} as never, USER_ID, fileOf([1, 2, 3, 4], 'image/png'), NOW)
    expect(result).toEqual({ success: false, error: 'INVALID_FILE_TYPE' })
    expect(upload).not.toHaveBeenCalled()
  })

  it('uploads to the user folder, saves the url and removes old objects', async () => {
    const result = await uploadAvatar({} as never, USER_ID, fileOf(WEBP), NOW)
    expect(result).toEqual({ success: true, data: { avatar_url: PUBLIC_URL } })
    expect(upload).toHaveBeenCalledWith(
      `${USER_ID}/avatar-${NOW}.webp`,
      expect.any(Uint8Array),
      { contentType: 'image/webp', upsert: false }
    )
    expect(updateUser).toHaveBeenCalledWith({}, USER_ID, { avatar_url: PUBLIC_URL })
    expect(remove).toHaveBeenCalledWith([`${USER_ID}/avatar-1.webp`])
  })

  it('returns UPLOAD_FAILED and leaves the profile untouched', async () => {
    upload.mockResolvedValue({ error: { message: 'boom' } })
    const result = await uploadAvatar({} as never, USER_ID, fileOf(WEBP), NOW)
    expect(result).toEqual({ success: false, error: 'UPLOAD_FAILED' })
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('deletes the new object when the profile update fails', async () => {
    updateUser.mockResolvedValue(null)
    const result = await uploadAvatar({} as never, USER_ID, fileOf(WEBP), NOW)
    expect(result).toEqual({ success: false, error: 'UPDATE_FAILED' })
    expect(remove).toHaveBeenCalledWith([`${USER_ID}/avatar-${NOW}.webp`])
  })
})

describe('removeAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    list.mockResolvedValue({ data: [{ name: 'avatar-1.webp' }, { name: 'avatar-2.webp' }], error: null })
    remove.mockResolvedValue({ error: null })
    updateUser.mockResolvedValue({ id: USER_ID })
  })

  it('clears avatar_url and deletes every object in the user folder', async () => {
    const result = await removeAvatar({} as never, USER_ID)
    expect(result).toEqual({ success: true, data: { avatar_url: null } })
    expect(updateUser).toHaveBeenCalledWith({}, USER_ID, { avatar_url: null })
    expect(remove).toHaveBeenCalledWith([`${USER_ID}/avatar-1.webp`, `${USER_ID}/avatar-2.webp`])
  })

  it('keeps objects when the profile update fails', async () => {
    updateUser.mockResolvedValue(null)
    const result = await removeAvatar({} as never, USER_ID)
    expect(result).toEqual({ success: false, error: 'UPDATE_FAILED' })
    expect(remove).not.toHaveBeenCalled()
  })
})
