import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'
import FilterPreview from './FilterPreview'
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys'

export default function SynthFILTER() {
  const s = useBrowser() as any;
  const which = s.filterSelect === 0 ? '1' : '2';
  const ui = s.getSynthUI();
  const filt = which === '1' ? ui.filter1 : ui.filter2;
  const key = which === '1' ? 'filter1' : 'filter2';
  // Hotkeys: nudge values with fixed steps
  const stepSmall = 1/48; // ~1 semitone worth for pitch-like params; fine for others
  const clamp01 = (x:number)=> Math.max(0, Math.min(1, x));
  const setType = (v:number)=> { const nv = clamp01(v); updateFilt(s, key, { type: nv }); s.setSynthParam(`part/0/${key}/type`, Math.round(nv*3), 'I32'); };
  const setCut = (v:number)=> { const nv = clamp01(v); updateFilt(s, key, { cutoff: nv }); s.setSynthParam(`part/0/${key}/cutoff_hz`, mapCutoff(nv)); };
  const setRes = (v:number)=> { const nv = clamp01(v); updateFilt(s, key, { res: nv }); s.setSynthParam(`part/0/${key}/q`, mapQ(nv)); };
  const setAssign = (v:number)=> { const i = Math.max(0, Math.min(3, Math.round(v*3))); updateFilt(s, key, { assign: i }); s.setSynthParam(`part/0/${key}/assign`, i, 'I32'); };
  useFourKnobHotkeys({
    // Type discrete 4: step by 1/3 per press
    dec1: ()=> { const idx = Math.max(0, Math.round(filt.type*3) - 1); setType(idx/3); },
    inc1: ()=> { const idx = Math.min(3, Math.round(filt.type*3) + 1); setType(idx/3); },
    dec2: ()=> setCut(filt.cutoff - stepSmall),
    inc2: ()=> setCut(filt.cutoff + stepSmall),
    dec3: ()=> setRes(filt.res - stepSmall),
    inc3: ()=> setRes(filt.res + stepSmall),
  // Assign discrete 4
  dec4: ()=> { const idx = Math.max(0, Math.round(((filt.assign ?? 3)/3)*3) - 1); setAssign(idx/3); },
  inc4: ()=> { const idx = Math.min(3, Math.round(((filt.assign ?? 3)/3)*3) + 1); setAssign(idx/3); },
    active: true,
  });
  return (
    <Page title={`FILTER · ${which}`}>
      <FilterPreview type={filt.type} cutoff={filt.cutoff} q={filt.res} />
      <Row>
  <Knob label="Type" value={filt.type} step={4} onChange={(v)=> { updateFilt(s, key, { type: v }); s.setSynthParam(`part/0/${key}/type`, Math.round(v*3), 'I32'); }} format={(v)=>['LP','HP','BP','Notch'][Math.round(v*3)]} />
  <Knob label="Cutoff" value={filt.cutoff} step={49} onChange={(v)=> { updateFilt(s, key, { cutoff: v }); s.setSynthParam(`part/0/${key}/cutoff_hz`, mapCutoff(v)); }} format={(v)=>`${Math.round(mapCutoff(v))} Hz`} />
  <Knob label="Resonance" value={filt.res} step={49} onChange={(v)=> { updateFilt(s, key, { res: v }); s.setSynthParam(`part/0/${key}/q`, mapQ(v)); }} format={(v)=>`${mapQ(v).toFixed(2)} Q`} />
  <Knob label="Assign" value={(filt.assign ?? 3)/3} step={4} onChange={(v)=> { const a = Math.round(v*3); updateFilt(s, key, { assign: a }); s.setSynthParam(`part/0/${key}/assign`, a, 'I32'); }} format={(v)=>['None','A','B','AB'][Math.round(v*3)]} />
      </Row>
    </Page>
  );
}

function Page({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div style={{ padding: 8, borderTop: '3px solid var(--accent)' }}>
      <div style={{ height: 2, background: 'var(--accent)' }} />
      <div style={{ fontSize: 12, margin: '6px 0 8px' }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>{children}</div>
  )
}

function mapCutoff(v: number): number { return 20 * Math.pow(10, v * Math.log10(18000/20)); }
function mapQ(v: number): number { return 0.5 + v * (12 - 0.5); }

function updateFilt(s: any, key: 'filter1'|'filter2', patch: Partial<{type:number;cutoff:number;res:number;assign:number}>) {
  s.updateSynthUI((ui: any) => ({ ...ui, [key]: { ...(ui as any)[key], ...patch } }));
}
