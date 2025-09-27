import React, { useEffect, useState } from 'react'
import { rpc } from '../rpc'
import type { ViewName } from '../types/ui'
import { useBrowser } from '../store/browser'

type Props = {
  active: ViewName
  onSelect: (v: ViewName) => void
}

const NAV_HINT = '3=Prev / 4=Next';
const TABS: Array<{ key: ViewName; label: string; hotkey: string }> = [
  { key: 'Sounds',     label: 'SOUNDS',      hotkey: NAV_HINT },
  { key: 'Sequencer',  label: 'SEQUENCER',   hotkey: NAV_HINT },
  { key: 'Arrangement',label: 'ARRANGEMENT', hotkey: NAV_HINT },
  { key: 'Perform',    label: 'PERFORM',     hotkey: NAV_HINT },
]

export default function TopBar({ active, onSelect }: Props) {
  const s: any = useBrowser();
  const [bpm, setBpm] = useState<number>(120);
  // Reflect tempo changes from Shell hotkey and local edits
  useEffect(() => {
    const onTempo = (e: any) => {
      const next = e?.detail?.bpm;
      if (typeof next === 'number' && isFinite(next)) setBpm(next);
    };
    window.addEventListener('tempo-change', onTempo as any);
    return () => window.removeEventListener('tempo-change', onTempo as any);
  }, []);
  const setTempo = (next: number) => {
    const clamped = Math.min(300, Math.max(40, Math.round(next)));
    setBpm(clamped);
    rpc.setTempo(clamped);
    try { window.dispatchEvent(new CustomEvent('tempo-change', { detail: { bpm: clamped } })); } catch {}
  };
  // Removed legacy low-contrast & ark toggles; UI now always Ark-styled.
  return (
    <div className="topbar pixel-text" role="tablist" aria-label="Views">
      <div className="topbar-tabs" style={{ display:'flex', alignItems:'stretch' }}>
        {TABS.map(t => {
          const isActive = t.key === active
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              className={`tab ${isActive ? 'active' : ''}`}
              onClick={() => onSelect(t.key)}
              tabIndex={0}
              title={`${t.label} [${t.hotkey}]`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div style={{ flex:1 }} />
      <div className="tempo" style={{ display:'flex', alignItems:'center', gap:'var(--space-1)', paddingRight:'var(--space-2)' }}>
        <button className="tab" onClick={() => setTempo(bpm - 1)} title="Tempo -1" aria-label="Tempo down">-</button>
        <input
          aria-label="Tempo"
          className="tab"
          type="number"
          min={40}
          max={300}
          value={bpm}
          onChange={(e) => setBpm(parseInt(e.target.value || '0', 10) || 0)}
          onBlur={(e) => {
            const v = parseInt(e.target.value || '0', 10);
            setTempo(Number.isFinite(v) ? v : bpm);
          }}
          style={{ width:64, textAlign:'right', padding:'0 var(--space-2)' }}
        />
        <span style={{ paddingRight:'var(--space-2)' }}>BPM</span>
        <button className="tab" onClick={() => setTempo(bpm + 1)} title="Tempo +1" aria-label="Tempo up">+</button>
      </div>
  {/* Ark mode permanent - buttons removed */}
    </div>
  )
}
