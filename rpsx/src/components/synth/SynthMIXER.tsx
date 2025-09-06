import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'

export default function SynthMIXER() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const mx = ui.mixer;
  
  return (
    <Page title={`MIXER`}>
      <Row>
        <Knob label="Volume" value={mx.volume} onChange={(v)=> { updateMx(s, { volume: v }); s.setSynthParam(`part/0/mixer/volume`, v); }} />
        <Knob label="Pan" value={mx.pan} onChange={(v)=> { updateMx(s, { pan: v }); s.setSynthParam(`part/0/mixer/pan`, (v-0.5)*2); }} format={(v)=>`${Math.round((v-0.5)*200)/100}`} />
        <Knob label="Haas Mix" value={mx.haas ?? 0} onChange={(v)=> { updateMx(s, { haas: v }); s.setSynthParam(`part/0/mixer/haas`, v); }} />
        <Knob label="Comp" value={mx.comp} onChange={(v)=> { updateMx(s, { comp: v }); s.setSynthParam(`part/0/mixer/comp`, v); }} />
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

function updateMx(s: any, patch: Partial<{volume:number;pan:number;haas:number;comp:number}>) {
  s.updateSynthUI((ui: any) => ({ ...ui, mixer: { ...ui.mixer, ...patch } }));
}
