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
      padding: 12, 
      background: 'var(--neutral-1)',
      margin: '8px'
    }}>
      <div style={{ 
        fontSize: 12, 
        margin: '0 0 12px',
        color: 'var(--accent)',
        fontWeight: 'bold'
      }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>{children}</div>
  )
}

function updateOsc(s: any, key: 'oscA'|'oscB', patch: Partial<{shape:number;detune:number;fm:number;level:number}>) {
  s.updateSynthUI((ui: any) => ({ ...ui, [key]: { ...(ui as any)[key], ...patch } }));
}
