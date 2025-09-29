import React from 'react'
import Knob from './Knob'
import { useSynthEqState, setEqPage, updateEqGain } from '../../store/browser'
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys'
import { listen } from '@tauri-apps/api/event'

const FREQS = [50, 100, 200, 400, 800, 1600, 3200, 6400];
const FMIN = 20, FMAX = 20000;
const AUDIO_DB_MIN = -12, AUDIO_DB_MAX = 12;
const VISUAL_DB_MIN = -8, VISUAL_DB_MAX = 8; // reduced magnification per spec

export default function SynthEQView({ partIndex }: { partIndex?: number }) {
  const { eqGains, eqPage } = useSynthEqState(partIndex);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const specCanvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const spectrumRef = React.useRef<number[] | null>(null);
  const spectrumSmoothRef = React.useRef<number[] | null>(null);

  // Global key listeners (StrictMode-safe) and shift latch
  React.useEffect(() => {
    const w: any = window as any;
    if (w.__eq_keys_registered__) return;
    w.__eq_keys_registered__ = true;
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') w.__eq_shift__ = true;
      if (e.key === 'w' || e.key === 'W') setEqPage(0);
      if (e.key === 'r' || e.key === 'R') setEqPage(1);
    };
    const onUp = (e: KeyboardEvent) => { if (e.key === 'Shift') w.__eq_shift__ = false; };
    window.addEventListener('keydown', onDown, { passive: true } as any);
    window.addEventListener('keyup', onUp, { passive: true } as any);
    return () => {
      window.removeEventListener('keydown', onDown as any);
      window.removeEventListener('keyup', onUp as any);
      w.__eq_keys_registered__ = false;
    };
  }, []);

  // Canvas drawing helpers
  const xFromHz = React.useCallback((hz: number, w: number, pad = 10) => {
    const t = (Math.log10(hz / FMIN)) / (Math.log10(FMAX / FMIN));
    return pad + t * (w - 2 * pad);
  }, []);
  const yFromDb = React.useCallback((db: number, h: number, pad = 10) => {
    const clamped = Math.max(AUDIO_DB_MIN, Math.min(AUDIO_DB_MAX, db));
    const t = (clamped - VISUAL_DB_MIN) / (VISUAL_DB_MAX - VISUAL_DB_MIN);
    return pad + (1 - t) * (h - 2 * pad);
  }, []);
  const gainAtHz = React.useCallback((hz: number, gains: number[]) => {
    // piecewise-linear over log domain of FREQS
    const lx = FREQS.map(f => Math.log10(f));
    const ly = gains.slice();
    const x = Math.log10(hz);
    if (x <= lx[0]) return ly[0];
    if (x >= lx[lx.length - 1]) return ly[ly.length - 1];
    for (let i = 0; i < lx.length - 1; i++) {
      if (x >= lx[i] && x <= lx[i + 1]) {
        const t = (x - lx[i]) / (lx[i + 1] - lx[i]);
        return ly[i] + t * (ly[i + 1] - ly[i]);
      }
    }
    return 0;
  }, []);

  const drawStatic = React.useCallback(() => {
    const canvas = canvasRef.current; const wrap = wrapRef.current; if (!canvas || !wrap) return;
    const dpr = Math.max(1, (window.devicePixelRatio as number) || 1);
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(100, Math.floor(rect.width));
    const h = Math.max(80, Math.floor(rect.height));
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const BG = '#000000';  // pure black background - monochrome theme
    const CY = '#ffffff';  // white for primary lines - monochrome theme  
    const MG = '#666666';  // gray for 0dB line - monochrome theme
    ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = CY; ctx.lineWidth = 3; ctx.globalAlpha = 1.0;
    // Frame (neon)
    ctx.strokeRect(1.5, 1.5, w - 3, h - 3);
    // Grid: faint ±12 dB, medium visual window ±6 dB, bold 0 dB
    const yA12 = yFromDb(AUDIO_DB_MAX, h), yA_12 = yFromDb(AUDIO_DB_MIN, h);
    const yV6 = yFromDb(VISUAL_DB_MAX, h), yV_6 = yFromDb(VISUAL_DB_MIN, h);
    const y0 = yFromDb(0, h);
    // ±12 guides (dark) - monochrome theme
    ctx.globalAlpha = 0.25; ctx.lineWidth = 1; ctx.strokeStyle = '#2a2a2a';
    ctx.beginPath(); ctx.moveTo(6, yA12 + 0.5); ctx.lineTo(w - 6, yA12 + 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, yA_12 + 0.5); ctx.lineTo(w - 6, yA_12 + 0.5); ctx.stroke();
    // visual window edges ±6 (slightly brighter) - monochrome theme
    ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.strokeStyle = '#444444';
    ctx.beginPath(); ctx.moveTo(6, yV6 + 0.5); ctx.lineTo(w - 6, yV6 + 0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, yV_6 + 0.5); ctx.lineTo(w - 6, yV_6 + 0.5); ctx.stroke();
    // 0 dB line (gray bold) - monochrome theme
    ctx.globalAlpha = 1.0; ctx.lineWidth = 3; ctx.strokeStyle = MG;
    ctx.beginPath(); ctx.moveTo(6, y0 + 0.5); ctx.lineTo(w - 6, y0 + 0.5); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = CY; ctx.globalAlpha = 1.0;
    // Vertical lines at band freqs - monochrome theme
    ctx.setLineDash([3, 3]); ctx.strokeStyle = '#2a2a2a'; ctx.globalAlpha = 1.0; ctx.lineWidth = 1;
    for (const f of FREQS) {
      const x = xFromHz(f, w);
      ctx.beginPath(); ctx.moveTo(x + 1, 1); ctx.lineTo(x + 1, h - 1); ctx.stroke();
    }
    ctx.setLineDash([]);
    // Curve (make more apparent with a soft halo + thicker stroke)
    const pad = 10;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Halo pass
    ctx.beginPath();
    for (let i = 0; i <= 240; i++) {
      const t = i / 240;
      const hz = FMIN * Math.pow(FMAX / FMIN, t);
      const x = xFromHz(hz, w, pad);
      const gdb = gainAtHz(hz, eqGains);
      const y = yFromDb(gdb, h, pad);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(43, 209, 201, 0.35)'; // CY at low alpha
    ctx.lineWidth = 6;
    ctx.stroke();
    // Main pass
    ctx.beginPath();
    for (let i = 0; i <= 240; i++) {
      const t = i / 240;
      const hz = FMIN * Math.pow(FMAX / FMIN, t);
      const x = xFromHz(hz, w, pad);
      const gdb = gainAtHz(hz, eqGains);
      const y = yFromDb(gdb, h, pad);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = CY;
    ctx.lineWidth = 3;
    ctx.stroke();
    // Handles
    for (let i = 0; i < 8; i++) {
      const x = xFromHz(FREQS[i], w, pad);
      const y = yFromDb(eqGains[i], h, pad);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      const active = (eqPage === 0 && i < 4) || (eqPage === 1 && i >= 4);
      if (active) { ctx.fillStyle = CY; ctx.fill(); ctx.fillStyle = BG; ctx.strokeStyle = BG; ctx.stroke(); ctx.strokeStyle = CY; }
      else { ctx.stroke(); }
    }
  }, [eqGains, eqPage, xFromHz, yFromDb, gainAtHz]);

  const drawSpectrum = React.useCallback(() => {
    const canvas = specCanvasRef.current; const wrap = wrapRef.current; if (!canvas || !wrap) return;
    const dpr = Math.max(1, (window.devicePixelRatio as number) || 1);
    const rect = wrap.getBoundingClientRect();
    const w = Math.max(100, Math.floor(rect.width));
    const h = Math.max(80, Math.floor(rect.height));
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const spec = spectrumSmoothRef.current || spectrumRef.current;
    if (!spec || spec.length <= 8) return;
    ctx.save();
    ctx.globalAlpha = 0.45; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;  // white spectrum - monochrome theme
    const pad = 10; const n = spec.length;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const hz = FMIN * Math.pow(FMAX / FMIN, t);
      const x = xFromHz(hz, w, pad);
      const m = Math.max(1e-9, spec[i]);
      const db = 20 * Math.log10(m);
      const dbMin = -80, dbMax = 0;
      const dbClamp = Math.max(dbMin, Math.min(dbMax, db));
      const norm = (dbClamp - dbMin) / (dbMax - dbMin);
      const y = pad + (1 - norm) * (h - 2 * pad);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }, [xFromHz]);

  // Steady redraw via RAF scheduling
  const rafRefStat = React.useRef<number | null>(null);
  const rafRefSpec = React.useRef<number | null>(null);
  const scheduleDrawStatic = React.useCallback(() => {
    if (rafRefStat.current) cancelAnimationFrame(rafRefStat.current);
    rafRefStat.current = requestAnimationFrame(() => { rafRefStat.current = null; drawStatic(); });
  }, [drawStatic]);
  const scheduleDrawSpectrum = React.useCallback(() => {
    if (rafRefSpec.current) cancelAnimationFrame(rafRefSpec.current);
    rafRefSpec.current = requestAnimationFrame(() => { rafRefSpec.current = null; drawSpectrum(); });
  }, [drawSpectrum]);
  React.useEffect(() => { scheduleDrawStatic(); }, [scheduleDrawStatic, eqGains, eqPage]);
  React.useEffect(() => { const onR = () => { scheduleDrawStatic(); scheduleDrawSpectrum(); }; window.addEventListener('resize', onR); return () => window.removeEventListener('resize', onR); }, [scheduleDrawStatic, scheduleDrawSpectrum]);
  React.useEffect(() => {
    let unlisten: (()=>void)|undefined;
    (async () => {
      try {
        unlisten = await listen<number[]>('eq_spectrum', (e) => {
          const arr = Array.isArray(e.payload) ? (e.payload as number[]) : [];
          // Simple temporal smoothing to reduce jitter
          const prev = spectrumSmoothRef.current || spectrumRef.current || [];
          const alpha = 0.8; // heavier weight to previous
          const smoothed = arr.map((v, i) => {
            const p = prev[i] ?? v;
            return alpha * p + (1 - alpha) * v;
          });
          spectrumRef.current = arr;
          spectrumSmoothRef.current = smoothed;
          scheduleDrawSpectrum();
        });
      } catch {}
    })();
    return () => { try { unlisten && unlisten(); } catch {} };
  }, [scheduleDrawSpectrum]);

  const pageBase = eqPage === 0 ? 0 : 4;
  // Knobs behave like other pages: direct normalized control 0..1 -> dB
  const normFromDb = (db: number) => (db + 8) / 16;
  const dbFromNorm = (n: number) => -8 + n * 16;

  // 4-knob hotkeys to adjust current page bands in 0.5 dB steps (matches step=33)
  const clampDb = (db: number) => Math.max(VISUAL_DB_MIN, Math.min(VISUAL_DB_MAX, db));
  const stepDb = 0.5;
  const quantizeDb = (db: number) => Math.round(db / stepDb) * stepDb;
  const adjustBand = (idx: number, delta: number) => {
    const cur = eqGains[idx] ?? 0;
    const nxt = quantizeDb(clampDb(cur + delta));
    updateEqGain(idx, nxt);
  };
  useFourKnobHotkeys({
    dec1: () => adjustBand(pageBase + 0, -stepDb),
    inc1: () => adjustBand(pageBase + 0, +stepDb),
    dec2: () => adjustBand(pageBase + 1, -stepDb),
    inc2: () => adjustBand(pageBase + 1, +stepDb),
    dec3: () => adjustBand(pageBase + 2, -stepDb),
    inc3: () => adjustBand(pageBase + 2, +stepDb),
    dec4: () => adjustBand(pageBase + 3, -stepDb),
    inc4: () => adjustBand(pageBase + 3, +stepDb),
    active: true,
  });

  return (
    <div className="eq-panel">
      <div className="eq-canvas-wrap" ref={wrapRef} style={{ position: 'relative' }}>
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />
        <canvas ref={specCanvasRef} style={{ position: 'absolute', inset: 0 }} />
      </div>
      <div style={{ display: 'flex', gap: 12, marginTop: 6, justifyContent: 'center' }}>
        <Knob label={`Band ${pageBase+1}`} value={normFromDb(eqGains[pageBase+0] || 0)} onChange={(v)=> updateEqGain(pageBase+0, dbFromNorm(v))} step={33} format={() => ''} />
        <Knob label={`Band ${pageBase+2}`} value={normFromDb(eqGains[pageBase+1] || 0)} onChange={(v)=> updateEqGain(pageBase+1, dbFromNorm(v))} step={33} format={() => ''} />
        <Knob label={`Band ${pageBase+3}`} value={normFromDb(eqGains[pageBase+2] || 0)} onChange={(v)=> updateEqGain(pageBase+2, dbFromNorm(v))} step={33} format={() => ''} />
        <Knob label={`Band ${pageBase+4}`} value={normFromDb(eqGains[pageBase+3] || 0)} onChange={(v)=> updateEqGain(pageBase+3, dbFromNorm(v))} step={33} format={() => ''} />
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }
