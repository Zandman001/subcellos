import React from 'react';
import { useBrowser } from '../../store/browser';
import Knob from './Knob';

export default function SamplerEnvelope() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const sampler = ui.sampler || {
    attack: 0.01,
    decay: 0.3,
    sustain: 0.7,
    release: 0.5,
  };

  const setParam = (key: string, value: number) => {
    s.updateSynthUI((ui: any) => ({
      ...ui,
      sampler: { ...ui.sampler, [key]: value }
    }));
    
    // Also send to audio engine
    const part = s.selectedSoundPart ?? 0;
    switch (key) {
      case 'attack':
        s.setSynthParam(`part/${part}/sampler/attack`, value);
        break;
      case 'decay':
        s.setSynthParam(`part/${part}/sampler/decay`, value);
        break;
      case 'sustain':
        s.setSynthParam(`part/${part}/sampler/sustain`, value);
        break;
      case 'release':
        s.setSynthParam(`part/${part}/sampler/release`, value);
        break;
    }
  };

  // Convert time values to display format (similar to EnvelopePreview)
  const formatTime = (v: number): string => {
    const sec = v * 4.0; // 0..1 -> 0..4 seconds approximately
    if (sec < 0.1) return (sec * 1000).toFixed(0) + 'ms';
    return sec.toFixed(2) + 's';
  };

  const formatPercent = (v: number): string => {
    return (v * 100).toFixed(0) + '%';
  };

  return (
    <div className="synth-page">
      <div className="page-header">
        <h2>ENVELOPE</h2>
      </div>

      {/* Envelope preview visualization */}
      <div className="envelope-container">
        <div className="envelope-preview">
          <div className="envelope-curve">
            {/* Simple ADSR visualization */}
            <svg viewBox="0 0 200 100" className="envelope-svg">
              {/* Attack */}
              <line 
                x1="10" y1="90" 
                x2={10 + sampler.attack * 40} y2="10" 
                stroke="var(--accent)" strokeWidth="2"
              />
              {/* Decay */}
              <line 
                x1={10 + sampler.attack * 40} y1="10" 
                x2={10 + sampler.attack * 40 + sampler.decay * 40} y2={10 + (1 - sampler.sustain) * 80} 
                stroke="var(--accent)" strokeWidth="2"
              />
              {/* Sustain */}
              <line 
                x1={10 + sampler.attack * 40 + sampler.decay * 40} y1={10 + (1 - sampler.sustain) * 80} 
                x2="150" y2={10 + (1 - sampler.sustain) * 80} 
                stroke="var(--accent)" strokeWidth="2"
              />
              {/* Release */}
              <line 
                x1="150" y1={10 + (1 - sampler.sustain) * 80} 
                x2={150 + sampler.release * 40} y2="90" 
                stroke="var(--accent)" strokeWidth="2"
              />
              
              {/* Labels */}
              <text x="25" y="95" fill="var(--text)" fontSize="8">A</text>
              <text x="55" y="95" fill="var(--text)" fontSize="8">D</text>
              <text x="100" y="95" fill="var(--text)" fontSize="8">S</text>
              <text x="160" y="95" fill="var(--text)" fontSize="8">R</text>
            </svg>
          </div>
        </div>
      </div>

      {/* ADSR knobs */}
      <div className="knob-grid envelope-knobs">
        <div className="knob-group">
          <Knob
            value={sampler.attack}
            onChange={(v: number) => setParam('attack', v)}
            label="Attack"
            format={formatTime}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={sampler.decay}
            onChange={(v: number) => setParam('decay', v)}
            label="Decay"
            format={formatTime}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={sampler.sustain}
            onChange={(v: number) => setParam('sustain', v)}
            label="Sustain"
            format={formatPercent}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={sampler.release}
            onChange={(v: number) => setParam('release', v)}
            label="Release"
            format={formatTime}
          />
        </div>
      </div>

      <div className="envelope-info">
        <div className="info-text">
          Total envelope time: {formatTime(sampler.attack + sampler.decay + sampler.release)}
        </div>
        <div className="info-text">
          Sustain level: {formatPercent(sampler.sustain)}
        </div>
      </div>
    </div>
  );
}
