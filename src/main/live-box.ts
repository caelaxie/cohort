import type { BoxStarter } from './box'

export function createLiveBoxStarter(): BoxStarter {
  return async ({ hostPath, guestPath }) => {
    const { SimpleBox } = await import('@boxlite-ai/boxlite')
    const box = new SimpleBox({
      image: 'alpine:latest',
      workingDir: guestPath,
      network: { mode: 'disabled' },
      volumes: [{ hostPath, guestPath, readOnly: false }]
    })
    await box.exec('true')
    return {
      stop: async () => {
        await box.stop()
      }
    }
  }
}
