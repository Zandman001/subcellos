import React from 'react'
import { useBrowser } from '../store/browser'

export default function LowResOverlay({ activeView }: { activeView: string }) {
  const state = useBrowser() as any
  const crumbs: string[] = []
  if (state.projectName) {
    crumbs.push(state.projectName)
    if (state.patternName) crumbs.push(state.patternName)
    if (state.patternName && state.selectedSoundName) crumbs.push(state.selectedSoundName)
  } else {
    crumbs.push('Projects')
  }
  const final = crumbs[crumbs.length - 1] || ''
  const abbrev = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

  // Map views to single-letter codes to save space
  const viewCodes: Record<string, string> = { Sounds: 'S', Sequencer: 'Q', Arrangement: 'A', Perform: 'P' }

  return (
    <div className="lowres-container pixel-text" aria-label="Low-res view 128x64">
      {/* Top row: view tabs */}
      <div className="lr-row lr-tabs">
        {(['Sounds','Sequencer','Arrangement','Perform'] as const).map(v => (
          <div key={v} className={`lr-tab ${v === activeView ? 'on' : ''}`}>{viewCodes[v]}</div>
        ))}
      </div>
      {/* Middle: current selection/name */}
      <div className="lr-row lr-main">
        <div className="lr-chip">{abbrev(final || '—', 16)}</div>
      </div>
      {/* Bottom: key hints */}
      <div className="lr-row lr-hints">
        <span>3◀</span>
        <span>▶4</span>
      </div>
    </div>
  )
}
