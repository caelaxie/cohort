type Props = {
  name?: string
  brief?: string
  onStop: () => void
}

export function WorkingStatus({ name, brief, onStop }: Props): React.JSX.Element {
  return (
    <>
      {name !== undefined && brief !== undefined ? (
        <p role="status" className="min-w-0 flex-1 text-sm text-ink">
          {name} is working on {brief}
        </p>
      ) : null}
      <button
        type="button"
        className="rounded-md border border-hairline bg-surface-1 px-3.5 py-2 text-sm font-medium text-ink hover:bg-surface-2"
        onClick={onStop}
      >
        Stop
      </button>
    </>
  )
}
