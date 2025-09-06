import React from 'react'

export default function EQPreview({ gains }: { gains: number[] }) {
  return (
    <div style={{ border: '1px solid var(--line)', padding: 6, marginBottom: 8, display: 'flex', gap: 6, height: 120, alignItems: 'flex-end', background: 'var(--bg)' }}>
      {gains.slice(0,8).map((g, i) => {
        const db = -12 + g * 24; // -12..+12
        const h = 4 + ((db + 12) / 24) * (120 - 16);
        return <div key={i} style={{ width: 10, height: h, background: 'rgba(var(--accent-rgb),0.85)' }} />
      })}
    </div>
  )
}
