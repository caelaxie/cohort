import type { Thread } from '../shared/talk'

export type TurnResult =
  | { readonly kind: 'ok'; readonly body: string }
  | { readonly kind: 'needs_login' }
  | { readonly kind: 'turn_failed'; readonly detail: string }

export type Turn = (input: {
  readonly prior: Thread
  readonly ownerBody: string
}) => Promise<TurnResult>
