export type CohortApi = {
  home: () => Promise<unknown>
  select: (id: string) => Promise<unknown>
  hatch: (name: string) => Promise<unknown>
  remove: (id: string) => Promise<unknown>
  kernel: () => Promise<unknown>
  connect: (input?: unknown) => Promise<unknown>
  thread: (botId: string) => Promise<unknown>
  send: (input: unknown) => Promise<unknown>
  room: () => Promise<unknown>
  roomSend: (input: unknown) => Promise<unknown>
  assign: (input: unknown) => Promise<unknown>
  interrupt: (botId: string) => Promise<unknown>
  coordination: () => Promise<unknown>
  onOpenSettings: (callback: () => void) => () => void
}
