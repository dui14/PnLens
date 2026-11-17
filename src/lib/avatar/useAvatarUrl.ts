'use client'

import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/db/supabase-browser'

export function useProviderAvatarUrl(): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    createSupabaseBrowserClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!active) return
        const value = data.user?.user_metadata?.avatar_url
        setUrl(typeof value === 'string' && value ? value : null)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  return url
}
