import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'

export default function ResonatorBank() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const part = s.selectedSoundPart ?? 0;
  const selectedSoundId = s.selectedSoundId;
  const moduleKindById = s.moduleKindById;
  
  // Ensure module is set to ResonatorBank when page is active, but only if it's not already ResonatorBank
  React.useEffect(() => { 
    try { 
      if (!selectedSoundId) return;
      const moduleKind = moduleKindById?.[selectedSoundId];
      if (moduleKind !== 'resonator') {
        s.setSynthParam(`part/${part}/module_kind`, 3, 'I32'); 
      }
    } catch {} 
  }, [part, selectedSoundId, moduleKindById, s.setSynthParam]);

  // Local paging: W -> prev page, R -> next page (4 pages total)
  const [page, setPage] = React.useState<0|1|2|3>(0);
  React.useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W') {
        setPage(prev => prev === 0 ? 3 : (prev - 1) as any);
      }
      if (e.key === 'r' || e.key === 'R') {
        setPage(prev => (prev + 1) % 4 as any);
      }
    };
    window.addEventListener('keydown', onDown as any);
    return () => window.removeEventListener('keydown', onDown as any);
  }, []);

  // Mirror values in UI state; apply robust defaults so NaN/undefined never leak into knobs
  const raw = (ui as any).resonator || {};
  const resonator = {
    // Page 1 - Core
    pitch: typeof raw.pitch === 'number' && isFinite(raw.pitch) ? raw.pitch : 0.0,
    decay: typeof raw.decay === 'number' && isFinite(raw.decay) ? raw.decay : 0.5,
    brightness: typeof raw.brightness === 'number' && isFinite(raw.brightness) ? raw.brightness : 0.5,
  bank_size: typeof raw.bank_size === 'number' && isFinite(raw.bank_size) ? raw.bank_size : 0.875, // ~8 default when mapped
    // Page 2 - Structure
    mode: typeof raw.mode === 'number' && isFinite(raw.mode) ? raw.mode : 0.0,
    inharmonicity: typeof raw.inharmonicity === 'number' && isFinite(raw.inharmonicity) ? raw.inharmonicity : 0.1,
    feedback: typeof raw.feedback === 'number' && isFinite(raw.feedback) ? raw.feedback : 0.3,
    drive: typeof raw.drive === 'number' && isFinite(raw.drive) ? raw.drive : 0.0,
    // Page 3 - Excitation
    exciter_type: typeof raw.exciter_type === 'number' && isFinite(raw.exciter_type) ? raw.exciter_type : 0.0,
    exciter_amount: typeof raw.exciter_amount === 'number' && isFinite(raw.exciter_amount) ? raw.exciter_amount : 0.5,
    noise_color: typeof raw.noise_color === 'number' && isFinite(raw.noise_color) ? raw.noise_color : 0.0,
    strike_rate: typeof raw.strike_rate === 'number' && isFinite(raw.strike_rate) ? raw.strike_rate : 0.0,
    // Page 4 - Output
    stereo_width: typeof raw.stereo_width === 'number' && isFinite(raw.stereo_width) ? raw.stereo_width : 0.0,
    randomize: typeof raw.randomize === 'number' && isFinite(raw.randomize) ? raw.randomize : 0.0,
    body_blend: typeof raw.body_blend === 'number' && isFinite(raw.body_blend) ? raw.body_blend : 0.4,
    output_gain: typeof raw.output_gain === 'number' && isFinite(raw.output_gain) ? raw.output_gain : 0.0,
  };

  const update = (patch: Partial<typeof resonator>) => s.updateSynthUI((u: any) => ({ ...u, resonator: { ...(u.resonator || {}), ...patch } }));

  // Derived flags for inactive visuals
  const modeI = resonator.mode < 0.5 ? 0 : 1; // 0 Modal, 1 Comb
  const exciterEffective = true; // exciter always influences excitation
  const noiseColorEffective = Math.floor((resonator.exciter_type || 0) * 3.99) === 1; // only for Noise
  const bankSizeEffective = modeI === 0; // bank size only matters in Modal

  // Page 1 - Core
  const knobs0 = (
    <Row>
  <Knob 
        label="Pitch" 
        value={resonator.pitch} 
        onChange={(v) => { 
          update({ pitch: v }); 
          s.setSynthParam(`part/${part}/resonator/pitch`, v * 2 - 1); // Map to ±1 for ±48 semitones
        }} 
        format={(v) => `${Math.round((v * 2 - 1) * 48)} st`} 
      />
  <Knob 
        label="Decay" 
        value={resonator.decay} 
        onChange={(v) => { 
          update({ decay: v }); 
          s.setSynthParam(`part/${part}/resonator/decay`, v); 
        }} 
        format={(v) => `${mapDecayTime(v).toFixed(2)}s`} 
      />
      <Knob 
        label="Brightness" 
        value={resonator.brightness} 
        onChange={(v) => { 
          update({ brightness: v }); 
          s.setSynthParam(`part/${part}/resonator/brightness`, v); 
        }} 
        format={(v) => v < 0.5 ? `dark ${((0.5-v)*2).toFixed(1)}` : `bright ${((v-0.5)*2).toFixed(1)}`} 
      />
      <Knob 
        label="Bank Size" 
        value={resonator.bank_size} 
        onChange={(v) => { 
          update({ bank_size: v }); 
          s.setSynthParam(`part/${part}/resonator/bank_size`, Math.round(1 + v * 15), 'I32'); 
        }} 
        format={(v) => `${Math.round(1 + v * 15)}`} 
        inactive={!bankSizeEffective}
      />
    </Row>
  );

  // Page 2 - Structure
  const knobs1 = (
    <Row>
  <Knob 
        label="Mode" 
        value={resonator.mode} 
        onChange={(v) => { 
          update({ mode: v }); 
          s.setSynthParam(`part/${part}/resonator/mode`, v < 0.5 ? 0 : 1, 'I32'); 
        }} 
        format={(v) => v < 0.5 ? 'Modal' : 'Comb'} 
      />
  <Knob 
        label="Spread" 
        value={resonator.inharmonicity} 
        onChange={(v) => { 
          update({ inharmonicity: v }); 
          s.setSynthParam(`part/${part}/resonator/inharmonicity`, v * 2); // 0-2 range
        }} 
        format={(v) => `${Math.round(v * 200)} cents`} 
      />
  <Knob 
        label="Feedback" 
        value={resonator.feedback} 
        onChange={(v) => { 
          update({ feedback: v }); 
          s.setSynthParam(`part/${part}/resonator/feedback`, v); 
        }} 
        format={(v) => `${Math.round(v * 100)}%`} 
      />
  <Knob 
        label="Drive" 
        value={resonator.drive} 
        onChange={(v) => { 
          update({ drive: v }); 
          s.setSynthParam(`part/${part}/resonator/drive`, v); 
        }} 
        format={(v) => `${Math.round(v * 24)} dB`} 
      />
    </Row>
  );

  // Page 3 - Excitation
  const knobs2 = (
    <Row>
      <Knob 
        label="Exciter" 
        value={resonator.exciter_type} 
        onChange={(v) => { 
          update({ exciter_type: v }); 
          const type = Math.floor(v * 3.99); // 0-3
          s.setSynthParam(`part/${part}/resonator/exciter_type`, type, 'I32'); 
        }} 
        format={(v) => {
          const type = Math.floor(v * 3.99);
          return ['Impulse', 'Noise', 'Click', 'External'][type] || 'Impulse';
        }} 
        inactive={!exciterEffective}
      />
      <Knob 
        label="Amount" 
        value={resonator.exciter_amount} 
        onChange={(v) => { 
          update({ exciter_amount: v }); 
          s.setSynthParam(`part/${part}/resonator/exciter_amount`, v); 
        }} 
        format={(v) => `${Math.round(v * 100)}%`} 
        inactive={!exciterEffective}
      />
      <Knob 
        label="Color" 
        value={resonator.noise_color} 
        onChange={(v) => { 
          update({ noise_color: v }); 
          s.setSynthParam(`part/${part}/resonator/noise_color`, v * 2 - 1); // ±1
        }} 
        format={(v) => {
          const mapped = v * 2 - 1;
          return mapped < 0 ? `HP ${Math.abs(mapped * 12).toFixed(1)}` : `LP ${(mapped * 12).toFixed(1)}`;
        }} 
        inactive={!noiseColorEffective}
      />
      <Knob 
        label="Strike Rate" 
        value={resonator.strike_rate} 
        onChange={(v) => { 
          update({ strike_rate: v }); 
          s.setSynthParam(`part/${part}/resonator/strike_rate`, v); // 0..1; engine maps 0.5..10Hz inside
        }} 
        format={(v) => v < 0.05 ? 'Off' : `${(v * 20).toFixed(1)} Hz`} 
      />
    </Row>
  );

  // Page 4 - Output
  const knobs3 = (
    <Row>
  <Knob 
        label="Width" 
        value={resonator.stereo_width} 
        onChange={(v) => { 
          update({ stereo_width: v }); 
          s.setSynthParam(`part/${part}/resonator/stereo_width`, v); 
        }} 
        format={(v) => `${Math.round(v * 100)}%`} 
      />
  <Knob 
        label="Randomize" 
        value={resonator.randomize} 
        onChange={(v) => { 
          update({ randomize: v }); 
          s.setSynthParam(`part/${part}/resonator/randomize`, v); 
        }} 
        format={(v) => `${Math.round(v * 100)}%`} 
      />
  <Knob 
        label="Body Blend" 
        value={resonator.body_blend} 
        onChange={(v) => { 
          update({ body_blend: v }); 
          s.setSynthParam(`part/${part}/resonator/body_blend`, v); 
        }} 
        format={(v) => v < 0.5 ? `stringy ${((0.5-v)*2).toFixed(1)}` : `plate ${((v-0.5)*2).toFixed(1)}`} 
      />
  <Knob 
        label="Gain" 
        value={resonator.output_gain} 
        onChange={(v) => { 
          update({ output_gain: v }); 
          s.setSynthParam(`part/${part}/resonator/output_gain`, (v - 0.5) * 2); // ±1 for ±24dB range
        }} 
        format={(v) => `${((v - 0.5) * 48).toFixed(1)} dB`} 
      />
    </Row>
  );

  const pageNames = ['Core', 'Structure', 'Excitation', 'Output'];
  const pageKnobs = [knobs0, knobs1, knobs2, knobs3];
  const label = pageNames[page];

  return (
    <div id="resonator-bank-tab" style={{ 
      padding: '16px', 
      backgroundColor: 'var(--bg)', 
      minHeight: 200,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center'
    }}>
      <div style={{ 
        fontSize: 12, 
        margin: '8px 0 10px',
        color: 'var(--accent)',
        fontWeight: 'bold'
  }}>MUSHROOMS · {label} · {page + 1}/4 · press W/R</div>
      {pageKnobs[page]}
      <div style={{ 
        marginTop: 10, 
        opacity: 0.8, 
        fontSize: 11,
        color: 'var(--text-soft)'
      }}>
        Signal: Exciter → {resonator.mode < 0.5 ? 'Modal Resonators' : 'Comb Filter'} → Drive → (FX Rack) → Mixer → EQ
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>{children}</div>
  )
}

function mapDecayTime(v: number): number { 
  return 0.01 + v * 9.99; // 0.01s to 10s
}
