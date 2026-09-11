import { useEffect, useState } from 'react'
import { readyForTalk, type KernelStatus } from '../../../shared/kernel'
import { CHIEF_ID, currentBot, rosterBots, type Roster } from '../../../shared/roster'
import {
  emptyThread,
  paint,
  parseSendResult,
  parseThread,
  sendCopy,
  type Running,
  type SendResult,
  type Thread
} from '../../../shared/talk'

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
  const [draft, setDraft] = useState('')
  const [hatchName, setHatchName] = useState('')
  const [brief, setBrief] = useState('')
  const [assigneeDraft, setAssigneeDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [coordError, setCoordError] = useState<string | null>(null)

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

  const assignee = roster.others.some((item) => item.id === assigneeDraft)
    ? assigneeDraft
    : (roster.others[0]?.id ?? '')

  async function onAssignSubmit(): Promise<void> {
    const target = roster.others.find((item) => item.id === assignee)
    if (!target || brief.trim().length === 0) return
    setAssigning(true)
    setCoordError(null)
    try {
      const result = await onAssign(target.id, brief)
      if (result.kind === 'ok') {
        setBrief('')
        return
      }
      setCoordError(sendCopy(result, target.name))
    } catch (reason: unknown) {
      setCoordError(fail(reason, 'Could not assign'))
    } finally {
      setAssigning(false)
    }
  }

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
      setSendError(sendCopy(result, bot.name))
    } catch (reason: unknown) {
      setSendError(fail(reason, 'Could not send'))
    } finally {
      setBusy(false)
    }
  }

  const canSend = readyForTalk(kernelStatus) && !busy
  const lines = paint(thread)
  const thisRunning = running.find((item) => item.botId === bot.id)
  const teammatesRunning = running.filter((item) => item.botId !== CHIEF_ID)
  const named = (id: string): string =>
    rosterBots(roster).find((item) => item.id === id)?.name ?? id
  const canAssign =
    readyForTalk(kernelStatus) &&
    !assigning &&
    assignee.length > 0 &&
    brief.trim().length > 0 &&
    !running.some((item) => item.botId === assignee)

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
      {bot.id === CHIEF_ID && roster.others.length > 0 ? (
        <form
          className="flex shrink-0 flex-wrap items-end gap-3 border-b border-hairline px-6 py-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canAssign) return
            void onAssignSubmit()
          }}
        >
          <label className="flex min-w-32 flex-col gap-1.5 text-sm text-ink">
            To
            <select
              value={assignee}
              className="rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
              onChange={(event) => {
                setAssigneeDraft(event.target.value)
              }}
            >
              {roster.others.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm text-ink">
            Brief
            <input
              type="text"
              value={brief}
              disabled={assigning}
              className="rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
              onChange={(event) => {
                setBrief(event.target.value)
              }}
            />
          </label>
          <button
            type="submit"
            disabled={!canAssign}
            className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            Assign
          </button>
          {coordError ? (
            <p className="basis-full text-sm text-danger" role="alert">
              {coordError}
            </p>
          ) : null}
        </form>
      ) : null}
      {bot.id === CHIEF_ID && teammatesRunning.length > 0 ? (
        <ul className="shrink-0 border-b border-hairline px-6 py-3">
          {teammatesRunning.map((item) => (
            <li key={item.botId} className="mb-2 flex items-center gap-3 last:mb-0">
              <p role="status" className="min-w-0 flex-1 text-sm text-ink">
                {named(item.botId)} is working on {item.brief}
              </p>
              <button
                type="button"
                className="rounded-md border border-hairline bg-surface-1 px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
                onClick={() => {
                  void onInterrupt(item.botId)
                }}
              >
                Stop
              </button>
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
            <>
              <p role="status" className="min-w-0 flex-1 text-sm text-ink">
                {bot.name} is working on {thisRunning.brief}
              </p>
              <button
                type="button"
                className="rounded-md border border-hairline bg-surface-1 px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
                onClick={() => {
                  void onInterrupt(bot.id)
                }}
              >
                Stop
              </button>
            </>
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
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            Send
          </button>
          {busy || thisRunning ? (
            <button
              type="button"
              className="rounded-md border border-hairline bg-surface-1 px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
              onClick={() => {
                void onInterrupt(bot.id)
              }}
            >
              Stop
            </button>
          ) : null}
        </div>
        {sendError ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            {sendError}
          </p>
        ) : null}
      </form>
    </section>
  )
}
