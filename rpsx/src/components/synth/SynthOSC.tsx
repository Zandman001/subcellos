import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'
import OscPreview from './OscPreview'

export default function SynthOSC() {
  const s = useBrowser() as any;
  const which = s.oscSelect === 0 ? 'A' : 'B';
  const ui = s.getSynthUI();
  const osc = which === 'A' ? ui.oscA : ui.oscB;
  const idx = which === 'A' ? 'oscA' : 'oscB';
  return (
    <Page title={`OSC · ${which}`}>
      <div style={{ margin: '12px 0' }}>
        <OscPreview which={which} />
      </div>
      <Row>
        <Knob label="Shape" value={osc.shape} step={8} onChange={(v)=> { updateOsc(s, idx, { shape: v }); s.setSynthParam(`part/0/${idx}/shape`, Math.round(v*7), 'I32'); }} format={(v)=>['sine','saw','square','tri','pulse','Noise W','Noise P','Noise B'][Math.round(v*7)]} />
        <Knob label="Detune" value={osc.detune} onChange={(v)=> { updateOsc(s, idx, { detune: v }); s.setSynthParam(`part/0/${idx}/detune_cents`, (v-0.5)*100, 'F32'); }} format={(v)=>`${Math.round((v-0.5)*100)}c`} />
        <Knob label="FM Amt" value={osc.fm} onChange={(v)=> { updateOsc(s, idx, { fm: v }); const fmPath = idx === 'oscA' ? `part/0/oscA/fm_to_B` : `part/0/oscB/fm_to_A`; s.setSynthParam(fmPath, v); }} format={(v)=>`${Math.round(v*100)}%`} />
        <Knob label="Level" value={osc.level} onChange={(v)=> { updateOsc(s, idx, { level: v }); s.setSynthParam(`part/0/${idx}/level`, v); }} format={(v)=>`${Math.round(v*100)}%`} />
      </Row>
    </Page>
  );
}

function Page({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div style={{ 
      padding: 8, 
      borderTop: '3px solid var(--accent)',
      background: 'rgba(var(--neutral-1), 0.4)',
      backdropFilter: 'blur(10px)',
      boxShadow: '0 0 20px rgba(var(--accent-rgb), 0.1), inset 0 1px 0 rgba(var(--accent-rgb), 0.2)'
    }}>
      <div style={{ 
        height: 2, 
        background: 'linear-gradient(90deg, var(--accent), var(--glow), var(--accent))',
        boxShadow: '0 0 10px var(--accent)'
      }} />
      <div style={{ 
        fontSize: 12, 
        margin: '6px 0 8px', 
        color: 'var(--accent)',
        textShadow: '0 0 8px currentColor'
      }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>{children}</div>
  )
}

function updateOsc(s: any, key: 'oscA'|'oscB', patch: Partial<{shape:number;detune:number;fm:number;level:number}>) {
  s.updateSynthUI((ui: any) => ({ ...ui, [key]: { ...(ui as any)[key], ...patch } }));
}
