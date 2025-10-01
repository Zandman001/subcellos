import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'
import EQPreview from './EQPreview'
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys'

export default function SynthEQ() {
  const s = useBrowser() as any;
  const group = s.eqGroup === 0 ? '1–4' : '5–8';
  const ui = s.getSynthUI();
  const gains = ui.eq.gains;
  const base = s.eqGroup === 0 ? 0 : 4;
  const clamp01 = (x:number)=> Math.max(0, Math.min(1, x));
  const step = 1/48;
  useFourKnobHotkeys({
    dec1: ()=> setEqGain(s, base+0, clamp01(gains[base+0] - step)), inc1: ()=> setEqGain(s, base+0, clamp01(gains[base+0] + step)),
    dec2: ()=> setEqGain(s, base+1, clamp01(gains[base+1] - step)), inc2: ()=> setEqGain(s, base+1, clamp01(gains[base+1] + step)),
    dec3: ()=> setEqGain(s, base+2, clamp01(gains[base+2] - step)), inc3: ()=> setEqGain(s, base+2, clamp01(gains[base+2] + step)),
    dec4: ()=> setEqGain(s, base+3, clamp01(gains[base+3] - step)), inc4: ()=> setEqGain(s, base+3, clamp01(gains[base+3] + step)),
    active: true,
  });
  return (
    <Page title={`EQ · ${group}`}>
      <EQPreview gains={gains} />
      <Row>
        {[0,1,2,3].map(i => (
          <Knob key={i} label={`Gain ${i+1}`} value={gains[base+i]} onChange={(v)=> setEqGain(s, base+i, v)} format={(v)=>`${Math.round((-12+v*24))} dB`} />
        ))}
      </Row>
    </Page>
  );
}

function Page({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div style={{ padding: 8, borderTop: '1px solid var(--line)' }}>
      <div style={{ fontSize: 12, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>{children}</div>
  )
}

function setEqGain(s: any, idx: number, v: number) {
  s.updateSynthUI((ui: any) => {
    const nextG = ui.eq.gains.slice(); nextG[idx] = v;
    return { ...ui, eq: { gains: nextG } };
  });
  const part = (s as any).selectedSoundPart ?? 0;
  s.setSynthParam(`part/${part}/eq/gain_db/b${idx+1}`, -12 + v*24);
}
