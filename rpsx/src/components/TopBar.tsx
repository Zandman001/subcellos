import React from 'react'
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
      <button onClick={toggle} title="Toggle Low-Contrast Theme" className="tab" style={{ borderLeft: '1px solid var(--line)', background: low ? 'rgba(var(--accent-rgb),0.12)' : 'transparent' }}>
        LC
      </button>
    </div>
  )
}
