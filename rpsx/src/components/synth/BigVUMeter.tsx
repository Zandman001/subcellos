import React from 'react';
import { useBrowser } from '../../store/browser';
import { useSequencer } from '../../store/sequencer';

export default function BigVUMeter() {
  const s = useBrowser() as any;
  const sid = s?.selectedSoundId || '__none__';
  const seq = useSequencer(sid);
  const ui = s.getSynthUI();
  const mx = ui.mixer || { volume: 0.8, pan: 0.5, comp: 0 };

  const lRef = React.useRef(0);
  const rRef = React.useRef(0);
  const peakLRef = React.useRef(0);
  const peakRRef = React.useRef(0);
  const rafRef = React.useRef<number | null>(null);
  const lastRef = React.useRef<number | null>(null);
  const [tick, setTick] = React.useState(0);

  // helper: bump meters from a trigger (sequencer step, preview, etc)
  const bump = React.useCallback((strength = 0.7) => {
    const vol = Math.max(0, Math.min(1, mx.volume ?? 0.8));
    const pan = Math.max(0, Math.min(1, mx.pan ?? 0.5));
    const p = (pan - 0.5) * 2; // -1..+1
    const lWeight = (1 - p) / 2; // 0..1
    const rWeight = (1 + p) / 2; // 0..1
    const base = strength * (0.6 + Math.random() * 0.4) * (0.85 + (mx.comp ?? 0) * 0.3) * vol;
    lRef.current = Math.min(1, lRef.current + base * lWeight);
    rRef.current = Math.min(1, rRef.current + base * rWeight);
    // Update peaks immediately
    peakLRef.current = Math.max(peakLRef.current, lRef.current);
    peakRRef.current = Math.max(peakRRef.current, rRef.current);
    setTick((t) => t + 1);
  }, [mx.volume, mx.pan, mx.comp]);

  // Pulse on sequencer steps
  const stepIndex = seq?.stepIndex;
  React.useEffect(() => {
    if (typeof stepIndex === 'number') {
      bump(0.6);
    }
  }, [stepIndex, bump]);

  // Pulse on preview note events
  const curPrev = s.currentPreview;
  React.useEffect(() => {
    if (typeof curPrev === 'number') bump(0.8);
  }, [curPrev, bump]);

  // Animation loop with decay and peak hold
  React.useEffect(() => {
    const decayPerSec = 2.5; // value per second
    const peakHold = 0.35; // seconds before peak falls
    let peakTimerL = 0;
    let peakTimerR = 0;
    const frame = (t: number) => {
      const last = lastRef.current ?? t;
      lastRef.current = t;
      const dt = Math.max(0, (t - last) / 1000);
      const dec = decayPerSec * dt;
      // decay
      lRef.current = Math.max(0, lRef.current - dec);
      rRef.current = Math.max(0, rRef.current - dec);
      // peak timers
      peakTimerL += dt; peakTimerR += dt;
      if (peakTimerL > peakHold) {
        peakLRef.current = Math.max(peakLRef.current - dec * 1.5, lRef.current);
      }
      if (peakTimerR > peakHold) {
        peakRRef.current = Math.max(peakRRef.current - dec * 1.5, rRef.current);
      }
      // if current surpasses peak, reset hold timers
      if (lRef.current >= peakLRef.current - 1e-3) peakTimerL = 0;
      if (rRef.current >= peakRRef.current - 1e-3) peakTimerR = 0;
      setTick((t) => t + 1);
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const renderRow = (val: number, peak: number) => {
    const pct = Math.max(0, Math.min(1, val)) * 100;
    const peakPct = Math.max(0, Math.min(1, peak)) * 100;
    return (
      <div style={{ position: 'relative', height: 48, background: '#111', border: '1px solid #fff', display: 'flex', alignItems: 'center' }}>
        <div style={{ position: 'absolute', inset: 4, background: '#fff' }} />
        <div style={{ position: 'absolute', left: 4 + pct * 0.92 + '%', top: 8, bottom: 8, width: 18, background: '#777' }} />
        <div style={{ position: 'absolute', inset: 4, right: `${100 - pct}%`, background: '#000' }} />
        {/* Peak marker */}
        <div style={{ position: 'absolute', left: `calc(${peakPct}% - 2px)`, top: 6, bottom: 6, width: 3, background: '#000' }} />
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, margin: '8px 8px 14px' }}>
      {renderRow(lRef.current, peakLRef.current)}
      {renderRow(rRef.current, peakRRef.current)}
    </div>
  );
}
