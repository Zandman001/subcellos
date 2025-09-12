import React, { useEffect, useState } from 'react'
import { rpc } from '../rpc'
import type { ViewName } from '../types/ui'

type Props = {
  active: ViewName
  onSelect: (v: ViewName) => void
}

const TABS: Array<{ key: ViewName; label: string; hotkey: string }> = [
  { key: 'Sounds',     label: 'SOUNDS',      hotkey: '1' },
  { key: 'Sequencer',  label: 'SEQUENCER',   hotkey: '2' },
  { key: 'Arrangement',label: 'ARRANGEMENT', hotkey: '3' },
  { key: 'Perform',    label: 'PERFORM',     hotkey: '4' },
]

export default function TopBar({ active, onSelect }: Props) {
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
  const [low, setLow] = React.useState<boolean>(false);
  React.useEffect(() => {
    const saved = localStorage.getItem('theme.low');
    const isLow = saved === '1';
    setLow(isLow);
    if (isLow) document.documentElement.setAttribute('data-theme', 'low');
    else document.documentElement.removeAttribute('data-theme');
  }, []);
  const toggle = () => {
    const next = !low;
    setLow(next);
    if (next) { document.documentElement.setAttribute('data-theme', 'low'); localStorage.setItem('theme.low', '1'); }
    else { document.documentElement.removeAttribute('data-theme'); localStorage.removeItem('theme.low'); }
  };
  return (
    <div className="topbar pixel-text" role="tablist" aria-label="Views" style={{ display: 'flex', alignItems: 'stretch' }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
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
      <div style={{ flex: 1 }} />
      <div className="tempo" style={{ display: 'flex', alignItems: 'center', gap: 6, paddingRight: 6 }}>
        <button className="tab" onClick={() => setTempo(bpm - 1)} title="Tempo -1">-</button>
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
          style={{ width: 64, textAlign: 'right', padding: '0 6px' }}
        />
        <span style={{ paddingRight: 6 }}>BPM</span>
        <button className="tab" onClick={() => setTempo(bpm + 1)} title="Tempo +1">+</button>
      </div>
      <button onClick={toggle} title="Toggle Low-Contrast Theme" className="tab" style={{ borderLeft: '1px solid var(--line)', background: low ? 'rgba(var(--accent-rgb),0.12)' : 'transparent' }}>
        LC
      </button>
    </div>
  )
}
