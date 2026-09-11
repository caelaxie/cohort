import { useState } from 'react'
import { ENDPOINT_PRESETS, readyForTalk, type KernelStatus } from '../../../shared/kernel'

type Props = {
  status: KernelStatus
  error: string | null
  onConnect: (input?: unknown) => Promise<void>
}

type Draft = {
  readonly baseUrl: string
  readonly model: string
  readonly secret: string
}

export function SettingsPane({ status, error, onConnect }: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)

  const ready = readyForTalk(status)
  const baseUrl = draft?.baseUrl ?? (ready ? status.baseUrl : '')
  const model = draft?.model ?? (ready ? status.model : '')
  const secret = draft?.secret ?? ''

  async function runConnect(input?: unknown): Promise<void> {
    setBusy(true)
    try {
      await onConnect(input)
      setDraft(null)
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
            Chief uses an OpenAI-compatible chat completions endpoint. Cohort does not meter a
            weekly cap.
          </p>
          {ready ? (
            <>
              <p className="mt-4 text-sm text-ink">{status.model}</p>
              <p className="text-sm text-ink-muted">{status.baseUrl}</p>
            </>
          ) : (
            <p className="mt-4 text-sm text-ink">No model connected</p>
          )}

          <button
            type="button"
            disabled={busy}
            className="mt-5 rounded-md border border-hairline bg-surface-1 px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
            onClick={() => {
              void runConnect({ kind: 'probe' })
            }}
          >
            Use a key already on this Mac
          </button>

          <div className="mt-5 flex flex-wrap gap-2">
            {ENDPOINT_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                disabled={busy}
                className="rounded-md border border-hairline bg-surface-1 px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2 disabled:opacity-50"
                onClick={() => {
                  setDraft({
                    baseUrl: preset.baseUrl,
                    model: preset.model,
                    secret
                  })
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <form
            className="mt-5 flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void runConnect({
                kind: 'paste',
                baseUrl,
                model,
                secret
              })
            }}
          >
            <label className="flex min-w-0 flex-col gap-1.5 text-sm text-ink">
              Base URL
              <input
                type="text"
                value={baseUrl}
                disabled={busy}
                className="rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
                onChange={(event) => {
                  setDraft({
                    baseUrl: event.target.value,
                    model,
                    secret
                  })
                }}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm text-ink">
              Model
              <input
                type="text"
                value={model}
                disabled={busy}
                className="rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
                onChange={(event) => {
                  setDraft({
                    baseUrl,
                    model: event.target.value,
                    secret
                  })
                }}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm text-ink">
              API key
              <input
                type="password"
                value={secret}
                disabled={busy}
                className="rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink"
                onChange={(event) => {
                  setDraft({
                    baseUrl,
                    model,
                    secret: event.target.value
                  })
                }}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="self-start rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-on-primary hover:bg-primary-hover disabled:opacity-50"
            >
              Connect
            </button>
          </form>

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
