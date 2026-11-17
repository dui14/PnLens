import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserProfile, Result } from '@/lib/types'
import { getUserById, updateUser } from '@/lib/db/usersDb'

export async function getSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<Result<UserProfile>> {
  const profile = await getUserById(supabase, userId)
  if (!profile) {
    return { success: false, error: 'NOT_FOUND' }
  }
  return { success: true, data: profile }
}

export async function updateSettings(
  supabase: SupabaseClient,
  userId: string,
  updates: { displayName: string }
): Promise<Result<UserProfile>> {
  const profile = await updateUser(supabase, userId, { display_name: updates.displayName })
  if (!profile) {
    return { success: false, error: 'INTERNAL_ERROR' }
  }

  return { success: true, data: profile }
}
