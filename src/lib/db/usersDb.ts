import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserProfile } from '@/lib/types'

export async function getUserById(
  supabase: SupabaseClient,
  userId: string
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single()

  if (error) return null
  return data as UserProfile
}

export async function updateUser(
  supabase: SupabaseClient,
  userId: string,
  updates: Partial<Pick<UserProfile, 'display_name' | 'avatar_url'>>
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', userId)
    .select()
    .single()

  if (error) return null
  return data as UserProfile
}

export async function getUserDemoBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<number> {
  const { data, error } = await supabase
    .from('users')
    .select('demo_balance')
    .eq('id', userId)
    .single()

  if (error) return 0
  return Number(data?.demo_balance ?? 0)
}

export async function upsertUser(
  supabase: SupabaseClient,
  userId: string,
  email: string
): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .upsert({ id: userId, email }, { onConflict: 'id' })
    .select()
    .single()

  if (error) return null
  return data as UserProfile
}
