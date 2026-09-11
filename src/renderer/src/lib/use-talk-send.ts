import { useRef, useState } from 'react'
import { readyForTalk, type KernelStatus } from '../../../shared/kernel'
import { sendCopy, talkStopTarget, type SendResult } from '../../../shared/talk'

export type TalkFailure = Exclude<SendResult, { kind: 'ok' }>

function fail(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

export function useTalkSend(options: {
  kernelStatus: KernelStatus
  nameFor: (botId: string) => string
}): {
  draft: string
  setDraft: (value: string) => void
  busy: boolean
  flightBotId: string | null
  sendError: string | null
  setSendError: (value: string | null) => void
  canSend: boolean
  send: (
    botId: string,
    run: (body: string) => Promise<{ kind: 'ok' } | TalkFailure>
  ) => Promise<void>
  stop: (interrupt: (botId: string) => Promise<void>, fallbackBotId: string) => void
} {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [flightBotId, setFlightBotId] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const flightRef = useRef<string | null>(null)

  async function send(
    botId: string,
    run: (body: string) => Promise<{ kind: 'ok' } | TalkFailure>
  ): Promise<void> {
    if (botId.length === 0) return
    const name = options.nameFor(botId)
    flightRef.current = botId
    setFlightBotId(botId)
    setBusy(true)
    setSendError(null)
    try {
      const result = await run(draft)
      if (result.kind === 'ok') {
        setDraft('')
        return
      }
      setSendError(sendCopy(result, name))
    } catch (reason: unknown) {
      setSendError(fail(reason, 'Could not send'))
    } finally {
      flightRef.current = null
      setBusy(false)
      setFlightBotId(null)
    }
  }

  function stop(interrupt: (botId: string) => Promise<void>, fallbackBotId: string): void {
    void interrupt(talkStopTarget(flightRef.current, fallbackBotId))
  }

  return {
    draft,
    setDraft,
    busy,
    flightBotId,
    sendError,
    setSendError,
    canSend: readyForTalk(options.kernelStatus) && !busy,
    send,
    stop
  }
}
