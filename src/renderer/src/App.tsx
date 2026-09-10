import { useEffect, useState } from 'react'
import { BotSidebar } from '@/components/bot-sidebar'
import { BotMain } from '@/components/bot-main'
import { hatchOnlyRoster, parseHome, viewWith, type HomeView } from '../../shared/roster'

function App(): React.JSX.Element {
  const [view, setView] = useState<HomeView>(() =>
    window.cohort
      ? viewWith(hatchOnlyRoster())
      : viewWith(hatchOnlyRoster(), 'The app bridge is missing. Restart Cohort.')
  )

  useEffect(() => {
    if (!window.cohort) return
    void window.cohort
      .home()
      .then((raw) => setView(viewWith(parseHome(raw))))
      .catch((reason: unknown) => {
        setView((prev) =>
          viewWith(prev.roster, reason instanceof Error ? reason.message : 'Could not load bots')
        )
      })
    return window.cohort.onState((raw) => setView(viewWith(parseHome(raw))))
  }, [])

  return (
    <div className="flex h-full min-h-0 bg-canvas text-ink">
      <BotSidebar
        roster={view.roster}
        error={view.error}
        onSelect={(id) => {
          if (id === view.roster.current) return
          void window.cohort
            .select(id)
            .then((raw) => setView(viewWith(parseHome(raw))))
            .catch((reason: unknown) => {
              setView((prev) =>
                viewWith(
                  prev.roster,
                  reason instanceof Error ? reason.message : 'Could not switch bots'
                )
              )
            })
        }}
      />
      <BotMain roster={view.roster} />
    </div>
  )
}

export default App
