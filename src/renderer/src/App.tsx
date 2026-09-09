import { useEffect, useState } from 'react'
import { BotMain } from '@/components/bot-main'
import { BotSidebar } from '@/components/bot-sidebar'
import {
  hatchOnlyRoster,
  type BotId,
  type HomeView,
  type Roster
} from '../../shared/roster'

function viewWith(roster: Roster, error: string | null = null): HomeView {
  return { roster, error }
}

function App(): React.JSX.Element {
  const [view, setView] = useState<HomeView>(() =>
    window.cohort
      ? viewWith(hatchOnlyRoster())
      : viewWith(hatchOnlyRoster(), 'The app bridge is missing. Restart Cohort.')
  )

  useEffect(() => {
    if (!window.cohort) return
    void window.cohort
      .roster()
      .then((roster) => setView(viewWith(roster)))
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : 'Could not load bots'
        setView((prev) => viewWith(prev.roster, message))
      })
    return window.cohort.onState((roster) => setView(viewWith(roster)))
  }, [])

  const onSelect = (id: BotId): void => {
    if (view.roster.current === id) return
    if (!window.cohort) return
    void window.cohort
      .setCurrent(id)
      .then((roster) => setView(viewWith(roster)))
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : 'Could not switch bot'
        setView((prev) => viewWith(prev.roster, message))
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
