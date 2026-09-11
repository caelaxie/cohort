import { useEffect, useState } from 'react'
import { BotSidebar } from '@/components/bot-sidebar'
import { BotMain } from '@/components/bot-main'
import { SettingsPane } from '@/components/settings-pane'
import { parseKernelStatus, type KernelStatus } from '../../shared/kernel'
import {
  chiefOnlyRoster,
  parseBotId,
  parseRoster,
  viewWith,
  type HomeView
} from '../../shared/roster'
import {
  parseCoordination,
  parseInterruptResult,
  parseSendResult,
  type Running
} from '../../shared/talk'

function fail(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

function App(): React.JSX.Element {
  const [view, setView] = useState<HomeView>(() =>
    window.cohort
      ? viewWith(chiefOnlyRoster())
      : viewWith(chiefOnlyRoster(), 'The app bridge is missing. Restart Cohort.')
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [kernelStatus, setKernelStatus] = useState<KernelStatus>({ kind: 'needs_login' })
  const [kernelError, setKernelError] = useState<string | null>(null)
  const [running, setRunning] = useState<readonly Running[]>([])

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
    void window.cohort
      .coordination()
      .then((raw) => setRunning(parseCoordination(raw).running))
      .catch(() => undefined)
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
        running={running}
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
        <BotMain
          key={view.roster.current}
          roster={view.roster}
          kernelStatus={kernelStatus}
          running={running}
          onAssign={async (botId, brief) => {
            setRunning((prev) => [
              ...prev.filter((item) => item.botId !== botId),
              { botId: parseBotId(botId), brief }
            ])
            try {
              return parseSendResult(await window.cohort.assign({ botId, body: brief }))
            } finally {
              try {
                setRunning(parseCoordination(await window.cohort.coordination()).running)
              } catch {
                setRunning((prev) => prev.filter((item) => item.botId !== botId))
              }
            }
          }}
          onInterrupt={async (botId) => {
            try {
              parseInterruptResult(await window.cohort.interrupt(botId))
            } finally {
              try {
                setRunning(parseCoordination(await window.cohort.coordination()).running)
              } catch {
                setRunning((prev) => prev.filter((item) => item.botId !== botId))
              }
            }
          }}
          onHatch={(name) => {
            void window.cohort
              .hatch(name)
              .then((raw) => setView(viewWith(parseRoster(raw))))
              .catch((reason: unknown) => {
                setView((prev) => viewWith(prev.roster, fail(reason, 'Could not hatch')))
              })
          }}
          onRemove={(id) => {
            void window.cohort
              .remove(id)
              .then((raw) => {
                setView(viewWith(parseRoster(raw)))
                setRunning((prev) => prev.filter((item) => item.botId !== id))
              })
              .catch((reason: unknown) => {
                setView((prev) => viewWith(prev.roster, fail(reason, 'Could not remove')))
              })
          }}
        />
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
