import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'

export default function Acid303() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const part = s.selectedSoundPart ?? 0;
  // Ensure module is set to Acid when page is active
  React.useEffect(() => { try { s.setSynthParam(`part/${part}/module_kind`, 1, 'I32'); } catch {} }, [part]);
  // Local paging: W -> first 4, R -> second 4
  const [page, setPage] = React.useState<0|1>(0);
  React.useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W') setPage(0);
      if (e.key === 'r' || e.key === 'R') setPage(1);
    };
    window.addEventListener('keydown', onDown as any);
    return () => window.removeEventListener('keydown', onDown as any);
  }, []);

  // Mirror values in UI state; apply robust defaults so NaN/undefined never leak into knobs
  const raw = (ui as any).acid || {};
  const acid = {
    wave: typeof raw.wave === 'number' && isFinite(raw.wave) ? raw.wave : 0.0,
    cutoff: typeof raw.cutoff === 'number' && isFinite(raw.cutoff) ? raw.cutoff : 0.0,
    reso: typeof raw.reso === 'number' && isFinite(raw.reso) ? raw.reso : 0.5,
    envmod: typeof raw.envmod === 'number' && isFinite(raw.envmod) ? raw.envmod : 0.6,
    decay: typeof raw.decay === 'number' && isFinite(raw.decay) ? raw.decay : 0.5,
    accent: typeof raw.accent === 'number' && isFinite(raw.accent) ? raw.accent : 0.7,
    slide: typeof raw.slide === 'number' && isFinite(raw.slide) ? raw.slide : 0.4,
    drive: typeof raw.drive === 'number' && isFinite(raw.drive) ? raw.drive : 0.3,
  };
  const update = (patch: Partial<typeof acid>) => s.updateSynthUI((u: any) => ({ ...u, acid: { ...(u.acid || {}), ...patch } }));

  const knobs0 = (
    <Row>
      <Knob label="Wave" value={acid.wave} onChange={(v)=> { update({ wave: v }); s.setSynthParam(`part/${part}/acid/wave`, v); }} format={(v)=> v<0.5?`saw ${(1-v*2).toFixed(2)}`:`square ${(2*v-1).toFixed(2)}`} />
      <Knob label="Cutoff" value={acid.cutoff} onChange={(v)=> { update({ cutoff: v }); s.setSynthParam(`part/${part}/acid/cutoff`, v); }} format={(v)=> `${Math.round(mapCutoff(v))} Hz`} />
      <Knob label="Reso" value={acid.reso} onChange={(v)=> { update({ reso: v }); s.setSynthParam(`part/${part}/acid/reso`, v); }} format={(v)=> `${Math.round(v*100)}%`} />
      <Knob label="EnvMod" value={acid.envmod} onChange={(v)=> { update({ envmod: v }); s.setSynthParam(`part/${part}/acid/envmod`, v); }} format={(v)=> `${Math.round(v*100)}%`} />
    </Row>
  );
  const knobs1 = (
    <Row>
      <Knob label="Decay" value={acid.decay} onChange={(v)=> { update({ decay: v }); s.setSynthParam(`part/${part}/acid/decay`, v); }} format={(v)=> `${Math.round(mapDecayMs(v))} ms`} />
      <Knob label="Accent" value={acid.accent} onChange={(v)=> { update({ accent: v }); s.setSynthParam(`part/${part}/acid/accent`, v); }} format={(v)=> `${Math.round(v*100)}%`} />
      <Knob label="Slide" value={acid.slide} onChange={(v)=> { update({ slide: v }); s.setSynthParam(`part/${part}/acid/slide`, v); }} format={(v)=> `${Math.round(v*300)} ms`} />
      <Knob label="Drive" value={acid.drive} onChange={(v)=> { update({ drive: v }); s.setSynthParam(`part/${part}/acid/drive`, v); }} format={(v)=> `${Math.round(v*100)}%`} />
    </Row>
  );

  const label = page === 0 ? '[Wave, Cutoff, Reso, EnvMod]' : '[Decay, Accent, Slide, Drive]';
  return (
    <div id="acid303-tab" style={{ 
      padding: 8
    }}>
      <div style={{ 
        fontSize: 12, 
        margin: '6px 0 8px',
        color: 'var(--accent)',
        textShadow: '0 0 8px currentColor'
      }}>ACID303 · {label} · press W/R</div>
      {page === 0 ? knobs0 : knobs1}
      <div style={{ 
        marginTop: 8, 
        opacity: 0.75, 
        fontSize: 11,
        color: 'var(--glow)',
        textShadow: '0 0 5px currentColor'
      }}>
        Signal: Osc → LPF → Drive → (FX Rack) → Mixer → EQ
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>{children}</div>
  )
}

function mapCutoff(v: number): number { return 20 * Math.pow(10, v * Math.log10(10000/20)); }
function mapDecayMs(v: number): number { const lo=5, hi=800; return Math.round(lo * Math.pow(hi/lo, v)); }
