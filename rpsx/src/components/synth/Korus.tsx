import React from 'react'
import Knob from './Knob'
import { useBrowser } from '../../store/browser'
import { useFourKnobHotkeys } from '../../hooks/useFourKnobHotkeys'

/**
 * Korus – 6-voice Juno-style polysynth
 * 4 subpages: OSC, FILTER, ENV, MOD (W/R to switch between first 2, E/D for second 2)
 * Params: wave, pwm, sub, noise | cutoff, reso, env_amt, lfo_filter | attack, decay, sustain, release | lfo_rate, lfo_pwm, chorus, chorus_rate
 */
export default function Korus() {
  const s = useBrowser() as any;
  const ui = s.getSynthUI();
  const part = s.selectedSoundPart ?? 0;
  const selectedSoundId = s.selectedSoundId;
  const moduleKindById = s.moduleKindById;

  // Ensure module is set to Korus (kind 6) when page is active
  React.useEffect(() => {
    try {
      if (!selectedSoundId) return;
      const moduleKind = moduleKindById?.[selectedSoundId];
      if (moduleKind !== 'korus') {
        s.setSynthParam(`part/${part}/module_kind`, 6, 'I32');
      }
    } catch {}
  }, [part, selectedSoundId, moduleKindById, s.setSynthParam]);

  // Local subpage: 0=OSC, 1=FILTER, 2=ENV, 3=MOD
  const [subpage, setSubpage] = React.useState<0 | 1 | 2 | 3>(0);
  React.useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      const code = e.code;
      const k = (e.key || '').toLowerCase();
      if (code === 'KeyW' || k === 'w') setSubpage(0);
      if (code === 'KeyE' || k === 'e') setSubpage(1);
      if (code === 'KeyD' || k === 'd') setSubpage(2);
      if (code === 'KeyR' || k === 'r') setSubpage(3);
    };
    window.addEventListener('keydown', onDown as any);
    return () => window.removeEventListener('keydown', onDown as any);
  }, []);

  // Mirror values from UI state with robust defaults
  const raw = (ui as any).korus || {};
  const korus = {
    wave: typeof raw.wave === 'number' && isFinite(raw.wave) ? raw.wave : 0.5,
    pwm: typeof raw.pwm === 'number' && isFinite(raw.pwm) ? raw.pwm : 0.5,
    sub: typeof raw.sub === 'number' && isFinite(raw.sub) ? raw.sub : 0.0,
    noise: typeof raw.noise === 'number' && isFinite(raw.noise) ? raw.noise : 0.0,
    cutoff: typeof raw.cutoff === 'number' && isFinite(raw.cutoff) ? raw.cutoff : 0.7,
    reso: typeof raw.reso === 'number' && isFinite(raw.reso) ? raw.reso : 0.0,
    env_amt: typeof raw.env_amt === 'number' && isFinite(raw.env_amt) ? raw.env_amt : 0.3,
    lfo_filter: typeof raw.lfo_filter === 'number' && isFinite(raw.lfo_filter) ? raw.lfo_filter : 0.0,
    attack: typeof raw.attack === 'number' && isFinite(raw.attack) ? raw.attack : 0.01,
    decay: typeof raw.decay === 'number' && isFinite(raw.decay) ? raw.decay : 0.2,
    sustain: typeof raw.sustain === 'number' && isFinite(raw.sustain) ? raw.sustain : 0.8,
    release: typeof raw.release === 'number' && isFinite(raw.release) ? raw.release : 0.3,
    lfo_rate: typeof raw.lfo_rate === 'number' && isFinite(raw.lfo_rate) ? raw.lfo_rate : 0.3,
    lfo_pwm: typeof raw.lfo_pwm === 'number' && isFinite(raw.lfo_pwm) ? raw.lfo_pwm : 0.0,
    chorus: typeof raw.chorus === 'number' && isFinite(raw.chorus) ? raw.chorus : 0.5,
    chorus_rate: typeof raw.chorus_rate === 'number' && isFinite(raw.chorus_rate) ? raw.chorus_rate : 0.3,
  };

  const update = (patch: Partial<typeof korus>) =>
    s.updateSynthUI((u: any) => ({ ...u, korus: { ...(u.korus || {}), ...patch } }));

  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const step = 1 / 48;

  // 4-knob hotkeys per subpage
  useFourKnobHotkeys({
    dec1: () => {
      if (subpage === 0) { const v = clamp01(korus.wave - step); update({ wave: v }); s.setSynthParam(`part/${part}/korus/wave`, v); }
      else if (subpage === 1) { const v = clamp01(korus.cutoff - step); update({ cutoff: v }); s.setSynthParam(`part/${part}/korus/cutoff`, v); }
      else if (subpage === 2) { const v = clamp01(korus.attack - step); update({ attack: v }); s.setSynthParam(`part/${part}/korus/attack`, v); }
      else { const v = clamp01(korus.lfo_rate - step); update({ lfo_rate: v }); s.setSynthParam(`part/${part}/korus/lfo_rate`, v); }
    },
    inc1: () => {
      if (subpage === 0) { const v = clamp01(korus.wave + step); update({ wave: v }); s.setSynthParam(`part/${part}/korus/wave`, v); }
      else if (subpage === 1) { const v = clamp01(korus.cutoff + step); update({ cutoff: v }); s.setSynthParam(`part/${part}/korus/cutoff`, v); }
      else if (subpage === 2) { const v = clamp01(korus.attack + step); update({ attack: v }); s.setSynthParam(`part/${part}/korus/attack`, v); }
      else { const v = clamp01(korus.lfo_rate + step); update({ lfo_rate: v }); s.setSynthParam(`part/${part}/korus/lfo_rate`, v); }
    },
    dec2: () => {
      if (subpage === 0) { const v = clamp01(korus.pwm - step); update({ pwm: v }); s.setSynthParam(`part/${part}/korus/pwm`, v); }
      else if (subpage === 1) { const v = clamp01(korus.reso - step); update({ reso: v }); s.setSynthParam(`part/${part}/korus/reso`, v); }
      else if (subpage === 2) { const v = clamp01(korus.decay - step); update({ decay: v }); s.setSynthParam(`part/${part}/korus/decay`, v); }
      else { const v = clamp01(korus.lfo_pwm - step); update({ lfo_pwm: v }); s.setSynthParam(`part/${part}/korus/lfo_pwm`, v); }
    },
    inc2: () => {
      if (subpage === 0) { const v = clamp01(korus.pwm + step); update({ pwm: v }); s.setSynthParam(`part/${part}/korus/pwm`, v); }
      else if (subpage === 1) { const v = clamp01(korus.reso + step); update({ reso: v }); s.setSynthParam(`part/${part}/korus/reso`, v); }
      else if (subpage === 2) { const v = clamp01(korus.decay + step); update({ decay: v }); s.setSynthParam(`part/${part}/korus/decay`, v); }
      else { const v = clamp01(korus.lfo_pwm + step); update({ lfo_pwm: v }); s.setSynthParam(`part/${part}/korus/lfo_pwm`, v); }
    },
    dec3: () => {
      if (subpage === 0) { const v = clamp01(korus.sub - step); update({ sub: v }); s.setSynthParam(`part/${part}/korus/sub`, v); }
      else if (subpage === 1) { const v = clamp01(korus.env_amt - step); update({ env_amt: v }); s.setSynthParam(`part/${part}/korus/env_amt`, v); }
      else if (subpage === 2) { const v = clamp01(korus.sustain - step); update({ sustain: v }); s.setSynthParam(`part/${part}/korus/sustain`, v); }
      else { const v = clamp01(korus.chorus - step); update({ chorus: v }); s.setSynthParam(`part/${part}/korus/chorus`, v); }
    },
    inc3: () => {
      if (subpage === 0) { const v = clamp01(korus.sub + step); update({ sub: v }); s.setSynthParam(`part/${part}/korus/sub`, v); }
      else if (subpage === 1) { const v = clamp01(korus.env_amt + step); update({ env_amt: v }); s.setSynthParam(`part/${part}/korus/env_amt`, v); }
      else if (subpage === 2) { const v = clamp01(korus.sustain + step); update({ sustain: v }); s.setSynthParam(`part/${part}/korus/sustain`, v); }
      else { const v = clamp01(korus.chorus + step); update({ chorus: v }); s.setSynthParam(`part/${part}/korus/chorus`, v); }
    },
    dec4: () => {
      if (subpage === 0) { const v = clamp01(korus.noise - step); update({ noise: v }); s.setSynthParam(`part/${part}/korus/noise`, v); }
      else if (subpage === 1) { const v = clamp01(korus.lfo_filter - step); update({ lfo_filter: v }); s.setSynthParam(`part/${part}/korus/lfo_filter`, v); }
      else if (subpage === 2) { const v = clamp01(korus.release - step); update({ release: v }); s.setSynthParam(`part/${part}/korus/release`, v); }
      else { const v = clamp01(korus.chorus_rate - step); update({ chorus_rate: v }); s.setSynthParam(`part/${part}/korus/chorus_rate`, v); }
    },
    inc4: () => {
      if (subpage === 0) { const v = clamp01(korus.noise + step); update({ noise: v }); s.setSynthParam(`part/${part}/korus/noise`, v); }
      else if (subpage === 1) { const v = clamp01(korus.lfo_filter + step); update({ lfo_filter: v }); s.setSynthParam(`part/${part}/korus/lfo_filter`, v); }
      else if (subpage === 2) { const v = clamp01(korus.release + step); update({ release: v }); s.setSynthParam(`part/${part}/korus/release`, v); }
      else { const v = clamp01(korus.chorus_rate + step); update({ chorus_rate: v }); s.setSynthParam(`part/${part}/korus/chorus_rate`, v); }
    },
    active: true,
  });

  // Formatters
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const waveShape = (v: number) => (v < 0.33 ? 'Saw' : v < 0.66 ? 'Pulse' : 'Square');
  const mapCutoff = (v: number) => 20 * Math.pow(10, v * Math.log10(18000 / 20));
  const mapLfoHz = (v: number) => 0.1 + v * 9.9; // 0.1-10 Hz
  const mapChorusHz = (v: number) => 0.1 + v * 1.9; // 0.1-2 Hz
  const adsrMs = (v: number) => {
    const ms = 1 + v * 4999; // 1ms-5000ms
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
  };

  // Subpage knob sets
  const oscKnobs = (
    <Row>
      <Knob label="Wave" value={korus.wave} onChange={(v) => { update({ wave: v }); s.setSynthParam(`part/${part}/korus/wave`, v); }} format={waveShape} />
      <Knob label="PWM" value={korus.pwm} onChange={(v) => { update({ pwm: v }); s.setSynthParam(`part/${part}/korus/pwm`, v); }} format={pct} />
      <Knob label="Sub" value={korus.sub} onChange={(v) => { update({ sub: v }); s.setSynthParam(`part/${part}/korus/sub`, v); }} format={pct} />
      <Knob label="Noise" value={korus.noise} onChange={(v) => { update({ noise: v }); s.setSynthParam(`part/${part}/korus/noise`, v); }} format={pct} />
    </Row>
  );

  const filterKnobs = (
    <Row>
      <Knob label="Cutoff" value={korus.cutoff} onChange={(v) => { update({ cutoff: v }); s.setSynthParam(`part/${part}/korus/cutoff`, v); }} format={(v) => `${Math.round(mapCutoff(v))} Hz`} />
      <Knob label="Reso" value={korus.reso} onChange={(v) => { update({ reso: v }); s.setSynthParam(`part/${part}/korus/reso`, v); }} format={pct} />
      <Knob label="Env Amt" value={korus.env_amt} onChange={(v) => { update({ env_amt: v }); s.setSynthParam(`part/${part}/korus/env_amt`, v); }} format={pct} />
      <Knob label="LFO→Flt" value={korus.lfo_filter} onChange={(v) => { update({ lfo_filter: v }); s.setSynthParam(`part/${part}/korus/lfo_filter`, v); }} format={pct} />
    </Row>
  );

  const envKnobs = (
    <Row>
      <Knob label="Attack" value={korus.attack} onChange={(v) => { update({ attack: v }); s.setSynthParam(`part/${part}/korus/attack`, v); }} format={adsrMs} />
      <Knob label="Decay" value={korus.decay} onChange={(v) => { update({ decay: v }); s.setSynthParam(`part/${part}/korus/decay`, v); }} format={adsrMs} />
      <Knob label="Sustain" value={korus.sustain} onChange={(v) => { update({ sustain: v }); s.setSynthParam(`part/${part}/korus/sustain`, v); }} format={pct} />
      <Knob label="Release" value={korus.release} onChange={(v) => { update({ release: v }); s.setSynthParam(`part/${part}/korus/release`, v); }} format={adsrMs} />
    </Row>
  );

  const modKnobs = (
    <Row>
      <Knob label="LFO Rate" value={korus.lfo_rate} onChange={(v) => { update({ lfo_rate: v }); s.setSynthParam(`part/${part}/korus/lfo_rate`, v); }} format={(v) => `${mapLfoHz(v).toFixed(2)} Hz`} />
      <Knob label="LFO→PWM" value={korus.lfo_pwm} onChange={(v) => { update({ lfo_pwm: v }); s.setSynthParam(`part/${part}/korus/lfo_pwm`, v); }} format={pct} />
      <Knob label="Chorus" value={korus.chorus} onChange={(v) => { update({ chorus: v }); s.setSynthParam(`part/${part}/korus/chorus`, v); }} format={pct} />
      <Knob label="Chr Rate" value={korus.chorus_rate} onChange={(v) => { update({ chorus_rate: v }); s.setSynthParam(`part/${part}/korus/chorus_rate`, v); }} format={(v) => `${mapChorusHz(v).toFixed(2)} Hz`} />
    </Row>
  );

  const pages = [oscKnobs, filterKnobs, envKnobs, modKnobs];
  const pageNames = ['OSC', 'FILTER', 'ENV', 'MOD'];

  return (
    <div id="korus-tab" style={{ padding: 12, background: 'var(--neutral-1)', margin: '8px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 8, fontSize: 'calc(10px * var(--ui-font-scale))' }}>
        {pageNames.map((name, i) => (
          <span
            key={name}
            onClick={() => setSubpage(i as 0 | 1 | 2 | 3)}
            style={{
              cursor: 'pointer',
              padding: '2px 6px',
              borderBottom: subpage === i ? '2px solid var(--text)' : '2px solid transparent',
              opacity: subpage === i ? 1 : 0.5,
            }}
          >
            {name}
          </span>
        ))}
      </div>
      {pages[subpage]}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>{children}</div>
  );
}
