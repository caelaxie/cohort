import { cn } from '@/lib/utils'
import { rosterBots, type BotId, type HomeView } from '../../../shared/roster'

type Props = {
  view: HomeView
  onSelect: (id: BotId) => void
}

export function BotSidebar({ view, onSelect }: Props): React.JSX.Element {
  const bots = view.status === 'ready' ? rosterBots(view.roster) : [view.hatch]
  const current = view.status === 'ready' ? view.roster.current : view.hatch.id
  const error = view.status === 'blocked' ? view.message : null

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
        {bots.map((bot) => (
          <li key={bot.id}>
            <button
              type="button"
              aria-current={bot.id === current ? 'page' : undefined}
              className={cn(
                'flex min-h-8 w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-ink-muted',
                'transition-[background-color,color] duration-150 ease-out',
                'hover:bg-surface-2 hover:text-ink',
                'focus-visible:outline-2 focus-visible:outline-offset-2',
                'focus-visible:outline-[color-mix(in_srgb,var(--color-primary-focus)_50%,transparent)]',
                bot.id === current && 'bg-surface-2 text-ink'
              )}
              onClick={() => onSelect(bot.id)}
            >
              <span className="truncate">{bot.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
