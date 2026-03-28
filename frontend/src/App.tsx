import { Header } from '@/components/Header'
import { MainContent } from '@/components/MainContent'
import { useAppStore } from '@/stores/app-store'

function App() {
  const { isLoading, error, clearError } = useAppStore()

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <MainContent>
        {error && (
          <div className="mb-4 rounded-md bg-destructive/10 p-4 text-destructive">
            <p>{error}</p>
            <button
              onClick={clearError}
              className="mt-2 text-sm underline"
            >
              Dismiss
            </button>
          </div>
        )}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <h1 className="text-2xl font-bold">Welcome to Intelligent Reading Concept Graph</h1>
          <p className="mt-2 text-muted-foreground">
            Your AI-powered reading companion for building concept graphs
          </p>
        </div>
      </MainContent>
    </div>
  )
}

export default App