import React from 'react';
import { useBrowser } from '../../store/browser';
import Knob from './Knob';

export default function Sampler() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const part = s.selectedSoundPart ?? 0;
  const selectedSoundId = s.selectedSoundId;
  const moduleKindById = s.moduleKindById;
  
  // Ensure module is set to Sampler when page is active, but only if it's not already Sampler
  React.useEffect(() => { 
    try { 
      if (!selectedSoundId) return;
      const moduleKind = moduleKindById?.[selectedSoundId];
      if (moduleKind !== 'sampler') {
        s.setSynthParam(`part/${part}/module_kind`, 4, 'I32'); 
      }
    } catch {} 
  }, [part, selectedSoundId, moduleKindById, s.setSynthParam]);

  const sampler = ui.sampler || {
    sample_start: 0.0,
    sample_end: 1.0,
    pitch_coarse: 0,
    pitch_fine: 0.0,
    playback_mode: 0,
    loop_mode: 0,
    loop_start: 0.2,
    loop_end: 0.8,
    attack: 0.01,
    decay: 0.3,
    sustain: 0.7,
    release: 0.5,
    gain: 0.8,
  };

  const setParam = (key: string, value: number) => {
    s.updateSynthUI((ui: any) => ({
      ...ui,
      sampler: { ...ui.sampler, [key]: value }
    }));
    
    // Also send to audio engine
    const part = s.selectedSoundPart ?? 0;
    switch (key) {
      case 'sample_start':
        s.setSynthParam(`part/${part}/sampler/sample_start`, value);
        break;
      case 'sample_end':
        s.setSynthParam(`part/${part}/sampler/sample_end`, value);
        break;
      case 'pitch_coarse':
        s.setSynthParam(`part/${part}/sampler/pitch_coarse`, Math.round(value), 'I32');
        break;
      case 'pitch_fine':
        s.setSynthParam(`part/${part}/sampler/pitch_fine`, value);
        break;
      case 'playback_mode':
        s.setSynthParam(`part/${part}/sampler/playback_mode`, Math.round(value), 'I32');
        break;
      case 'gain':
        s.setSynthParam(`part/${part}/sampler/gain`, value);
        break;
    }
  };

  // Convert pitch coarse to semitones display (-48 to +48)
  const pitchCoarseDisplay = (sampler.pitch_coarse - 48).toString();
  const pitchFineDisplay = (sampler.pitch_fine * 100).toFixed(0);

  // Playback mode display
  const playbackModes = ['One-Shot', 'Loop', 'Keytrack'];
  const playbackModeDisplay = playbackModes[Math.floor(sampler.playback_mode * 2.99)] || 'One-Shot';

  return (
    <div className="synth-page">
      <div className="page-header">
        <h2>SAMPLER</h2>
        <div className="sampler-controls">
          <button className="record-btn">
            Press R to Record
          </button>
          <button className="load-btn">
            Press E to Load File
          </button>
        </div>
      </div>

      {/* Waveform display area */}
      <div className="waveform-container">
        <div className="waveform-display">
          <div className="waveform-placeholder">
            <div className="waveform-text">No sample loaded</div>
            <div className="sample-markers">
              <div 
                className="sample-start-marker" 
                style={{ left: `${sampler.sample_start * 100}%` }}
              />
              <div 
                className="sample-end-marker" 
                style={{ left: `${sampler.sample_end * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main sampler knobs */}
      <div className="knob-grid sampler-knobs">
        <div className="knob-group">
          <Knob
            value={sampler.sample_start}
            onChange={(v: number) => setParam('sample_start', v)}
            label="Sample Start"
            format={(v: number) => (v * 100).toFixed(1) + '%'}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={sampler.sample_end}
            onChange={(v: number) => setParam('sample_end', v)}
            label="Sample End"
            format={(v: number) => (v * 100).toFixed(1) + '%'}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={(sampler.pitch_coarse + 48) / 96} // Normalize -48 to +48 into 0-1
            onChange={(v: number) => setParam('pitch_coarse', Math.round(v * 96 - 48))}
            label="Pitch (Coarse)"
            format={(v: number) => (Math.round(v * 96 - 48)).toString() + ' st'}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={(sampler.pitch_fine + 1) / 2} // Normalize -1 to +1 into 0-1
            onChange={(v: number) => setParam('pitch_fine', v * 2 - 1)}
            label="Pitch (Fine)"
            format={(v: number) => ((v * 2 - 1) * 100).toFixed(0) + ' ct'}
          />
        </div>
      </div>

      <div className="knob-grid sampler-knobs-row2">
        <div className="knob-group">
          <Knob
            value={sampler.playback_mode / 3} // Normalize 0-2 into 0-1 (approximately)
            onChange={(v: number) => setParam('playback_mode', Math.round(v * 2.99))}
            label="Playback Type"
            format={(v: number) => playbackModes[Math.floor(v * 2.99)] || 'One-Shot'}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={sampler.gain}
            onChange={(v: number) => setParam('gain', v)}
            label="Gain"
            format={(v: number) => (v * 100).toFixed(0) + '%'}
          />
        </div>
      </div>
    </div>
  );
}
