import { Suspense } from 'react'
import { SettingsPanel } from '@/components/features/settings/SettingsPanel'

export default function SettingsPage(): React.JSX.Element {
  return (
    <Suspense>
      <SettingsPanel />
    </Suspense>
  )
}
