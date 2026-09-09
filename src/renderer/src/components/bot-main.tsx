import { headingName, type HomeView } from '../../../shared/roster'

type Props = {
  view: HomeView
}

export function BotMain({ view }: Props): React.JSX.Element {
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center border-b border-hairline px-6">
        <h1 className="font-display truncate text-balance text-[22px] font-medium tracking-[-0.4px] text-ink">
          {headingName(view)}
        </h1>
      </header>
      <div className="min-h-0 flex-1" />
    </section>
  )
}
