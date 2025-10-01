import React from "react";
import { useBrowser } from "../store/browser";
import type { ViewName } from "../types/ui";
import SynthOSC from "./synth/SynthOSC";
import SynthENV from "./synth/SynthENV";
import SynthFILTER from "./synth/SynthFILTER";
import SynthLFO from "./synth/SynthLFO";
import SynthModMatrix from "./synth/SynthModMatrix";
import SynthFX from "./synth/SynthFX";
import SynthMIXER from "./synth/SynthMIXER";
import SynthEQView from "./synth/SynthEQView";
import Acid303 from "./synth/Acid303";
import StringTheory from "./synth/StringTheory";
import Mushrooms from "./synth/Mushrooms";
import Sampler from "./synth/Sampler";
import SamplerLoop from "./synth/SamplerLoop";
import SamplerEnvelope from "./synth/SamplerEnvelope";
import Drubbles from "./synth/Drubbles";
import { MOD_DEST_LIST } from "./synth/ModMatrixTable";
// WaterDroplets removed
import SequencerRow from "./SequencerRow";
import { useSequencer } from "../store/sequencer";
import { useSynthEqState } from "../store/browser";

export default function RightPane({ view }: { view: ViewName }) {
  const s = useBrowser();
  const { focus, level, items, selected, selectedSoundId, selectedSoundPart } = s as any;
  // Always call hooks; use a dummy id when none is selected to respect Rules of Hooks
  const seq = useSequencer(selectedSoundId || '__none__');
  const focused = focus === 'right';
  // Droplets removed

  // Droplets removed: no special Acid303 overlay

  // Droplets removed: no overlay triggers

  return (
  <div className={`panel right-pane ${focused ? 'focused' : ''}`} style={{ flex:1, height:'100%', minHeight:0, display:'flex', flexDirection:'column', fontFamily: "'Press Start 2P', monospace", overflow:'hidden' }}>
  {/* Droplets removed */}
      
      {view === 'Sounds' && (
        level === 'synth'
          ? (
            <div style={{ height:'100%', display:'flex', flexDirection:'column' }}>
              <div className="no-scrollbars" style={{ flex:1, minHeight:0, overflow:'auto', display:'flex', flexDirection:'column' }}>
                {renderSynthPage(s.synthPages[s.synthPageIndex])}
              </div>
              <FooterHints page={s.synthPages[s.synthPageIndex]} />
            </div>
          )
          : (level === 'pattern' && selectedSoundId && (s.selectedSoundName || items[selected]))
            ? null
            : <Center>Select a sound to start editing</Center>
      )}
      {view === 'Sequencer' && (
        level === 'pattern' && selectedSoundId && items[selected]
          ? (
            <div style={{ height:'100%', display:'flex', flexDirection:'column' }}>
              <div className="no-scrollbars" style={{ flex:1, minHeight:0, overflow:'auto' }}>
                <SequencerRow soundId={selectedSoundId} part={typeof selectedSoundPart === 'number' ? selectedSoundPart : 0} />
              </div>
              <FooterHints page={'SEQUENCER'} />
            </div>
          )
          : <Center>Nothing to sequence, please select a sound</Center>
      )}
      {view === 'Arrangement' && (
        <div>Arrangement</div>
      )}
      {view === 'Perform' && (
        <div>Perform</div>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'var(--space-4)' }}><div style={{ fontSize:16, textAlign:'center' }}>{children}</div></div>;
}

function extractName(label: string): string {
  const idx = label.indexOf(' (');
  return idx >= 0 ? label.slice(0, idx) : label;
}

function renderSynthPage(label: string): React.ReactNode {
  switch (label) {
    case 'ACID303': return <Acid303 />;
  case 'STRING THEORY': return <StringTheory />;
  case 'MUSHROOMS': return <Mushrooms />;
    case 'SAMPLER': return <Sampler />;
    case 'LOOP': return <SamplerLoop />;
    case 'ENVELOPE': return <SamplerEnvelope />;
  case 'DRUBBLES': return <Drubbles />;
    case 'OSC': return <SynthOSC />;
    case 'ENV': return <SynthENV />;
    case 'FILTER': return <SynthFILTER />;
    case 'LFO': return <SynthLFO />;
    case 'MOD': return <SynthModMatrix />;
    case 'FX': return <SynthFX />;
    case 'MIXER': return <SynthMIXER />;
    case 'EQ': return <SynthEQView />;
    default: return null;
  }
}

function FooterHints({ page }: { page: string }) {
  const s = useBrowser() as any;
  const lower = (page || '').toLowerCase();
  const ui = s?.getSynthUI ? s.getSynthUI() : undefined;
  const sid = (s && (s as any).selectedSoundId) || '__none__';
  const seq = useSequencer(sid);
  const { eqGains, eqPage } = useSynthEqState();

  // Helpers
  const pct = (v?: number) => (typeof v === 'number' && Number.isFinite(v)) ? `${Math.round(v * 100)}%` : '—';
  const pct1 = (v?: number) => (typeof v === 'number' && Number.isFinite(v)) ? `${(v * 100).toFixed(1)}%` : '—';
  const stFmt = (cents?: number, semi?: number) => {
    const total = (Number(semi)||0)*100 + (Number(cents)||0);
    return `${(total/100).toFixed(1)} st`;
  };
  const pbName = (idx?: number) => ['One-Shot','Loop','Keytrack'][Math.max(0, Math.min(2, Math.round(Number(idx)||0)))] || 'One-Shot';
  const midiToName = (m?: number) => {
    if (typeof m !== 'number' || !Number.isFinite(m)) return '—';
    const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
    const pc = ((m % 12)+12)%12; const oct = Math.floor(m/12) - 1; return `${names[pc]}${oct}`;
  };
  // Map functions (align with synth components)
  const mapCutoff = (v: number) => 20 * Math.pow(10, v * Math.log10(18000/20));
  const mapQ = (v: number) => 0.5 + v * (12 - 0.5);
  const mapRate = (v: number) => 0.05 + v * (20 - 0.05);
  const detuneCents = (v: number) => (v - 0.5) * 200;
  const lfoShapeName = (v: number) => ['Sine','Tri','Saw','Square'][Math.max(0, Math.min(3, Math.round(v*3)))] || 'Sine';
  const filterTypeName = (v: number) => ['LP','HP','BP','Notch'][Math.max(0, Math.min(3, Math.round(v*3)))] || 'LP';
  // Acid303 cutoff mapper (module-specific range ~10kHz)
  const mapCutoffAcid = (v: number) => 20 * Math.pow(10, v * Math.log10(10000/20));

  let labels: [string, string, string, string] = ['K1', 'K2', 'K3', 'K4'];
  let values: [string, string, string, string] = ['—','—','—','—'];
  let norms: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];

  if (lower.includes('sampler') || lower === 'sampler') {
    const sp = ui?.sampler || {};
    labels = ['Sample Start', 'Sample End', 'Pitch', 'Playback'];
    values = [pct1(sp.sample_start), pct1(sp.sample_end), stFmt(sp.pitch_cents, sp.pitch_semitones), pbName(sp.playback_mode)];
    // normals
    norms = [
      Math.max(0, Math.min(1, Number(sp.sample_start) || 0)),
      Math.max(0, Math.min(1, Number(sp.sample_end) || 1)),
      (() => { const cents = (Number(sp.pitch_semitones)||0)*100 + (Number(sp.pitch_cents)||0); const c = Math.max(-4900, Math.min(4900, cents)); return (c/4900 + 1)/2; })(),
      (() => { const idx = Math.max(0, Math.min(2, Math.round(Number(sp.playback_mode)||0))); return idx/2; })(),
    ];
  } else if (lower === 'loop') {
    const sp = ui?.sampler || {};
    labels = ['Loop Start', 'Loop End', '—', '—'];
    values = [pct1(sp.loop_start), pct1(sp.loop_end), '—', '—'];
    norms = [
      Math.max(0, Math.min(1, Number(sp.loop_start) || 0)),
      Math.max(0, Math.min(1, Number(sp.loop_end) || 1)),
      0.5,
      0.5,
    ];
  } else if (lower === 'envelope' || lower === 'env') {
    const sp = ui?.sampler || {};
    labels = ['Attack', 'Decay', 'Sustain', 'Release'];
    values = [pct(sp.attack), pct(sp.decay), pct(sp.sustain), pct(sp.release)];
    norms = [
      Math.max(0, Math.min(1, Number(sp.attack) || 0)),
      Math.max(0, Math.min(1, Number(sp.decay) || 0)),
      Math.max(0, Math.min(1, Number(sp.sustain) || 0)),
      Math.max(0, Math.min(1, Number(sp.release) || 0)),
    ];
  } else if (lower === 'eq') {
    const base = eqPage === 0 ? 0 : 4;
    labels = [
      `Band ${base+1}`,
      `Band ${base+2}`,
      `Band ${base+3}`,
      `Band ${base+4}`,
    ];
    const db = eqGains || [];
    const getDb = (i:number)=> {
      const v = db[i] as number; // already dB
      return (typeof v === 'number' && Number.isFinite(v)) ? `${Math.round(v)} dB` : '0 dB';
    };
    values = [getDb(base+0), getDb(base+1), getDb(base+2), getDb(base+3)] as any;
    const normFromDb = (x:number)=> (Math.max(-8, Math.min(8, x)) + 8) / 16;
    norms = [
      normFromDb((db[base+0] ?? 0) as number),
      normFromDb((db[base+1] ?? 0) as number),
      normFromDb((db[base+2] ?? 0) as number),
      normFromDb((db[base+3] ?? 0) as number),
    ] as any;
  } else if (lower === 'mixer') {
    const mx = ui?.mixer || {};
    labels = ['Volume', 'Pan', 'Haas', 'Comp'];
    values = [
      pct(mx.volume),
      `${Math.round(((mx.pan ?? 0.5) - 0.5) * 200) / 100}`,
      pct(mx.haas ?? 0),
      pct(mx.comp),
    ] as any;
    norms = [
      Math.max(0, Math.min(1, Number(mx.volume) || 0)),
      Math.max(0, Math.min(1, Number(mx.pan) || 0.5)),
      Math.max(0, Math.min(1, Number(mx.haas) || 0)),
      Math.max(0, Math.min(1, Number(mx.comp) || 0)),
    ];
  } else if (lower === 'filter') {
    const which = (s.filterSelect ?? 0) === 1 ? 'filter2' : 'filter1';
    const f = (ui?.[which] || { type:0, cutoff:0.7, res:0.2, assign:0 });
    labels = ['Type', 'Cutoff', 'Q', 'Assign'];
    values = [
      filterTypeName(f.type ?? 0),
      `${Math.round(mapCutoff(f.cutoff ?? 0))} Hz`,
      mapQ(f.res ?? 0).toFixed(2),
      ['None','A','B','AB'][Math.max(0, Math.min(3, Math.round(Number(f.assign)||0)))] || 'None',
    ] as any;
    norms = [
      Math.max(0, Math.min(1, Number(f.type) || 0)),
      Math.max(0, Math.min(1, Number(f.cutoff) || 0)),
      Math.max(0, Math.min(1, Number(f.res) || 0)),
      Math.max(0, Math.min(1, (Number(f.assign) || 0) / 3)),
    ];
  } else if (lower === 'lfo') {
    const lf = ui?.lfo || { shape:0, rate:0.2, amount:1, drive:0 };
    labels = ['Rate', 'Amount', 'Shape', 'Drive'];
    values = [
      `${mapRate(lf.rate ?? 0).toFixed(2)} Hz`,
      pct(lf.amount ?? 1),
      lfoShapeName(lf.shape ?? 0),
      pct(lf.drive ?? 0),
    ] as any;
    norms = [
      Math.max(0, Math.min(1, Number(lf.rate) || 0)),
      Math.max(0, Math.min(1, Number(lf.amount) || 0)),
      Math.max(0, Math.min(1, Number(lf.shape) || 0)),
      Math.max(0, Math.min(1, Number(lf.drive) || 0)),
    ];
  } else if (lower === 'osc') {
    const a = ui?.oscA || { shape:0, detune:0.5, fm:0, level:0.7 };
    const b = ui?.oscB || { shape:1, detune:0.5, fm:0, level:0.7 };
    labels = ['A Shape', 'A Detune', 'B Shape', 'B Level'];
    values = [
      `${Math.round((a.shape ?? 0)*7)}`,
      `${Math.round(detuneCents(a.detune ?? 0))} ct`,
      `${Math.round((b.shape ?? 1)*7)}`,
      pct(b.level ?? 0.7),
    ] as any;
    norms = [
      Math.max(0, Math.min(1, Number(a.shape) || 0)),
      Math.max(0, Math.min(1, Number(a.detune) || 0.5)),
      Math.max(0, Math.min(1, Number(b.shape) || 1)),
      Math.max(0, Math.min(1, Number(b.level) || 0.7)),
    ];
  } else if (lower === 'env') {
    const which = (s.envSelect ?? 0) === 1 ? 'modEnv' : 'ampEnv';
    const e = ui?.[which] || { a:0.02, d:0.2, s:0.7, r:0.25 };
    labels = ['Attack','Decay','Sustain','Release'];
    values = [pct(e.a), pct(e.d), pct(e.s), pct(e.r)] as any;
    norms = [
      Math.max(0, Math.min(1, Number(e.a) || 0)),
      Math.max(0, Math.min(1, Number(e.d) || 0)),
      Math.max(0, Math.min(1, Number(e.s) || 0)),
      Math.max(0, Math.min(1, Number(e.r) || 0)),
    ];
  } else if (lower === 'fx') {
    const which = (s.fxSelect ?? 0);
    const key = ['fx1','fx2','fx3','fx4'][Math.max(0, Math.min(3, which))];
    const fx = (ui && (ui as any)[key]) || { type:0, p1:0.5, p2:0.4, p3:0.3 };
    labels = ['Type','P1','P2','P3'];
    values = [ `${Math.round(fx.type ?? 0)}`, pct(fx.p1 ?? 0), pct(fx.p2 ?? 0), pct(fx.p3 ?? 0) ] as any;
    norms = [
      Math.max(0, Math.min(1, (Number(fx.type) || 0) / 8)),
      Math.max(0, Math.min(1, Number(fx.p1) || 0)),
      Math.max(0, Math.min(1, Number(fx.p2) || 0)),
      Math.max(0, Math.min(1, Number(fx.p3) || 0)),
    ];
  } else if (lower === 'sequencer' || lower === 'sequencerrow') {
    labels = ['Step', 'Note', 'Pitch', 'Velocity'];
    const step = (seq?.stepIndex ?? 0); const len = (seq?.length ?? 0);
    const notes = (seq?.steps?.[step]?.notes || []);
    const ni = Math.max(0, Math.min(notes.length - 1, seq?.noteIndex ?? 0));
    const nn = notes[ni];
    values = [`${step+1}/${len}`, notes.length ? `${ni+1}/${notes.length}` : '0/0', midiToName(nn?.midi), (typeof nn?.vel === 'number') ? `${Math.round((nn.vel||0)*100)}%` : '—'];
    norms = [
      (len > 1) ? Math.max(0, Math.min(1, step / (len - 1))) : 0,
      (notes.length > 1) ? Math.max(0, Math.min(1, ni / (notes.length - 1))) : 0,
      (typeof nn?.midi === 'number') ? Math.max(0, Math.min(1, nn.midi / 127)) : 0.5,
      (typeof nn?.vel === 'number') ? Math.max(0, Math.min(1, nn.vel)) : 0,
    ];
  } else if (lower === 'mod') {
    // Mod Matrix compact controls mirror
    const lRow = ui?.mod?.lfoRow ?? 0;
    const eRow = ui?.mod?.envRow ?? 0;
    const lAmt = ui?.mod?.lfo?.[lRow]?.amount ?? 0;
    const eAmt = ui?.mod?.env?.[eRow]?.amount ?? 0;
    const lDest = ui?.mod?.lfo?.[lRow]?.dest ?? 0;
    const eDest = ui?.mod?.env?.[eRow]?.dest ?? 0;
    const maxIdx = Math.max(1, (MOD_DEST_LIST?.length ?? 1) - 1);
    labels = [s.isRDown? 'LFO Amt':'LFO Row', 'LFO Dest', s.isRDown? 'ENV Amt':'ENV Row', 'ENV Dest'];
    values = [
      s.isRDown ? (lAmt as number).toFixed(2) : String(1 + Math.round(lRow)),
      (MOD_DEST_LIST && MOD_DEST_LIST[lDest]) ? MOD_DEST_LIST[lDest] : String(lDest),
      s.isRDown ? (eAmt as number).toFixed(2) : String(1 + Math.round(eRow)),
      (MOD_DEST_LIST && MOD_DEST_LIST[eDest]) ? MOD_DEST_LIST[eDest] : String(eDest),
    ] as any;
    norms = [
      s.isRDown ? Math.max(0, Math.min(1, (lAmt + 1) / 2)) : Math.max(0, Math.min(1, lRow / 4)),
      Math.max(0, Math.min(1, (lDest || 0) / maxIdx)),
      s.isRDown ? Math.max(0, Math.min(1, (eAmt + 1) / 2)) : Math.max(0, Math.min(1, eRow / 4)),
      Math.max(0, Math.min(1, (eDest || 0) / maxIdx)),
    ] as any;
  } else if (lower === 'acid303') {
    const ac = (ui as any)?.acid || {};
    labels = ['Wave', 'Cutoff', 'Reso', 'EnvMod'];
    values = [
      (typeof ac.wave === 'number') ? (ac.wave < 0.5 ? `saw ${(1 - ac.wave * 2).toFixed(2)}` : `square ${(2 * ac.wave - 1).toFixed(2)}`) : '—',
      `${Math.round(mapCutoffAcid(ac.cutoff ?? 0))} Hz`,
      pct(ac.reso ?? 0),
      pct(ac.envmod ?? 0),
    ] as any;
    norms = [
      Math.max(0, Math.min(1, Number(ac.wave) || 0)),
      Math.max(0, Math.min(1, Number(ac.cutoff) || 0)),
      Math.max(0, Math.min(1, Number(ac.reso) || 0)),
      Math.max(0, Math.min(1, Number(ac.envmod) || 0)),
    ];
  } else if (lower === 'string theory') {
    const ks = (ui as any)?.karplus || {};
    labels = ['Decay', 'Damp', 'Excite', 'Tune'];
    values = [
      pct(ks.decay ?? 0.8),
      pct(ks.damp ?? 0.5),
      pct(ks.excite ?? 0.7),
      `${(((ks.tune ?? 0) * 12) - 6).toFixed(1)} st`,
    ] as any;
    norms = [
      Math.max(0, Math.min(1, Number(ks.decay) || 0.8)),
      Math.max(0, Math.min(1, Number(ks.damp) || 0.5)),
      Math.max(0, Math.min(1, Number(ks.excite) || 0.7)),
      Math.max(0, Math.min(1, Number(ks.tune) || 0.0)),
    ];
  } else if (lower === 'mushrooms') {
    const rz = (ui as any)?.resonator || {};
    labels = ['Pitch', 'Decay', 'Brightness', 'Bank Size'];
    values = [
      `${Math.round(((Number(rz.pitch) || 0) * 2 - 1) * 48)} st`,
      `${(0.01 + (Number(rz.decay) || 0) * 9.99).toFixed(2)}s`,
      (typeof rz.brightness === 'number') ? (rz.brightness < 0.5 ? `dark ${((0.5 - rz.brightness) * 2).toFixed(1)}` : `bright ${((rz.brightness - 0.5) * 2).toFixed(1)}`) : '—',
      `${Math.round(1 + (Number(rz.bank_size) || 0) * 15)}`,
    ] as any;
    norms = [
      Math.max(0, Math.min(1, Number(rz.pitch) || 0)),
      Math.max(0, Math.min(1, Number(rz.decay) || 0)),
      Math.max(0, Math.min(1, Number(rz.brightness) || 0)),
      Math.max(0, Math.min(1, Number(rz.bank_size) || 0)),
    ];
  } else if (lower === 'drubbles') {
    // Drubbles UI is mostly local in the component; show pack/selection context instead
    const packs: string[] = s.drumPackItems || [];
    const packSel: number = s.drumPackSelected || 0;
    const samples: string[] = s.drumSampleItems || [];
    const sampleSel: number = s.drumSampleSelected || 0;
    const pack = packs[packSel] || (ui as any)?.drum?.current_pack || 'None';
    labels = ['Pack', 'Slots', 'Selected', 'Preview'];
    values = [
      pack,
      String(samples.length || 0),
      samples.length ? `${sampleSel + 1}` : '—',
      s.drumPreviewing ? 'On' : '—',
    ] as any;
    norms = [0.5, Math.min(1, (samples.length || 0) / 16), samples.length ? Math.max(0, Math.min(1, sampleSel / Math.max(1, samples.length - 1))) : 0.5, s.drumPreviewing ? 1 : 0.0];
  }

  const ANG_MIN = -135; const ANG_MAX = 135;
  const angleFromNorm = (n: number) => ANG_MIN + Math.max(0, Math.min(1, n)) * (ANG_MAX - ANG_MIN);
  const item = (label: string, value: string, norm: number) => (
    <div style={{ display:'flex', alignItems:'center', gap:8, minWidth:0 }}>
      <svg width={14} height={14} viewBox="0 0 14 14" aria-hidden="true" style={{ display:'inline-block', flex:'0 0 auto' }}>
        <circle cx={7} cy={7} r={6} fill="#000" stroke="#fff" strokeWidth={1} />
        <g transform={`rotate(${angleFromNorm(norm)} 7 7)`}>
          <line x1={7} y1={7} x2={7} y2={2} stroke="#fff" strokeWidth={1} strokeLinecap="square" />
        </g>
      </svg>
      <div style={{ display:'flex', flexDirection:'column', lineHeight:1, minWidth:0 }}>
        <span style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{label}</span>
        <span style={{ fontSize:9, color:'#ccc' }}>{value}</span>
      </div>
    </div>
  );
  return (
    <div style={{ height: 32, background:'#000', color:'#fff', borderTop:'1px solid #fff', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 10px', fontFamily: "'Press Start 2P', monospace", fontSize:10, gap:10, isolation:'isolate', mixBlendMode:'normal' }}>
      {item(labels[0], values[0], norms[0])}
      {item(labels[1], values[1], norms[1])}
      {item(labels[2], values[2], norms[2])}
      {item(labels[3], values[3], norms[3])}
    </div>
  );
}
