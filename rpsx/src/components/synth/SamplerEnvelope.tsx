import React from 'react';
import { useBrowser } from '../../store/browser';
import Knob from './Knob';
import EnvelopePreview from './EnvelopePreview';

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
    s.setSynthParam(`part/${part}/sampler/attack`, mapTimeMs(value));
        break;
      case 'decay':
    s.setSynthParam(`part/${part}/sampler/decay`, mapTimeMs(value));
        break;
      case 'sustain':
        s.setSynthParam(`part/${part}/sampler/sustain`, value);
        break;
      case 'release':
    s.setSynthParam(`part/${part}/sampler/release`, mapTimeMs(value));
        break;
    }
  };

  // Same mapping/formatting style as analog AMP env, but send ms to sampler engine
  function mapTime(v: number): number { return 0.001 + Math.pow(v, 2) * 5.0; } // seconds
  function mapTimeMs(v: number): number { return mapTime(v) * 1000.0; }
  function fmtTime(sec: number): string { return sec < 0.1 ? `${Math.round(sec*1000)}ms` : `${sec.toFixed(2)}s`; }

  const formatPercent = (v: number): string => (v * 100).toFixed(0) + '%';

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
          <Knob label="Attack" value={sampler.attack ?? 0} onChange={(v)=> setParam('attack', v)} format={(v)=>fmtTime(mapTime(v))} disabled={disabled} />
        </div>

        <div className="knob-group">
          <Knob label="Decay" value={sampler.decay ?? 0} onChange={(v)=> setParam('decay', v)} format={(v)=>fmtTime(mapTime(v))} disabled={disabled} />
        </div>

        <div className="knob-group">
          <Knob label="Sustain" value={sampler.sustain ?? 0.7} onChange={(v)=> setParam('sustain', v)} format={formatPercent} disabled={disabled} />
        </div>

        <div className="knob-group">
          <Knob label="Release" value={sampler.release ?? 0} onChange={(v)=> setParam('release', v)} format={(v)=>fmtTime(mapTime(v))} disabled={disabled} />
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
