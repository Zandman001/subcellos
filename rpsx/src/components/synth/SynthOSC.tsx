import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'
import OscPreview from './OscPreview'
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys'

export default function SynthOSC() {
  const s = useBrowser() as any;
  const which = s.oscSelect === 0 ? 'A' : 'B';
  const ui = s.getSynthUI();
  const osc = which === 'A' ? ui.oscA : ui.oscB;
  const idx = which === 'A' ? 'oscA' : 'oscB';
  const part = (s as any).selectedSoundPart ?? 0;
  const step = 1/48; const clamp01 = (x:number)=> Math.max(0, Math.min(1, x));
  const setShape = (v:number)=> { const nv = clamp01(v); updateOsc(s, idx, { shape: nv }); s.setSynthParam(`part/${part}/${idx}/shape`, Math.round(nv*7), 'I32'); };
  const setDetune = (v:number)=> { const nv = clamp01(v); updateOsc(s, idx, { detune: nv }); s.setSynthParam(`part/${part}/${idx}/detune_cents`, (nv-0.5)*100, 'F32'); };
  const setFm = (v:number)=> { const nv = clamp01(v); updateOsc(s, idx, { fm: nv }); const fmPath = idx === 'oscA' ? `part/${part}/oscA/fm_to_B` : `part/${part}/oscB/fm_to_A`; s.setSynthParam(fmPath, nv); };
  const setLevel = (v:number)=> { const nv = clamp01(v); updateOsc(s, idx, { level: nv }); s.setSynthParam(`part/${part}/${idx}/level`, nv); };
  useFourKnobHotkeys({
    // Shape is discrete (8). Step by one index.
    dec1: ()=> { const idx = Math.max(0, Math.round(osc.shape*7) - 1); setShape(idx/7); },
    inc1: ()=> { const idx = Math.min(7, Math.round(osc.shape*7) + 1); setShape(idx/7); },
    dec2: ()=> setDetune(osc.detune - step), inc2: ()=> setDetune(osc.detune + step),
    dec3: ()=> setFm(osc.fm - step), inc3: ()=> setFm(osc.fm + step),
    dec4: ()=> setLevel(osc.level - step), inc4: ()=> setLevel(osc.level + step),
    active: true,
  });
  return (
    <Page title={`OSC · ${which}`}>
      <div style={{ margin: '12px 0' }}>
        <OscPreview which={which} />
      </div>
      <Row>
    <Knob label="Shape" value={osc.shape} step={8} onChange={(v)=> { updateOsc(s, idx, { shape: v }); s.setSynthParam(`part/${part}/${idx}/shape`, Math.round(v*7), 'I32'); }} format={(v)=>['sine','saw','square','tri','pulse','Noise W','Noise P','Noise B'][Math.round(v*7)]} />
  <Knob label="Detune" value={osc.detune} step={49} onChange={(v)=> { updateOsc(s, idx, { detune: v }); s.setSynthParam(`part/${part}/${idx}/detune_cents`, (v-0.5)*100, 'F32'); }} format={(v)=>`${Math.round((v-0.5)*100)}c`} />
  <Knob label="FM Amt" value={osc.fm} step={49} onChange={(v)=> { updateOsc(s, idx, { fm: v }); const fmPath = idx === 'oscA' ? `part/${part}/oscA/fm_to_B` : `part/${part}/oscB/fm_to_A`; s.setSynthParam(fmPath, v); }} format={(v)=>`${Math.round(v*100)}%`} />
  <Knob label="Level" value={osc.level} step={49} onChange={(v)=> { updateOsc(s, idx, { level: v }); s.setSynthParam(`part/${part}/${idx}/level`, v); }} format={(v)=>`${Math.round(v*100)}%`} />
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
