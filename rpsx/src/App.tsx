import Shell from './Shell'
import ErrorBoundary from './components/ErrorBoundary'
import ArkPreviewView from './ark/ArkPreviewView'
import './ark/ark1bit.css'
import './ark/ark-integrations.css'
// Ark mode now permanent; store flag removed

export default function App() {
  const showArkPreview = typeof window !== 'undefined' && window.location.hash === '#ark';
  if (typeof document !== 'undefined') {
    document.body.classList.add('ark-mode');
  }
  return (
    <ErrorBoundary>
      {showArkPreview ? <ArkPreviewView /> : <Shell />}
    </ErrorBoundary>
  )
}
