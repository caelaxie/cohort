import { cn } from '@/lib/utils'
import { rosterBots, type Roster } from '../../../shared/roster'
import { readyForTalk, type KernelStatus } from '../../../shared/kernel'
import type { Running } from '../../../shared/talk'

type Props = {
  roster: Roster
  error: string | null
  running: readonly Running[]
  onSelect: (id: string) => void
  settingsOpen: boolean
  kernelStatus: KernelStatus
  onOpenSettings: () => void
}

const navButtonClass =
  'flex min-h-8 w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-ink-muted transition-[background-color,color] duration-150 ease-out hover:bg-surface-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color-mix(in_srgb,var(--color-primary-focus)_50%,transparent)]'

export function BotSidebar({
  roster,
  error,
  running,
  onSelect,
  settingsOpen,
  kernelStatus,
  onOpenSettings
}: Props): React.JSX.Element {
  const working = new Set(running.map((item) => item.botId))
  return (
    <aside className="flex w-[244px] shrink-0 flex-col border-r border-hairline bg-surface-1">
      <div className="flex h-14 items-center px-3">
        <p className="font-display text-sm font-medium tracking-[-0.05px] text-ink">Cohort</p>
      </div>

      <div className="flex items-center px-3 pb-2">
        <h2 className="text-[13px] font-medium tracking-[0.4px] text-ink-subtle">Crew</h2>
      </div>

      {error ? (
        <p className="px-3 pb-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-1 flex-col gap-0.5 overflow-auto px-2 pb-3">
        {rosterBots(roster).map((bot) => {
          const current = !settingsOpen && bot.id === roster.current
          return (
            <li key={bot.id}>
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                className={cn(navButtonClass, current && 'bg-surface-2 text-ink')}
                onClick={() => onSelect(bot.id)}
              >
                <span className="truncate">{bot.name}</span>
                {working.has(bot.id) ? (
                  <span className="ml-auto text-xs text-ink-subtle">working</span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="shrink-0 border-t border-hairline px-2 py-3">
        <button
          type="button"
          aria-current={settingsOpen ? 'page' : undefined}
          className={cn(navButtonClass, settingsOpen && 'bg-surface-2 text-ink')}
          onClick={onOpenSettings}
        >
          Settings
        </button>
        <p className="px-2 pt-1 text-xs text-ink-subtle">
          {readyForTalk(kernelStatus) ? kernelStatus.model : 'No model connected'}
        </p>
      </div>
    </aside>
  )
}
