import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys'

export default function SynthMIXER() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const mx = ui.mixer;
  const step = 1/48; const clamp01 = (x:number)=> Math.max(0, Math.min(1, x));
  const setVol = (v:number)=> { const nv = clamp01(v); updateMx(s, { volume: nv }); s.setSynthParam(`part/0/mixer/volume`, nv); };
  const setPan = (v:number)=> { const nv = clamp01(v); updateMx(s, { pan: nv }); s.setSynthParam(`part/0/mixer/pan`, (nv-0.5)*2); };
  const setHaas = (v:number)=> { const nv = clamp01(v); updateMx(s, { haas: nv }); s.setSynthParam(`part/0/mixer/haas`, nv); };
  const setComp = (v:number)=> { const nv = clamp01(v); updateMx(s, { comp: nv }); s.setSynthParam(`part/0/mixer/comp`, nv); };
  useFourKnobHotkeys({
    dec1: ()=> setVol(mx.volume - step), inc1: ()=> setVol(mx.volume + step),
    dec2: ()=> setPan(mx.pan - step), inc2: ()=> setPan(mx.pan + step),
    dec3: ()=> setHaas((mx.haas ?? 0) - step), inc3: ()=> setHaas((mx.haas ?? 0) + step),
    dec4: ()=> setComp(mx.comp - step), inc4: ()=> setComp(mx.comp + step),
    active: true,
  });
  
  return (
    <Page title={`MIXER`}>
    <Row style={{ justifyContent:'center' }}>
  <Knob label="Volume" value={mx.volume} step={49} onChange={(v)=> { updateMx(s, { volume: v }); s.setSynthParam(`part/0/mixer/volume`, v); }} />
  <Knob label="Pan" value={mx.pan} step={41} onChange={(v)=> { updateMx(s, { pan: v }); s.setSynthParam(`part/0/mixer/pan`, (v-0.5)*2); }} format={(v)=>`${Math.round((v-0.5)*200)/100}`} />
  <Knob label="Haas Mix" value={mx.haas ?? 0} step={49} onChange={(v)=> { updateMx(s, { haas: v }); s.setSynthParam(`part/0/mixer/haas`, v); }} />
  <Knob label="Comp" value={mx.comp} step={49} onChange={(v)=> { updateMx(s, { comp: v }); s.setSynthParam(`part/0/mixer/comp`, v); }} />
      </Row>
    </Page>
  );
}

function Page({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div style={{ padding: 8 }}>
      <div style={{ fontSize: 12, margin: '0 0 8px', color: 'var(--accent)' }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children, style }: { children: React.ReactNode, style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', gap: 12, ...(style || {}) }}>{children}</div>
  )
}

function updateMx(s: any, patch: Partial<{volume:number;pan:number;haas:number;comp:number}>) {
  s.updateSynthUI((ui: any) => ({ ...ui, mixer: { ...ui.mixer, ...patch } }));
}
