import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'
import EnvelopePreview from './EnvelopePreview'
import { envTimeFromNorm, formatEnvTime } from '../../utils/envTime'
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys'

export default function SynthENV() {
  const s = useBrowser() as any;
  const which = s.envSelect === 0 ? 'AMP' : 'MOD';
  const ui = s.getSynthUI();
  const env = which === 'AMP' ? ui.ampEnv : ui.modEnv;
  const key = which === 'AMP' ? 'amp_env' : 'mod_env';
  const part = s.selectedSoundPart ?? 0;
  const step = 1/48; const clamp01 = (x:number)=> Math.max(0, Math.min(1, x));
  const setA = (v:number)=> { const nv = clamp01(v); updateEnv(s, which, { a: nv }); s.setSynthParam(`part/${part}/${key}/attack`, envTimeFromNorm(nv)); };
  const setD = (v:number)=> { const nv = clamp01(v); updateEnv(s, which, { d: nv }); s.setSynthParam(`part/${part}/${key}/decay`, envTimeFromNorm(nv)); };
  const setS = (v:number)=> { const nv = clamp01(v); updateEnv(s, which, { s: nv }); s.setSynthParam(`part/${part}/${key}/sustain`, nv); };
  const setR = (v:number)=> { const nv = clamp01(v); updateEnv(s, which, { r: nv }); s.setSynthParam(`part/${part}/${key}/release`, envTimeFromNorm(nv)); };
  useFourKnobHotkeys({
    dec1: ()=> setA(env.a - step), inc1: ()=> setA(env.a + step),
    dec2: ()=> setD(env.d - step), inc2: ()=> setD(env.d + step),
    dec3: ()=> setS(env.s - step), inc3: ()=> setS(env.s + step),
    dec4: ()=> setR(env.r - step), inc4: ()=> setR(env.r + step),
    active: true,
  });
  return (
    <Page title={`ENV · ${which}`}>
      <EnvelopePreview a={env.a} d={env.d} s={env.s} r={env.r} />
      <Row>
  <Knob label="Attack" value={env.a} step={49} onChange={(v)=> { updateEnv(s, which, { a: v }); s.setSynthParam(`part/${part}/${key}/attack`, envTimeFromNorm(v)); }} format={(v)=>fmtTime(envTimeFromNorm(v))} />
  <Knob label="Decay" value={env.d} step={49} onChange={(v)=> { updateEnv(s, which, { d: v }); s.setSynthParam(`part/${part}/${key}/decay`, envTimeFromNorm(v)); }} format={(v)=>fmtTime(envTimeFromNorm(v))} />
  <Knob label="Sustain" value={env.s} step={49} onChange={(v)=> { updateEnv(s, which, { s: v }); s.setSynthParam(`part/${part}/${key}/sustain`, v); }} format={(v)=>`${Math.round(v*100)}%`} />
  <Knob label="Release" value={env.r} step={49} onChange={(v)=> { updateEnv(s, which, { r: v }); s.setSynthParam(`part/${part}/${key}/release`, envTimeFromNorm(v)); }} format={(v)=>fmtTime(envTimeFromNorm(v))} />
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

function fmtTime(sec: number): string { return formatEnvTime(sec); }

function updateEnv(s: any, which: 'AMP'|'MOD', patch: Partial<{a:number;d:number;s:number;r:number}>) {
  const key = which === 'AMP' ? 'ampEnv' : 'modEnv';
  s.updateSynthUI((ui: any) => ({ ...ui, [key]: { ...(ui as any)[key], ...patch } }));
}
