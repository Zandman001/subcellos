import Shell from './Shell'
import ErrorBoundary from './components/ErrorBoundary'

export default function App() {
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  )
}
