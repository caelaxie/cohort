import { useEffect } from 'react'
import type { PendingApproval } from '../../../shared/approval'

type Props = {
  pending: readonly PendingApproval[]
  nameFor: (botId: string) => string
  onApprove: (id: string) => void
  onDeny: (id: string) => void
  onDismiss: () => void
}

export function ApprovalPrompt({
  pending,
  nameFor,
  onApprove,
  onDeny,
  onDismiss
}: Props): React.JSX.Element | null {
  useEffect(() => {
    if (pending.length === 0) return
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending.length, onDismiss])

  if (pending.length === 0) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-overlay/60 px-6"
      onClick={onDismiss}
    >
      <article
        role="dialog"
        aria-modal="true"
        aria-labelledby="approval-title"
        className="w-full max-w-lg rounded-lg border border-hairline bg-surface-1 p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <h2
          id="approval-title"
          className="font-display text-lg font-medium tracking-[-0.2px] text-ink"
        >
          Ask first
        </h2>
        <p className="mt-2 text-sm text-ink-muted">Only you approve. Deny is the safe default.</p>
        <ul className="mt-5 flex flex-col gap-4">
          {pending.map((request, index) => (
            <li key={request.id} className="rounded-md border border-hairline bg-canvas p-4">
              <p className="text-sm text-ink">
                {nameFor(request.botId)} wants to {request.action}
              </p>
              <p className="mt-2 text-sm text-ink">{request.summary}</p>
              {request.payload.length > 0 ? (
                <p className="mt-2 font-mono text-[13px] text-ink-muted">{request.payload}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  autoFocus={index === 0}
                  className="rounded-md border border-hairline bg-surface-1 px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
                  onClick={() => {
                    onDeny(request.id)
                  }}
                >
                  Deny
                </button>
                <button
                  type="button"
                  className="rounded-md border border-hairline bg-canvas px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
                  onClick={() => {
                    onApprove(request.id)
                  }}
                >
                  Approve
                </button>
              </div>
            </li>
          ))}
        </ul>
      </article>
    </div>
  )
}
