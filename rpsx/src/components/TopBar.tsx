import React from 'react'
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
  {/* Ark mode permanent - buttons removed */}
    </div>
  )
}
