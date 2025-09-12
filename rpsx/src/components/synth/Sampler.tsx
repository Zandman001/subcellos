import React, { useEffect, useState } from 'react';
import { useBrowser } from '../../store/browser';
import Knob from './Knob';
import { rpc } from '../../rpc';

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
    current_sample: undefined as string | undefined,
    pitch_semitones: 0,
    pitch_cents: 0.0,
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
      case 'pitch_semitones':
        s.setSynthParam(`part/${part}/sampler/pitch_semitones`, Math.round(value), 'F32');
        break;
      case 'pitch_cents':
        s.setSynthParam(`part/${part}/sampler/pitch_cents`, value);
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
  const safeSemi = Number.isFinite(sampler.pitch_semitones) ? sampler.pitch_semitones : 0;
  const safeCents = Number.isFinite(sampler.pitch_cents) ? sampler.pitch_cents : 0;
  const pitchCoarseDisplay = safeSemi.toString();
  const pitchFineDisplay = (safeCents).toFixed(0);

  // Playback mode display
  const playbackModes = ['One-Shot', 'Loop', 'Keytrack'];
  const playbackModeIndex = Number.isFinite(sampler.playback_mode) ? Math.max(0, Math.min(2, Math.round(sampler.playback_mode))) : 0;
  const playbackModeDisplay = playbackModes[playbackModeIndex] || 'One-Shot';

  // Waveform state
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const currentSamplePath = sampler.current_sample as string | undefined;
  const selectionSpan = Math.max(0.00001, sampler.sample_end - sampler.sample_start);
  const dragScaleForSelection = selectionSpan; // smaller selection => smaller scale -> finer control

  // --- Derived selection + zoom target (computed each render) ---
  // Determine which selection to zoom: prefer loop if it's significantly narrower than sample region
  const sampleSelStart = sampler.sample_start;
  const sampleSelEnd = sampler.sample_end;
  const sampleSelWidth = Math.max(0.000001, sampleSelEnd - sampleSelStart);
  const loopStartRaw = sampler.loop_start ?? sampleSelStart;
  const loopEndRaw = sampler.loop_end ?? sampleSelEnd;
  // Clamp loop inside sample selection
  const loopStart = Math.min(Math.max(loopStartRaw, sampleSelStart), sampleSelEnd);
  const loopEnd = Math.min(Math.max(loopEndRaw, loopStart + 0.000001), sampleSelEnd);
  const loopWidth = Math.max(0.000001, loopEnd - loopStart);
  const useLoop = loopWidth < sampleSelWidth * 0.98; // loop is a tighter selection
  const selStart = useLoop ? loopStart : sampleSelStart;
  const selEnd = useLoop ? loopEnd : sampleSelEnd;
  const selWidth = useLoop ? loopWidth : sampleSelWidth;
  let targetDisplayStart = 0;
  let targetDisplayEnd = 1;
  if (selWidth < 0.995) {
    // Centered zoom: choose a desired span based on selection size, then center window on selection midpoint.
    const center = (selStart + selEnd) * 0.5;
    const minSpan = Math.max(selWidth * 1.8, 0.03); // ensure some context around very small selections
    const extraFactor = 0.6; // how much extra (relative) context we want on each side before enforcing minSpan
    const desiredSpanRaw = selWidth * (1 + extraFactor * 2); // selection plus symmetric context
    const desiredSpan = Math.min(1, Math.max(minSpan, desiredSpanRaw));
    let start = center - desiredSpan / 2;
    let end = center + desiredSpan / 2;
    if (start < 0) { end -= start; start = 0; }
    if (end > 1) { const over = end - 1; start -= over; end = 1; if (start < 0) start = 0; }
    targetDisplayStart = start;
    targetDisplayEnd = end;
  }
  const zoomActive = targetDisplayStart !== 0 || targetDisplayEnd !== 1;

  // We now crop the waveform to the selection instead of transforming the full waveform.
  // Keep simple fade animation readiness (placeholder state for potential future smoothing).
  const animSpan = Math.max(0.000001, targetDisplayEnd - targetDisplayStart);

  useEffect(() => {
    let cancelled = false;
    if (!currentSamplePath) { setWaveform(null); return; }
    rpc.getSampleWaveform(currentSamplePath)
      .then(w => { if (!cancelled) setWaveform(w); })
      .catch((e: any) => { if (!cancelled) { console.warn('Waveform fetch failed', e); setWaveform([]); }});
    return () => { cancelled = true; };
  }, [currentSamplePath]);

  // Fallback: if we have a sampler.current_sample but waveform ended up empty, retry once after short delay
  useEffect(() => {
    if (!currentSamplePath) return;
    if (waveform && waveform.length > 0) return;
    const t = setTimeout(() => {
      rpc.getSampleWaveform(currentSamplePath)
        .then(w => { if (w.length > 0) setWaveform(w); })
        .catch(()=>{});
    }, 300);
    return () => clearTimeout(t);
  }, [currentSamplePath, waveform]);

  const renderWaveform = () => {
    if (!currentSamplePath) return <div className="waveform-text">No sample</div>;
    if (!waveform) return <div className="waveform-text">Loading...</div>;
    if (waveform.length === 0) return <div className="waveform-text">No waveform</div>;
    const max = Math.max(0.00001, ...waveform.map(v => Math.abs(v)));
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i < waveform.length; i++) {
      const x = (i / (waveform.length - 1)) * 100;
      const a = waveform[i] / max;
      const yT = 50 - a * 45;
      const yB = 50 + a * 45;
      top.push(`${x},${yT}`);
      bottom.push(`${x},${yB}`);
    }
    const pathD = `M ${top[0]} L ${top.slice(1).join(' ')} L ${bottom.reverse().join(' ')} Z`;
    // Build cropped waveform for zoom (selection or loop region with context window)
    let croppedPath = pathD;
    let showRangeStart = 0;
    let showRangeEnd = 1;
    if (zoomActive) {
      showRangeStart = targetDisplayStart;
      showRangeEnd = targetDisplayEnd;
      const total = waveform.length - 1;
      const idxStart = Math.max(0, Math.min(total, Math.floor(showRangeStart * total)));
      const idxEnd = Math.max(idxStart + 1, Math.min(total, Math.ceil(showRangeEnd * total)));
      const region = waveform.slice(idxStart, idxEnd + 1);
      if (region.length > 1) {
        const maxAmp = Math.max(0.00001, ...region.map(v => Math.abs(v)));
        const topZ: string[] = [];
        const botZ: string[] = [];
        for (let i = 0; i < region.length; i++) {
          const x = (i / (region.length - 1)) * 100;
          const a = region[i] / maxAmp;
          const yT = 50 - a * 45;
          const yB = 50 + a * 45;
          topZ.push(`${x},${yT}`);
          botZ.push(`${x},${yB}`);
        }
        if (topZ.length > 1) {
          croppedPath = `M ${topZ[0]} L ${topZ.slice(1).join(' ')} L ${botZ.reverse().join(' ')} Z`;
        }
      }
    }
    // Map selection (selStart/selEnd) to local cropped space
    const localSelStart = ((selStart - showRangeStart) / (showRangeEnd - showRangeStart)) * 100;
    const localSelEnd = ((selEnd - showRangeStart) / (showRangeEnd - showRangeStart)) * 100;
    return (
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="sampler-waveform-svg">
        <rect x={0} y={0} width={100} height={100} fill="#222" />
        <path d={croppedPath} fill="#ffffff" fillOpacity={0.85} stroke="#ffffff" strokeWidth={0.25} />
        <line x1="0" y1="50" x2="100" y2="50" stroke="#555" strokeWidth={0.4} strokeDasharray="2 2" />
        {/* Selection highlight */}
        <rect x={localSelStart} y={0} width={Math.max(0.5, localSelEnd - localSelStart)} height={100} fill="#ffffff" fillOpacity={0.06} />
        <line x1={localSelStart} y1={0} x2={localSelStart} y2={100} stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.6} />
        <line x1={localSelEnd} y1={0} x2={localSelEnd} y2={100} stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.6} />
        {/* Loop markers if loop used and distinct */}
        {useLoop && (
          (() => {
            const lStartLocal = ((loopStart - showRangeStart) / (showRangeEnd - showRangeStart)) * 100;
            const lEndLocal = ((loopEnd - showRangeStart) / (showRangeEnd - showRangeStart)) * 100;
            return (
              <g>
                <rect x={lStartLocal} y={0} width={Math.max(0.3, lEndLocal - lStartLocal)} height={100} fill="#ffffff" fillOpacity={0.08} />
                <rect x={lStartLocal - 0.9} y={0} width={1.8} height={100} fill="#fff" fillOpacity={0.9} />
                <rect x={lEndLocal - 0.9} y={0} width={1.8} height={100} fill="#fff" fillOpacity={0.9} />
              </g>
            );
          })()
        )}
        {zoomActive && (
          <text x={2} y={8} fontSize={5} fill="#fff8" style={{userSelect:'none'}}>
            {useLoop ? 'LOOP' : 'REG'} ZOOM {Math.round((selWidth)*100)}%
          </text>
        )}
      </svg>
    );
  };

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

      {/* Waveform display area with start/end markers */}
      <div className="waveform-container">
        <div className="waveform-display">
          <div className="waveform-placeholder">
            <div className="waveform-svg-wrap">
              {renderWaveform()}
            </div>
          </div>
        </div>
      </div>

      {/* Main sampler knobs */}
      <div className="knob-grid sampler-knobs">
        <div className="knob-group">
          <Knob
            value={sampler.sample_start}
            dragScale={dragScaleForSelection}
            onChange={(v: number) => {
              let nv = Math.min(v, sampler.sample_end - 0.0005);
              if (nv < 0) nv = 0;
              setParam('sample_start', nv);
            }}
            label="Sample Start"
            format={(v: number) => (v * 100).toFixed(1) + '%'}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={sampler.sample_end}
            dragScale={dragScaleForSelection}
            onChange={(v: number) => {
              let nv = Math.max(v, sampler.sample_start + 0.0005);
              if (nv > 1) nv = 1;
              setParam('sample_end', nv);
            }}
            label="Sample End"
            format={(v: number) => (v * 100).toFixed(1) + '%'}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={((Number.isFinite(safeSemi)? safeSemi:0) + 48) / 96}
            onChange={(v: number) => {
              const semi = Math.round(v * 96 - 48);
              setParam('pitch_semitones', semi);
            }}
            label="Pitch (Semi)"
            format={(v: number) => (Math.round(v * 96 - 48)).toString() + ' st'}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={((Number.isFinite(safeCents)? safeCents:0) + 100) / 200}
            onChange={(v: number) => {
              const cents = (v * 200 - 100);
              setParam('pitch_cents', cents);
            }}
            label="Pitch (Fine)"
            format={(v: number) => (Math.round(v * 200 - 100)).toString() + ' ct'}
          />
        </div>
      </div>

      <div className="knob-grid sampler-knobs-row2">
        <div className="knob-group">
          <Knob
            value={playbackModeIndex / 2} // discrete 0,0.5,1 for 3 states
            onChange={(v: number) => {
              // v already quantized via step prop
              const idx = Math.round(v * 2);
              setParam('playback_mode', idx);
            }}
            step={3}
            label="Playback Type"
            format={(v: number) => {
              const idx = Math.round(v * 2);
              return playbackModes[idx] || 'One-Shot';
            }}
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
