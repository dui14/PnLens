import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatConversation, ChatMessage, ChatMessageAnalysisMeta } from '@/lib/types'

export async function createConversation(
  supabase: SupabaseClient,
  userId: string,
  title: string
): Promise<ChatConversation | null> {
  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({ user_id: userId, title })
    .select()
    .single()

  if (error) return null
  return data as ChatConversation
}

export async function getConversations(
  supabase: SupabaseClient,
  userId: string
): Promise<ChatConversation[]> {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('id, title, updated_at, created_at, user_id')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })

  if (error) return []
  return (data ?? []) as ChatConversation[]
}

export async function getConversationById(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string
): Promise<ChatConversation | null> {
  const { data, error } = await supabase
    .from('chat_conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('user_id', userId)
    .single()

  if (error) return null
  return data as ChatConversation
}

export async function getConversationMessages(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string
): Promise<ChatMessage[]> {
  const conversation = await getConversationById(supabase, conversationId, userId)
  if (!conversation) return []

  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) return []
  return (data ?? []) as ChatMessage[]
}

export async function createChatMessage(
  supabase: SupabaseClient,
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  tokensUsed?: number,
  analysisMeta?: ChatMessageAnalysisMeta | null,
  errorCode?: string | null
): Promise<ChatMessage | null> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      conversation_id: conversationId,
      role,
      content,
      tokens_used: tokensUsed ?? null,
      analysis_meta: analysisMeta ?? null,
      status: errorCode ? 'error' : 'ok',
      error_code: errorCode ?? null,
    })
    .select()
    .single()

  if (error) return null
  return data as ChatMessage
}

export async function updateConversationTitle(
  supabase: SupabaseClient,
  conversationId: string,
  title: string
): Promise<void> {
  await supabase
    .from('chat_conversations')
    .update({ title })
    .eq('id', conversationId)
}

export async function renameConversation(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  title: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('chat_conversations')
    .update({ title })
    .eq('id', conversationId)
    .eq('user_id', userId)
    .select('id')

  if (error) return false
  return (data?.length ?? 0) > 0
}

export async function deleteConversation(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string
): Promise<boolean> {
  await supabase
    .from('chat_messages')
    .delete()
    .eq('conversation_id', conversationId)

  const { error } = await supabase
    .from('chat_conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', userId)

  return !error
}
