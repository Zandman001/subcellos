import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'
import EnvelopePreview from './EnvelopePreview'

export default function SynthENV() {
  const s = useBrowser() as any;
  const which = s.envSelect === 0 ? 'AMP' : 'MOD';
  const ui = s.getSynthUI();
  const env = which === 'AMP' ? ui.ampEnv : ui.modEnv;
  const key = which === 'AMP' ? 'amp_env' : 'mod_env';
  const part = s.selectedSoundPart ?? 0;
  return (
    <Page title={`ENV · ${which}`}>
      <EnvelopePreview a={env.a} d={env.d} s={env.s} r={env.r} />
      <Row>
        <Knob label="Attack" value={env.a} onChange={(v)=> { updateEnv(s, which, { a: v }); s.setSynthParam(`part/${part}/${key}/attack`, mapTime(v)); }} format={(v)=>fmtTime(mapTime(v))} />
        <Knob label="Decay" value={env.d} onChange={(v)=> { updateEnv(s, which, { d: v }); s.setSynthParam(`part/${part}/${key}/decay`, mapTime(v)); }} format={(v)=>fmtTime(mapTime(v))} />
        <Knob label="Sustain" value={env.s} onChange={(v)=> { updateEnv(s, which, { s: v }); s.setSynthParam(`part/${part}/${key}/sustain`, v); }} format={(v)=>`${Math.round(v*100)}%`} />
        <Knob label="Release" value={env.r} onChange={(v)=> { updateEnv(s, which, { r: v }); s.setSynthParam(`part/${part}/${key}/release`, mapTime(v)); }} format={(v)=>fmtTime(mapTime(v))} />
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

function mapTime(v: number): number { return 0.001 + Math.pow(v, 2) * 5.0; }
function fmtTime(sec: number): string { return sec < 0.1 ? `${Math.round(sec*1000)}ms` : `${sec.toFixed(2)}s`; }

function updateEnv(s: any, which: 'AMP'|'MOD', patch: Partial<{a:number;d:number;s:number;r:number}>) {
  const key = which === 'AMP' ? 'ampEnv' : 'modEnv';
  s.updateSynthUI((ui: any) => ({ ...ui, [key]: { ...(ui as any)[key], ...patch } }));
}
