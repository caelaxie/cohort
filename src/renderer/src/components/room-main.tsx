import { useEffect, useState } from 'react'
import type { KernelStatus } from '../../../shared/kernel'
import { rosterBots, type Roster } from '../../../shared/roster'
import {
  emptyRoom,
  parseRoom,
  roomSpeakerKey,
  talkStopTarget,
  type Room,
  type RoomSendResult,
  type Running
} from '../../../shared/talk'
import { useTalkSend } from '@/lib/use-talk-send'
import { TalkComposer } from './talk-composer'

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
  const [toDraft, setToDraft] = useState<string>(bots[0]?.id ?? '')
  const named = (id: string): string => bots.find((item) => item.id === id)?.name ?? id
  const { draft, setDraft, busy, flightBotId, sendError, setSendError, canSend, send, stop } =
    useTalkSend({ kernelStatus, nameFor: named })
  const to = bots.some((item) => item.id === toDraft) ? toDraft : (bots[0]?.id ?? '')
  const flight = talkStopTarget(flightBotId, to)
  const thisRunning = running.find((item) => item.botId === flight)

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
  }, [setSendError])

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

      <TalkComposer
        kernelStatus={kernelStatus}
        draft={draft}
        busy={busy}
        canSend={canSend && to.length > 0}
        sendError={sendError}
        showStop={busy || thisRunning !== undefined}
        leading={
          <label className="flex min-w-32 flex-col gap-1.5 text-sm text-ink">
            To
            <select
              value={to}
              disabled={busy}
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
        }
        onDraftChange={setDraft}
        onSend={() => {
          void send(to, async (body) => {
            const result = await onRoomSend(to, body)
            if (result.kind === 'ok') setRoom(result.room)
            return result
          })
        }}
        onStop={() => {
          stop(onInterrupt, to)
        }}
      />
    </section>
  )
}
