import React from 'react';
import { useBrowser } from '../../store/browser';
import Knob from './Knob';
import EnvelopePreview from './EnvelopePreview';
import { envTimeFromNorm, envTimeMsFromNorm, formatEnvTime } from '../../utils/envTime';
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys';

export default function SamplerEnvelope() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  // Sampler envelope in UI uses normalized [0..1] like analog AMP env
  const sampler = ui.sampler || { attack: 0.02, decay: 0.2, sustain: 0.7, release: 0.25 };
  const pmode = Math.round(sampler.playback_mode ?? 0); // 0=OneShot,1=Loop,2=Keytrack
  const disabled = !(pmode === 1 || pmode === 2);

  const setParam = (key: string, value: number) => {
    s.updateSynthUI((ui: any) => ({
      ...ui,
      sampler: { ...ui.sampler, [key]: value }
    }));
    
    // Also send to audio engine
    const part = s.selectedSoundPart ?? 0;
    switch (key) {
      case 'attack':
        s.setSynthParam(`part/${part}/sampler/attack`, envTimeMsFromNorm(value));
        break;
      case 'decay':
        s.setSynthParam(`part/${part}/sampler/decay`, envTimeMsFromNorm(value));
        break;
      case 'sustain':
        s.setSynthParam(`part/${part}/sampler/sustain`, value);
        break;
      case 'release':
        s.setSynthParam(`part/${part}/sampler/release`, envTimeMsFromNorm(value));
        break;
    }
  };

  const mapTime = (v: number): number => envTimeFromNorm(v);
  const fmtTime = (sec: number): string => formatEnvTime(sec);

  const formatPercent = (v: number): string => (v * 100).toFixed(0) + '%';

  // 4-knob hotkeys: Attack, Decay, Sustain, Release
  const clamp01 = (x:number)=> Math.max(0, Math.min(1, x));
  const step = 1/48;
  useFourKnobHotkeys({
    dec1: ()=> setParam('attack', clamp01((sampler.attack ?? 0) - step)), inc1: ()=> setParam('attack', clamp01((sampler.attack ?? 0) + step)),
    dec2: ()=> setParam('decay', clamp01((sampler.decay ?? 0) - step)), inc2: ()=> setParam('decay', clamp01((sampler.decay ?? 0) + step)),
    dec3: ()=> setParam('sustain', clamp01((sampler.sustain ?? 0.7) - step)), inc3: ()=> setParam('sustain', clamp01((sampler.sustain ?? 0.7) + step)),
    dec4: ()=> setParam('release', clamp01((sampler.release ?? 0) - step)), inc4: ()=> setParam('release', clamp01((sampler.release ?? 0) + step)),
    active: !disabled,
  });

  return (
    <div className="synth-page">
      <div className="page-header"><h2>ENVELOPE</h2></div>
      <EnvelopePreview a={sampler.attack ?? 0} d={sampler.decay ?? 0} s={sampler.sustain ?? 0.7} r={sampler.release ?? 0} />
      {disabled && (
        <div className="info-text" style={{opacity:0.7, marginTop: 8}}>Envelope is only active in Loop or Keytrack modes.</div>
      )}

      {/* ADSR knobs */}
      <div className="knob-grid envelope-knobs">
        <div className="knob-group">
          <Knob label="Attack" value={sampler.attack ?? 0} step={49} onChange={(v)=> setParam('attack', v)} format={(v)=>fmtTime(mapTime(v))} disabled={disabled} />
        </div>

        <div className="knob-group">
          <Knob label="Decay" value={sampler.decay ?? 0} step={49} onChange={(v)=> setParam('decay', v)} format={(v)=>fmtTime(mapTime(v))} disabled={disabled} />
        </div>

        <div className="knob-group">
          <Knob label="Sustain" value={sampler.sustain ?? 0.7} step={49} onChange={(v)=> setParam('sustain', v)} format={formatPercent} disabled={disabled} />
        </div>

        <div className="knob-group">
          <Knob label="Release" value={sampler.release ?? 0} step={49} onChange={(v)=> setParam('release', v)} format={(v)=>fmtTime(mapTime(v))} disabled={disabled} />
        </div>
      </div>

      <div className="envelope-info">
        <div className="info-text">
          Total envelope time: {fmtTime(mapTime(sampler.attack ?? 0) + mapTime(sampler.decay ?? 0) + mapTime(sampler.release ?? 0))}
        </div>
        <div className="info-text">
          Sustain level: {formatPercent(sampler.sustain)}
        </div>
      </div>
    </div>
  );
}
