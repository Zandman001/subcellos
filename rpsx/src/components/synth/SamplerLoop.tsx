import React from 'react';
import { useBrowser } from '../../store/browser';
import Knob from './Knob';

export default function SamplerLoop() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const sampler = ui.sampler || {
    loop_mode: 0,
    loop_start: 0.2,
    loop_end: 0.8,
  };

  const setParam = (key: string, value: number) => {
    s.updateSynthUI((ui: any) => ({
      ...ui,
      sampler: { ...ui.sampler, [key]: value }
    }));
    
    // Also send to audio engine
    const part = s.selectedSoundPart ?? 0;
    switch (key) {
      case 'loop_mode':
        s.setSynthParam(`part/${part}/sampler/loop_mode`, Math.round(value), 'I32');
        break;
      case 'loop_start':
        s.setSynthParam(`part/${part}/sampler/loop_start`, value);
        break;
      case 'loop_end':
        s.setSynthParam(`part/${part}/sampler/loop_end`, value);
        break;
    }
  };

  // Loop mode display
  const loopModes = ['Off', 'Forward', 'Ping-Pong'];
  
  return (
    <div className="synth-page">
      <div className="page-header">
        <h2>LOOP</h2>
      </div>

      {/* Waveform display with loop markers */}
      <div className="waveform-container">
        <div className="waveform-display">
          <div className="waveform-placeholder">
            <div className="waveform-text">Sample waveform</div>
            <div className="loop-markers">
              <div 
                className="loop-start-marker" 
                style={{ left: `${sampler.loop_start * 100}%` }}
              />
              <div 
                className="loop-end-marker" 
                style={{ left: `${sampler.loop_end * 100}%` }}
              />
              <div 
                className="loop-region"
                style={{ 
                  left: `${sampler.loop_start * 100}%`,
                  width: `${(sampler.loop_end - sampler.loop_start) * 100}%`
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Loop controls */}
      <div className="knob-grid loop-knobs">
        <div className="knob-group">
          <Knob
            value={sampler.loop_mode / 2} // Normalize 0-2 into 0-1
            onChange={(v: number) => setParam('loop_mode', Math.round(v * 2))}
            label="Loop Mode"
            format={(v: number) => loopModes[Math.round(v * 2)] || 'Off'}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={sampler.loop_start}
            onChange={(v: number) => setParam('loop_start', v)}
            label="Loop Start"
            format={(v: number) => (v * 100).toFixed(1) + '%'}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={sampler.loop_end}
            onChange={(v: number) => setParam('loop_end', v)}
            label="Loop End"
            format={(v: number) => (v * 100).toFixed(1) + '%'}
          />
        </div>
      </div>

      <div className="loop-info">
        <div className="info-text">
          Loop region: {(sampler.loop_start * 100).toFixed(1)}% - {(sampler.loop_end * 100).toFixed(1)}%
        </div>
        <div className="info-text">
          Mode: {loopModes[sampler.loop_mode] || 'Off'}
        </div>
      </div>
    </div>
  );
}
