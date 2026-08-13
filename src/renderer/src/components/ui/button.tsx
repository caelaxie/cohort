import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium leading-[1.2]',
    'outline-none transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out',
    'active:scale-[0.96]',
    'disabled:pointer-events-none disabled:bg-surface-2 disabled:text-ink-tertiary',
    'focus-visible:outline-2 focus-visible:outline-offset-2',
    'focus-visible:outline-[color-mix(in_srgb,var(--color-primary-focus)_50%,transparent)]'
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-focus',
        secondary: 'border border-hairline bg-surface-1 text-ink hover:bg-surface-2',
        outline: 'border border-hairline bg-surface-1 text-ink hover:bg-surface-2',
        ghost: 'bg-transparent text-ink hover:bg-surface-2'
      },
      size: {
        default: 'h-10 px-3.5 py-2',
        sm: 'h-8 px-3.5'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>

function Button({ className, variant, size, ...props }: ButtonProps): React.JSX.Element {
  return <ButtonPrimitive className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
