import React, { useCallback, useEffect, useMemo, useState } from 'react'
import TopBar from './components/TopBar'
import ProjectBrowser from './components/ProjectBrowser'
import RightPane from './components/RightPane'
import BrowserKeys from './components/BrowserKeys'
import SampleBrowser from './components/SampleBrowser'
import ProjectSettings from './components/ProjectSettings'
import type { ViewName } from './types/ui'
import { rpc } from './rpc'
import { sampleBrowser, useBrowser, useBrowserStore } from './store/browser'
import { useSequencer, sequencerToggleLocalFor, sequencerSetPart } from './store/sequencer'
import { keyIs } from './utils/key'

export default function Shell() {
  const [view, setView] = useState<ViewName>('Sounds')
  const browser = useBrowser() as any;
  const selectedSoundId = browser?.selectedSoundId || '__none__';
  const seq = useSequencer(selectedSoundId);
  const viewOrder: ViewName[] = useMemo(() => ['Sounds', 'Sequencer', 'Arrangement', 'Perform'], [])
  // Fixed-canvas base resolution presets (16:9)
  const basePresets = useMemo(() => ([
    { w: 320, h: 180 },
    { w: 480, h: 270 },
    { w: 640, h: 360 },
    { w: 800, h: 450 },
    { w: 960, h: 540 },
    { w: 1280, h: 720 },
    { w: 1600, h: 900 },
  ]), [])
  // Start smaller by default so the UI appears larger on small screens (480x270)
  const [baseIdx, setBaseIdx] = useState(1)

  useEffect(() => {
    const store = useBrowserStore.getState()
    store.setActiveView?.(view)
  }, [view])

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
    
    const applyCssVars = (vars: Record<string, string | number>) => {
      const root = document.documentElement;
      const body = document.body;
      Object.entries(vars).forEach(([k, v]) => {
        root.style.setProperty(k, String(v));
        body.style.setProperty(k, String(v));
      });
    };

    // Theme state trackers (kept on window to persist across HMR reloads)
    const themeState = (window as any).__ARK_THEME_STATE__ || ((window as any).__ARK_THEME_STATE__ = {
      dotAlphaIdx: 1, // 0..n
      dotStepIdx: 1,
      dotSizeIdx: 0,
      sepWIdx: 1,
    });

    const dotAlphaPresets = [0.10, 0.16, 0.22, 0.30];
    const dotStepPresets = ['6px', '4px', '3px', '2px']; // denser to the right
    const dotSizePresets = ['1px', '2px', '3px'];
    const sepWPresets = ['2px', '3px', '4px'];

  const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (target as any).isContentEditable) return
      }
      const code = (e as any).code as string | undefined;
      const key = e.key;
      // If Project Settings overlay is open, only allow closing with 'O' here; let overlay handle the rest
      try {
        const bs = useBrowserStore.getState() as any;
        if (bs.projectSettingsOpen) {
          if (keyIs(e, ['KeyO'], ['o','O'])) { e.preventDefault(); bs.closeProjectSettings?.(); }
          return;
        }
      } catch {}
      const isDigit = (d: string) => code === `Digit${d}` || code === `Numpad${d}` || key === d;
      // Global: Tabs 1..4 (Sounds, Sequencer, Arrangement, Perform)
      if (isDigit('1')) { e.preventDefault(); setView('Sounds'); return; }
      if (isDigit('2')) { e.preventDefault(); setView('Sequencer'); return; }
      if (isDigit('3')) { e.preventDefault(); setView('Arrangement'); return; }
      if (isDigit('4')) { e.preventDefault(); setView('Perform'); return; }
      // Global: Open Project Settings with 'O'
      if (keyIs(e, ['KeyO'], ['o','O'])) { e.preventDefault(); try { useBrowserStore.getState().openProjectSettings?.(); } catch {} return; }
      // Global: Transport — I = Local, U = Global
      if (keyIs(e, ['KeyI'], ['i','I'])) {
        e.preventDefault();
        try {
          // Ensure routing is set before toggling local play
          const s = useBrowserStore.getState() as any;
          // Only allow local play when at sound-selection or synth levels
          const lvl = s.level as string | undefined;
          const atSoundLevel = lvl === 'pattern' || lvl === 'synth';
          if (!atSoundLevel) {
            // Ignore I outside sound levels (e.g., projects/project/patterns)
            return;
          }
          let sid = s.selectedSoundId;
          // Fallback: if no selected id (e.g., in sound picker focus), use the highlighted item
          if (!sid && Array.isArray(s.soundIdsAtLevel)) {
            const idx = Math.max(0, Math.min((s.items?.length||0)-1, s.selected||0));
            sid = s.soundIdsAtLevel[idx];
            if (sid) {
              // Also sync selectedSoundId so UI reflects it
              (s as any).selectedSoundId = sid;
              (s as any).selectedSoundPart = (s.soundPartsAtLevel||[])[idx] ?? 0;
            }
          }
          if (sid) {
            const part = typeof s.selectedSoundPart === 'number' ? s.selectedSoundPart : 0;
            const mk = s.moduleKindById?.[sid];
            // Push routing to sequencer store for this sound so local play has proper context
            sequencerSetPart(sid, part, mk === 'drum' ? 'drum' : mk === 'sampler' ? 'sampler' : 'synth');
            // Toggle local for that specific sound
            sequencerToggleLocalFor(sid);
          } else {
            // Fallback to current hook-based instance
            seq.toggleLocalPlay?.();
          }
        } catch {}
        return;
      }
      if (keyIs(e, ['KeyU'], ['u','U'])) {
        e.preventDefault();
        try {
          const s = useBrowserStore.getState() as any;
          // Gate: allow global play at patterns list, pattern, or synth
          const lvl = s.level as string | undefined;
          const allowGlobal = lvl === 'patterns' || lvl === 'pattern' || lvl === 'synth';
          if (!allowGlobal) return; // ignore behind patterns (projects/project)
          // Ensure routing is set before toggling global play
          const sid = s.selectedSoundId;
          if (sid) {
            const part = s.selectedSoundPart;
            if (typeof part === 'number') seq.setPart?.(part);
            const mk = s.moduleKindById?.[sid];
            if (mk === 'drum') seq.setModuleKind?.('drum');
            else if (mk === 'sampler') seq.setModuleKind?.('sampler');
            else seq.setModuleKind?.('synth');
          }
          seq.toggleGlobalPlay?.();
        } catch {}
        return;
      }
      switch (true) {
        case isDigit('7'): { // Dot alpha
          e.preventDefault();
          themeState.dotAlphaIdx = (themeState.dotAlphaIdx + 1) % dotAlphaPresets.length;
          const val = dotAlphaPresets[themeState.dotAlphaIdx];
          applyCssVars({ '--ark-dot-alpha': String(val) });
          break;
        }
        case isDigit('8'): { // Dot step (density)
          e.preventDefault();
          themeState.dotStepIdx = (themeState.dotStepIdx + 1) % dotStepPresets.length;
          const val = dotStepPresets[themeState.dotStepIdx];
          applyCssVars({ '--ark-dot-step': val });
          break;
        }
        case isDigit('9'): { // Dot size
          e.preventDefault();
          themeState.dotSizeIdx = (themeState.dotSizeIdx + 1) % dotSizePresets.length;
          const val = dotSizePresets[themeState.dotSizeIdx];
          applyCssVars({ '--ark-dot-size': val });
          break;
        }
        case isDigit('0'): { // Separator thickness
          e.preventDefault();
          themeState.sepWIdx = (themeState.sepWIdx + 1) % sepWPresets.length;
          const val = sepWPresets[themeState.sepWIdx];
          applyCssVars({ '--ark-sep-w': val });
          break;
        }
        case isDigit('3'):
          e.preventDefault()
          moveView(-1)
          break
        case isDigit('4'):
          e.preventDefault()
          moveView(1)
          break
        case key === '[': {
          // Cycle to a smaller base (UI appears larger)
          e.preventDefault();
          setBaseIdx(i => Math.max(0, i - 1));
          break;
        }
        case key === ']': {
          // Cycle to a larger base (more detail if space allows)
          e.preventDefault();
          setBaseIdx(i => Math.min(basePresets.length - 1, i + 1));
          break;
        }
  // Space is used elsewhere; no global toggle now
        case key === 'r' || key === 'R': {
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
        case key === 'w' || key === 'W': {
          if (view === 'Sounds') {
            const s = useBrowserStore.getState();
            const selectedSoundId = s.selectedSoundId;
            const mk = selectedSoundId ? s.moduleKindById?.[selectedSoundId] : undefined;
            // Only allow entering the sample picker when we're on the Sampler module
            // AND the current right-pane page is the primary "SAMPLER" tab
            const currentPage = Array.isArray(s.synthPages) ? s.synthPages[s.synthPageIndex] : undefined;
            const atSynthLevel = (s as any).level === 'synth';
            if (mk === 'sampler' && currentPage === 'SAMPLER' && atSynthLevel) {
              if (s.sampleBrowserOpen) {
                sampleBrowser.closeSampleBrowser();
              } else {
                sampleBrowser.openSampleBrowser();
              }
            }
          }
          break;
        }
        default: {
          // no-op
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (target as any).isContentEditable) return
      }
      const code = (e as any).code as string | undefined;
      const key = e.key;
      switch (true) {
        case (code === 'KeyR' || key === 'r' || key === 'R'): {
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

  // Fixed-canvas 16:9 scaling with adjustable base preset
  useEffect(() => {
    const root = document.documentElement
    document.body.classList.add('ark-fixed')
    const apply = () => {
      const { w: BASE_W, h: BASE_H } = basePresets[baseIdx]
      root.style.setProperty('--ark-base-w', BASE_W + 'px')
      root.style.setProperty('--ark-base-h', BASE_H + 'px')
      const ww = window.innerWidth
      const wh = window.innerHeight
      const sx = ww / BASE_W
      const sy = wh / BASE_H
      const raw = Math.min(sx, sy)
      // If we have room, snap to an integer for crisp pixels; otherwise allow fractional fit
      const s = raw >= 1 ? Math.floor(raw) : Math.max(0.1, raw)
      const usedW = BASE_W * s
      const usedH = BASE_H * s
      const left = Math.floor((ww - usedW) / 2)
      const top = Math.floor((wh - usedH) / 2)
      root.style.setProperty('--ark-scale', String(s))
      root.style.setProperty('--ark-left', left + 'px')
      root.style.setProperty('--ark-top', top + 'px')
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [baseIdx, basePresets])

  return (
    <div className={'ark-fixed-frame'}>
      <div className="app" style={{ display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--text)' }}>
      <TopBar active={view} onSelect={setView} />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 4, padding: 4, boxSizing: 'border-box' }}>
        <ProjectBrowser />
        <RightPane view={view} />
      </div>
      <BrowserKeys />
      <SampleBrowser />
  <ProjectSettings />
      </div>
    </div>
  )
}
