type Props = {
  files: string[]
}

export function WorkspaceFilesSidebar({ files }: Props): React.JSX.Element {
  return (
    <aside className="flex w-[244px] shrink-0 flex-col border-l border-hairline bg-surface-1">
      <div className="flex h-14 items-center px-3" />

      <div className="flex items-center px-3 pb-2">
        <h2 className="text-[13px] font-medium tracking-[0.4px] text-ink-subtle">Files</h2>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-2 pb-3">
        {files.map((name) => (
          <li key={name} className="truncate px-2 py-1.5 text-sm text-ink-muted" title={name}>
            {name}
          </li>
        ))}
      </ul>
    </aside>
  )
}
