import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
  const viewOrder: ViewName[] = useMemo(() => ['Sounds', 'Sequencer', 'Arrangement', 'Perform'], [])

  const moveView = useCallback((delta: number) => {
    setView(prev => {
      const idx = viewOrder.indexOf(prev)
      const next = (idx + delta + viewOrder.length) % viewOrder.length
      return viewOrder[next]
    })
  }, [viewOrder])

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
        case '3':
          e.preventDefault()
          moveView(-1)
          break
        case '4':
          e.preventDefault()
          moveView(1)
          break
        case 't':
        case 'T': {
          // Quick tempo toggle example: cycle between a few tempos
          const s = useBrowserStore.getState();
          const cur = (s as any)._lastTempo ?? 120;
          const next = cur >= 140 ? 100 : cur >= 120 ? 140 : 120;
          (s as any)._lastTempo = next;
          rpc.setTempo(next);
          // Notify UI
          try { window.dispatchEvent(new CustomEvent('tempo-change', { detail: { bpm: next } })); } catch {}
          break;
        }
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
              if (s.sampleBrowserOpen) {
                sampleBrowser.closeSampleBrowser();
              } else {
                sampleBrowser.openSampleBrowser();
              }
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
  }, [moveView, view])

  return (
    <div className="app" style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--text)' }}>
      <TopBar active={view} onSelect={setView} />
      <div style={{ display: 'flex', flex: 1, gap: 4, padding: 4, boxSizing: 'border-box' }}>
        <ProjectBrowser />
        <RightPane view={view} />
      </div>
      <BrowserKeys />
      <SampleBrowser />
    </div>
  )
}
