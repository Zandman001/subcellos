import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'
import FilterPreview from './FilterPreview'

export default function SynthFILTER() {
  const s = useBrowser() as any;
  const which = s.filterSelect === 0 ? '1' : '2';
  const ui = s.getSynthUI();
  const filt = which === '1' ? ui.filter1 : ui.filter2;
  const key = which === '1' ? 'filter1' : 'filter2';
  return (
    <Page title={`FILTER · ${which}`}>
      <FilterPreview type={filt.type} cutoff={filt.cutoff} q={filt.res} />
      <Row>
        <Knob label="Type" value={filt.type} step={4} onChange={(v)=> { updateFilt(s, key, { type: v }); s.setSynthParam(`part/0/${key}/type`, Math.round(v*3), 'I32'); }} format={(v)=>['LP','HP','BP','Notch'][Math.round(v*3)]} />
        <Knob label="Cutoff" value={filt.cutoff} onChange={(v)=> { updateFilt(s, key, { cutoff: v }); s.setSynthParam(`part/0/${key}/cutoff_hz`, mapCutoff(v)); }} format={(v)=>`${Math.round(mapCutoff(v))} Hz`} />
        <Knob label="Resonance" value={filt.res} onChange={(v)=> { updateFilt(s, key, { res: v }); s.setSynthParam(`part/0/${key}/q`, mapQ(v)); }} format={(v)=>`${mapQ(v).toFixed(2)} Q`} />
        <Knob label="Assign" value={filt.assign/3} step={4} onChange={(v)=> { updateFilt(s, key, { assign: Math.round(v*3) }); s.setSynthParam(`part/0/${key}/assign`, Math.round(v*3), 'I32'); }} format={(v)=>['None','A','B','AB'][Math.round(v*3)]} />
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
