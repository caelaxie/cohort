import { useEffect, useState } from 'react'
import type { KernelStatus } from '../../../shared/kernel'
import { CHIEF_ID, currentBot, rosterBots, type Roster } from '../../../shared/roster'
import {
  emptyThread,
  paint,
  parseSendResult,
  parseThread,
  type Running,
  type SendResult,
  type Thread
} from '../../../shared/talk'
import { ChiefAssign } from './chief-assign'
import { useTalkSend } from '@/lib/use-talk-send'
import { TalkComposer } from './talk-composer'
import { WorkingStatus } from './working-status'

type Props = {
  roster: Roster
  kernelStatus: KernelStatus
  running: readonly Running[]
  onAssign: (botId: string, brief: string) => Promise<SendResult>
  onInterrupt: (botId: string) => Promise<void>
  onHatch: (name: string) => void
  onRemove: (id: string) => void
}

function fail(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

export function BotMain({
  roster,
  kernelStatus,
  running,
  onAssign,
  onInterrupt,
  onHatch,
  onRemove
}: Props): React.JSX.Element {
  const bot = currentBot(roster)
  const [thread, setThread] = useState<Thread>(() => emptyThread(bot.id))
  const [hatchName, setHatchName] = useState('')
  const { draft, setDraft, busy, sendError, setSendError, canSend, send, stop } = useTalkSend({
    kernelStatus,
    nameFor: () => bot.name
  })

  useEffect(() => {
    if (!window.cohort) return
    let cancelled = false
    void window.cohort
      .thread(bot.id)
      .then((raw) => {
        if (!cancelled) setThread(parseThread(raw))
      })
      .catch((reason: unknown) => {
        if (!cancelled) setSendError(fail(reason, 'Could not load thread'))
      })
    return () => {
      cancelled = true
    }
  }, [bot.id, setSendError])

  const lines = paint(thread)
  const thisRunning = running.find((item) => item.botId === bot.id)
  const teammatesRunning = running.filter((item) => item.botId !== CHIEF_ID)
  const named = (id: string): string =>
    rosterBots(roster).find((item) => item.id === id)?.name ?? id

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-6">
        <h1 className="font-display truncate text-balance text-[22px] font-medium tracking-[-0.4px] text-ink">
          {bot.name}
        </h1>
      </header>

      {bot.id === CHIEF_ID ? (
        <form
          className="flex shrink-0 flex-wrap items-end gap-3 border-b border-hairline px-6 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            const name = hatchName.trim()
            if (name.length === 0) return
            onHatch(name)
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm text-ink">
            Name
            <input
              type="text"
              value={hatchName}
              className="rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
              onChange={(event) => {
                setHatchName(event.target.value)
              }}
            />
          </label>
          <button
            type="submit"
            disabled={hatchName.trim().length === 0}
            className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            Hatch
          </button>
        </form>
      ) : null}
      {bot.id === CHIEF_ID ? (
        <ChiefAssign
          others={roster.others}
          kernelStatus={kernelStatus}
          running={running}
          onAssign={onAssign}
        />
      ) : null}
      {bot.id === CHIEF_ID && teammatesRunning.length > 0 ? (
        <ul className="shrink-0 border-b border-hairline px-6 py-3">
          {teammatesRunning.map((item) => (
            <li key={item.botId} className="mb-2 flex items-center gap-3 last:mb-0">
              <WorkingStatus
                name={named(item.botId)}
                brief={item.brief}
                onStop={() => {
                  void onInterrupt(item.botId)
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
      {bot.id !== CHIEF_ID ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline px-6 py-3">
          <button
            type="button"
            className="rounded-md border border-hairline bg-surface-1 px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
            onClick={() => {
              onRemove(bot.id)
            }}
          >
            Remove
          </button>
          {thisRunning ? (
            <WorkingStatus
              name={bot.name}
              brief={thisRunning.brief}
              onStop={() => {
                void onInterrupt(bot.id)
              }}
            />
          ) : null}
        </div>
      ) : null}

      <ul className="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-4">
        {lines.map((line) => (
          <li key={line.id} data-speaker={line.speaker} className="mb-3">
            <span className="text-xs text-ink-subtle">
              {line.speaker === 'owner' ? 'You' : bot.name}
            </span>
            <p className="text-sm text-ink">{line.body}</p>
          </li>
        ))}
      </ul>

      <TalkComposer
        kernelStatus={kernelStatus}
        draft={draft}
        busy={busy}
        canSend={canSend}
        sendError={sendError}
        showStop={busy || thisRunning !== undefined}
        onDraftChange={setDraft}
        onSend={() => {
          void send(bot.id, async (body) => {
            const result = parseSendResult(await window.cohort.send({ botId: bot.id, body }))
            if (result.kind === 'ok') setThread(result.thread)
            return result
          })
        }}
        onStop={() => {
          stop(onInterrupt, bot.id)
        }}
      />
    </section>
  )
}
