import { useEffect, useState } from 'react'
import { BotSidebar } from '@/components/bot-sidebar'
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [kernelStatus, setKernelStatus] = useState<KernelStatus>({ kind: 'needs_login' })
  const [kernelError, setKernelError] = useState<string | null>(null)

  useEffect(() => {
    if (!window.cohort) return
    void window.cohort
      .home()
      .then((raw) => setView(viewWith(parseRoster(raw))))
      .catch((reason: unknown) => {
        setView((prev) => viewWith(prev.roster, fail(reason, 'Could not load bots')))
      })
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
      setSettingsOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!window.cohort) return
    return window.cohort.onOpenSettings(() => {
      setSettingsOpen(true)
    })
  }, [])

  return (
    <div className="flex h-full min-h-0 bg-canvas text-ink">
      <BotSidebar
        roster={view.roster}
        error={view.error}
        settingsOpen={settingsOpen}
        kernelStatus={kernelStatus}
        onOpenSettings={() => {
          setSettingsOpen(true)
        }}
        onSelect={(id) => {
          setSettingsOpen(false)
          void window.cohort
            .select(id)
            .then((raw) => setView(viewWith(parseRoster(raw))))
            .catch((reason: unknown) => {
              setView((prev) => viewWith(prev.roster, fail(reason, 'Could not switch bots')))
            })
        }}
      />
      <div className={settingsOpen ? 'hidden min-w-0 flex-1' : 'flex min-w-0 flex-1'}>
        <BotMain key={view.roster.current} roster={view.roster} kernelStatus={kernelStatus} />
      </div>
      {settingsOpen ? (
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
      ) : null}
    </div>
  )
}

export default App
