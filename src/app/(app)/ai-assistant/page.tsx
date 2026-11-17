import { Suspense } from 'react'
import { AIChatInterface } from '@/components/features/ai-assistant/AIChatInterface'

export default function AIAssistantPage(): React.JSX.Element {
  return (
    <Suspense>
      <AIChatInterface />
    </Suspense>
  )
}
