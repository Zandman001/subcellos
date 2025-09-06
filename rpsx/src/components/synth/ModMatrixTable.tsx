import React from 'react'
import { useBrowser } from '../../store/browser'

const DESTS = [
  "None",
  "Osc A: Pitch (¢)",
  "Osc B: Pitch (¢)",
  "Osc A: Level",
  "Osc B: Level",
  "Filter 1: Cutoff",
  "Filter 2: Cutoff",
  "Mixer: Pan",
  "Mixer: Volume",
  "FX1: Mix",
  "FX2: Mix",
];

export default function ModMatrixTable() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const lSel = ui.mod.lfoRow; const eSel = ui.mod.envRow;
  return (
    <div style={{ border: '2px solid var(--line)', padding: 6, marginBottom: 8, background: 'var(--bg)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
        <div>LFO</div>
        <div>ENV</div>
        {Array.from({ length: 5 }).map((_, i) => (
          <React.Fragment key={i}>
            <Cell selected={i===lSel} dest={ui.mod.lfo[i].dest} amount={ui.mod.lfo[i].amount} />
            <Cell selected={i===eSel} dest={ui.mod.env[i].dest} amount={ui.mod.env[i].amount} />
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

function Cell({ dest, amount, selected }: { dest: number; amount?: number; selected: boolean }) {
  const amt = typeof amount === 'number' ? amount : 1;
  const absPct = Math.min(100, Math.abs(amt) * 100);
  const label = dest === 0 ? 'None' : DESTS[dest] || 'None';
  const sign = amt >= 0 ? '+' : '−';
  return (
    <div className="mm-row" style={{ position: 'relative', border: '2px solid var(--accent)', padding: 4, overflow: 'hidden', background: 'var(--bg)' }}>
      <div className="mm-fill" style={{ position: 'absolute', inset: 0, width: `${absPct}%`, background: `rgba(var(--accent-rgb), 0.16)` }} />
      <span className="mm-label" style={{ position: 'relative', zIndex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text)' }}>{label}</span>
      <span className="mm-amt" style={{ position: 'absolute', right: 6, top: 2, zIndex: 1, opacity: 0.85, color: 'var(--accent-2)' }}>{sign}{Math.abs(amt).toFixed(2)}</span>
      {selected && <div style={{ position: 'absolute', inset: -2, border: '2px solid var(--accent-2)', pointerEvents: 'none' }} />}
    </div>
  )
}

export { DESTS as MOD_DEST_LIST };
