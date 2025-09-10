import React, { useEffect, useMemo, useState } from 'react'
import TopBar from './components/TopBar'
import ProjectBrowser from './components/ProjectBrowser'
import RightPane from './components/RightPane'
import BrowserKeys from './components/BrowserKeys'
import SampleBrowser from './components/SampleBrowser'
import type { ViewName } from './types/ui'
import { rpc } from './rpc'
import { sampleBrowser, useBrowserStore } from './store/browser'

export default function Shell() {
  const [view, setView] = useState<ViewName>('Sounds')

  useEffect(() => {
    // Pre-warm audio engine to avoid first-note startup latency
    (async () => { try { await rpc.startAudio(); } catch (_) {} })();
    
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (target as any).isContentEditable) return
      }
      switch (e.key) {
        case '1': setView('Sounds'); break
        case '2': setView('Sequencer'); break
        case '3': setView('Arrangement'); break
        case '4': setView('Perform'); break
        case 'r':
        case 'R': {
          // Start recording only if in Sounds view AND current module is sampler
            if (view === 'Sounds') {
              const s = useBrowserStore.getState();
              const selectedSoundId = s.selectedSoundId;
              const mk = selectedSoundId ? s.moduleKindById?.[selectedSoundId] : undefined;
              if (mk === 'sampler') {
                sampleBrowser.startRecording();
              }
            }
            break;
        }
        case 'w':
        case 'W': {
          if (view === 'Sounds') {
            const s = useBrowserStore.getState();
            const selectedSoundId = s.selectedSoundId;
            const mk = selectedSoundId ? s.moduleKindById?.[selectedSoundId] : undefined;
            if (mk === 'sampler') {
              sampleBrowser.openSampleBrowser();
            }
          }
          break;
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (target as any).isContentEditable) return
      }
      switch (e.key) {
        case 'r':
        case 'R': {
          if (view === 'Sounds') {
            const s = useBrowserStore.getState();
            const selectedSoundId = s.selectedSoundId;
            const mk = selectedSoundId ? s.moduleKindById?.[selectedSoundId] : undefined;
            if (mk === 'sampler') {
              sampleBrowser.stopRecording();
            }
          }
          break;
        }
      }
    }
    
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [view])

  return (
    <div className="app" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--text)' }}>
      <TopBar active={view} onSelect={setView} />
      <div style={{ display: 'flex', flex: 1, gap: 6, padding: 6, boxSizing: 'border-box' }}>
        <ProjectBrowser />
        <RightPane view={view} />
      </div>
      <BrowserKeys />
      <SampleBrowser />
    </div>
  )
}
