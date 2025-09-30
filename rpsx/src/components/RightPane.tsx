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
// WaterDroplets removed
import SequencerRow from "./SequencerRow";
import { useSequencer } from "../store/sequencer";

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
    labels = ['Band 1', 'Band 2', 'Band 3', 'Band 4'];
    // Values not wired generically; leave as dashes
  } else if (lower === 'mixer') {
    labels = ['Vol A', 'Vol B', 'Pan', 'Mix'];
  } else if (lower === 'filter') {
    labels = ['Cutoff', 'Reso', 'Env', 'Mix'];
  } else if (lower === 'lfo') {
    labels = ['Rate', 'Depth', 'Shape', 'Mix'];
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
