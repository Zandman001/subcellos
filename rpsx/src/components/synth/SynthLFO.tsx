import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys'

export default function SynthLFO() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const lfo = ui.lfo;
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const phaseRef = React.useRef<number>(0);

  // Map shape index (0..3) to sample function
  const sampleFn = React.useCallback((shapeIdx: number, t: number): number => {
    const x = t % 1;
    switch (Math.round(shapeIdx)) {
      case 1: // saw
        return 2 * (x - 0.5);
      case 2: // square
        return x < 0.5 ? 1 : -1;
      case 3: // tri
        return 2 * Math.abs(2 * (x - Math.floor(x + 0.5))) - 1;
      default: // sine
        return Math.sin(2 * Math.PI * x);
    }
  }, []);

  const draw = React.useCallback(() => {
    const canvas = canvasRef.current; const wrap = wrapRef.current; if (!canvas || !wrap) return;
    const dpr = Math.max(1, (window.devicePixelRatio as number) || 1);
    const rect = wrap.getBoundingClientRect();
    const W = Math.max(120, Math.floor(rect.width));
    const H = 60;
    if (canvas.width !== Math.floor(W * dpr) || canvas.height !== Math.floor(H * dpr)) {
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
    }
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const BG = '#000000', CY = '#ffffff', MG = '#666666';  // monochrome theme colors
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    // axis (magenta)
    ctx.strokeStyle = MG; ctx.lineWidth = 2; ctx.globalAlpha = 1.0;
    ctx.beginPath(); ctx.moveTo(0, Math.floor(H/2)+0.5); ctx.lineTo(W, Math.floor(H/2)+0.5); ctx.stroke();
    // waveform
    const shape = lfo.shape || 0;
    const rateHz = 0.05 + (lfo.rate || 0) * (20 - 0.05);
    const phase = phaseRef.current;
    ctx.strokeStyle = CY; ctx.lineWidth = 3; ctx.beginPath();
    for (let x = 0; x < W; x++) {
      const t = (x / W) + phase;
      const yN = sampleFn(shape, t);
      const y = (H/2) - yN * (H/2 - 6);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // advance phase for next frame
    const dt = 1 / 60; // approx 60fps
    phaseRef.current = (phase + rateHz * dt) % 1;
  }, [lfo.shape, lfo.rate, sampleFn]);

  React.useEffect(() => {
    const tick = () => { draw(); rafRef.current = requestAnimationFrame(tick); };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [draw]);

  // 4-knob hotkeys: Shape (discrete 4), Rate, Amount, Drive
  const clamp01 = (x:number)=> Math.max(0, Math.min(1, x));
  const step = 1/48;
  const stepDiscrete = (v:number, steps:number, dir:number)=> {
    const i = Math.round(v * (steps-1));
    const ni = Math.max(0, Math.min(steps-1, i + dir));
    return (steps===1)?0:(ni / (steps-1));
  };
  const setShape = (nv:number)=> { const v = clamp01(nv); s.updateSynthUI((ui:any)=>({ ...ui, lfo: { ...ui.lfo, shape: v } })); s.setSynthParam(`part/0/lfo/shape`, Math.round(v*3), 'I32'); };
  const setRate = (nv:number)=> { const v = clamp01(nv); s.updateSynthUI((ui:any)=>({ ...ui, lfo: { ...ui.lfo, rate: v } })); s.setSynthParam(`part/0/lfo/rate_hz`, mapRate(v)); };
  const setAmount = (nv:number)=> { const v = clamp01(nv); s.updateSynthUI((ui:any)=>({ ...ui, lfo: { ...ui.lfo, amount: v } })); s.setSynthParam(`part/0/lfo/amount`, v); };
  const setDrive = (nv:number)=> { const v = clamp01(nv); s.updateSynthUI((ui:any)=>({ ...ui, lfo: { ...ui.lfo, drive: v } })); s.setSynthParam(`part/0/lfo/drive`, v); };
  useFourKnobHotkeys({
    dec1: ()=> setShape(stepDiscrete(lfo.shape||0, 4, -1)), inc1: ()=> setShape(stepDiscrete(lfo.shape||0, 4, +1)),
    dec2: ()=> setRate((lfo.rate||0) - step), inc2: ()=> setRate((lfo.rate||0) + step),
    dec3: ()=> setAmount((lfo.amount||0) - step), inc3: ()=> setAmount((lfo.amount||0) + step),
    dec4: ()=> setDrive((lfo.drive||0) - step), inc4: ()=> setDrive((lfo.drive||0) + step),
    active: true,
  });

  return (
    <Page title={`LFO`}>
      <div ref={wrapRef} style={{ width: '100%', marginBottom: 8 }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: 60, display: 'block' }} />
      </div>
      <Row>
  <Knob label="Shape" value={lfo.shape} step={4} onChange={(v)=> { updateLfo(s, { shape: v }); s.setSynthParam(`part/0/lfo/shape`, Math.round(v*3), 'I32'); }} format={(v)=>['sine','saw','square','tri'][Math.round(v*3)]} />
  <Knob label="Rate" value={lfo.rate} step={49} onChange={(v)=> { updateLfo(s, { rate: v }); s.setSynthParam(`part/0/lfo/rate_hz`, mapRate(v)); }} format={(v)=>`${mapRate(v).toFixed(2)} Hz`} />
  <Knob label="Amount" value={lfo.amount ?? 1} step={49} onChange={(v)=> { updateLfo(s, { amount: v }); s.setSynthParam(`part/0/lfo/amount`, v); }} format={(v)=>`${Math.round(v*100)}%`} />
  <Knob label="Drive" value={lfo.drive} step={49} onChange={(v)=> { updateLfo(s, { drive: v }); s.setSynthParam(`part/0/lfo/drive`, v); }} format={(v)=>`${Math.round(v*100)}%`} />
      </Row>
    </Page>
  );
}

function Page({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div style={{ padding: 8, borderTop: '3px solid var(--accent)' }}>
      <div style={{ height: 2, background: 'var(--accent)' }} />
      <div style={{ fontSize: 12, margin: '6px 0 8px' }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>{children}</div>
  )
}

function mapRate(v: number): number { return 0.05 + v * (20 - 0.05); }
function updateLfo(s: any, patch: Partial<{shape:number;rate:number;amount:number;drive:number}>) {
  s.updateSynthUI((ui: any) => ({ ...ui, lfo: { ...ui.lfo, ...patch } }));
}
