import { useEffect, useState } from 'react'
import { BotSidebar, type Screen } from '@/components/bot-sidebar'
import { BotMain } from '@/components/bot-main'
import { SettingsPane } from '@/components/settings-pane'
import { parseKernelStatus, type KernelStatus } from '../../shared/kernel'
import { hatchOnlyRoster, parseRoster, viewWith, type HomeView } from '../../shared/roster'

function fail(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

function App(): React.JSX.Element {
  const [view, setView] = useState<HomeView>(() =>
    window.cohort
      ? viewWith(hatchOnlyRoster())
      : viewWith(hatchOnlyRoster(), 'The app bridge is missing. Restart Cohort.')
  )
  const [screen, setScreen] = useState<Screen>('crew')
  const [kernelStatus, setKernelStatus] = useState<KernelStatus | null>(null)
  const [kernelError, setKernelError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.cohort) return
    void window.cohort
      .home()
      .then((raw) => setView(viewWith(parseRoster(raw))))
      .catch((reason: unknown) => {
        setView((prev) => viewWith(prev.roster, fail(reason, 'Could not load bots')))
      })
  }, [])

  useEffect(() => {
    if (!window.cohort) return
    void window.cohort
      .kernel()
      .then((raw) => {
        setKernelStatus(parseKernelStatus(raw))
        setKernelError(null)
      })
      .catch((reason: unknown) => {
        setKernelError(fail(reason, 'Could not load model'))
      })
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== ',') return
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.altKey || event.shiftKey) return
      event.preventDefault()
      setScreen('settings')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!window.cohort) return
    return window.cohort.onOpenSettings(() => {
      setScreen('settings')
    })
  }, [])

  return (
    <div className="flex h-full min-h-0 bg-canvas text-ink">
      <BotSidebar
        roster={view.roster}
        error={view.error}
        screen={screen}
        kernelStatus={kernelStatus}
        onOpenSettings={() => {
          setScreen('settings')
        }}
        onSelect={(id) => {
          setScreen('crew')
          void window.cohort
            .select(id)
            .then((raw) => setView(viewWith(parseRoster(raw))))
            .catch((reason: unknown) => {
              setView((prev) => viewWith(prev.roster, fail(reason, 'Could not switch bots')))
            })
        }}
      />
      {screen === 'settings' ? (
        <SettingsPane
          status={kernelStatus}
          error={kernelError}
          onConnect={async (input) => {
            try {
              const raw = await window.cohort.connect(input)
              setKernelStatus(parseKernelStatus(raw))
              setKernelError(null)
            } catch (reason: unknown) {
              setKernelError(fail(reason, 'Could not connect'))
              throw reason
            }
          }}
        />
      ) : (
        <BotMain roster={view.roster} />
      )}
    </div>
  )
}

export default App
