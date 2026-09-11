export type CohortApi = {
  home: () => Promise<unknown>
  select: (id: string) => Promise<unknown>
  kernel: () => Promise<unknown>
  connect: (input?: unknown) => Promise<unknown>
  thread: (botId: string) => Promise<unknown>
  send: (input: unknown) => Promise<unknown>
  onOpenSettings: (callback: () => void) => () => void
}
