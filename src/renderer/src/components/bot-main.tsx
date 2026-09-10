import { currentBot, type Roster } from '../../../shared/roster'

type Props = {
  roster: Roster
}

export function BotMain({ roster }: Props): React.JSX.Element {
  const bot = currentBot(roster)

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-6">
        <h1 className="font-display truncate text-balance text-[22px] font-medium tracking-[-0.4px] text-ink">
          {bot.name}
        </h1>
      </header>

      <ul className="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-4" />
    </section>
  )
}
