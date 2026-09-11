import { useEffect, useState } from 'react'
import { readyForTalk, type KernelStatus } from '../../../shared/kernel'
import { currentBot, type Roster } from '../../../shared/roster'
import {
  emptyThread,
  paint,
  parseSendResult,
  parseThread,
  sendCopy,
  type Thread
} from '../../../shared/talk'

type Props = {
  roster: Roster
  kernelStatus: KernelStatus
}

function fail(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

export function BotMain({ roster, kernelStatus }: Props): React.JSX.Element {
  const bot = currentBot(roster)
  const [thread, setThread] = useState<Thread>(() => emptyThread(bot.id))
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

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
  }, [bot.id])

  async function onSend(): Promise<void> {
    setBusy(true)
    setSendError(null)
    try {
      const result = parseSendResult(await window.cohort.send({ botId: bot.id, body: draft }))
      if (result.kind === 'ok') {
        setThread(result.thread)
        setDraft('')
        return
      }
      setSendError(sendCopy(result))
    } catch (reason: unknown) {
      setSendError(fail(reason, 'Could not send'))
    } finally {
      setBusy(false)
    }
  }

  const canSend = readyForTalk(kernelStatus) && !busy
  const lines = paint(thread)

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-6">
        <h1 className="font-display truncate text-balance text-[22px] font-medium tracking-[-0.4px] text-ink">
          {bot.name}
        </h1>
      </header>

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

      <form
        className="shrink-0 border-t border-hairline px-6 py-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSend) return
          void onSend()
        }}
      >
        {kernelStatus.kind === 'needs_login' ? (
          <p className="mb-3 text-sm text-ink-muted">Connect a model in Settings</p>
        ) : null}
        <label className="flex min-w-0 flex-col gap-1.5 text-sm text-ink">
          Message
          <textarea
            value={draft}
            disabled={busy}
            className="min-h-16 rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
            onChange={(event) => {
              setDraft(event.target.value)
            }}
          />
        </label>
        <button
          type="submit"
          disabled={!canSend}
          className="mt-3 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
        >
          Send
        </button>
        {sendError ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {sendError}
          </p>
        ) : null}
      </form>
    </section>
  )
}
