import { useState } from 'react'
import { readyForTalk, type KernelStatus } from '../../../shared/kernel'
import type { Teammate } from '../../../shared/roster'
import { sendCopy, type Running, type SendResult } from '../../../shared/talk'

type Props = {
  others: readonly Teammate[]
  kernelStatus: KernelStatus
  running: readonly Running[]
  onAssign: (botId: string, brief: string) => Promise<SendResult>
}

function fail(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

export function ChiefAssign({
  others,
  kernelStatus,
  running,
  onAssign
}: Props): React.JSX.Element | null {
  const [brief, setBrief] = useState('')
  const [assigneeDraft, setAssigneeDraft] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [coordError, setCoordError] = useState<string | null>(null)

  if (others.length === 0) return null

  const assignee = others.some((item) => item.id === assigneeDraft)
    ? assigneeDraft
    : (others[0]?.id ?? '')
  const canAssign =
    readyForTalk(kernelStatus) &&
    !assigning &&
    assignee.length > 0 &&
    brief.trim().length > 0 &&
    !running.some((item) => item.botId === assignee)

  async function onAssignSubmit(): Promise<void> {
    const target = others.find((item) => item.id === assignee)
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

  return (
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
          {others.map((item) => (
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
  )
}
