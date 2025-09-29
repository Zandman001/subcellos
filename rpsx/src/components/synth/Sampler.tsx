import React, { useEffect, useState } from 'react';
import { useBrowser } from '../../store/browser';
import Knob from './Knob';
import { rpc } from '../../rpc';
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys';

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
  // Ensure pages reflect current playback mode
  s.refreshSynthPages?.();
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
  // Recompute pages so LOOP tab toggles visibility when not in Loop mode
  try { s.refreshSynthPages?.(); } catch {}
        break;
  // no default
    }
  };

  // Convert pitch coarse to semitones display (-48 to +48)
  const safeSemi = Number.isFinite(sampler.pitch_semitones) ? sampler.pitch_semitones : 0;
  const safeCents = Number.isFinite(sampler.pitch_cents) ? sampler.pitch_cents : 0;
  // Universal pitch knob: map current semitones+cents to a single 0..1 value across ±49 st (±4900 cents)
  const totalCents = (Number.isFinite(safeSemi) ? safeSemi : 0) * 100 + (Number.isFinite(safeCents) ? safeCents : 0);
  const totalCentsClamped = Math.max(-4900, Math.min(4900, totalCents));
  const unifiedPitchNorm = (totalCentsClamped / 4900 + 1) / 2; // 0..1

  // Playback mode display
  const playbackModes = ['One-Shot', 'Loop', 'Keytrack'];
  const playbackModeIndex = Number.isFinite(sampler.playback_mode) ? Math.max(0, Math.min(2, Math.round(sampler.playback_mode))) : 0;
  const playbackModeDisplay = playbackModes[playbackModeIndex] || 'One-Shot';

  // Waveform state
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const currentSamplePath = sampler.current_sample as string | undefined;
  const selectionSpan = Math.max(0.00001, sampler.sample_end - sampler.sample_start);
  const dragScaleForSelection = selectionSpan; // smaller selection => smaller scale -> finer control

  // Engine-synced playhead inside selection region (0..1 of sample_start..sample_end)
  const [playheadRel, setPlayheadRel] = useState(0);
  const [playheadActive, setPlayheadActive] = useState(false);
  // Sample info for time ruler
  const [sampleInfo, setSampleInfo] = useState<{ length_samples: number; sample_rate: number; channels: number } | null>(null);
  // Poll engine for playhead; hide when not playing; no local simulation
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const st = await rpc.getSamplerPlayhead(part);
        if (st && typeof st.position_rel === 'number' && st.playing) {
          setPlayheadRel(Math.max(0, Math.min(1, st.position_rel)));
          setPlayheadActive(true);
        } else {
          setPlayheadActive(false);
        }
      } catch {
        setPlayheadActive(false);
      }
      if (!cancelled) setTimeout(poll, 16); // ~60 FPS for smoother motion
    };
    poll();
    return () => { cancelled = true; };
  }, [part]);

  // Fetch sample info for time ruler
  useEffect(() => {
    let cancelled = false;
    if (!currentSamplePath) { setSampleInfo(null); return; }
    rpc.getSampleInfo(currentSamplePath)
      .then(info => { if (!cancelled) setSampleInfo(info); })
      .catch(() => { if (!cancelled) setSampleInfo(null); });
    return () => { cancelled = true; };
  }, [currentSamplePath]);

  // --- Derived selection + zoom target (computed each render) ---
  // Determine which selection to zoom: prefer loop if it's significantly narrower than sample region
  const sampleSelStart = sampler.sample_start;
  const sampleSelEnd = sampler.sample_end;
  const sampleSelWidth = Math.max(0.000001, sampleSelEnd - sampleSelStart);
  const loopStartRaw = sampler.loop_start ?? sampleSelStart;
  const loopEndRaw = sampler.loop_end ?? sampleSelEnd;
  // Clamp loop inside sample selection (display only)
  const loopStart = Math.min(Math.max(loopStartRaw, sampleSelStart), sampleSelEnd);
  const loopEnd = Math.min(Math.max(loopEndRaw, loopStart + 0.000001), sampleSelEnd);
  const selStart = sampleSelStart;
  const selEnd = sampleSelEnd;
  const selWidth = sampleSelWidth;
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
    // Reserve a top bar for the time ruler and loop indicator so text doesn't overlap the waveform
  const topBarH = 26; // percent of SVG height (taller for proper proportions)
    const waveTop = topBarH;
    const waveBottom = 100;
    const waveH = waveBottom - waveTop;
    const centerY = waveTop + waveH * 0.5;
    const ampY = waveH * 0.45;
    const max = Math.max(0.00001, ...waveform.map(v => Math.abs(v)));
    const top: string[] = [];
    const bottom: string[] = [];
    for (let i = 0; i < waveform.length; i++) {
      const x = (i / (waveform.length - 1)) * 100;
      const a = waveform[i] / max;
      const yT = centerY - a * ampY;
      const yB = centerY + a * ampY;
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
          const yT = centerY - a * ampY;
          const yB = centerY + a * ampY;
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

    // Compute playhead x in local cropped space from engine-reported region-relative position
  const regionWidth = Math.max(1e-9, sampleSelEnd - sampleSelStart);
  const playheadAbs = sampleSelStart + playheadRel * regionWidth; // absolute in 0..1 of whole sample
  const localPlayhead = ((playheadAbs - showRangeStart) / (showRangeEnd - showRangeStart)) * 100;
  const showPlayhead = playheadActive && Number.isFinite(localPlayhead) && localPlayhead >= 0 && localPlayhead <= 100;
    
  // Time ruler ticks (seconds)
    const totalSeconds = sampleInfo && sampleInfo.length_samples > 0 ? (sampleInfo.length_samples / (sampleInfo.sample_rate || 44100)) : 0;
    const viewStartSec = totalSeconds * showRangeStart;
    const viewEndSec = totalSeconds * showRangeEnd;
    const visibleSec = Math.max(0, viewEndSec - viewStartSec);
    const tickSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = tickSteps.find(s => visibleSec / s <= 10) || tickSteps[tickSteps.length - 1];
    const ticks: number[] = [];
    if (totalSeconds > 0 && step > 0) {
      let t = Math.ceil(viewStartSec / step) * step;
      const end = viewEndSec + 1e-6;
      for (; t <= end; t += step) ticks.push(t);
    }
    const fmtTime = (t: number) => {
      if (t >= 60) {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
      }
      if (step < 1) return t.toFixed(1) + 's';
      return Math.floor(t).toString() + 's';
    };
  // Font + layout tuned to fit inside the top bar and match UI font (SVG units)
  // Use a fraction of the top bar height so text remains readable regardless of container pixels
  const labelFont = Math.min(topBarH - 2, Math.max(3, topBarH * 0.65));
  const tickH = Math.max(2, Math.min(topBarH - 2, topBarH - labelFont - 1));
  const labelY = Math.min(topBarH - 1, tickH + labelFont * 0.8);
    
    // Loop bar positions in local space
    const lStartLocal = ((loopStart - showRangeStart) / (showRangeEnd - showRangeStart)) * 100;
    const lEndLocal = ((loopEnd - showRangeStart) / (showRangeEnd - showRangeStart)) * 100;
    const loopBarX = Math.max(0, Math.min(100, lStartLocal));
    const loopBarW = Math.max(0, Math.min(100, lEndLocal) - loopBarX);
    return (
      <>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="sampler-waveform-svg">
        <rect x={0} y={0} width={100} height={100} fill="#000" />
        {/* Top bar background (white alpha over black, no gray hex) */}
        <rect x={0} y={0} width={100} height={topBarH} fill="#fff" fillOpacity={0.08} />
        {/* Top time ruler and loop bar (within top bar) */}
  <g fontFamily="'Press Start 2P', monospace">
          {/* Loop bar above waveform; only show in Loop playback mode */}
          {playbackModeIndex === 1 && loopBarW > 0 && (
            <rect x={loopBarX} y={0} width={loopBarW} height={Math.min(4, topBarH)} fill="#fff" fillOpacity={0.95} />
          )}
          {/* Tick marks */}
          {totalSeconds > 0 && ticks.map((t, i) => {
            const x = ((t / totalSeconds - showRangeStart) / (showRangeEnd - showRangeStart)) * 100;
            if (!Number.isFinite(x)) return null;
            return (
              <g key={i}>
                <line x1={x} y1={0} x2={x} y2={tickH} stroke="#fff" strokeOpacity={0.7} strokeWidth={0.4} />
              </g>
            );
          })}
        </g>
        {/* Waveform and overlays below the top bar */}
  <path d={croppedPath} fill="#fff" fillOpacity={0.85} stroke="#fff" strokeWidth={0.25} />
  <line x1="0" y1={centerY} x2="100" y2={centerY} stroke="#fff" strokeOpacity={0.35} strokeWidth={0.4} strokeDasharray="2 2" />
        {/* Selection highlight */}
        <rect x={localSelStart} y={waveTop} width={Math.max(0.5, localSelEnd - localSelStart)} height={waveH} fill="#ffffff" fillOpacity={0.06} />
        <line x1={localSelStart} y1={waveTop} x2={localSelStart} y2={waveBottom} stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.6} />
        <line x1={localSelEnd} y1={waveTop} x2={localSelEnd} y2={waveBottom} stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.6} />
        {/* Engine-synced playhead */}
        {showPlayhead && (
          <line x1={localPlayhead} y1={waveTop} x2={localPlayhead} y2={waveBottom} stroke="#fffb" strokeWidth={0.7} />
        )}
        {zoomActive && (
          <text x={2} y={waveTop + 8} fontSize={5} fill="#fff8" style={{userSelect:'none'}}>
            ZOOM {Math.round((selWidth)*100)}%
          </text>
        )}
      </svg>
      {/* HTML overlay for labels to avoid SVG squish */}
      {totalSeconds > 0 && (
        <div className="timebar-overlay" style={{ height: `${topBarH}%` }}>
          {(ticks || []).map((t, i) => {
            const x = ((t / totalSeconds - showRangeStart) / (showRangeEnd - showRangeStart)) * 100;
            if (!Number.isFinite(x)) return null;
            if (!(visibleSec / step <= 8 || (i % 2 === 0))) return null;
            const align = x < 2 ? 'left' : x > 98 ? 'right' : 'center';
            return (
              <span
                key={i}
                className={`timebar-label align-${align}`}
                style={{ left: `${Math.max(0, Math.min(100, x))}%` }}
              >
                {fmtTime(t)}
              </span>
            );
          })}
        </div>
      )}
      </>
    );
  };

  // 4-knob hotkeys: Sample Start, Sample End, Pitch, Playback
  const clamp01 = (x:number)=> Math.max(0, Math.min(1, x));
  const step = 1/48;
  useFourKnobHotkeys({
    dec1: ()=> { const nv = Math.min(sampler.sample_end - 0.0005, clamp01((sampler.sample_start ?? 0) - step)); setParam('sample_start', nv); },
    inc1: ()=> { const nv = Math.min(sampler.sample_end - 0.0005, clamp01((sampler.sample_start ?? 0) + step)); setParam('sample_start', nv); },
    dec2: ()=> { const nv = Math.max(sampler.sample_start + 0.0005, clamp01((sampler.sample_end ?? 1) - step)); setParam('sample_end', nv); },
    inc2: ()=> { const nv = Math.max(sampler.sample_start + 0.0005, clamp01((sampler.sample_end ?? 1) + step)); setParam('sample_end', nv); },
    dec3: ()=> { const v = clamp01(unifiedPitchNorm - step); const cents = (v * 2 - 1) * 4900; s.updateSynthUI((ui: any) => ({ ...ui, sampler: { ...ui.sampler, pitch_semitones: 0, pitch_cents: cents } })); s.setSynthParam(`part/${part}/sampler/pitch_semitones`, 0, 'F32'); s.setSynthParam(`part/${part}/sampler/pitch_cents`, cents); },
    inc3: ()=> { const v = clamp01(unifiedPitchNorm + step); const cents = (v * 2 - 1) * 4900; s.updateSynthUI((ui: any) => ({ ...ui, sampler: { ...ui.sampler, pitch_semitones: 0, pitch_cents: cents } })); s.setSynthParam(`part/${part}/sampler/pitch_semitones`, 0, 'F32'); s.setSynthParam(`part/${part}/sampler/pitch_cents`, cents); },
    dec4: ()=> { const idx = Math.max(0, playbackModeIndex - 1); setParam('playback_mode', idx); },
    inc4: ()=> { const idx = Math.min(2, playbackModeIndex + 1); setParam('playback_mode', idx); },
    active: true,
  });

  return (
    <div className="synth-page">
      <div className="page-header compact">
        <h2>SAMPLER</h2>
        <div className="sampler-controls compact">
          <button className="record-btn">Press R to Record</button>
          <button className="load-btn">Press W to Load File</button>
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

  {/* Main sampler knobs: 4 in one row */}
  <div className="knob-grid sampler-knobs">
        <div className="knob-group">
          <Knob
            value={sampler.sample_start}
            step={49}
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
            step={49}
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
            value={unifiedPitchNorm}
            step={49}
            onChange={(v: number) => {
              // Map 0..1 to total cents in [-4900, +4900]
              const totalCents = (v * 2 - 1) * 4900;
              // Drive engine with cents only for continuous control; zero out semitone param to avoid double counting
              s.updateSynthUI((ui: any) => ({
                ...ui,
                sampler: { ...ui.sampler, pitch_semitones: 0, pitch_cents: totalCents }
              }));
              const part = s.selectedSoundPart ?? 0;
              s.setSynthParam(`part/${part}/sampler/pitch_semitones`, 0, 'F32');
              s.setSynthParam(`part/${part}/sampler/pitch_cents`, totalCents);
            }}
            label="Pitch"
            format={(v: number) => {
              const cents = (v * 2 - 1) * 4900;
              const st = cents / 100;
              return (st >= 0 ? '+' : '') + st.toFixed(1) + ' st';
            }}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={playbackModeIndex / 2} // discrete 0,0.5,1 for 3 states
            onChange={(v: number) => {
              const idx = Math.round(v * 2);
              setParam('playback_mode', idx);
            }}
            step={3}
            label="Playback"
            format={(v: number) => {
              const idx = Math.round(v * 2);
              return playbackModes[idx] || 'One-Shot';
            }}
          />
        </div>
      </div>
  </div>
  );
}
