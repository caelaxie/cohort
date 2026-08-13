import { Button } from '@/components/ui/button'

function App(): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-start gap-4 p-6">
      <h1 className="text-xl font-semibold">Cohort</h1>
      <p className="text-sm text-muted-foreground">Create a workspace to get started.</p>
      <Button type="button">Create workspace</Button>
    </main>
  )
}

export default App
