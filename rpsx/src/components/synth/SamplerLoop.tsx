import React, { useEffect, useRef, useState } from 'react';
import { useBrowser } from '../../store/browser';
import Knob from './Knob';
import { rpc } from '../../rpc';
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys';

export default function SamplerLoop() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const sampler = ui.sampler || {
    loop_mode: 0,
    loop_start: 0.2,
    loop_end: 0.8,
    sample_start: 0.0,
    sample_end: 1.0,
    pitch_semitones: 0,
    pitch_cents: 0,
    current_sample: undefined as string | undefined,
  retrig_mode: 0, // 0=Immediate; 1..7 = Follow tempo divisions (1/1..1/64)
  };
  const safeLoopMode = Number.isFinite(sampler.loop_mode) ? Math.max(0, Math.min(1, Math.round(sampler.loop_mode))) : 0; // 0=Forward,1=PingPong
  const sampleStart = Math.max(0, Math.min(1, sampler.sample_start ?? 0));
  const sampleEnd = Math.max(sampleStart + 0.0005, Math.min(1, sampler.sample_end ?? 1));
  const span = sampleEnd - sampleStart;

  const currentSamplePath = sampler.current_sample as string | undefined;
  const [waveform, setWaveform] = useState<number[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!currentSamplePath) { setWaveform(null); return; }
    rpc.getSampleWaveform(currentSamplePath)
      .then(w => { if (!cancelled) setWaveform(w); })
      .catch(()=> { if (!cancelled) setWaveform(null); });
    return () => { cancelled = true; };
  }, [currentSamplePath]);
  // Region (selection) waveform path: only sample_start..sample_end stretched to full width
  let regionPath = '';
  if (waveform && waveform.length > 1) {
    const total = waveform.length - 1;
    const startIdx = Math.max(0, Math.min(total, Math.floor(sampleStart * total)));
    const endIdx = Math.max(startIdx + 1, Math.min(total, Math.ceil(sampleEnd * total)));
    const region = waveform.slice(startIdx, endIdx + 1);
    if (region.length > 1) {
      const maxAmp = Math.max(0.00001, ...region.map(v => Math.abs(v)));
      const top: string[] = [];
      const bottom: string[] = [];
      for (let i = 0; i < region.length; i++) {
        const x = (i / (region.length - 1)) * 100;
        const a = region[i] / maxAmp;
        const yT = 50 - a * 45;
        const yB = 50 + a * 45;
        top.push(`${x},${yT}`);
        bottom.push(`${x},${yB}`);
      }
      regionPath = `M ${top[0]} L ${top.slice(1).join(' ')} L ${bottom.reverse().join(' ')} Z`;
    }
  }

  // Playhead: prefer engine-reported position; fallback to local simulation
  const [playhead, setPlayhead] = useState(0); // relative (0..1) inside loop region
  const [playheadActive, setPlayheadActive] = useState(false);
  // Follow engine playhead only; no local simulation
  useEffect(() => {
    let cancelled = false;
    const part = s.selectedSoundPart ?? 0;
    const poll = async () => {
      if (cancelled) return;
      try {
        const st = await rpc.getSamplerPlayhead(part);
        if (st && typeof st.position_rel === 'number' && st.playing) {
          const ls = Math.max(0, Math.min(1, (sampler.loop_start - sampleStart) / span));
          const le = Math.max(ls + 1e-6, Math.min(1, (sampler.loop_end - sampleStart) / span));
          const loopW = Math.max(1e-6, le - ls);
          let rel = (st.position_rel - ls) / loopW;
          if (!Number.isFinite(rel)) rel = 0;
          setPlayhead(Math.max(0, Math.min(1, rel)));
          setPlayheadActive(true);
        } else {
          setPlayheadActive(false);
        }
      } catch {
        setPlayheadActive(false);
      }
      if (!cancelled) setTimeout(poll, 16);
    };
    poll();
    return () => { cancelled = true; };
  }, [s.selectedSoundPart, sampler.loop_start, sampler.loop_end, sampleStart, span]);

  // --- Loop editing state & handlers (restored) ---
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [editing, setEditing] = useState<null | 'start' | 'end'>(null);
  const minSpan = 0.0015;
  const handleGrabRadius = 0.02;
  const lsRel = (sampler.loop_start - sampleStart) / span; // relative inside displayed region (0..1)
  const leRel = (sampler.loop_end - sampleStart) / span;

  // Keep loop within selection whenever selection changes
  useEffect(() => {
    let changed = false;
    let newStart = sampler.loop_start;
    let newEnd = sampler.loop_end;
    if (newStart < sampleStart) { newStart = sampleStart; changed = true; }
    if (newEnd > sampleEnd) { newEnd = sampleEnd; changed = true; }
    if (newEnd - newStart < minSpan) {
      newEnd = Math.min(sampleEnd, newStart + minSpan);
      if (newEnd - newStart < minSpan) {
        newStart = Math.max(sampleStart, newEnd - minSpan);
      }
      changed = true;
    }
    if (changed) {
      setParam('loop_start', newStart);
      setParam('loop_end', newEnd);
    }
  }, [sampleStart, sampleEnd]);

  // (Zoom removed for loop tab; full region shown for consistent loop editing)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!editing || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const relView = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const abs = sampleStart + relView * span; // absolute sample position
      if (editing === 'start') {
        const newStart = Math.min(Math.max(sampleStart, abs), sampler.loop_end - minSpan);
        setParam('loop_start', newStart);
      } else if (editing === 'end') {
        const newEnd = Math.max(Math.min(sampleEnd, abs), sampler.loop_start + minSpan);
        setParam('loop_end', newEnd);
      }
    };
    const onUp = () => setEditing(null);
    if (editing) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [editing, sampleStart, span, sampler.loop_end, sampler.loop_start]);

  const onMouseDownRegion = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
  const relView = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (Math.abs(relView - lsRel) <= handleGrabRadius) { setEditing('start'); return; }
  if (Math.abs(relView - leRel) <= handleGrabRadius) { setEditing('end'); return; }
  const defaultRelSpan = Math.min(0.1, 1);
  let half = (defaultRelSpan / 2) * span;
    if (half < minSpan * 4) half = minSpan * 4;
  const abs = sampleStart + relView * span;
    let newStart = abs - half;
    let newEnd = abs + half;
    if (newStart < sampleStart) { const diff = sampleStart - newStart; newStart += diff; newEnd += diff; }
    if (newEnd > sampleEnd) { const diff = newEnd - sampleEnd; newStart -= diff; newEnd -= diff; }
    newStart = Math.max(sampleStart, Math.min(sampleEnd - minSpan, newStart));
    newEnd = Math.max(newStart + minSpan, Math.min(sampleEnd, newEnd));
    setParam('loop_start', newStart);
    setParam('loop_end', newEnd);
  setEditing(Math.abs(relView - ((newStart - sampleStart)/span)) < Math.abs(relView - ((newEnd - sampleStart)/span)) ? 'start' : 'end');
  };

  // 4-knob hotkeys: Loop Type (discrete 2), Loop Start, Loop End, Retrig (discrete 8)
  const clamp01 = (x:number)=> Math.max(0, Math.min(1, x));
  const step = 1/48;
  useFourKnobHotkeys({
    dec1: ()=> setParam('loop_mode', Math.max(0, Math.round(sampler.loop_mode ?? 0) - 1)),
    inc1: ()=> setParam('loop_mode', Math.min(1, Math.round(sampler.loop_mode ?? 0) + 1)),
    dec2: ()=> {
      const rel = clamp01(safeLoopStartRel - step);
      let abs = sampleStart + rel * span;
      if (abs > sampler.loop_end - minSpan) abs = sampler.loop_end - minSpan;
      if (abs < sampleStart) abs = sampleStart;
      setParam('loop_start', abs);
    },
    inc2: ()=> {
      const rel = clamp01(safeLoopStartRel + step);
      let abs = sampleStart + rel * span;
      if (abs > sampler.loop_end - minSpan) abs = sampler.loop_end - minSpan;
      if (abs < sampleStart) abs = sampleStart;
      setParam('loop_start', abs);
    },
    dec3: ()=> {
      const rel = clamp01(safeLoopEndRel - step);
      let abs = sampleStart + rel * span;
      if (abs < sampler.loop_start + minSpan) abs = sampler.loop_start + minSpan;
      if (abs > sampleEnd) abs = sampleEnd;
      setParam('loop_end', abs);
    },
    inc3: ()=> {
      const rel = clamp01(safeLoopEndRel + step);
      let abs = sampleStart + rel * span;
      if (abs < sampler.loop_start + minSpan) abs = sampler.loop_start + minSpan;
      if (abs > sampleEnd) abs = sampleEnd;
      setParam('loop_end', abs);
    },
    dec4: ()=> setParam('retrig_mode', Math.max(0, Math.round(sampler.retrig_mode ?? 0) - 1)),
    inc4: ()=> setParam('retrig_mode', Math.min(7, Math.round(sampler.retrig_mode ?? 0) + 1)),
    active: true,
  });

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
        {
          // Engine expects loop positions relative to the trimmed region [sample_start..sample_end]
          const rel = (value - sampleStart) / span;
          s.setSynthParam(`part/${part}/sampler/loop_start`, Math.max(0, Math.min(1, rel)));
        }
        break;
      case 'loop_end':
        {
          const rel = (value - sampleStart) / span;
          s.setSynthParam(`part/${part}/sampler/loop_end`, Math.max(0, Math.min(1, rel)));
        }
        break;
      case 'retrig_mode':
        s.setSynthParam(`part/${part}/sampler/retrig_mode`, Math.round(value), 'I32');
        break;
    }
  };

  // Loop mode display
  const loopModes = ['Forward', 'Ping-Pong'];
  // Relative loop knob values (inside selection region)
  const loopStartRel = (sampler.loop_start - sampleStart) / span;
  const loopEndRel = (sampler.loop_end - sampleStart) / span;
  const safeLoopStartRel = Math.max(0, Math.min(1, loopStartRel));
  const safeLoopEndRel = Math.max(0, Math.min(1, loopEndRel));
  const minLoopRel = 0.0015 / span; // relative min
  
  return (
    <div className="synth-page">
      <div className="page-header">
        <h2>LOOP</h2>
      </div>

      {/* Waveform of trimmed sample region with loop markers relative to region */}
  <div className="waveform-container" ref={containerRef} onMouseDown={onMouseDownRegion} style={{ cursor: editing ? 'ew-resize' : 'crosshair' }}>
        <div className="waveform-display">
          <div className="waveform-placeholder">
            <div className="waveform-svg-wrap">
              {!currentSamplePath && <div className="waveform-text">No sample</div>}
              {currentSamplePath && !waveform && <div className="waveform-text">Loading...</div>}
              {regionPath && (
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="sampler-waveform-svg">
                  <rect x={0} y={0} width={100} height={100} fill="#222" />
                  <path d={regionPath} fill="#ffffff" fillOpacity={0.85} stroke="#ffffff" strokeWidth={0.25} />
                  <line x1="0" y1="50" x2="100" y2="50" stroke="#555" strokeWidth={0.4} strokeDasharray="2 2" />
                  {(() => {
                    const ls = Math.max(0, Math.min(1, lsRel));
                    const le = Math.max(ls + 0.0005, Math.min(1, leRel));
                    const loopWidth = le - ls;
                    const loopPlayheadX = ls + loopWidth * playhead; // relative 0..1 in region
                    return (
                      <g>
                        <rect x={ls * 100} y={0} width={loopWidth * 100} height={100} fill="#ffffff" fillOpacity={0.08} />
                        <line x1={ls * 100} y1={0} x2={ls * 100} y2={100} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.6} />
                        <line x1={le * 100} y1={0} x2={le * 100} y2={100} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.6} />
                        <rect x={ls*100 - 1.5} y={0} width={3} height={100} fill={editing==='start'? '#fff' : '#fff8'} />
                        <rect x={le*100 - 1.5} y={0} width={3} height={100} fill={editing==='end'? '#fff' : '#fff8'} />
                        {playheadActive && (
                          <line x1={loopPlayheadX * 100} y1={0} x2={loopPlayheadX * 100} y2={100} stroke="#fffb" strokeWidth={0.7} />
                        )}
                      </g>
                    );
                  })()}
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Loop controls */}
      <div className="knob-grid loop-knobs">
        <div className="knob-group">
          <Knob
            value={safeLoopMode}
            onChange={(v: number) => {
              const idx = v < 0.5 ? 0 : 1;
              setParam('loop_mode', idx);
            }}
            step={2}
            label="Loop Type"
            format={(v: number) => (v < 0.5 ? 'Forward' : 'Ping-Pong')}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={safeLoopStartRel}
            step={49}
            dragScale={span} /* smaller selection -> finer movement */
            onChange={(v: number) => {
              const rel = Math.max(0, Math.min(1, v));
              let abs = sampleStart + rel * span;
              if (abs > sampler.loop_end - minSpan) abs = sampler.loop_end - minSpan;
              if (abs < sampleStart) abs = sampleStart;
              setParam('loop_start', abs);
            }}
            label="Loop Start"
            format={(v: number) => ((sampleStart + v * span) * 100).toFixed(1) + '%'}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={safeLoopEndRel}
            step={49}
            dragScale={span}
            onChange={(v: number) => {
              const rel = Math.max(0, Math.min(1, v));
              let abs = sampleStart + rel * span;
              if (abs < sampler.loop_start + minSpan) abs = sampler.loop_start + minSpan;
              if (abs > sampleEnd) abs = sampleEnd;
              setParam('loop_end', abs);
            }}
            label="Loop End"
            format={(v: number) => ((sampleStart + v * span) * 100).toFixed(1) + '%'}
          />
        </div>

        <div className="knob-group">
          <Knob
            value={(Math.max(0, Math.min(7, (sampler.retrig_mode ?? 0) as number))) / 7}
            onChange={(v: number) => {
              const idx = Math.round(Math.max(0, Math.min(1, v)) * 7);
              setParam('retrig_mode', idx);
            }}
            step={8}
            label="Retrig"
            format={(v: number) => {
              const labels = ['Immediate','1/1','1/2','1/4','1/8','1/16','1/32','1/64'];
              const idx = Math.round(Math.max(0, Math.min(1, v)) * 7);
              return labels[idx] ?? 'Immediate';
            }}
          />
        </div>
      </div>

      <div className="loop-info">
  <div className="info-text">Region: {(sampleStart * 100).toFixed(1)}% - {(sampleEnd * 100).toFixed(1)}%</div>
  <div className="info-text">Loop (abs): {(sampler.loop_start * 100).toFixed(1)}% - {(sampler.loop_end * 100).toFixed(1)}%</div>
  <div className="info-text">Loop (rel): {(((sampler.loop_start - sampleStart)/span)*100).toFixed(1)}% - {(((sampler.loop_end - sampleStart)/span)*100).toFixed(1)}%</div>
        <div className="info-text">
          Mode: {loopModes[sampler.loop_mode] || 'Off'}
        </div>
      </div>
    </div>
  );
}
