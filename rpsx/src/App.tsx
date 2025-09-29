import Shell from './Shell'
import ErrorBoundary from './components/ErrorBoundary'
import './ark/ark1bit.css'
import './ark/ark-integrations.css'
// Ark mode now permanent; store flag removed

export default function App() {
  if (typeof document !== 'undefined') {
    document.body.classList.add('ark-mode');
  }
  return (
    <ErrorBoundary>
      <Shell />
    </ErrorBoundary>
  )
}
