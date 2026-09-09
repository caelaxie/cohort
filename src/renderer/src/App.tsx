import { useEffect, useState } from 'react'
import { BotMain } from '@/components/bot-main'
import { BotSidebar } from '@/components/bot-sidebar'
import { blockedView, openingView, readyView, type BotId, type HomeView } from '../../shared/roster'

function App(): React.JSX.Element {
  const [view, setView] = useState<HomeView>(() =>
    window.cohort ? openingView() : blockedView('The app bridge is missing. Restart Cohort.')
  )

  useEffect(() => {
    if (!window.cohort) return
    void window.cohort
      .roster()
      .then((roster) => setView(readyView(roster)))
      .catch((reason: unknown) => {
        setView(blockedView(reason instanceof Error ? reason.message : 'Could not load bots'))
      })
    return window.cohort.onState((roster) => setView(readyView(roster)))
  }, [])

  const onSelect = (id: BotId): void => {
    if (view.status === 'ready' && view.roster.current === id) return
    if (!window.cohort) return
    void window.cohort
      .setCurrent(id)
      .then((roster) => setView(readyView(roster)))
      .catch((reason: unknown) => {
        setView(blockedView(reason instanceof Error ? reason.message : 'Could not switch bot'))
      })
  }

  return (
    <div className="flex h-full min-h-0 bg-canvas text-ink">
      <BotSidebar view={view} onSelect={onSelect} />
      <BotMain view={view} />
    </div>
  )
}

export default App
