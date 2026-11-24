import type { SupabaseClient } from '@supabase/supabase-js'
import type { Result } from '@/lib/types'
import { updateUser } from '@/lib/db/usersDb'
import { createSupabaseServiceClient } from '@/lib/db/supabase-server'
import { AVATAR_BUCKET, AVATAR_MAX_BYTES } from '@/lib/avatar/avatarConfig'
import {
  buildAvatarPath,
  detectImageType,
  selectStaleAvatarPaths,
} from '@/lib/avatar/avatarFile'

const LIST_LIMIT = 100

async function removeUserObjects(
  storage: SupabaseClient['storage'],
  userId: string,
  keepPath: string | null
): Promise<void> {
  const { data, error } = await storage
    .from(AVATAR_BUCKET)
    .list(userId, { limit: LIST_LIMIT })
  if (error || !data) return
  const stale = selectStaleAvatarPaths(
    userId,
    data.map((item) => item.name),
    keepPath
  )
  if (stale.length === 0) return
  await storage.from(AVATAR_BUCKET).remove(stale)
}

export async function uploadAvatar(
  supabase: SupabaseClient,
  userId: string,
  file: File,
  now: number = Date.now()
): Promise<Result<{ avatar_url: string }>> {
  if (file.size > AVATAR_MAX_BYTES) {
    return { success: false, error: 'FILE_TOO_LARGE' }
  }
  const buffer = new Uint8Array(await file.arrayBuffer())
  const contentType = detectImageType(buffer)
  if (!contentType) {
    return { success: false, error: 'INVALID_FILE_TYPE' }
  }

  const path = buildAvatarPath(userId, now)
  const storage = createSupabaseServiceClient().storage

  const { error: uploadError } = await storage
    .from(AVATAR_BUCKET)
    .upload(path, buffer, { contentType, upsert: false })
  if (uploadError) {
    console.error('[avatarService] upload failed:', uploadError.message)
    return { success: false, error: 'UPLOAD_FAILED' }
  }

  const { data: urlData } = storage.from(AVATAR_BUCKET).getPublicUrl(path)
  const updated = await updateUser(supabase, userId, { avatar_url: urlData.publicUrl })
  if (!updated) {
    await storage.from(AVATAR_BUCKET).remove([path])
    return { success: false, error: 'UPDATE_FAILED' }
  }

  await removeUserObjects(storage, userId, path)
  return { success: true, data: { avatar_url: urlData.publicUrl } }
}

export async function removeAvatar(
  supabase: SupabaseClient,
  userId: string
): Promise<Result<{ avatar_url: null }>> {
  const updated = await updateUser(supabase, userId, { avatar_url: null })
  if (!updated) {
    return { success: false, error: 'UPDATE_FAILED' }
  }
  await removeUserObjects(createSupabaseServiceClient().storage, userId, null)
  return { success: true, data: { avatar_url: null } }
}
