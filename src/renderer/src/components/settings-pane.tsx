import { useState } from 'react'
import { readyForTalk, type KernelStatus } from '../../../shared/kernel'

type Props = {
  status: KernelStatus | null
  error: string | null
  onConnect: (input?: unknown) => Promise<void>
}

function kernelLine(status: KernelStatus): string {
  return readyForTalk(status) ? status.model : 'No model connected'
}

export function SettingsPane({ status, error, onConnect }: Props): React.JSX.Element {
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const pasteMethods = status?.methods.filter((method) => method.kind === 'paste') ?? []
  const probeMethod = status?.methods.find((method) => method.kind === 'probe')

  async function runConnect(input?: unknown): Promise<void> {
    setBusy(true)
    try {
      await onConnect(input)
      setSecrets({})
    } catch {
      return
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-hairline px-6">
        <h1 className="font-display truncate text-balance text-[22px] font-medium tracking-[-0.4px] text-ink">
          Settings
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <article className="max-w-xl rounded-lg border border-hairline bg-surface-1 p-6">
          <h2 className="font-display text-lg font-medium tracking-[-0.2px] text-ink">Model</h2>
          <p className="mt-2 text-sm text-ink-muted">
            Hatch uses a subscription you already pay for. Cohort does not meter a weekly cap.
          </p>
          {status ? <p className="mt-4 text-sm text-ink">{kernelLine(status)}</p> : null}

          {probeMethod ? (
            <button
              type="button"
              disabled={busy}
              className="mt-5 rounded-md border border-hairline bg-surface-1 px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
              onClick={() => {
                void runConnect({ kind: 'probe' })
              }}
            >
              {probeMethod.label}
            </button>
          ) : null}

          <div className="mt-5 flex flex-col gap-4">
            {pasteMethods.map((method) => (
              <form
                key={method.id}
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void runConnect({
                    kind: 'paste',
                    id: method.id,
                    secret: secrets[method.id] ?? ''
                  })
                }}
              >
                <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm text-ink">
                  {method.label}
                  <input
                    type="password"
                    value={secrets[method.id] ?? ''}
                    disabled={busy}
                    className="rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
                    onChange={(event) => {
                      const value = event.target.value
                      setSecrets((prev) => ({ ...prev, [method.id]: value }))
                    }}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
                >
                  Connect
                </button>
              </form>
            ))}
          </div>

          {error ? (
            <p className="mt-4 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </article>
      </div>
    </section>
  )
}
