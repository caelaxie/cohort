import { useEffect, useState } from 'react'
import { readyForTalk, type KernelStatus } from '../../../shared/kernel'
import { rosterBots, type Roster } from '../../../shared/roster'
import {
  emptyRoom,
  parseRoom,
  roomSpeakerKey,
  sendCopy,
  type Room,
  type RoomSendResult,
  type Running
} from '../../../shared/talk'
import { WorkingStatus } from './working-status'

type Props = {
  roster: Roster
  kernelStatus: KernelStatus
  running: readonly Running[]
  onRoomSend: (botId: string, body: string) => Promise<RoomSendResult>
  onInterrupt: (botId: string) => Promise<void>
}

function fail(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

export function RoomMain({
  roster,
  kernelStatus,
  running,
  onRoomSend,
  onInterrupt
}: Props): React.JSX.Element {
  const bots = rosterBots(roster)
  const [room, setRoom] = useState<Room>(emptyRoom)
  const [draft, setDraft] = useState('')
  const [toDraft, setToDraft] = useState<string>(bots[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const to = bots.some((item) => item.id === toDraft) ? toDraft : (bots[0]?.id ?? '')
  const named = (id: string): string => bots.find((item) => item.id === id)?.name ?? id
  const toName = named(to)
  const thisRunning = running.find((item) => item.botId === to)

  useEffect(() => {
    if (!window.cohort) return
    let cancelled = false
    void window.cohort
      .room()
      .then((raw) => {
        if (!cancelled) setRoom(parseRoom(raw))
      })
      .catch((reason: unknown) => {
        if (!cancelled) setSendError(fail(reason, 'Could not load room'))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function onSend(): Promise<void> {
    if (to.length === 0) return
    setBusy(true)
    setSendError(null)
    try {
      const result = await onRoomSend(to, draft)
      if (result.kind === 'ok') {
        setRoom(result.room)
        setDraft('')
        return
      }
      setSendError(sendCopy(result, toName))
    } catch (reason: unknown) {
      setSendError(fail(reason, 'Could not send'))
    } finally {
      setBusy(false)
    }
  }

  const canSend = readyForTalk(kernelStatus) && !busy && to.length > 0

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-6">
        <h1 className="font-display truncate text-balance text-[22px] font-medium tracking-[-0.4px] text-ink">
          Room
        </h1>
      </header>

      <ul className="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-4">
        {room.lines.map((line) => (
          <li key={line.id} data-speaker={roomSpeakerKey(line.speaker)} className="mb-3">
            <span className="text-xs text-ink-subtle">
              {line.speaker.kind === 'owner' ? 'You' : named(line.speaker.botId)}
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
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-32 flex-col gap-1.5 text-sm text-ink">
            To
            <select
              value={to}
              className="rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
              onChange={(event) => {
                setToDraft(event.target.value)
              }}
            >
              {bots.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm text-ink">
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
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            Send
          </button>
          {busy || thisRunning ? (
            <WorkingStatus
              onStop={() => {
                void onInterrupt(to)
              }}
            />
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
