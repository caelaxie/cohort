import { cn } from '@/lib/utils'

type InputProps = React.ComponentProps<'input'>

function Input({ className, type = 'text', ...props }: InputProps): React.JSX.Element {
  return (
    <input
      type={type}
      className={cn(
        'h-10 w-full rounded-md border border-hairline bg-surface-1 px-3 py-2 text-base text-ink',
        'placeholder:text-ink-tertiary',
        'outline-none transition-[border-color,box-shadow] duration-150 ease-out',
        'focus-visible:outline-2 focus-visible:outline-offset-2',
        'focus-visible:outline-[color-mix(in_srgb,var(--color-primary-focus)_50%,transparent)]',
        'disabled:text-ink-tertiary',
        className
      )}
      {...props}
    />
  )
}

export { Input }
