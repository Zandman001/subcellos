#![allow(dead_code, unused_variables, unused_mut)]
use std::f32::consts::PI;

use crate::engine::params::{ParamStore, hash_path};
use crate::engine::dsp::{delay::SimpleDelay, mod_delay::ModDelay, phaser::Phaser, reverb::OnePoleLP, bitcrusher::Bitcrusher};
use crate::engine::modules::acid303::{Acid303, AcidParamKeys};
use crate::engine::modules::karplus_strong::{KarplusStrong, KSParamKeys};
use crate::engine::modules::resonator_bank::{ResonatorBank, ResonatorParamKeys};
use crate::engine::modules::sampler::{Sampler, SamplerParamKeys};
use crate::engine::modules::drum::{DrumPlayer, DrumParamKeys};
use crate::engine::state::{init_playhead_states, set_playhead_state};
use freeverb::Freeverb;

#[inline]
fn midi_to_freq(m: u8) -> f32 { 440.0 * (2.0_f32).powf((m as f32 - 69.0) / 12.0) }


#[derive(Clone)]
struct Svf {
  ic1eq: f32,
  ic2eq: f32,
  g: f32,
  k: f32,
}

impl Svf {
  fn new() -> Self { Self { ic1eq: 0.0, ic2eq: 0.0, g: 0.1, k: 0.5 } }
  fn set_params(&mut self, cutoff: f32, q: f32, sr: f32) {
    let g = (PI * (cutoff / sr)).tan();
    self.g = g;
    self.k = 1.0 / q.max(0.001);
  }
  fn process(&mut self, x: f32) -> (f32, f32, f32, f32) {
    let g = self.g; let k = self.k;
    let v0 = x;
    let v1 = (self.ic1eq + g * (v0 - self.ic2eq)) / (1.0 + g * (g + k));
    let v2 = self.ic2eq + g * v1;
    self.ic1eq = 2.0 * v1 - self.ic1eq;
    self.ic2eq = 2.0 * v2 - self.ic2eq;
    let lp = v2;
    let bp = v1;
    let hp = v0 - k * bp - lp;
    let notch = hp + lp;
    (lp, hp, bp, notch)
  }
}

// Simple RBJ biquad for peaking EQ
#[derive(Clone, Copy)]
struct Biquad {
  b0: f32,
  b1: f32,
  b2: f32,
  a1: f32,
  a2: f32,
  z1: f32,
  z2: f32,
}

impl Biquad {
  fn new() -> Self { Self { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z1: 0.0, z2: 0.0 } }
  fn set_peaking(&mut self, sr: f32, freq: f32, q: f32, gain_db: f32) {
    // If near zero gain, bypass
    if gain_db.abs() < 1e-3 { self.b0=1.0; self.b1=0.0; self.b2=0.0; self.a1=0.0; self.a2=0.0; return; }
    let a = 10.0_f32.powf(gain_db / 40.0);
    let w0 = 2.0 * PI * (freq / sr).clamp(0.0, 0.49);
    let alpha = w0.sin() / (2.0 * q.max(0.1));
    let cosw0 = w0.cos();
    let b0 = 1.0 + alpha * a;
    let b1 = -2.0 * cosw0;
    let b2 = 1.0 - alpha * a;
    let a0 = 1.0 + alpha / a;
    let a1 = -2.0 * cosw0;
    let a2 = 1.0 - alpha / a;
    // Normalize
    self.b0 = b0 / a0;
    self.b1 = b1 / a0;
    self.b2 = b2 / a0;
    self.a1 = a1 / a0;
    self.a2 = a2 / a0;
  }
  fn process(&mut self, x: f32) -> f32 {
    let y = self.b0 * x + self.z1;
    self.z1 = self.b1 * x - self.a1 * y + self.z2;
    self.z2 = self.b2 * x - self.a2 * y;
    y
  }
}

#[derive(Clone)]
struct Adsr {
  a: f32, d: f32, s: f32, r: f32, sr: f32,
  env: f32,
  gate: bool,
  attacking: bool,
}

impl Adsr {
  fn new(sr: f32) -> Self { Self { a: 0.01, d: 0.1, s: 0.8, r: 0.2, sr, env: 0.0, gate: false, attacking: false } }
  fn set(&mut self, a: f32, d: f32, s: f32, r: f32) { self.a=a.max(0.001); self.d=d.max(0.001); self.s=s.clamp(0.0,1.0); self.r=r.max(0.001); }
  fn gate_on(&mut self){ self.gate = true; self.attacking = true; }
  fn gate_off(&mut self){ self.gate = false; self.attacking = false; }
  fn next(&mut self) -> f32 {
    if self.gate {
      if self.attacking {
        // Attack to 1.0
        if self.env < 1.0 { self.env += 1.0 / (self.a * self.sr); if self.env >= 1.0 { self.env = 1.0; self.attacking = false; } }
        else { self.attacking = false; }
      } else {
        // Approach sustain: decay down toward s, or rise up if s increases while held
        if self.env > self.s {
          let dec = (1.0 - self.s).max(0.0001) / (self.d * self.sr);
          self.env -= dec;
          if self.env < self.s { self.env = self.s; }
        } else if self.env < self.s {
          let inc = self.s.max(0.0001) / (self.d * self.sr);
          self.env += inc;
          if self.env > self.s { self.env = self.s; }
        }
      }
    } else {
      // Linear release to zero independent of sustain level
      if self.env > 0.0 { self.env -= 1.0 / (self.r * self.sr); if self.env < 0.0 { self.env = 0.0; } }
    }
    self.env
  }
}

#[derive(Clone, Copy)]
enum OscShape { Sine, Saw, Square, Tri, Pulse, NoiseWhite, NoisePink, NoiseBrown }

#[derive(Clone)]
struct Osc {
  phase: f32,
  sr: f32,
}

impl Osc {
  fn new(sr: f32) -> Self { Self { phase: 0.0, sr } }
  fn next_pm(&mut self, freq: f32, shape: OscShape, pulse_w: f32, pm: f32) -> f32 {
    let p = (self.phase + pm) % 1.0;
    self.phase = (self.phase + freq / self.sr) % 1.0;
    match shape {
      OscShape::Sine => (2.0 * PI * p).sin(),
      OscShape::Saw => 2.0 * (p - 0.5),
      OscShape::Square => if p < 0.5 { 1.0 } else { -1.0 },
      OscShape::Tri => 2.0 * (2.0 * ((p + 0.25) % 1.0) - 1.0).abs() - 1.0,
      OscShape::Pulse => if p < pulse_w { 1.0 } else { -1.0 },
      OscShape::NoiseWhite => 0.0, // handled outside
      OscShape::NoisePink => 0.0,
      OscShape::NoiseBrown => 0.0,
    }
  }
}

#[derive(Clone)]
pub struct Voice {
  active: bool,
  pub note: u8,
  age: u64,
  base_freq: f32,
  vel: f32,
  osc_a: Osc,
  osc_b: Osc,
  env_amp: Adsr,
  env_mod: Adsr,
  filt1: Svf,
  filt2: Svf,
  last_fa_fc: f32,
  last_fa_q: f32,
  last_fb_fc: f32,
  last_fb_q: f32,
  last_a: f32,
  last_b: f32,
  filt_upd_phase: u8,
  rng: u32,
  pink: f32,
  brown: f32,
}

#[derive(Clone, Copy)]
struct ModFrame { cents_a: f32, cents_b: f32, lvl_a: f32, lvl_b: f32, filt1: f32, filt2: f32 }

impl Voice {
  pub fn new(sr: f32) -> Self { Self { active: false, note: 0, age: 0, base_freq: 0.0, vel: 0.0, osc_a: Osc::new(sr), osc_b: Osc::new(sr), env_amp: Adsr::new(sr), env_mod: Adsr::new(sr), filt1: Svf::new(), filt2: Svf::new(), last_fa_fc: -1.0, last_fa_q: -1.0, last_fb_fc: -1.0, last_fb_q: -1.0, last_a: 0.0, last_b: 0.0, filt_upd_phase: 0, rng: 0x12345678, pink: 0.0, brown: 0.0 } }
  pub fn is_active(&self) -> bool { self.active || self.env_amp.env > 1e-4 }
  pub fn note_on(&mut self, _params: &ParamStore, note: u8, vel: f32) {
    self.active = true; self.note = note; self.base_freq = midi_to_freq(note); self.vel = vel; self.env_amp.gate_on(); self.env_mod.gate_on();
    // Reseed noise states per note for stability
    self.rng = (note as u32).wrapping_mul(747796405).wrapping_add(2891336453);
    self.pink = 0.0; self.brown = 0.0;
  }
  pub fn note_off(&mut self) { self.env_amp.gate_off(); self.env_mod.gate_off(); self.active = false; }
  fn render(&mut self, params: &ParamStore, paths: &ParamPaths, _sr: f32, modf: &ModFrame) -> f32 {
    self.age = self.age.wrapping_add(1);
    // Shapes arrive as I32 0..3
    let sh_a = params.get_i32_h(paths.oscA_shape, 0);
    let sh_b = params.get_i32_h(paths.oscB_shape, 0);
    // Update envelope parameters from ParamStore
    let a = params.get_f32_h(paths.amp_attack, 0.01);
    let d = params.get_f32_h(paths.amp_decay, 0.1);
    let s = params.get_f32_h(paths.amp_sustain, 0.8);
    let r = params.get_f32_h(paths.amp_release, 0.2);
    self.env_amp.set(a, d, s, r);
    let ma = params.get_f32_h(paths.mod_attack, 0.01);
    let md = params.get_f32_h(paths.mod_decay, 0.1);
    let ms = params.get_f32_h(paths.mod_sustain, 0.8);
    let mr = params.get_f32_h(paths.mod_release, 0.2);
    self.env_mod.set(ma, md, ms, mr);
    // Envelope (mod) normalized value for this voice
    let env_mod_v = self.env_mod.next();
    // Merge LFO frame with ENV matrix contributions
    let mut cents_a = modf.cents_a;
    let mut cents_b = modf.cents_b;
    let mut lvl_a_m = modf.lvl_a;
    let mut lvl_b_m = modf.lvl_b;
  let mut _filt1_m = modf.filt1;
  let mut _filt2_m = modf.filt2;
    for i in 0..5 {
      let dest = params.get_i32_h(paths.env_dest[i], 0) as u16;
      if dest == 0 { continue; }
      let row_amt = params.get_f32_h(paths.env_row_amount[i], 1.0).clamp(-1.0, 1.0);
      let v = env_mod_v * row_amt;
      match dest {
        1 => cents_a += 100.0 * v,
        2 => cents_b += 100.0 * v,
        3 => lvl_a_m += v,
        4 => lvl_b_m += v,
  5 => _filt1_m += v,
  6 => _filt2_m += v,
        _ => {}
      }
    }
    let det_a = params.get_f32_h(paths.oscA_detune_cents, 0.0) + cents_a;
    let det_b = params.get_f32_h(paths.oscB_detune_cents, 0.0) + cents_b;
    // --- Oscillator frequency calculations ---
    let freq_a = self.base_freq * (2.0_f32).powf(det_a / 1200.0);
    let freq_b = self.base_freq * (2.0_f32).powf(det_b / 1200.0);
    // Pulse width and FM amounts
    let pw_a = params.get_f32_h(paths.oscA_pulse_width, 0.5).clamp(0.02, 0.98);
    let fm_a_from_b = params.get_f32_h(paths.oscB_fm_to_A, 0.0) * 0.002; // modest scaling
    let fm_b_from_a = params.get_f32_h(paths.oscA_fm_to_B, 0.0) * 0.002;
    // Levels (with modulation from mod matrix already folded into lvl_a_m / lvl_b_m)
    let mut lvl_a = params.get_f32_h(paths.oscA_level, 0.5) + lvl_a_m;
    let mut lvl_b = params.get_f32_h(paths.oscB_level, 0.5) + lvl_b_m;
    lvl_a = lvl_a.clamp(0.0, 1.2);
    lvl_b = lvl_b.clamp(0.0, 1.2);
    // Envelope advance
    let env_amp = self.env_amp.next();
    // Basic noise RNG (xorshift32)
  let noise_sample = |state: &mut u32| -> f32 {
      let mut x = *state;
      x ^= x << 13; x ^= x >> 17; x ^= x << 5; *state = x; ((x as f32) * 2.3283064365e-10) * 2.0 - 1.0
    };
    // Generate oscillator phases with simple phase modulation (FM)
    let pm_a = fm_a_from_b * self.last_b;
    let pm_b = fm_b_from_a * self.last_a;
    let sig_a = if matches!(sh_a, 5 | 6 | 7) { 0.0 } else { self.osc_a.next_pm(freq_a, match sh_a { 1 => OscShape::Saw, 2 => OscShape::Square, 3 => OscShape::Tri, 4 => OscShape::Pulse, 5 => OscShape::NoiseWhite, 6 => OscShape::NoisePink, 7 => OscShape::NoiseBrown, _ => OscShape::Sine }, pw_a, pm_a) };
    let sig_b = if matches!(sh_b, 5 | 6 | 7) { 0.0 } else { self.osc_b.next_pm(freq_b, match sh_b { 1 => OscShape::Saw, 2 => OscShape::Square, 3 => OscShape::Tri, 4 => OscShape::Pulse, 5 => OscShape::NoiseWhite, 6 => OscShape::NoisePink, 7 => OscShape::NoiseBrown, _ => OscShape::Sine }, pw_a, pm_b) };
    // Noise handling (simple implementations)
    let noise_a = if sh_a >= 5 { let n = noise_sample(&mut self.rng); if sh_a == 5 { n } else if sh_a == 6 { // pink (leaky integrator)
        self.pink = 0.98 * self.pink + 0.02 * n; self.pink
      } else { // brown
        self.brown = (self.brown + 0.02 * n).clamp(-1.0, 1.0); self.brown
      }} else { 0.0 };
    let noise_b = if sh_b >= 5 { let n = noise_sample(&mut self.rng); if sh_b == 5 { n } else if sh_b == 6 { self.pink = 0.98 * self.pink + 0.02 * n; self.pink } else { self.brown = (self.brown + 0.02 * n).clamp(-1.0,1.0); self.brown } } else { 0.0 };
    let a_out = sig_a + noise_a;
    let b_out = sig_b + noise_b;
    self.last_a = a_out;
    self.last_b = b_out;
    // Pre-mix per-oscillator signals (post level) used for filter assignment
    let in_a = a_out * lvl_a;
    let in_b = b_out * lvl_b;
  // --- Filters with ENV/LFO modulation and per-filter Assign routing ---
  // Filter 1
  // Type is 0=LP, 1=HP, 2=BP, 3=Notch (driven by UI "Type" knob)
  let f1_type = params.get_i32_h(paths.filter1_type, 0);
  // Assign: 0=None (mute), 1=A, 2=B, 3=AB
  let f1_assign = params.get_i32_h(paths.filter1_assign, 0);
  let w1_a: f32 = if f1_assign == 1 || f1_assign == 3 { 1.0_f32 } else { 0.0_f32 };
  let w1_b: f32 = if f1_assign == 2 || f1_assign == 3 { 1.0_f32 } else { 0.0_f32 };
  let norm1 = (w1_a + w1_b).max(1.0_f32); // avoid doubling when AB
  let mut x1 = (w1_a * in_a + w1_b * in_b) / norm1;
  let mut f1_cut = params.get_f32_h(paths.filter1_cutoff_hz, 1200.0);
    let mut f1_q = params.get_f32_h(paths.filter1_q, 0.707);
  // Apply modulation to cutoff from LFO/ENV (coarse mapping: +/- 24 semitones in log freq domain)
  // Use _filt1_m which already combines LFO and ENV rows targeting filter1
  if _filt1_m.abs() > 1e-6 { let ratio = (2.0_f32).powf(_filt1_m * 2.0); f1_cut = (f1_cut * ratio).clamp(20.0, 18000.0); }
    // Optionally add ENV influence via mod matrix already folded into modf.filt1 through env_dest
    // Smooth-ish update every few samples to avoid CPU spikes
    if self.filt_upd_phase & 3 == 0 {
      if (f1_cut - self.last_fa_fc).abs() > 1e-3 || (f1_q - self.last_fa_q).abs() > 1e-3 {
        self.filt1.set_params(f1_cut, f1_q.clamp(0.3, 10.0), _sr);
        self.last_fa_fc = f1_cut; self.last_fa_q = f1_q;
      }
    }
  let (lp1, hp1, bp1, nt1) = self.filt1.process(x1);
  // Select output by filter type (from UI)
  let y1 = match f1_type { 0 => lp1, 1 => hp1, 2 => bp1, 3 => nt1, _ => lp1 };

    // Filter 2
  let f2_type = params.get_i32_h(paths.filter2_type, 0);
  let f2_assign = params.get_i32_h(paths.filter2_assign, 0);
  let w2_a: f32 = if f2_assign == 1 || f2_assign == 3 { 1.0_f32 } else { 0.0_f32 };
  let w2_b: f32 = if f2_assign == 2 || f2_assign == 3 { 1.0_f32 } else { 0.0_f32 };
  let norm2 = (w2_a + w2_b).max(1.0_f32);
  let mut x2 = (w2_a * in_a + w2_b * in_b) / norm2;
  let mut f2_cut = params.get_f32_h(paths.filter2_cutoff_hz, 1200.0);
    let mut f2_q = params.get_f32_h(paths.filter2_q, 0.707);
  if _filt2_m.abs() > 1e-6 { let ratio = (2.0_f32).powf(_filt2_m * 2.0); f2_cut = (f2_cut * ratio).clamp(20.0, 18000.0); }
    if self.filt_upd_phase & 3 == 2 {
      if (f2_cut - self.last_fb_fc).abs() > 1e-3 || (f2_q - self.last_fb_q).abs() > 1e-3 {
        self.filt2.set_params(f2_cut, f2_q.clamp(0.3, 10.0), _sr);
        self.last_fb_fc = f2_cut; self.last_fb_q = f2_q;
      }
    }
  let (lp2, hp2, bp2, nt2) = self.filt2.process(x2);
  let y2 = match f2_type { 0 => lp2, 1 => hp2, 2 => bp2, 3 => nt2, _ => lp2 };

    // Mix filters in parallel; average if both are active to maintain headroom
  let used1: f32 = if w1_a + w1_b > 0.0_f32 { 1.0_f32 } else { 0.0_f32 };
  let used2: f32 = if w2_a + w2_b > 0.0_f32 { 1.0_f32 } else { 0.0_f32 };
  let denom = (used1 + used2).max(1.0_f32);
    let mut y = (y1 * used1 + y2 * used2) / denom;

    // Amp envelope and velocity
    y *= env_amp * self.vel;
    y
  }
}

#[allow(non_snake_case)]
struct ParamPaths {
  oscA_shape: u64, oscB_shape: u64,
  oscA_detune_cents: u64, oscB_detune_cents: u64,
  oscA_pulse_width: u64, oscA_fm_to_B: u64, oscB_fm_to_A: u64,
  amp_attack: u64, amp_decay: u64, amp_sustain: u64, amp_release: u64,
  mod_attack: u64, mod_decay: u64, mod_sustain: u64, mod_release: u64,
  filter1_type: u64, filter1_cutoff_hz: u64, filter1_q: u64, filter1_res_q: u64, filter1_assign: u64,
  filter2_type: u64, filter2_cutoff_hz: u64, filter2_q: u64, filter2_res_q: u64, filter2_assign: u64,
  oscA_level: u64, oscB_level: u64,
  lfo_shape: u64, lfo_rate_hz: u64, lfo_amount: u64, lfo_drive: u64,
  lfo_dest: [u64;5], lfo_row_amount: [u64;5],
  env_dest: [u64;5], env_row_amount: [u64;5],
  fx1_type: u64, fx1_p1: u64, fx1_p2: u64, fx1_p3: u64,
  fx2_type: u64, fx2_p1: u64, fx2_p2: u64, fx2_p3: u64,
  fx3_type: u64, fx3_p1: u64, fx3_p2: u64, fx3_p3: u64,
  fx4_type: u64, fx4_p1: u64, fx4_p2: u64, fx4_p3: u64,
  mix_width: u64, mix_pan: u64, mix_comp: u64, mix_volume: u64, mix_haas: u64,
  eq_bands: [u64;8],
  mixer_gain_db: u64,
  module_kind: u64,
  // Acid303
  acid_wave: u64, acid_cutoff: u64, acid_reso: u64, acid_envmod: u64, acid_decay: u64, acid_accent: u64, acid_slide: u64, acid_drive: u64, acid_step_accent: u64, acid_step_slide: u64,
  // Karplus
  ks_decay: u64, ks_damp: u64, ks_excite: u64, ks_tune: u64,
  // Resonator
  resonator_pitch: u64, resonator_decay: u64, resonator_brightness: u64, resonator_bank_size: u64, resonator_mode: u64, resonator_inharmonicity: u64, resonator_feedback: u64, resonator_drive: u64, resonator_exciter_type: u64, resonator_exciter_amount: u64, resonator_noise_color: u64, resonator_strike_rate: u64, resonator_stereo_width: u64, resonator_randomize: u64, resonator_body_blend: u64, resonator_output_gain: u64,
  // Sampler
  sampler_sample_start: u64, sampler_sample_end: u64, sampler_pitch_semitones: u64, sampler_pitch_cents: u64, sampler_playback_mode: u64, sampler_loop_start: u64, sampler_loop_end: u64, sampler_loop_mode: u64, sampler_smoothness: u64, sampler_attack: u64, sampler_decay: u64, sampler_sustain: u64, sampler_release: u64,
}

impl ParamPaths {
  fn new(idx: usize) -> Self {
    let base = format!("part/{}/", idx);
    let p = |s: &str| -> u64 { hash_path(&(base.clone() + s)) };
    let mut eq = [0u64; 8];
    for i in 0..8 { eq[i] = hash_path(&format!("part/{}/eq/gain_db/b{}", idx, i+1)); }
    Self {
      oscA_shape: p("oscA/shape"), oscB_shape: p("oscB/shape"),
      oscA_detune_cents: p("oscA/detune_cents"), oscB_detune_cents: p("oscB/detune_cents"),
      oscA_pulse_width: p("oscA/pulse_width"), oscA_fm_to_B: p("oscA/fm_to_B"), oscB_fm_to_A: p("oscB/fm_to_A"),
      amp_attack: p("amp_env/attack"), amp_decay: p("amp_env/decay"), amp_sustain: p("amp_env/sustain"), amp_release: p("amp_env/release"),
      mod_attack: p("mod_env/attack"), mod_decay: p("mod_env/decay"), mod_sustain: p("mod_env/sustain"), mod_release: p("mod_env/release"),
      filter1_type: p("filter1/type"), filter1_cutoff_hz: p("filter1/cutoff_hz"), filter1_q: p("filter1/q"), filter1_res_q: p("filter1/res_q"), filter1_assign: p("filter1/assign"),
      filter2_type: p("filter2/type"), filter2_cutoff_hz: p("filter2/cutoff_hz"), filter2_q: p("filter2/q"), filter2_res_q: p("filter2/res_q"), filter2_assign: p("filter2/assign"),
      oscA_level: p("oscA/level"), oscB_level: p("oscB/level"),
      lfo_shape: p("lfo/shape"), lfo_rate_hz: p("lfo/rate_hz"), lfo_amount: p("lfo/amount"), lfo_drive: p("lfo/drive"),
      lfo_dest: [p("mod/lfo/row0/dest"), p("mod/lfo/row1/dest"), p("mod/lfo/row2/dest"), p("mod/lfo/row3/dest"), p("mod/lfo/row4/dest")],
      lfo_row_amount: [p("mod/lfo/row0/amount"), p("mod/lfo/row1/amount"), p("mod/lfo/row2/amount"), p("mod/lfo/row3/amount"), p("mod/lfo/row4/amount")],
      env_dest: [p("mod/env/row0/dest"), p("mod/env/row1/dest"), p("mod/env/row2/dest"), p("mod/env/row3/dest"), p("mod/env/row4/dest")],
      env_row_amount: [p("mod/env/row0/amount"), p("mod/env/row1/amount"), p("mod/env/row2/amount"), p("mod/env/row3/amount"), p("mod/env/row4/amount")],
      fx1_type: p("fx1/type"), fx1_p1: p("fx1/p1"), fx1_p2: p("fx1/p2"), fx1_p3: p("fx1/p3"),
      fx2_type: p("fx2/type"), fx2_p1: p("fx2/p1"), fx2_p2: p("fx2/p2"), fx2_p3: p("fx2/p3"),
      fx3_type: p("fx3/type"), fx3_p1: p("fx3/p1"), fx3_p2: p("fx3/p2"), fx3_p3: p("fx3/p3"),
      fx4_type: p("fx4/type"), fx4_p1: p("fx4/p1"), fx4_p2: p("fx4/p2"), fx4_p3: p("fx4/p3"),
      mix_width: p("mixer/width"), mix_pan: p("mixer/pan"), mix_comp: p("mixer/comp"), mix_volume: p("mixer/volume"),
      mix_haas: p("mixer/haas"),
      eq_bands: eq,
      mixer_gain_db: hash_path(&format!("mixer/part{}/gain_db", idx)),
      // Module select & Acid303 params
      module_kind: p("module_kind"),
      acid_wave: p("acid/wave"),
      acid_cutoff: p("acid/cutoff"),
      acid_reso: p("acid/reso"),
      acid_envmod: p("acid/envmod"),
      acid_decay: p("acid/decay"),
      acid_accent: p("acid/accent"),
      acid_slide: p("acid/slide"),
      acid_drive: p("acid/drive"),
      acid_step_accent: p("acid/step/accent"),
      acid_step_slide: p("acid/step/slide"),
      // Karplus-Strong params
      ks_decay: p("ks/decay"),
      ks_damp: p("ks/damp"),
      ks_excite: p("ks/excite"),
      ks_tune: p("ks/tune"),
      // Resonator Bank params
      resonator_pitch: p("resonator/pitch"),
      resonator_decay: p("resonator/decay"),
      resonator_brightness: p("resonator/brightness"),
      resonator_bank_size: p("resonator/bank_size"),
      resonator_mode: p("resonator/mode"),
      resonator_inharmonicity: p("resonator/inharmonicity"),
      resonator_feedback: p("resonator/feedback"),
      resonator_drive: p("resonator/drive"),
      resonator_exciter_type: p("resonator/exciter_type"),
      resonator_exciter_amount: p("resonator/exciter_amount"),
      resonator_noise_color: p("resonator/noise_color"),
      resonator_strike_rate: p("resonator/strike_rate"),
      resonator_stereo_width: p("resonator/stereo_width"),
      resonator_randomize: p("resonator/randomize"),
      resonator_body_blend: p("resonator/body_blend"),
      resonator_output_gain: p("resonator/output_gain"),
      // Sampler params
      sampler_sample_start: p("sampler/sample_start"),
      sampler_sample_end: p("sampler/sample_end"),
      sampler_pitch_semitones: p("sampler/pitch_semitones"),
      sampler_pitch_cents: p("sampler/pitch_cents"),
      sampler_playback_mode: p("sampler/playback_mode"),
      sampler_loop_start: p("sampler/loop_start"),
      sampler_loop_end: p("sampler/loop_end"),
      sampler_loop_mode: p("sampler/loop_mode"),
      sampler_smoothness: p("sampler/smoothness"),
      sampler_attack: p("sampler/attack"),
      sampler_decay: p("sampler/decay"),
      sampler_sustain: p("sampler/sustain"),
      sampler_release: p("sampler/release"),
    }
  }
}

pub struct Part {
  voices: Vec<Voice>,
  sr: f32,
  next_voice: usize,
  acid: Acid303,
  acid_keys: AcidParamKeys,
  karplus: KarplusStrong,
  karplus_keys: KSParamKeys,
  resonator: ResonatorBank,
  resonator_keys: ResonatorParamKeys,
  sampler: Sampler,
  sampler_keys: SamplerParamKeys,
  drum: DrumPlayer,
  drum_keys: DrumParamKeys,
  delay1: ModDelay, delay2: ModDelay, delay3: ModDelay, delay4: ModDelay,
  sdelay1: SimpleDelay, sdelay2: SimpleDelay, sdelay3: SimpleDelay, sdelay4: SimpleDelay,
  fx1_reverb: Option<Freeverb>, fx2_reverb: Option<Freeverb>, fx3_reverb: Option<Freeverb>, fx4_reverb: Option<Freeverb>,
  fx1_crusher: Option<Bitcrusher>, fx2_crusher: Option<Bitcrusher>, fx3_crusher: Option<Bitcrusher>, fx4_crusher: Option<Bitcrusher>,
  fx1_wet_lp_l: OnePoleLP, fx1_wet_lp_r: OnePoleLP,
  fx2_wet_lp_l: OnePoleLP, fx2_wet_lp_r: OnePoleLP,
  fx3_wet_lp_l: OnePoleLP, fx3_wet_lp_r: OnePoleLP,
  fx4_wet_lp_l: OnePoleLP, fx4_wet_lp_r: OnePoleLP,
  phaser1: Phaser, phaser2: Phaser, phaser3: Phaser, phaser4: Phaser,
  eq_lp: Svf, eq_hp: Svf,
  eq_bands: [Biquad;8], eq_centers: [f32;8], eq_last_db: [f32;8],
  paths: ParamPaths,
  lfo_phase: f32, lfo_hold: f32,
  haas_buf: Vec<f32>, haas_wr: usize, haas_len: usize, haas_d: usize,
}

impl Part {
  pub fn new(sr: f32, poly: usize, idx: usize) -> Self {
    let mut voices = Vec::with_capacity(poly);
    for _ in 0..poly { voices.push(Voice::new(sr)); }
    // Allocate modulated delay buffers for FX and explicit delays for TIME/FEEDBACK
    let mut p = Self { voices, sr, next_voice: 0,
      acid: Acid303::new(sr),
      acid_keys: AcidParamKeys {
        module_kind: hash_path(&format!("part/{}/module_kind", idx)),
        wave: hash_path(&format!("part/{}/acid/wave", idx)),
        cutoff: hash_path(&format!("part/{}/acid/cutoff", idx)),
        reso: hash_path(&format!("part/{}/acid/reso", idx)),
        envmod: hash_path(&format!("part/{}/acid/envmod", idx)),
        decay: hash_path(&format!("part/{}/acid/decay", idx)),
        accent: hash_path(&format!("part/{}/acid/accent", idx)),
        slide: hash_path(&format!("part/{}/acid/slide", idx)),
        drive: hash_path(&format!("part/{}/acid/drive", idx)),
        step_accent: hash_path(&format!("part/{}/acid/step/accent", idx)),
        step_slide: hash_path(&format!("part/{}/acid/step/slide", idx)),
      },
      karplus: KarplusStrong::new(sr),
      karplus_keys: KSParamKeys {
        module_kind: hash_path(&format!("part/{}/module_kind", idx)),
        decay: hash_path(&format!("part/{}/ks/decay", idx)),
        damp: hash_path(&format!("part/{}/ks/damp", idx)),
        excite: hash_path(&format!("part/{}/ks/excite", idx)),
        tune: hash_path(&format!("part/{}/ks/tune", idx)),
      },
      resonator: ResonatorBank::new(sr),
      resonator_keys: ResonatorParamKeys {
        module_kind: hash_path(&format!("part/{}/module_kind", idx)),
        pitch: hash_path(&format!("part/{}/resonator/pitch", idx)),
        decay: hash_path(&format!("part/{}/resonator/decay", idx)),
        brightness: hash_path(&format!("part/{}/resonator/brightness", idx)),
        bank_size: hash_path(&format!("part/{}/resonator/bank_size", idx)),
        mode: hash_path(&format!("part/{}/resonator/mode", idx)),
        inharmonicity: hash_path(&format!("part/{}/resonator/inharmonicity", idx)),
        feedback: hash_path(&format!("part/{}/resonator/feedback", idx)),
        drive: hash_path(&format!("part/{}/resonator/drive", idx)),
        exciter_type: hash_path(&format!("part/{}/resonator/exciter_type", idx)),
        exciter_amount: hash_path(&format!("part/{}/resonator/exciter_amount", idx)),
        noise_color: hash_path(&format!("part/{}/resonator/noise_color", idx)),
        strike_rate: hash_path(&format!("part/{}/resonator/strike_rate", idx)),
        stereo_width: hash_path(&format!("part/{}/resonator/stereo_width", idx)),
        randomize: hash_path(&format!("part/{}/resonator/randomize", idx)),
        body_blend: hash_path(&format!("part/{}/resonator/body_blend", idx)),
        output_gain: hash_path(&format!("part/{}/resonator/output_gain", idx)),
      },
  sampler: Sampler::new(sr),
      sampler_keys: SamplerParamKeys {
        module_kind: hash_path(&format!("part/{}/module_kind", idx)),
        sample_start: hash_path(&format!("part/{}/sampler/sample_start", idx)),
        sample_end: hash_path(&format!("part/{}/sampler/sample_end", idx)),
        pitch_semitones: hash_path(&format!("part/{}/sampler/pitch_semitones", idx)),
        pitch_cents: hash_path(&format!("part/{}/sampler/pitch_cents", idx)),
        playback_mode: hash_path(&format!("part/{}/sampler/playback_mode", idx)),
        loop_start: hash_path(&format!("part/{}/sampler/loop_start", idx)),
        loop_end: hash_path(&format!("part/{}/sampler/loop_end", idx)),
        loop_mode: hash_path(&format!("part/{}/sampler/loop_mode", idx)),
        smoothness: hash_path(&format!("part/{}/sampler/smoothness", idx)),
  retrig_mode: hash_path(&format!("part/{}/sampler/retrig_mode", idx)),
        attack: hash_path(&format!("part/{}/sampler/attack", idx)),
        decay: hash_path(&format!("part/{}/sampler/decay", idx)),
        sustain: hash_path(&format!("part/{}/sampler/sustain", idx)),
        release: hash_path(&format!("part/{}/sampler/release", idx)),
      },
  drum: DrumPlayer::new(sr),
  drum_keys: DrumParamKeys::new(idx),
  delay1: ModDelay::new(1500.0, sr), delay2: ModDelay::new(1500.0, sr),
      delay3: ModDelay::new(1500.0, sr), delay4: ModDelay::new(1500.0, sr),
      sdelay1: SimpleDelay::new(1200.0, sr), sdelay2: SimpleDelay::new(1200.0, sr),
      sdelay3: SimpleDelay::new(1200.0, sr), sdelay4: SimpleDelay::new(1200.0, sr),
      fx1_reverb: None, fx2_reverb: None, fx3_reverb: None, fx4_reverb: None,
      fx1_crusher: None, fx2_crusher: None, fx3_crusher: None, fx4_crusher: None,
      fx1_wet_lp_l: OnePoleLP::new(), fx1_wet_lp_r: OnePoleLP::new(),
      fx2_wet_lp_l: OnePoleLP::new(), fx2_wet_lp_r: OnePoleLP::new(),
      fx3_wet_lp_l: OnePoleLP::new(), fx3_wet_lp_r: OnePoleLP::new(),
      fx4_wet_lp_l: OnePoleLP::new(), fx4_wet_lp_r: OnePoleLP::new(),
      phaser1: Phaser::new(), phaser2: Phaser::new(), phaser3: Phaser::new(), phaser4: Phaser::new(),
      eq_lp: Svf::new(), eq_hp: Svf::new(),
  eq_bands: [Biquad::new(), Biquad::new(), Biquad::new(), Biquad::new(), Biquad::new(), Biquad::new(), Biquad::new(), Biquad::new()],
  eq_centers: [60.0,120.0,250.0,500.0,1000.0,2000.0,4000.0,8000.0], eq_last_db: [0.0; 8],
  paths: ParamPaths::new(idx), lfo_phase: 0.0, lfo_hold: 0.0,
      haas_buf: Vec::new(), haas_wr: 0, haas_len: 0, haas_d: 0 };
    // Initialize helper filters used for pseudo-side width
    p.eq_lp.set_params(250.0, 0.707, sr);
    p.eq_hp.set_params(2000.0, 0.707, sr);
    // Haas delay buffers
    let max_len = ((0.02 * sr).ceil() as usize).max(2);
    let d_samp = ((0.015 * sr).round() as usize).min(max_len - 1);
    p.haas_buf = vec![0.0; max_len];
    p.haas_wr = 0;
    p.haas_len = max_len;
    p.haas_d = d_samp;
    p
  }
  pub fn note_on(&mut self, params: &ParamStore, note: u8, vel: f32) {
    let mk = params.get_i32_h(self.paths.module_kind, 0);
    match mk {
      0 => { // Analog poly
        for v in &mut self.voices { if v.note == note && v.is_active() { v.note_off(); } }
        let mut idx = None; for (i, v) in self.voices.iter().enumerate() { if !v.is_active() { idx = Some(i); break; } }
        let i = idx.unwrap_or_else(|| { let i = self.next_voice; self.next_voice = (self.next_voice + 1) % self.voices.len(); i });
        self.voices[i].note_on(params, note, vel);
      }
      1 => { self.acid.note_on(note, vel); }
      2 => { self.karplus.note_on(note, vel); }
      3 => { self.resonator.note_on(note, vel); }
      4 => { // Sampler
        let retrig_i = params.get_i32_h(self.sampler_keys.retrig_mode, 0);
        let retrig_mode = crate::engine::modules::sampler::RetrigMode::from_index(retrig_i);
        self.sampler.note_on(note, vel, retrig_mode);
      }
      5 => { self.drum.note_on(note, vel); }
      _ => {}
    }
  }
  pub fn note_off(&mut self, note: u8) {
    // Stop all voices with this note to guarantee preview stops fully
    for v in &mut self.voices { if v.note == note && v.is_active() { v.note_off(); } }
    self.acid.note_off(note);
    self.karplus.note_off();
    self.resonator.note_off(note);
  self.sampler.note_off(note);
  // Drum voices may have been triggered; attempt to stop matching slot
  self.drum.note_off(note);
  }

  pub fn load_sample(&mut self, path: &str) -> Result<(), String> {
    self.sampler.load_sample(path);
    Ok(())
  }

  pub fn clear_sample(&mut self) {
    self.sampler.clear_sample();
  }

  pub fn load_drum_pack(&mut self, paths: &[String]) {
    self.drum.load_pack(paths);
  }

  pub fn drum_mut(&mut self) -> &mut DrumPlayer { &mut self.drum }

  pub fn render(&mut self, params: &ParamStore, _part_idx: usize, beat_phase: f32) -> (f32, f32) {
    // Module dispatch (0 = Analog, 1 = Acid303, 2 = KarplusStrong, 3 = ResonatorBank, 4 = Sampler)
    let module = params.get_i32_h(self.paths.module_kind, 0);
    
    // Debug: Log module kind for part 0 when it changes
  // (debug logging removed for stability)
    
    if module == 5 {
      // Drum Sampler render path (mono aggregation -> FX -> EQ -> Mixer)
      let dframe = self.drum.render(params, &self.drum_keys);
      // Allow FX tails like the Sampler: only early-out if dry is silent and all FX mixes are ~zero
      let fx1_t_peek = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_mix_peek = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      let fx2_t_peek = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_mix_peek = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      let fx3_t_peek = params.get_i32_h(self.paths.fx3_type, 0);
      let fx3_mix_peek = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
      let fx4_t_peek = params.get_i32_h(self.paths.fx4_type, 0);
      let fx4_mix_peek = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
      if dframe.mono.abs() < 1e-9 && (fx1_t_peek <= 0 || fx1_mix_peek <= 0.0005) && (fx2_t_peek <= 0 || fx2_mix_peek <= 0.0005) && (fx3_t_peek <= 0 || fx3_mix_peek <= 0.0005) && (fx4_t_peek <= 0 || fx4_mix_peek <= 0.0005) {
        return (0.0, 0.0);
      }
      let mut out = dframe.mono; // summed mono
      // --- FX1 chain (copied from other module branches) ---
      let fx1_t = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_p1 = params.get_f32_h(self.paths.fx1_p1, 0.0);
      let fx1_p2 = params.get_f32_h(self.paths.fx1_p2, 0.0);
      let fx1_mix = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      if fx1_t <= 0 || fx1_mix <= 0.0005 {
        if fx1_t <= 0 { self.fx1_reverb = None; self.fx1_crusher = None; }
      } else if fx1_t == 2 {
        let time_ms = 10.0 + fx1_p1.clamp(0.0, 1.0) * 990.0;
        let fb = (fx1_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out];
        self.sdelay1.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx1_mix, false);
        out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 1 {
        if self.fx1_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize);
          rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          self.fx1_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx1_reverb {
          let room = 0.2 + fx1_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx1_p2.clamp(0.0, 1.0) * 0.8; let mix = fx1_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64));
          let lp_amt = 0.5 + 0.5 * (damp as f32); self.fx1_wet_lp_l.set_hf_damp(lp_amt); self.fx1_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx1_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx1_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx1_t == 3 || fx1_t == 4 || fx1_t == 5 {
        let rate = 0.05 + fx1_p1 * (5.0 - 0.05);
        let depth_ms = match fx1_t { 4 => 6.0 * fx1_p2, 5 => 12.0 * fx1_p2, _ => 4.0 * fx1_p2 };
        if fx1_t == 3 {
          let (wet, _) = self.phaser1.process_one(out, out, self.sr, rate, fx1_p2, 1.0);
          out = out * (1.0 - fx1_mix) + wet * fx1_mix;
        } else {
          let base_ms = match fx1_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
          let (wet, _) = self.delay1.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
          out = out * (1.0 - fx1_mix) + wet * fx1_mix;
        }
        self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 6 {
        let dry = out; let drive_db = (fx1_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0);
        let x = (dry * g).tanh(); let tone = fx1_p2.clamp(0.0, 1.0);
        let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx1_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx1_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone;
        out = dry * (1.0 - fx1_mix) + shaped * fx1_mix; self.fx1_reverb = None;
      } else if fx1_t == 7 {
        let dry = out; let drive = fx1_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx1_p1.clamp(0.0, 1.0);
        let xin = dry * g;
        let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx1_mix) + shaped * fx1_mix; self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 8 {
        if self.fx1_crusher.is_none() { self.fx1_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx1_crusher {
          let bits = 4.0 + fx1_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx1_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx1_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // FX2
      let fx2_t = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_p1 = params.get_f32_h(self.paths.fx2_p1, 0.0);
      let fx2_p2 = params.get_f32_h(self.paths.fx2_p2, 0.0);
      let fx2_mix = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      if fx2_t <= 0 || fx2_mix <= 0.0005 { if fx2_t <= 0 { self.fx2_reverb = None; self.fx2_crusher = None; } }
      else if fx2_t == 2 {
        let time_ms = 10.0 + fx2_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx2_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay2.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx2_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]); self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 1 {
        if self.fx2_reverb.is_none() { let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx2_reverb = Some(rv); }
        if let Some(rv) = &mut self.fx2_reverb {
          let room = 0.2 + fx2_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx2_p2.clamp(0.0, 1.0) * 0.8; let mix = fx2_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx2_wet_lp_l.set_hf_damp(lp_amt); self.fx2_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx2_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx2_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx2_t == 3 || fx2_t == 4 || fx2_t == 5 {
        let rate = 0.05 + fx2_p1 * (5.0 - 0.05); let depth_ms = match fx2_t { 4 => 6.0 * fx2_p2, 5 => 12.0 * fx2_p2, _ => 4.0 * fx2_p2 };
        if fx2_t == 3 { let (wet, _) = self.phaser2.process_one(out, out, self.sr, rate, fx2_p2, 1.0); out = out * (1.0 - fx2_mix) + wet * fx2_mix; }
        else { let base_ms = match fx2_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay2.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx2_mix) + wet * fx2_mix; }
        self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 6 {
        let dry = out; let drive_db = (fx2_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx2_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx2_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx2_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx2_mix) + shaped * fx2_mix; self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 7 {
        let dry = out; let drive = fx2_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx2_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx2_mix) + shaped * fx2_mix; self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 8 {
        if self.fx2_crusher.is_none() { self.fx2_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx2_crusher { let bits = 4.0 + fx2_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx2_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx2_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]); }
      }
      // FX3
      let fx3_t = params.get_i32_h(self.paths.fx3_type, 0);
      let fx3_p1 = params.get_f32_h(self.paths.fx3_p1, 0.0);
      let fx3_p2 = params.get_f32_h(self.paths.fx3_p2, 0.0);
      let fx3_mix = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
      if fx3_t <= 0 || fx3_mix <= 0.0005 { if fx3_t <= 0 { self.fx3_reverb = None; self.fx3_crusher = None; } }
      else if fx3_t == 2 {
        let time_ms = 10.0 + fx3_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx3_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay3.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx3_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]); self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 1 {
        if self.fx3_reverb.is_none() { let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx3_reverb = Some(rv); }
        if let Some(rv) = &mut self.fx3_reverb {
          let room = 0.2 + fx3_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx3_p2.clamp(0.0, 1.0) * 0.8; let mix = fx3_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32); self.fx3_wet_lp_l.set_hf_damp(lp_amt); self.fx3_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx3_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx3_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r); out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx3_t == 3 || fx3_t == 4 || fx3_t == 5 {
        let rate = 0.05 + fx3_p1 * (5.0 - 0.05); let depth_ms = match fx3_t { 4 => 6.0 * fx3_p2, 5 => 12.0 * fx3_p2, _ => 4.0 * fx3_p2 };
        if fx3_t == 3 { let (wet, _) = self.phaser3.process_one(out, out, self.sr, rate, fx3_p2, 1.0); out = out * (1.0 - fx3_mix) + wet * fx3_mix; }
        else { let base_ms = match fx3_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay3.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx3_mix) + wet * fx3_mix; }
        self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 6 {
        let dry = out; let drive_db = (fx3_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx3_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx3_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx3_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx3_mix) + shaped * fx3_mix; self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 7 {
        let dry = out; let drive = fx3_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx3_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx3_mix) + shaped * fx3_mix; self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 8 {
        if self.fx3_crusher.is_none() { self.fx3_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx3_crusher { let bits = 4.0 + fx3_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx3_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx3_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]); }
      }
      // FX4
      let fx4_t = params.get_i32_h(self.paths.fx4_type, 0);
      let fx4_p1 = params.get_f32_h(self.paths.fx4_p1, 0.0);
      let fx4_p2 = params.get_f32_h(self.paths.fx4_p2, 0.0);
      let fx4_mix = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
      if fx4_t <= 0 || fx4_mix <= 0.0005 { if fx4_t <= 0 { self.fx4_reverb = None; self.fx4_crusher = None; } }
      else if fx4_t == 2 {
        let time_ms = 10.0 + fx4_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx4_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay4.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx4_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]); self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 1 {
        if self.fx4_reverb.is_none() { let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx4_reverb = Some(rv); }
        if let Some(rv) = &mut self.fx4_reverb {
          let room = 0.2 + fx4_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx4_p2.clamp(0.0, 1.0) * 0.8; let mix = fx4_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32); self.fx4_wet_lp_l.set_hf_damp(lp_amt); self.fx4_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx4_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx4_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r); out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx4_t == 3 || fx4_t == 4 || fx4_t == 5 {
        let rate = 0.05 + fx4_p1 * (5.0 - 0.05); let depth_ms = match fx4_t { 4 => 6.0 * fx4_p2, 5 => 12.0 * fx4_p2, _ => 4.0 * fx4_p2 };
        if fx4_t == 3 { let (wet, _) = self.phaser4.process_one(out, out, self.sr, rate, fx4_p2, 1.0); out = out * (1.0 - fx4_mix) + wet * fx4_mix; }
        else { let base_ms = match fx4_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay4.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx4_mix) + wet * fx4_mix; }
        self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 6 {
        let dry = out; let drive_db = (fx4_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx4_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx4_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx4_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx4_mix) + shaped * fx4_mix; self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 7 {
        let dry = out; let drive = fx4_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx4_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx4_mix) + shaped * fx4_mix; self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 8 {
        if self.fx4_crusher.is_none() { self.fx4_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx4_crusher { let bits = 4.0 + fx4_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx4_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx4_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]); }
      }
      // EQ
      let q = 1.0_f32; let mut any_nonzero = false;
      for i in 0..8 {
        let db = params.get_f32_h(self.paths.eq_bands[i], 0.0).clamp(-12.0, 12.0);
        if (db - self.eq_last_db[i]).abs() > 1e-6 { self.eq_bands[i].set_peaking(self.sr, self.eq_centers[i], q, db); self.eq_last_db[i] = db; }
        if db.abs() > 1e-3 { any_nonzero = true; }
      }
      if any_nonzero { for i in 0..8 { out = self.eq_bands[i].process(out); } }
      // Mixer with per-voice pan blending
      let pan_local = if dframe.mono.abs() > 1e-9 { (dframe.pan_accum / dframe.mono).clamp(-1.0, 1.0) } else { 0.0 };
      let mut l = out; let mut r = out;
      let pan = (params.get_f32_h(self.paths.mix_pan, 0.0) + pan_local).clamp(-1.0, 1.0);
      let theta = (pan + 1.0) * std::f32::consts::FRAC_PI_4; let gl = theta.cos(); let gr = theta.sin(); l *= gl; r *= gr;
      let vol = params.get_f32_h(self.paths.mix_volume, 1.0).clamp(0.0, 1.0); l *= vol; r *= vol;
      let haas = params.get_f32_h(self.paths.mix_haas, 0.0).clamp(0.0, 1.0);
      if haas > 0.0005 {
        let rd = if self.haas_wr >= self.haas_d { self.haas_wr - self.haas_d } else { self.haas_wr + self.haas_len - self.haas_d };
        let delayed_l = self.haas_buf[rd]; self.haas_buf[self.haas_wr] = l; self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; }
        l = l * (1.0 - haas) + delayed_l * haas;
      } else { self.haas_buf[self.haas_wr] = l; self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; } }
      let comp = params.get_f32_h(self.paths.mix_comp, 0.0).clamp(0.0, 1.0);
      if comp > 0.001 { let drive = 1.0 + 8.0 * comp; let id = 1.0 / drive.tanh(); l = (l * drive).tanh() * id; r = (r * drive).tanh() * id; }
      return (l, r);
  } else if module == 1 {
      // Acid303 mono voice sample
      let s = self.acid.render_one(params, &self.acid_keys);
      // Early-out if dry is silent and all FX mixes are ~zero (no tails needed)
      let fx1_t_peek = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_mix_peek = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      let fx2_t_peek = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_mix_peek = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      let fx3_t_peek = params.get_i32_h(self.paths.fx3_type, 0);
      let fx3_mix_peek = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
      let fx4_t_peek = params.get_i32_h(self.paths.fx4_type, 0);
      let fx4_mix_peek = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
      if s.abs() < 1e-9 && (fx1_t_peek <= 0 || fx1_mix_peek <= 0.0005) && (fx2_t_peek <= 0 || fx2_mix_peek <= 0.0005) && (fx3_t_peek <= 0 || fx3_mix_peek <= 0.0005) && (fx4_t_peek <= 0 || fx4_mix_peek <= 0.0005) {
        return (0.0, 0.0);
      }
      // FX chain (identical to Analog)
      let mut out = s;
      let fx1_t = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_p1 = params.get_f32_h(self.paths.fx1_p1, 0.0);
      let fx1_p2 = params.get_f32_h(self.paths.fx1_p2, 0.0);
      let fx1_mix = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      if fx1_t <= 0 || fx1_mix <= 0.0005 {
        if fx1_t <= 0 { self.fx1_reverb = None; self.fx1_crusher = None; }
      } else if fx1_t == 2 {
        let time_ms = 10.0 + fx1_p1.clamp(0.0, 1.0) * 990.0;
        let fb = (fx1_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out];
        self.sdelay1.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx1_mix, false);
        out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 1 {
        if self.fx1_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize);
          rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          self.fx1_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx1_reverb {
          let room = 0.2 + fx1_p1.clamp(0.0, 1.0) * 0.8;
          let damp = 0.2 + fx1_p2.clamp(0.0, 1.0) * 0.8;
          let mix = fx1_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64));
          let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx1_wet_lp_l.set_hf_damp(lp_amt); self.fx1_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx1_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx1_wet_lp_r.tick(wr as f32) as f32;
          let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx1_t == 3 || fx1_t == 4 || fx1_t == 5 {
        let rate = 0.05 + fx1_p1 * (5.0 - 0.05);
        let depth_ms = match fx1_t { 4 => 6.0 * fx1_p2, 5 => 12.0 * fx1_p2, _ => 4.0 * fx1_p2 };
        if fx1_t == 3 {
          let (wet, _) = self.phaser1.process_one(out, out, self.sr, rate, fx1_p2, 1.0);
          out = out * (1.0 - fx1_mix) + wet * fx1_mix;
        } else {
          let base_ms = match fx1_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
          let (wet, _) = self.delay1.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
          out = out * (1.0 - fx1_mix) + wet * fx1_mix;
        }
        self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 6 {
        let dry = out; let drive_db = (fx1_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0);
        let x = (dry * g).tanh(); let tone = fx1_p2.clamp(0.0, 1.0);
        let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx1_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx1_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone;
        out = dry * (1.0 - fx1_mix) + shaped * fx1_mix; self.fx1_reverb = None;
      } else if fx1_t == 7 {
        let dry = out; let drive = fx1_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx1_p1.clamp(0.0, 1.0);
        let xin = dry * g;
        let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx1_mix) + shaped * fx1_mix; self.fx1_reverb = None;
      } else if fx1_t == 8 {
        if self.fx1_crusher.is_none() { self.fx1_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx1_crusher {
          let bits = 4.0 + fx1_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx1_p2.clamp(0.0, 1.0) * 15.0;
          cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx1_mix);
          let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // FX2 chain
      let fx2_t = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_p1 = params.get_f32_h(self.paths.fx2_p1, 0.0);
      let fx2_p2 = params.get_f32_h(self.paths.fx2_p2, 0.0);
      let fx2_mix = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      if fx2_t <= 0 || fx2_mix <= 0.0005 { if fx2_t <= 0 { self.fx2_reverb = None; self.fx2_crusher = None; } }
      else if fx2_t == 2 {
        let time_ms = 10.0 + fx2_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx2_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay2.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx2_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 1 {
        if self.fx2_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx2_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx2_reverb {
          let room = 0.2 + fx2_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx2_p2.clamp(0.0, 1.0) * 0.8; let mix = fx2_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx2_wet_lp_l.set_hf_damp(lp_amt); self.fx2_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx2_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx2_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx2_t == 3 || fx2_t == 4 || fx2_t == 5 {
        let rate = 0.05 + fx2_p1 * (5.0 - 0.05); let depth_ms = match fx2_t { 4 => 6.0 * fx2_p2, 5 => 12.0 * fx2_p2, _ => 4.0 * fx2_p2 };
        if fx2_t == 3 {
          let (wet, _) = self.phaser2.process_one(out, out, self.sr, rate, fx2_p2, 1.0); out = out * (1.0 - fx2_mix) + wet * fx2_mix;
        } else {
          let base_ms = match fx2_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay2.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx2_mix) + wet * fx2_mix;
        }
        self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 6 {
        let dry = out; let drive_db = (fx2_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx2_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx2_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx2_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx2_mix) + shaped * fx2_mix; self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 7 {
        let dry = out; let drive = fx2_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx2_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx2_mix) + shaped * fx2_mix; self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 8 {
        if self.fx2_crusher.is_none() { self.fx2_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx2_crusher {
          let bits = 4.0 + fx2_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx2_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx2_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // FX3 chain
      let fx3_t = params.get_i32_h(self.paths.fx3_type, 0);
      let fx3_p1 = params.get_f32_h(self.paths.fx3_p1, 0.0);
      let fx3_p2 = params.get_f32_h(self.paths.fx3_p2, 0.0);
      let fx3_mix = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
      if fx3_t <= 0 || fx3_mix <= 0.0005 { if fx3_t <= 0 { self.fx3_reverb = None; self.fx3_crusher = None; } }
      else if fx3_t == 2 {
        let time_ms = 10.0 + fx3_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx3_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay3.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx3_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 1 {
        if self.fx3_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx3_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx3_reverb {
          let room = 0.2 + fx3_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx3_p2.clamp(0.0, 1.0) * 0.8; let mix = fx3_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx3_wet_lp_l.set_hf_damp(lp_amt); self.fx3_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx3_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx3_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx3_t == 3 || fx3_t == 4 || fx3_t == 5 {
        let rate = 0.05 + fx3_p1 * (5.0 - 0.05); let depth_ms = match fx3_t { 4 => 6.0 * fx3_p2, 5 => 12.0 * fx3_p2, _ => 4.0 * fx3_p2 };
        if fx3_t == 3 {
          let (wet, _) = self.phaser3.process_one(out, out, self.sr, rate, fx3_p2, 1.0); out = out * (1.0 - fx3_mix) + wet * fx3_mix;
        } else {
          let base_ms = match fx3_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay3.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx3_mix) + wet * fx3_mix;
        }
        self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 6 {
        let dry = out; let drive_db = (fx3_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx3_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx3_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx3_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx3_mix) + shaped * fx3_mix; self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 7 {
        let dry = out; let drive = fx3_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx3_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx3_mix) + shaped * fx3_mix; self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 8 {
        if self.fx3_crusher.is_none() { self.fx3_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx3_crusher {
          let bits = 4.0 + fx3_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx3_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx3_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // FX4 chain
      let fx4_t = params.get_i32_h(self.paths.fx4_type, 0);
      let fx4_p1 = params.get_f32_h(self.paths.fx4_p1, 0.0);
      let fx4_p2 = params.get_f32_h(self.paths.fx4_p2, 0.0);
      let fx4_mix = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
      if fx4_t <= 0 || fx4_mix <= 0.0005 { if fx4_t <= 0 { self.fx4_reverb = None; self.fx4_crusher = None; } }
      else if fx4_t == 2 {
        let time_ms = 10.0 + fx4_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx4_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay4.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx4_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 1 {
        if self.fx4_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx4_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx4_reverb {
          let room = 0.2 + fx4_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx4_p2.clamp(0.0, 1.0) * 0.8; let mix = fx4_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx4_wet_lp_l.set_hf_damp(lp_amt); self.fx4_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx4_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx4_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx4_t == 3 || fx4_t == 4 || fx4_t == 5 {
        let rate = 0.05 + fx4_p1 * (5.0 - 0.05); let depth_ms = match fx4_t { 4 => 6.0 * fx4_p2, 5 => 12.0 * fx4_p2, _ => 4.0 * fx4_p2 };
        if fx4_t == 3 {
          let (wet, _) = self.phaser4.process_one(out, out, self.sr, rate, fx4_p2, 1.0); out = out * (1.0 - fx4_mix) + wet * fx4_mix;
        } else {
          let base_ms = match fx4_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay4.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx4_mix) + wet * fx4_mix;
        }
        self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 6 {
        let dry = out; let drive_db = (fx4_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx4_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx4_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx4_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx4_mix) + shaped * fx4_mix; self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 7 {
        let dry = out; let drive = fx4_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx4_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx4_mix) + shaped * fx4_mix; self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 8 {
        if self.fx4_crusher.is_none() { self.fx4_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx4_crusher {
          let bits = 4.0 + fx4_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx4_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx4_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // EQ
      let q = 1.0_f32; let mut any_nonzero = false;
      for i in 0..8 {
        let db = params.get_f32_h(self.paths.eq_bands[i], 0.0).clamp(-12.0, 12.0);
        if (db - self.eq_last_db[i]).abs() > 1e-6 { self.eq_bands[i].set_peaking(self.sr, self.eq_centers[i], q, db); self.eq_last_db[i] = db; }
        if db.abs() > 1e-3 { any_nonzero = true; }
      }
      if any_nonzero { for i in 0..8 { out = self.eq_bands[i].process(out); } }
      // Mixer: PAN, VOLUME, HAAS, COMP
      let mut l = out; let mut r = out;
      let pan = params.get_f32_h(self.paths.mix_pan, 0.0).clamp(-1.0, 1.0);
      let theta = (pan + 1.0) * std::f32::consts::FRAC_PI_4; let gl = theta.cos(); let gr = theta.sin(); l *= gl; r *= gr;
      let vol = params.get_f32_h(self.paths.mix_volume, 1.0).clamp(0.0, 1.0); l *= vol; r *= vol;
      let haas = params.get_f32_h(self.paths.mix_haas, 0.0).clamp(0.0, 1.0);
      if haas > 0.0005 {
        let rd = if self.haas_wr >= self.haas_d { self.haas_wr - self.haas_d } else { self.haas_wr + self.haas_len - self.haas_d };
        let delayed_l = self.haas_buf[rd]; self.haas_buf[self.haas_wr] = l; self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; }
        l = l * (1.0 - haas) + delayed_l * haas;
      } else { self.haas_buf[self.haas_wr] = l; self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; } }
      let comp = params.get_f32_h(self.paths.mix_comp, 0.0).clamp(0.0, 1.0);
      if comp > 0.001 { let drive = 1.0 + 8.0 * comp; let id = 1.0 / drive.tanh(); l = (l * drive).tanh() * id; r = (r * drive).tanh() * id; }
      return (l, r);
    } else if module == 2 {
      // Karplus-Strong mono voice sample
      let s = self.karplus.render_one(params, &self.karplus_keys);
      // Early-out if dry is silent and all FX mixes are ~zero (no tails needed)
      let fx1_t_peek = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_mix_peek = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      let fx2_t_peek = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_mix_peek = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      let fx3_t_peek = params.get_i32_h(self.paths.fx3_type, 0);
      let fx3_mix_peek = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
      let fx4_t_peek = params.get_i32_h(self.paths.fx4_type, 0);
      let fx4_mix_peek = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
      if s.abs() < 1e-9 && (fx1_t_peek <= 0 || fx1_mix_peek <= 0.0005) && (fx2_t_peek <= 0 || fx2_mix_peek <= 0.0005) && (fx3_t_peek <= 0 || fx3_mix_peek <= 0.0005) && (fx4_t_peek <= 0 || fx4_mix_peek <= 0.0005) {
        return (0.0, 0.0);
      }
      // FX chain (identical to Analog and Acid)
      let mut out = s;
      let fx1_t = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_p1 = params.get_f32_h(self.paths.fx1_p1, 0.0);
      let fx1_p2 = params.get_f32_h(self.paths.fx1_p2, 0.0);
      let fx1_mix = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      if fx1_t <= 0 || fx1_mix <= 0.0005 {
        if fx1_t <= 0 { self.fx1_reverb = None; self.fx1_crusher = None; }
      } else if fx1_t == 2 {
        let time_ms = 10.0 + fx1_p1.clamp(0.0, 1.0) * 990.0;
        let fb = (fx1_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out];
        self.sdelay1.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx1_mix, false);
        out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 1 {
        if self.fx1_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize);
          rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          self.fx1_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx1_reverb {
          let room = 0.2 + fx1_p1.clamp(0.0, 1.0) * 0.8;
          let damp = 0.2 + fx1_p2.clamp(0.0, 1.0) * 0.8;
          let mix = fx1_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64));
          let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx1_wet_lp_l.set_hf_damp(lp_amt); self.fx1_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx1_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx1_wet_lp_r.tick(wr as f32) as f32;
          let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx1_t == 3 || fx1_t == 4 || fx1_t == 5 {
        let rate = 0.05 + fx1_p1 * (5.0 - 0.05);
        let depth_ms = match fx1_t { 4 => 6.0 * fx1_p2, 5 => 12.0 * fx1_p2, _ => 4.0 * fx1_p2 };
        if fx1_t == 3 {
          let (wet, _) = self.phaser1.process_one(out, out, self.sr, rate, fx1_p2, 1.0);
          out = out * (1.0 - fx1_mix) + wet * fx1_mix;
        } else {
          let base_ms = match fx1_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
          let (wet, _) = self.delay1.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
          out = out * (1.0 - fx1_mix) + wet * fx1_mix;
        }
        self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 6 {
        let dry = out; let drive_db = (fx1_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx1_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx1_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx1_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx1_mix) + shaped * fx1_mix; self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 7 {
        let dry = out; let drive = fx1_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx1_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx1_mix) + shaped * fx1_mix; self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 8 {
        if self.fx1_crusher.is_none() { self.fx1_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx1_crusher {
          let bits = 4.0 + fx1_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx1_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx1_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // FX2
      let fx2_t = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_p1 = params.get_f32_h(self.paths.fx2_p1, 0.0);
      let fx2_p2 = params.get_f32_h(self.paths.fx2_p2, 0.0);
      let fx2_mix = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      if fx2_t <= 0 || fx2_mix <= 0.0005 {
        if fx2_t <= 0 { self.fx2_reverb = None; self.fx2_crusher = None; }
      } else if fx2_t == 2 {
        let time_ms = 10.0 + fx2_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx2_p2.clamp(0.0, 1.0) * 0.95).min(0.95); let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay2.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx2_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]); self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 1 {
        if self.fx2_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx2_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx2_reverb {
          let room = 0.2 + fx2_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx2_p2.clamp(0.0, 1.0) * 0.8; let mix = fx2_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx2_wet_lp_l.set_hf_damp(lp_amt); self.fx2_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx2_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx2_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx2_t == 3 || fx2_t == 4 || fx2_t == 5 {
        let rate = 0.05 + fx2_p1 * (5.0 - 0.05); let depth_ms = match fx2_t { 4 => 6.0 * fx2_p2, 5 => 12.0 * fx2_p2, _ => 4.0 * fx2_p2 };
        if fx2_t == 3 {
          let (wet, _) = self.phaser2.process_one(out, out, self.sr, rate, fx2_p2, 1.0); out = out * (1.0 - fx2_mix) + wet * fx2_mix;
        } else {
          let base_ms = match fx2_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay2.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx2_mix) + wet * fx2_mix;
        }
        self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 6 {
        let dry = out; let drive_db = (fx2_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx2_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx2_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx2_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx2_mix) + shaped * fx2_mix; self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 7 {
        let dry = out; let drive = fx2_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx2_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx2_mix) + shaped * fx2_mix; self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 8 {
        if self.fx2_crusher.is_none() { self.fx2_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx2_crusher {
          let bits = 4.0 + fx2_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx2_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx2_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // FX3 chain
      let fx3_t = params.get_i32_h(self.paths.fx3_type, 0);
      let fx3_p1 = params.get_f32_h(self.paths.fx3_p1, 0.0);
      let fx3_p2 = params.get_f32_h(self.paths.fx3_p2, 0.0);
      let fx3_mix = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
      if fx3_t <= 0 || fx3_mix <= 0.0005 { if fx3_t <= 0 { self.fx3_reverb = None; self.fx3_crusher = None; } }
      else if fx3_t == 2 {
        let time_ms = 10.0 + fx3_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx3_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay3.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx3_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 1 {
        if self.fx3_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx3_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx3_reverb {
          let room = 0.2 + fx3_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx3_p2.clamp(0.0, 1.0) * 0.8; let mix = fx3_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx3_wet_lp_l.set_hf_damp(lp_amt); self.fx3_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx3_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx3_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx3_t == 3 || fx3_t == 4 || fx3_t == 5 {
        let rate = 0.05 + fx3_p1 * (5.0 - 0.05); let depth_ms = match fx3_t { 4 => 6.0 * fx3_p2, 5 => 12.0 * fx3_p2, _ => 4.0 * fx3_p2 };
        if fx3_t == 3 {
          let (wet, _) = self.phaser3.process_one(out, out, self.sr, rate, fx3_p2, 1.0); out = out * (1.0 - fx3_mix) + wet * fx3_mix;
        } else {
          let base_ms = match fx3_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay3.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx3_mix) + wet * fx3_mix;
        }
        self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 6 {
        let dry = out; let drive_db = (fx3_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx3_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx3_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx3_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx3_mix) + shaped * fx3_mix; self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 7 {
        let dry = out; let drive = fx3_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx3_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx3_mix) + shaped * fx3_mix; self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 8 {
        if self.fx3_crusher.is_none() { self.fx3_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx3_crusher {
          let bits = 4.0 + fx3_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx3_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx3_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // FX4 chain
      let fx4_t = params.get_i32_h(self.paths.fx4_type, 0);
      let fx4_p1 = params.get_f32_h(self.paths.fx4_p1, 0.0);
      let fx4_p2 = params.get_f32_h(self.paths.fx4_p2, 0.0);
      let fx4_mix = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
      if fx4_t <= 0 || fx4_mix <= 0.0005 { if fx4_t <= 0 { self.fx4_reverb = None; self.fx4_crusher = None; } }
      else if fx4_t == 2 {
        let time_ms = 10.0 + fx4_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx4_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay4.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx4_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 1 {
        if self.fx4_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx4_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx4_reverb {
          let room = 0.2 + fx4_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx4_p2.clamp(0.0, 1.0) * 0.8; let mix = fx4_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx4_wet_lp_l.set_hf_damp(lp_amt); self.fx4_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx4_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx4_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx4_t == 3 || fx4_t == 4 || fx4_t == 5 {
        let rate = 0.05 + fx4_p1 * (5.0 - 0.05); let depth_ms = match fx4_t { 4 => 6.0 * fx4_p2, 5 => 12.0 * fx4_p2, _ => 4.0 * fx4_p2 };
        if fx4_t == 3 {
          let (wet, _) = self.phaser4.process_one(out, out, self.sr, rate, fx4_p2, 1.0); out = out * (1.0 - fx4_mix) + wet * fx4_mix;
        } else {
          let base_ms = match fx4_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay4.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx4_mix) + wet * fx4_mix;
        }
        self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 6 {
        let dry = out; let drive_db = (fx4_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx4_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx4_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx4_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx4_mix) + shaped * fx4_mix; self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 7 {
        let dry = out; let drive = fx4_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx4_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx4_mix) + shaped * fx4_mix; self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 8 {
        if self.fx4_crusher.is_none() { self.fx4_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx4_crusher {
          let bits = 4.0 + fx4_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx4_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx4_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // EQ
      let q = 1.0_f32; let mut any_nonzero = false;
      for i in 0..8 {
        let db = params.get_f32_h(self.paths.eq_bands[i], 0.0).clamp(-12.0, 12.0);
        if (db - self.eq_last_db[i]).abs() > 1e-6 { self.eq_bands[i].set_peaking(self.sr, self.eq_centers[i], q, db); self.eq_last_db[i] = db; }
        if db.abs() > 1e-3 { any_nonzero = true; }
      }
      if any_nonzero { for i in 0..8 { out = self.eq_bands[i].process(out); } }
      // Mixer: PAN, VOLUME, HAAS, COMP
      let mut l = out; let mut r = out;
      let pan = params.get_f32_h(self.paths.mix_pan, 0.0).clamp(-1.0, 1.0);
      let theta = (pan + 1.0) * std::f32::consts::FRAC_PI_4; let gl = theta.cos(); let gr = theta.sin(); l *= gl; r *= gr;
      let vol = params.get_f32_h(self.paths.mix_volume, 1.0).clamp(0.0, 1.0); l *= vol; r *= vol;
      let haas = params.get_f32_h(self.paths.mix_haas, 0.0).clamp(0.0, 1.0);
      if haas > 0.0005 {
        let rd = if self.haas_wr >= self.haas_d { self.haas_wr - self.haas_d } else { self.haas_wr + self.haas_len - self.haas_d };
        let delayed_l = self.haas_buf[rd]; self.haas_buf[self.haas_wr] = l; self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; }
        l = l * (1.0 - haas) + delayed_l * haas;
      } else { self.haas_buf[self.haas_wr] = l; self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; } }
      let comp = params.get_f32_h(self.paths.mix_comp, 0.0).clamp(0.0, 1.0);
      if comp > 0.001 { let drive = 1.0 + 8.0 * comp; let id = 1.0 / drive.tanh(); l = (l * drive).tanh() * id; r = (r * drive).tanh() * id; }
      return (l, r);
    } else if module == 3 {
      // Resonator Bank mono voice sample
      let s = self.resonator.render_one(params, &self.resonator_keys);
      // Early-out if dry is silent and all FX mixes are ~zero (no tails needed)
      let fx1_t_peek = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_mix_peek = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      let fx2_t_peek = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_mix_peek = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      let fx3_t_peek = params.get_i32_h(self.paths.fx3_type, 0);
      let fx3_mix_peek = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
      let fx4_t_peek = params.get_i32_h(self.paths.fx4_type, 0);
      let fx4_mix_peek = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
      if s.abs() < 1e-9 && (fx1_t_peek <= 0 || fx1_mix_peek <= 0.0005) && (fx2_t_peek <= 0 || fx2_mix_peek <= 0.0005) && (fx3_t_peek <= 0 || fx3_mix_peek <= 0.0005) && (fx4_t_peek <= 0 || fx4_mix_peek <= 0.0005) {
        return (0.0, 0.0);
      }
      // FX chain (identical to other modules)
      let mut out = s;
      let fx1_t = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_p1 = params.get_f32_h(self.paths.fx1_p1, 0.0);
      let fx1_p2 = params.get_f32_h(self.paths.fx1_p2, 0.0);
      let fx1_mix = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      if fx1_t <= 0 || fx1_mix <= 0.0005 { if fx1_t <= 0 { self.fx1_reverb = None; self.fx1_crusher = None; } }
      else if fx1_t == 2 {
        let time_ms = fx1_p1.clamp(0.0, 1.0) * 50.0 + 1.0; let fb = (fx1_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out];
        self.sdelay1.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx1_mix, false);
        out = 0.5 * (lbuf[0] + rbuf[0]); self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 1 {
        if self.fx1_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize);
          rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          self.fx1_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx1_reverb {
          let room = 0.2 + fx1_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx1_p2.clamp(0.0, 1.0) * 0.8; let mix = fx1_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64));
          let lp_amt = 0.5 + 0.5 * (damp as f32); self.fx1_wet_lp_l.set_hf_damp(lp_amt); self.fx1_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx1_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx1_wet_lp_r.tick(wr as f32) as f32;
          let wet_m = 0.5 * (wet_l + wet_r); out = dry * (1.0 - mix) + wet_m * mix;
        } self.fx1_crusher = None;
      } else if fx1_t >= 3 && fx1_t <= 5 {
        let rate = (fx1_p1.clamp(0.0, 1.0) * 10.0 + 0.1).min(20.0); let depth_ms = fx1_p2.clamp(0.0, 1.0) * 5.0;
        let base_ms = match fx1_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
        let (wet, _) = self.delay1.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
        out = out * (1.0 - fx1_mix) + wet * fx1_mix; self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 6 {
        let dry = out; let drive_db = (fx1_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0);
        let x = (dry * g).tanh(); let tone = fx1_p2.clamp(0.0, 1.0);
        let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx1_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx1_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone;
        out = dry * (1.0 - fx1_mix) + shaped * fx1_mix; self.fx1_reverb = None;
      } else if fx1_t == 7 {
        let dry = out; let drive = fx1_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx1_p1.clamp(0.0, 1.0);
        let xin = dry * g;
        let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx1_mix) + shaped * fx1_mix; self.fx1_reverb = None;
      } else if fx1_t == 8 {
        if self.fx1_crusher.is_none() { self.fx1_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx1_crusher {
          let bits = 4.0 + fx1_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx1_p2.clamp(0.0, 1.0) * 15.0;
          cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx1_mix);
          let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // FX2 chain
      let fx2_t = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_p1 = params.get_f32_h(self.paths.fx2_p1, 0.0);
      let fx2_p2 = params.get_f32_h(self.paths.fx2_p2, 0.0);
      let fx2_mix = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      if fx2_t <= 0 || fx2_mix <= 0.0005 { if fx2_t <= 0 { self.fx2_reverb = None; self.fx2_crusher = None; } }
      else if fx2_t == 2 {
        let time_ms = fx2_p1.clamp(0.0, 1.0) * 50.0 + 1.0; let fb = (fx2_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out];
        self.sdelay2.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx2_mix, false);
        out = 0.5 * (lbuf[0] + rbuf[0]); self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 1 {
        if self.fx2_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize);
          rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          self.fx2_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx2_reverb {
          let room = 0.2 + fx2_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx2_p2.clamp(0.0, 1.0) * 0.8; let mix = fx2_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64));
          let lp_amt = 0.5 + 0.5 * (damp as f32); self.fx2_wet_lp_l.set_hf_damp(lp_amt); self.fx2_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx2_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx2_wet_lp_r.tick(wr as f32) as f32;
          let wet_m = 0.5 * (wet_l + wet_r); out = dry * (1.0 - mix) + wet_m * mix;
        } self.fx2_crusher = None;
      } else if fx2_t >= 3 && fx2_t <= 5 {
        let rate = (fx2_p1.clamp(0.0, 1.0) * 10.0 + 0.1).min(20.0); let depth_ms = fx2_p2.clamp(0.0, 1.0) * 5.0;
        let base_ms = match fx2_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
        let (wet, _) = self.delay2.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
        out = out * (1.0 - fx2_mix) + wet * fx2_mix; self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 6 {
        let dry = out; let drive_db = (fx2_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0);
        let x = (dry * g).tanh(); let tone = fx2_p2.clamp(0.0, 1.0);
        let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx2_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx2_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone;
        out = dry * (1.0 - fx2_mix) + shaped * fx2_mix; self.fx2_reverb = None;
      } else if fx2_t == 7 {
        let dry = out; let drive = fx2_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx2_p1.clamp(0.0, 1.0);
        let xin = dry * g;
        let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx2_mix) + shaped * fx2_mix; self.fx2_reverb = None;
      } else if fx2_t == 8 {
        if self.fx2_crusher.is_none() { self.fx2_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx2_crusher {
          let bits = 4.0 + fx2_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx2_p2.clamp(0.0, 1.0) * 15.0;
          cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx2_mix);
          let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // FX3 chain
      let fx3_t = params.get_i32_h(self.paths.fx3_type, 0);
      let fx3_p1 = params.get_f32_h(self.paths.fx3_p1, 0.0);
      let fx3_p2 = params.get_f32_h(self.paths.fx3_p2, 0.0);
      let fx3_mix = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
      if fx3_t <= 0 || fx3_mix <= 0.0005 { if fx3_t <= 0 { self.fx3_reverb = None; self.fx3_crusher = None; } }
      else if fx3_t == 2 {
        let time_ms = fx3_p1.clamp(0.0, 1.0) * 50.0 + 1.0; let fb = (fx3_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out];
        self.sdelay3.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx3_mix, false);
        out = 0.5 * (lbuf[0] + rbuf[0]); self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 1 {
        if self.fx3_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize);
          rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          self.fx3_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx3_reverb {
          let room = 0.2 + fx3_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx3_p2.clamp(0.0, 1.0) * 0.8; let mix = fx3_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64));
          let lp_amt = 0.5 + 0.5 * (damp as f32); self.fx3_wet_lp_l.set_hf_damp(lp_amt); self.fx3_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx3_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx3_wet_lp_r.tick(wr as f32) as f32;
          let wet_m = 0.5 * (wet_l + wet_r); out = dry * (1.0 - mix) + wet_m * mix;
        } self.fx3_crusher = None;
      } else if fx3_t >= 3 && fx3_t <= 5 {
        let rate = (fx3_p1.clamp(0.0, 1.0) * 10.0 + 0.1).min(20.0); let depth_ms = fx3_p2.clamp(0.0, 1.0) * 5.0;
        let base_ms = match fx3_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
        let (wet, _) = self.delay3.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
        out = out * (1.0 - fx3_mix) + wet * fx3_mix; self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 6 {
        let dry = out; let drive_db = (fx3_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0);
        let x = (dry * g).tanh(); let tone = fx3_p2.clamp(0.0, 1.0);
        let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx3_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx3_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone;
        out = dry * (1.0 - fx3_mix) + shaped * fx3_mix; self.fx3_reverb = None;
      } else if fx3_t == 7 {
        let dry = out; let drive = fx3_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx3_p1.clamp(0.0, 1.0);
        let xin = dry * g;
        let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx3_mix) + shaped * fx3_mix; self.fx3_reverb = None;
      } else if fx3_t == 8 {
        if self.fx3_crusher.is_none() { self.fx3_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx3_crusher {
          let bits = 4.0 + fx3_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx3_p2.clamp(0.0, 1.0) * 15.0;
          cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx3_mix);
          let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // FX4 chain
      let fx4_t = params.get_i32_h(self.paths.fx4_type, 0);
      let fx4_p1 = params.get_f32_h(self.paths.fx4_p1, 0.0);
      let fx4_p2 = params.get_f32_h(self.paths.fx4_p2, 0.0);
      let fx4_mix = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
      if fx4_t <= 0 || fx4_mix <= 0.0005 { if fx4_t <= 0 { self.fx4_reverb = None; self.fx4_crusher = None; } }
      else if fx4_t == 2 {
        let time_ms = fx4_p1.clamp(0.0, 1.0) * 50.0 + 1.0; let fb = (fx4_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out];
        self.sdelay4.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx4_mix, false);
        out = 0.5 * (lbuf[0] + rbuf[0]); self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 1 {
        if self.fx4_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize);
          rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          self.fx4_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx4_reverb {
          let room = 0.2 + fx4_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx4_p2.clamp(0.0, 1.0) * 0.8; let mix = fx4_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64));
          let lp_amt = 0.5 + 0.5 * (damp as f32); self.fx4_wet_lp_l.set_hf_damp(lp_amt); self.fx4_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx4_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx4_wet_lp_r.tick(wr as f32) as f32;
          let wet_m = 0.5 * (wet_l + wet_r); out = dry * (1.0 - mix) + wet_m * mix;
        } self.fx4_crusher = None;
      } else if fx4_t >= 3 && fx4_t <= 5 {
        let rate = (fx4_p1.clamp(0.0, 1.0) * 10.0 + 0.1).min(20.0); let depth_ms = fx4_p2.clamp(0.0, 1.0) * 5.0;
        let base_ms = match fx4_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
        let (wet, _) = self.delay4.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
        out = out * (1.0 - fx4_mix) + wet * fx4_mix; self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 6 {
        let dry = out; let drive_db = (fx4_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0);
        let x = (dry * g).tanh(); let tone = fx4_p2.clamp(0.0, 1.0);
        let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx4_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx4_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone;
        out = dry * (1.0 - fx4_mix) + shaped * fx4_mix; self.fx4_reverb = None;
      } else if fx4_t == 7 {
        let dry = out; let drive = fx4_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx4_p1.clamp(0.0, 1.0);
        let xin = dry * g;
        let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx4_mix) + shaped * fx4_mix; self.fx4_reverb = None;
      } else if fx4_t == 8 {
        if self.fx4_crusher.is_none() { self.fx4_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx4_crusher {
          let bits = 4.0 + fx4_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx4_p2.clamp(0.0, 1.0) * 15.0;
          cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx4_mix);
          let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // Post-mix processing
      let mut l = out; let mut r = out;
      let pan = params.get_f32_h(self.paths.mix_pan, 0.0);
      if pan.abs() > 0.001 {
        let p = pan.clamp(-1.0, 1.0); let gl = ((1.0 - p) * 0.5).sqrt(); let gr = ((1.0 + p) * 0.5).sqrt();
        l *= gl; r *= gr;
      }
      let width = params.get_f32_h(self.paths.mix_width, 0.0).clamp(0.0, 1.0);
      if width > 0.001 {
        let mid = 0.5 * (l + r); let side = 0.5 * (l - r);
        let (low_s, _, _, _) = self.eq_lp.process(side); let (_, high_s, _, _) = self.eq_hp.process(side);
        let enh_s = low_s * (1.0 - width * 0.3) + high_s * (1.0 + width * 0.7);
        l = mid + enh_s; r = mid - enh_s;
      }
      let haas = params.get_f32_h(self.paths.mix_haas, 0.0).clamp(0.0, 1.0);
      if haas > 0.001 && self.haas_d > 0 {
        let rd = (self.haas_wr + self.haas_len - self.haas_d) % self.haas_len;
        let delayed_l = self.haas_buf[rd]; self.haas_buf[self.haas_wr] = l; self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; }
        l = l * (1.0 - haas) + delayed_l * haas;
      } else { self.haas_buf[self.haas_wr] = l; self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; } }
      let comp = params.get_f32_h(self.paths.mix_comp, 0.0).clamp(0.0, 1.0);
      if comp > 0.001 { let drive = 1.0 + 8.0 * comp; let id = 1.0 / drive.tanh(); l = (l * drive).tanh() * id; r = (r * drive).tanh() * id; }
      return (l, r);
  } else if module == 4 {
      // Sampler mono voice sample
      let s = self.sampler.render_one(params, &self.sampler_keys, beat_phase);
      // Early-out if dry is silent and all FX mixes are ~zero (no tails needed)
      let fx1_t_peek = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_mix_peek = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      let fx2_t_peek = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_mix_peek = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      let fx3_t_peek = params.get_i32_h(self.paths.fx3_type, 0);
      let fx3_mix_peek = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
      let fx4_t_peek = params.get_i32_h(self.paths.fx4_type, 0);
      let fx4_mix_peek = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
      if s.abs() < 1e-9 && (fx1_t_peek <= 0 || fx1_mix_peek <= 0.0005) && (fx2_t_peek <= 0 || fx2_mix_peek <= 0.0005) && (fx3_t_peek <= 0 || fx3_mix_peek <= 0.0005) && (fx4_t_peek <= 0 || fx4_mix_peek <= 0.0005) {
        return (0.0, 0.0);
      }
      // Full FX chain + EQ + Mixer, same as other modules
      let mut out = s;
      // FX1
      let fx1_t = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_p1 = params.get_f32_h(self.paths.fx1_p1, 0.0);
      let fx1_p2 = params.get_f32_h(self.paths.fx1_p2, 0.0);
      let fx1_mix = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      if fx1_t <= 0 || fx1_mix <= 0.0005 {
        if fx1_t <= 0 { self.fx1_reverb = None; self.fx1_crusher = None; }
      } else if fx1_t == 2 {
        let time_ms = 10.0 + fx1_p1.clamp(0.0, 1.0) * 990.0;
        let fb = (fx1_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out];
        self.sdelay1.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx1_mix, false);
        out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 1 {
        if self.fx1_reverb.is_none() {
          let mut rv = Freeverb::new(self.sr as usize);
          rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          self.fx1_reverb = Some(rv);
        }
        if let Some(rv) = &mut self.fx1_reverb {
          let room = 0.2 + fx1_p1.clamp(0.0, 1.0) * 0.8;
          let damp = 0.2 + fx1_p2.clamp(0.0, 1.0) * 0.8;
          let mix = fx1_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64));
          let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx1_wet_lp_l.set_hf_damp(lp_amt); self.fx1_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx1_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx1_wet_lp_r.tick(wr as f32) as f32;
          let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx1_t == 3 || fx1_t == 4 || fx1_t == 5 {
        let rate = 0.05 + fx1_p1 * (5.0 - 0.05);
        let depth_ms = match fx1_t { 4 => 6.0 * fx1_p2, 5 => 12.0 * fx1_p2, _ => 4.0 * fx1_p2 };
        if fx1_t == 3 {
          let (wet, _) = self.phaser1.process_one(out, out, self.sr, rate, fx1_p2, 1.0);
          out = out * (1.0 - fx1_mix) + wet * fx1_mix;
        } else {
          let base_ms = match fx1_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
          let (wet, _) = self.delay1.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
          out = out * (1.0 - fx1_mix) + wet * fx1_mix;
        }
        self.fx1_reverb = None; self.fx1_crusher = None;
      } else if fx1_t == 6 {
        let dry = out; let drive_db = (fx1_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx1_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx1_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx1_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx1_mix) + shaped * fx1_mix; self.fx1_reverb = None;
      } else if fx1_t == 7 {
        let dry = out; let drive = fx1_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx1_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx1_mix) + shaped * fx1_mix; self.fx1_reverb = None;
      } else if fx1_t == 8 {
        if self.fx1_crusher.is_none() { self.fx1_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx1_crusher {
          let bits = 4.0 + fx1_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx1_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx1_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]);
        }
      }
      // FX2
      let fx2_t = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_p1 = params.get_f32_h(self.paths.fx2_p1, 0.0);
      let fx2_p2 = params.get_f32_h(self.paths.fx2_p2, 0.0);
      let fx2_mix = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      if fx2_t <= 0 || fx2_mix <= 0.0005 { if fx2_t <= 0 { self.fx2_reverb = None; self.fx2_crusher = None; } }
      else if fx2_t == 2 {
        let time_ms = 10.0 + fx2_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx2_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay2.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx2_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 1 {
        if self.fx2_reverb.is_none() { let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx2_reverb = Some(rv); }
        if let Some(rv) = &mut self.fx2_reverb {
          let room = 0.2 + fx2_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx2_p2.clamp(0.0, 1.0) * 0.8; let mix = fx2_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx2_wet_lp_l.set_hf_damp(lp_amt); self.fx2_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx2_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx2_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx2_t == 3 || fx2_t == 4 || fx2_t == 5 {
        let rate = 0.05 + fx2_p1 * (5.0 - 0.05); let depth_ms = match fx2_t { 4 => 6.0 * fx2_p2, 5 => 12.0 * fx2_p2, _ => 4.0 * fx2_p2 };
        if fx2_t == 3 { let (wet, _) = self.phaser2.process_one(out, out, self.sr, rate, fx2_p2, 1.0); out = out * (1.0 - fx2_mix) + wet * fx2_mix; }
        else { let base_ms = match fx2_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay2.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx2_mix) + wet * fx2_mix; }
        self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 6 {
        let dry = out; let drive_db = (fx2_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx2_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx2_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx2_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx2_mix) + shaped * fx2_mix; self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 7 {
        let dry = out; let drive = fx2_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx2_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx2_mix) + shaped * fx2_mix; self.fx2_reverb = None; self.fx2_crusher = None;
      } else if fx2_t == 8 {
        if self.fx2_crusher.is_none() { self.fx2_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx2_crusher { let bits = 4.0 + fx2_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx2_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx2_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]); }
      }
      // FX3
      let fx3_t = params.get_i32_h(self.paths.fx3_type, 0);
      let fx3_p1 = params.get_f32_h(self.paths.fx3_p1, 0.0);
      let fx3_p2 = params.get_f32_h(self.paths.fx3_p2, 0.0);
      let fx3_mix = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
      if fx3_t <= 0 || fx3_mix <= 0.0005 { if fx3_t <= 0 { self.fx3_reverb = None; self.fx3_crusher = None; } }
      else if fx3_t == 2 {
        let time_ms = 10.0 + fx3_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx3_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay3.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx3_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 1 {
        if self.fx3_reverb.is_none() { let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx3_reverb = Some(rv); }
        if let Some(rv) = &mut self.fx3_reverb {
          let room = 0.2 + fx3_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx3_p2.clamp(0.0, 1.0) * 0.8; let mix = fx3_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx3_wet_lp_l.set_hf_damp(lp_amt); self.fx3_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx3_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx3_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx3_t == 3 || fx3_t == 4 || fx3_t == 5 {
        let rate = 0.05 + fx3_p1 * (5.0 - 0.05); let depth_ms = match fx3_t { 4 => 6.0 * fx3_p2, 5 => 12.0 * fx3_p2, _ => 4.0 * fx3_p2 };
        if fx3_t == 3 { let (wet, _) = self.phaser3.process_one(out, out, self.sr, rate, fx3_p2, 1.0); out = out * (1.0 - fx3_mix) + wet * fx3_mix; }
        else { let base_ms = match fx3_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay3.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx3_mix) + wet * fx3_mix; }
        self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 6 {
        let dry = out; let drive_db = (fx3_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx3_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx3_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx3_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx3_mix) + shaped * fx3_mix; self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 7 {
        let dry = out; let drive = fx3_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx3_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx3_mix) + shaped * fx3_mix; self.fx3_reverb = None; self.fx3_crusher = None;
      } else if fx3_t == 8 {
        if self.fx3_crusher.is_none() { self.fx3_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx3_crusher { let bits = 4.0 + fx3_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx3_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx3_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]); }
      }
      // FX4
      let fx4_t = params.get_i32_h(self.paths.fx4_type, 0);
      let fx4_p1 = params.get_f32_h(self.paths.fx4_p1, 0.0);
      let fx4_p2 = params.get_f32_h(self.paths.fx4_p2, 0.0);
      let fx4_mix = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
      if fx4_t <= 0 || fx4_mix <= 0.0005 { if fx4_t <= 0 { self.fx4_reverb = None; self.fx4_crusher = None; } }
      else if fx4_t == 2 {
        let time_ms = 10.0 + fx4_p1.clamp(0.0, 1.0) * 990.0; let fb = (fx4_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay4.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx4_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
        self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 1 {
        if self.fx4_reverb.is_none() { let mut rv = Freeverb::new(self.sr as usize); rv.set_room_size(0.35); rv.set_dampening(0.6); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9); self.fx4_reverb = Some(rv); }
        if let Some(rv) = &mut self.fx4_reverb {
          let room = 0.2 + fx4_p1.clamp(0.0, 1.0) * 0.8; let damp = 0.2 + fx4_p2.clamp(0.0, 1.0) * 0.8; let mix = fx4_mix;
          rv.set_room_size(room as f64); rv.set_dampening(damp as f64); rv.set_wet(1.0); rv.set_dry(0.0); rv.set_width(0.9);
          let dry = out; let (wl, wr) = rv.tick((dry as f64, dry as f64)); let lp_amt = 0.5 + 0.5 * (damp as f32);
          self.fx4_wet_lp_l.set_hf_damp(lp_amt); self.fx4_wet_lp_r.set_hf_damp(lp_amt);
          let wet_l = self.fx4_wet_lp_l.tick(wl as f32) as f32; let wet_r = self.fx4_wet_lp_r.tick(wr as f32) as f32; let wet_m = 0.5 * (wet_l + wet_r);
          out = dry * (1.0 - mix) + wet_m * mix;
        }
      } else if fx4_t == 3 || fx4_t == 4 || fx4_t == 5 {
        let rate = 0.05 + fx4_p1 * (5.0 - 0.05); let depth_ms = match fx4_t { 4 => 6.0 * fx4_p2, 5 => 12.0 * fx4_p2, _ => 4.0 * fx4_p2 };
        if fx4_t == 3 { let (wet, _) = self.phaser4.process_one(out, out, self.sr, rate, fx4_p2, 1.0); out = out * (1.0 - fx4_mix) + wet * fx4_mix; }
        else { let base_ms = match fx4_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay4.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx4_mix) + wet * fx4_mix; }
        self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 6 {
        let dry = out; let drive_db = (fx4_p1.clamp(0.0, 1.0)) * 20.0; let g = (10.0_f32).powf(drive_db / 20.0); let x = (dry * g).tanh();
        let tone = fx4_p2.clamp(0.0, 1.0); let lp_amt = 0.3 + 0.6 * (1.0 - tone); self.fx4_wet_lp_l.set_hf_damp(lp_amt);
        let y_lp = self.fx4_wet_lp_l.tick(x); let y_hp = x - y_lp; let shaped = y_lp * (1.0 - tone) + y_hp * tone; out = dry * (1.0 - fx4_mix) + shaped * fx4_mix; self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 7 {
        let dry = out; let drive = fx4_p2.clamp(0.0, 1.0) * 10.0; let g = 1.0 + drive; let cur = fx4_p1.clamp(0.0, 1.0);
        let xin = dry * g; let shaped = if cur < 0.34 { xin.tanh() } else if cur < 0.67 { xin.clamp(-1.0, 1.0) } else { let m = (xin + 1.0).abs().rem_euclid(4.0); ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0) };
        out = dry * (1.0 - fx4_mix) + shaped * fx4_mix; self.fx4_reverb = None; self.fx4_crusher = None;
      } else if fx4_t == 8 {
        if self.fx4_crusher.is_none() { self.fx4_crusher = Some(Bitcrusher::new()); }
        if let Some(cr) = &mut self.fx4_crusher { let bits = 4.0 + fx4_p1.clamp(0.0, 1.0) * 12.0; let fac = 1.0 + fx4_p2.clamp(0.0, 1.0) * 15.0; cr.set_bits(bits as u8); cr.set_factor(fac as u32); cr.set_mix(fx4_mix); let mut lbuf = [out]; let mut rbuf = [out]; cr.process(&mut lbuf, &mut rbuf); out = 0.5 * (lbuf[0] + rbuf[0]); }
      }
      // EQ: 8-band peaking
      let q = 1.0_f32; let mut any_nonzero = false;
      for i in 0..8 {
        let db = params.get_f32_h(self.paths.eq_bands[i], 0.0).clamp(-12.0, 12.0);
        if (db - self.eq_last_db[i]).abs() > 1e-6 { self.eq_bands[i].set_peaking(self.sr, self.eq_centers[i], q, db); self.eq_last_db[i] = db; }
        if db.abs() > 1e-3 { any_nonzero = true; }
      }
      if any_nonzero { for i in 0..8 { out = self.eq_bands[i].process(out); } }
      // Mixer: PAN, VOLUME, HAAS, COMP
      let mut l = out; let mut r = out;
      let pan = params.get_f32_h(self.paths.mix_pan, 0.0).clamp(-1.0, 1.0);
      let theta = (pan + 1.0) * std::f32::consts::FRAC_PI_4; let gl = theta.cos(); let gr = theta.sin(); l *= gl; r *= gr;
      let vol = params.get_f32_h(self.paths.mix_volume, 1.0).clamp(0.0, 1.0); l *= vol; r *= vol;
      let haas = params.get_f32_h(self.paths.mix_haas, 0.0).clamp(0.0, 1.0);
      if haas > 0.0005 {
        let rd = if self.haas_wr >= self.haas_d { self.haas_wr - self.haas_d } else { self.haas_wr + self.haas_len - self.haas_d };
        let delayed_l = self.haas_buf[rd]; self.haas_buf[self.haas_wr] = l; self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; }
        l = l * (1.0 - haas) + delayed_l * haas;
      } else { self.haas_buf[self.haas_wr] = l; self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; } }
      let comp = params.get_f32_h(self.paths.mix_comp, 0.0).clamp(0.0, 1.0);
      if comp > 0.001 { let drive = 1.0 + 8.0 * comp; let id = 1.0 / drive.tanh(); l = (l * drive).tanh() * id; r = (r * drive).tanh() * id; }
      return (l, r);
  } else {
      // Analog voices (module == 0)
      // Compute LFO sample every sample; apply global depth with internal smoothing
    let shape = params.get_i32_h(self.paths.lfo_shape, 0);
    let rate_hz = params.get_f32_h(self.paths.lfo_rate_hz, 1.0).max(0.01);
    self.lfo_phase = (self.lfo_phase + rate_hz / self.sr).fract();
    let x = self.lfo_phase;
    let mut lfo_val = match shape { 1 => 2.0*(x - (x+0.5).floor()).abs() - 1.0, 2 => if x < 0.5 { 1.0 } else { -1.0 }, 3 => 2.0*x - 1.0, _ => (2.0*PI*x).sin() };
    let drive = params.get_f32_h(self.paths.lfo_drive, 0.0);
    if drive > 0.001 { let k = 1.0 + 8.0*drive; lfo_val = (lfo_val*k).tanh() / k.tanh(); }
    let target_amt = params.get_f32_h(self.paths.lfo_amount, 1.0).clamp(0.0, 1.0);
    // simple de-zipper (~10ms): alpha = 1 - exp(-1/(ms*sr)) 
  let alpha = 1.0 - (-1.0f32/(0.01*self.sr)).exp();
    self.lfo_hold += (target_amt - self.lfo_hold) * alpha;
    let modv = lfo_val * self.lfo_hold;
    let mut modf = ModFrame { cents_a: 0.0, cents_b: 0.0, lvl_a: 0.0, lvl_b: 0.0, filt1: 0.0, filt2: 0.0 };
    for i in 0..5 {
      let dest = params.get_i32_h(self.paths.lfo_dest[i], 0) as u16;
      if dest == 0 { continue; }
      let row_amt = params.get_f32_h(self.paths.lfo_row_amount[i], 1.0).clamp(-1.0, 1.0);
      let v = modv * row_amt;
      match dest {
        1 => modf.cents_a += 100.0 * v,
        2 => modf.cents_b += 100.0 * v,
        3 => modf.lvl_a += v,
        4 => modf.lvl_b += v,
        5 => modf.filt1 += v,
        6 => modf.filt2 += v,
        _ => {}
      }
    }
    let mut s = 0.0f32;
    for v in &mut self.voices { if v.is_active() { s += v.render(params, &self.paths, self.sr, &modf); } }
    // Early-out if dry is silent and all FX mixes are ~zero (no tails needed)
    let fx1_t_peek = params.get_i32_h(self.paths.fx1_type, 0);
    let fx1_mix_peek = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
    let fx2_t_peek = params.get_i32_h(self.paths.fx2_type, 0);
    let fx2_mix_peek = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
    let fx3_t_peek = params.get_i32_h(self.paths.fx3_type, 0);
    let fx3_mix_peek = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
    let fx4_t_peek = params.get_i32_h(self.paths.fx4_type, 0);
    let fx4_mix_peek = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
    if s.abs() < 1e-9 && (fx1_t_peek <= 0 || fx1_mix_peek <= 0.0005) && (fx2_t_peek <= 0 || fx2_mix_peek <= 0.0005) && (fx3_t_peek <= 0 || fx3_mix_peek <= 0.0005) && (fx4_t_peek <= 0 || fx4_mix_peek <= 0.0005) {
      return (0.0, 0.0);
    }
    // FX1
    let mut out = s;
    let fx1_t = params.get_i32_h(self.paths.fx1_type, 0);
    let fx1_p1 = params.get_f32_h(self.paths.fx1_p1, 0.0);
    let fx1_p2 = params.get_f32_h(self.paths.fx1_p2, 0.0);
    let fx1_mix = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
    if fx1_t <= 0 || fx1_mix <= 0.0005 {
      // No Effect
      if fx1_t <= 0 { self.fx1_reverb = None; self.fx1_crusher = None; }
    } else if fx1_t == 2 {
      // Delay: p1->time_ms (10..1000), p2->feedback, p3->mix
      let time_ms = 10.0 + fx1_p1.clamp(0.0, 1.0) * 990.0;
      let fb = (fx1_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
      let mix = fx1_mix;
      let mut lbuf = [out];
      let mut rbuf = [out];
      self.sdelay1.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, mix, false);
      out = 0.5 * (lbuf[0] + rbuf[0]);
      self.fx1_reverb = None; self.fx1_crusher = None;
    } else if fx1_t == 1 {
      // Reverb (Freeverb): p1->room size, p2->damping, p3->mix
      if self.fx1_reverb.is_none() {
        let mut rv = Freeverb::new(self.sr as usize);
        rv.set_room_size(0.35);
        rv.set_dampening(0.6);
        rv.set_wet(1.0);
        rv.set_dry(0.0);
        rv.set_width(0.9);
        self.fx1_reverb = Some(rv);
      }
      if let Some(rv) = &mut self.fx1_reverb {
        // Map for a smoother, less metallic character
        let room = 0.2 + fx1_p1.clamp(0.0, 1.0) * 0.8;   // avoid tiny rooms
        let damp = 0.2 + fx1_p2.clamp(0.0, 1.0) * 0.8;   // stronger HF damping baseline
        let mix = fx1_mix;
        rv.set_room_size(room as f64);
        rv.set_dampening(damp as f64);
        // Use pure-wet from Freeverb, mix externally (allows extra LPF on wet)
        rv.set_wet(1.0);
        rv.set_dry(0.0);
        rv.set_width(0.9);
        let dry = out;
        let (wl, wr) = rv.tick((dry as f64, dry as f64));
        // Gentle LPF on wet to reduce metallic sheen (tie amount to damping)
        let lp_amt = 0.5 + 0.5 * (damp as f32);
        self.fx1_wet_lp_l.set_hf_damp(lp_amt);
        self.fx1_wet_lp_r.set_hf_damp(lp_amt);
        let wet_l = self.fx1_wet_lp_l.tick(wl as f32) as f32;
        let wet_r = self.fx1_wet_lp_r.tick(wr as f32) as f32;
        let wet_m = 0.5 * (wet_l + wet_r);
        out = dry * (1.0 - mix) + wet_m * mix;
      }
    } else if fx1_t == 3 || fx1_t == 4 || fx1_t == 5 {
      // Chorus/Flanger/Phaser approximate: modulated short delay
      let rate = 0.05 + fx1_p1 * (5.0 - 0.05);
      let depth_ms = match fx1_t { 4 => 6.0 * fx1_p2, 5 => 12.0 * fx1_p2, _ => 4.0 * fx1_p2 };
      if fx1_t == 3 {
        let (wet, _) = self.phaser1.process_one(out, out, self.sr, rate, fx1_p2, 1.0);
        out = out * (1.0 - fx1_mix) + wet * fx1_mix;
      } else {
        let base_ms = match fx1_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
        let (wet, _) = self.delay1.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
        out = out * (1.0 - fx1_mix) + wet * fx1_mix;
      }
      self.fx1_reverb = None; self.fx1_crusher = None;
    } else if fx1_t == 6 {
      // Distortion: Drive (0..20 dB), Tone (LP<->HP), Mix
      let dry = out;
      let drive_db = (fx1_p1.clamp(0.0, 1.0)) * 20.0;
      let g = (10.0_f32).powf(drive_db / 20.0);
      let x = (dry * g).tanh();
      let tone = fx1_p2.clamp(0.0, 1.0);
      let lp_amt = 0.3 + 0.6 * (1.0 - tone);
      self.fx1_wet_lp_l.set_hf_damp(lp_amt);
      let y_lp = self.fx1_wet_lp_l.tick(x);
      let y_hp = x - y_lp;
      let shaped = y_lp * (1.0 - tone) + y_hp * tone;
      out = dry * (1.0 - fx1_mix) + shaped * fx1_mix;
      self.fx1_reverb = None;
    } else if fx1_t == 7 {
      // Waveshaper: Curve (tanh/clip/fold), Drive (0..10), Mix
      let dry = out;
      let drive = fx1_p2.clamp(0.0, 1.0) * 10.0;
      let g = 1.0 + drive;
      let cur = fx1_p1.clamp(0.0, 1.0);
      let xin = dry * g;
      let shaped = if cur < 0.34 {
        xin.tanh()
      } else if cur < 0.67 {
        xin.clamp(-1.0, 1.0)
      } else {
        // foldback
        let m = (xin + 1.0).abs().rem_euclid(4.0);
        ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0)
      };
      out = dry * (1.0 - fx1_mix) + shaped * fx1_mix;
      self.fx1_reverb = None;
    } else if fx1_t == 8 {
      if self.fx1_crusher.is_none() { self.fx1_crusher = Some(Bitcrusher::new()); }
      if let Some(cr) = &mut self.fx1_crusher {
        let bits = 4.0 + fx1_p1.clamp(0.0, 1.0) * 12.0;
        let fac = 1.0 + fx1_p2.clamp(0.0, 1.0) * 15.0;
        cr.set_bits(bits as u8);
        cr.set_factor(fac as u32);
        cr.set_mix(fx1_mix);
        let mut lbuf = [out]; let mut rbuf = [out];
        cr.process(&mut lbuf, &mut rbuf);
        out = 0.5 * (lbuf[0] + rbuf[0]);
      }
    }
    // FX2
    let fx2_t = params.get_i32_h(self.paths.fx2_type, 0);
    let fx2_p1 = params.get_f32_h(self.paths.fx2_p1, 0.0);
    let fx2_p2 = params.get_f32_h(self.paths.fx2_p2, 0.0);
    let fx2_mix = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
    if fx2_t <= 0 || fx2_mix <= 0.0005 {
      // No Effect
      if fx2_t <= 0 { self.fx2_reverb = None; self.fx2_crusher = None; }
    } else if fx2_t == 2 {
      let time_ms = 10.0 + fx2_p1.clamp(0.0, 1.0) * 990.0;
      let fb = (fx2_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
      let mix = fx2_mix;
      let mut lbuf = [out];
      let mut rbuf = [out];
      // Ping-pong optional; set true here if stereo pipeline is used earlier
      self.sdelay2.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, mix, false);
      out = 0.5 * (lbuf[0] + rbuf[0]);
      self.fx2_reverb = None; self.fx2_crusher = None;
    } else if fx2_t == 1 {
      if self.fx2_reverb.is_none() {
        let mut rv = Freeverb::new(self.sr as usize);
        rv.set_room_size(0.35);
        rv.set_dampening(0.6);
        rv.set_wet(1.0);
        rv.set_dry(0.0);
        rv.set_width(0.9);
        self.fx2_reverb = Some(rv);
      }
      if let Some(rv) = &mut self.fx2_reverb {
        let room = 0.2 + fx2_p1.clamp(0.0, 1.0) * 0.8;
        let damp = 0.2 + fx2_p2.clamp(0.0, 1.0) * 0.8;
        let mix = fx2_mix;
        rv.set_room_size(room as f64);
        rv.set_dampening(damp as f64);
        rv.set_wet(1.0);
        rv.set_dry(0.0);
        rv.set_width(0.9);
        let dry = out;
        let (wl, wr) = rv.tick((dry as f64, dry as f64));
        let lp_amt = 0.5 + 0.5 * (damp as f32);
        self.fx2_wet_lp_l.set_hf_damp(lp_amt);
        self.fx2_wet_lp_r.set_hf_damp(lp_amt);
        let wet_l = self.fx2_wet_lp_l.tick(wl as f32) as f32;
        let wet_r = self.fx2_wet_lp_r.tick(wr as f32) as f32;
        let wet_m = 0.5 * (wet_l + wet_r);
      out = dry * (1.0 - mix) + wet_m * mix;
      }
    } else if fx2_t == 3 || fx2_t == 4 || fx2_t == 5 {
      let rate = 0.05 + fx2_p1 * (5.0 - 0.05);
      let depth_ms = match fx2_t { 4 => 6.0 * fx2_p2, 5 => 12.0 * fx2_p2, _ => 4.0 * fx2_p2 };
      if fx2_t == 3 {
        let (wet, _) = self.phaser2.process_one(out, out, self.sr, rate, fx2_p2, 1.0);
        out = out * (1.0 - fx2_mix) + wet * fx2_mix;
      } else {
        let base_ms = match fx2_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
        let (wet, _) = self.delay2.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
        out = out * (1.0 - fx2_mix) + wet * fx2_mix;
      }
      self.fx2_reverb = None; self.fx2_crusher = None;
    } else if fx2_t == 6 {
      // Distortion
      let dry = out;
      let drive_db = (fx2_p1.clamp(0.0, 1.0)) * 20.0;
      let g = (10.0_f32).powf(drive_db / 20.0);
      let x = (dry * g).tanh();
      let tone = fx2_p2.clamp(0.0, 1.0);
      let lp_amt = 0.3 + 0.6 * (1.0 - tone);
      self.fx2_wet_lp_l.set_hf_damp(lp_amt);
      let y_lp = self.fx2_wet_lp_l.tick(x);
      let y_hp = x - y_lp;
      let shaped = y_lp * (1.0 - tone) + y_hp * tone;
      out = dry * (1.0 - fx2_mix) + shaped * fx2_mix;
      self.fx2_reverb = None; self.fx2_crusher = None;
    } else if fx2_t == 7 {
      // Waveshaper
      let dry = out;
      let drive = fx2_p2.clamp(0.0, 1.0) * 10.0;
      let g = 1.0 + drive;
      let cur = fx2_p1.clamp(0.0, 1.0);
      let xin = dry * g;
      let shaped = if cur < 0.34 {
        xin.tanh()
      } else if cur < 0.67 {
        xin.clamp(-1.0, 1.0)
      } else {
        let m = (xin + 1.0).abs().rem_euclid(4.0);
        ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0)
      };
      out = dry * (1.0 - fx2_mix) + shaped * fx2_mix;
      self.fx2_reverb = None; self.fx2_crusher = None;
    } else if fx2_t == 8 {
      if self.fx2_crusher.is_none() { self.fx2_crusher = Some(Bitcrusher::new()); }
      if let Some(cr) = &mut self.fx2_crusher {
        let bits = 4.0 + fx2_p1.clamp(0.0, 1.0) * 12.0;
        let fac = 1.0 + fx2_p2.clamp(0.0, 1.0) * 15.0;
        cr.set_bits(bits as u8);
        cr.set_factor(fac as u32);
        cr.set_mix(fx2_mix);
        let mut lbuf = [out]; let mut rbuf = [out];
        cr.process(&mut lbuf, &mut rbuf);
        out = 0.5 * (lbuf[0] + rbuf[0]);
      }
    }
    // FX3
    let fx3_t = params.get_i32_h(self.paths.fx3_type, 0);
    let fx3_p1 = params.get_f32_h(self.paths.fx3_p1, 0.0);
    let fx3_p2 = params.get_f32_h(self.paths.fx3_p2, 0.0);
    let fx3_mix = params.get_f32_h(self.paths.fx3_p3, 0.0).clamp(0.0, 1.0);
    if fx3_t <= 0 || fx3_mix <= 0.0005 {
      // No Effect
      if fx3_t <= 0 { self.fx3_reverb = None; self.fx3_crusher = None; }
    } else if fx3_t == 2 {
      // Simple delay
      let time_ms = 10.0 + fx3_p1.clamp(0.0, 1.0) * 990.0;
      let fb = (fx3_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
      let mut lbuf = [out]; let mut rbuf = [out];
      self.sdelay3.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx3_mix, false);
      out = 0.5 * (lbuf[0] + rbuf[0]);
      self.fx3_reverb = None; self.fx3_crusher = None;
    } else if fx3_t == 1 {
      // Reverb: Room, Damp, Mix
      if self.fx3_reverb.is_none() {
        let mut rv = Freeverb::new(self.sr as usize);
        rv.set_room_size(0.35);
        rv.set_dampening(0.6);
        rv.set_wet(1.0);
        rv.set_dry(0.0);
        rv.set_width(0.9);
        self.fx3_reverb = Some(rv);
      }
      if let Some(rv) = &mut self.fx3_reverb {
        let room = 0.2 + fx3_p1.clamp(0.0, 1.0) * 0.8;
        let damp = 0.2 + fx3_p2.clamp(0.0, 1.0) * 0.8;
        let mix = fx3_mix;
        rv.set_room_size(room as f64);
        rv.set_dampening(damp as f64);
        rv.set_wet(1.0);
        rv.set_dry(0.0);
        rv.set_width(0.9);
        let dry = out;
        let (wl, wr) = rv.tick((dry as f64, dry as f64));
        let lp_amt = 0.5 + 0.5 * (damp as f32);
        self.fx3_wet_lp_l.set_hf_damp(lp_amt);
        self.fx3_wet_lp_r.set_hf_damp(lp_amt);
        let wet_l = self.fx3_wet_lp_l.tick(wl as f32) as f32;
        let wet_r = self.fx3_wet_lp_r.tick(wr as f32) as f32;
        let wet_m = 0.5 * (wet_l + wet_r);
        out = dry * (1.0 - mix) + wet_m * mix;
      }
    } else if fx3_t == 3 || fx3_t == 4 || fx3_t == 5 {
      // Phaser (3), Chorus (4), Flanger (5)
      let rate = 0.05 + fx3_p1 * (5.0 - 0.05);
      let depth_ms = match fx3_t {
        4 => 6.0 * fx3_p2,
        5 => 12.0 * fx3_p2,
        _ => 4.0 * fx3_p2
      };
      if fx3_t == 3 {
        let (wet, _) = self.phaser3.process_one(out, out, self.sr, rate, fx3_p2, 1.0);
        out = out * (1.0 - fx3_mix) + wet * fx3_mix;
      } else {
        let base_ms = match fx3_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
        let (wet, _) = self.delay1.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
        out = out * (1.0 - fx3_mix) + wet * fx3_mix;
      }
      self.fx3_reverb = None; self.fx3_crusher = None;
    } else if fx3_t == 6 {
      // Distortion: Drive (0..20db), Tone (0..1), Mix
      let dry = out;
      let drive_db = (fx3_p1.clamp(0.0, 1.0)) * 20.0;
      let g = (10.0_f32).powf(drive_db / 20.0);
      let x = (dry * g).tanh();
      let tone = fx3_p2.clamp(0.0, 1.0);
      let lp_amt = 0.3 + 0.6 * (1.0 - tone);
      self.fx3_wet_lp_l.set_hf_damp(lp_amt);
      let y_lp = self.fx3_wet_lp_l.tick(x);
      let y_hp = x - y_lp;
      let shaped = y_lp * (1.0 - tone) + y_hp * tone;
      out = dry * (1.0 - fx3_mix) + shaped * fx3_mix;
      self.fx3_reverb = None; self.fx3_crusher = None;
    } else if fx3_t == 7 {
      // Waveshaper
      let dry = out;
      let drive = fx3_p2.clamp(0.0, 1.0) * 10.0;
      let g = 1.0 + drive;
      let cur = fx3_p1.clamp(0.0, 1.0);
      let xin = dry * g;
      let shaped = if cur < 0.34 {
        xin.tanh()
      } else if cur < 0.67 {
        xin.clamp(-1.0, 1.0)
      } else {
        let m = (xin + 1.0).abs().rem_euclid(4.0);
        ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0)
      };
      out = dry * (1.0 - fx3_mix) + shaped * fx3_mix;
      self.fx3_reverb = None; self.fx3_crusher = None;
    } else if fx3_t == 8 {
      if self.fx3_crusher.is_none() { self.fx3_crusher = Some(Bitcrusher::new()); }
      if let Some(cr) = &mut self.fx3_crusher {
        let bits = 4.0 + fx3_p1.clamp(0.0, 1.0) * 12.0;
        let fac = 1.0 + fx3_p2.clamp(0.0, 1.0) * 15.0;
        cr.set_bits(bits as u8);
        cr.set_factor(fac as u32);
        cr.set_mix(fx3_mix);
        let mut lbuf = [out]; let mut rbuf = [out];
        cr.process(&mut lbuf, &mut rbuf);
        out = 0.5 * (lbuf[0] + rbuf[0]);
      }
    }
    // FX4
    let fx4_t = params.get_i32_h(self.paths.fx4_type, 0);
    let fx4_p1 = params.get_f32_h(self.paths.fx4_p1, 0.0);
    let fx4_p2 = params.get_f32_h(self.paths.fx4_p2, 0.0);
    let fx4_mix = params.get_f32_h(self.paths.fx4_p3, 0.0).clamp(0.0, 1.0);
    if fx4_t <= 0 || fx4_mix <= 0.0005 {
      // No Effect
      if fx4_t <= 0 { self.fx4_reverb = None; self.fx4_crusher = None; }
    } else if fx4_t == 2 {
      // Simple delay
      let time_ms = 10.0 + fx4_p1.clamp(0.0, 1.0) * 990.0;
      let fb = (fx4_p2.clamp(0.0, 1.0) * 0.95).min(0.95);
      let mut lbuf = [out]; let mut rbuf = [out];
      self.sdelay4.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx4_mix, false);
      out = 0.5 * (lbuf[0] + rbuf[0]);
      self.fx4_reverb = None; self.fx4_crusher = None;
    } else if fx4_t == 1 {
      // Reverb: Room, Damp, Mix
      if self.fx4_reverb.is_none() {
        let mut rv = Freeverb::new(self.sr as usize);
        rv.set_room_size(0.35);
        rv.set_dampening(0.6);
        rv.set_wet(1.0);
        rv.set_dry(0.0);
        rv.set_width(0.9);
        self.fx4_reverb = Some(rv);
      }
      if let Some(rv) = &mut self.fx4_reverb {
        let room = 0.2 + fx4_p1.clamp(0.0, 1.0) * 0.8;
        let damp = 0.2 + fx4_p2.clamp(0.0, 1.0) * 0.8;
        let mix = fx4_mix;
        rv.set_room_size(room as f64);
        rv.set_dampening(damp as f64);
        rv.set_wet(1.0);
        rv.set_dry(0.0);
        rv.set_width(0.9);
        let dry = out;
        let (wl, wr) = rv.tick((dry as f64, dry as f64));
        let lp_amt = 0.5 + 0.5 * (damp as f32);
        self.fx4_wet_lp_l.set_hf_damp(lp_amt);
        self.fx4_wet_lp_r.set_hf_damp(lp_amt);
        let wet_l = self.fx4_wet_lp_l.tick(wl as f32) as f32;
        let wet_r = self.fx4_wet_lp_r.tick(wr as f32) as f32;
        let wet_m = 0.5 * (wet_l + wet_r);
        out = dry * (1.0 - mix) + wet_m * mix;
      }
    } else if fx4_t == 3 || fx4_t == 4 || fx4_t == 5 {
      // Phaser (3), Chorus (4), Flanger (5)
      let rate = 0.05 + fx4_p1 * (5.0 - 0.05);
      let depth_ms = match fx4_t {
        4 => 6.0 * fx4_p2,
        5 => 12.0 * fx4_p2,
        _ => 4.0 * fx4_p2
      };
      if fx4_t == 3 {
        let (wet, _) = self.phaser4.process_one(out, out, self.sr, rate, fx4_p2, 1.0);
        out = out * (1.0 - fx4_mix) + wet * fx4_mix;
      } else {
        let base_ms = match fx4_t { 4 => 2.0, 5 => 15.0, _ => 3.0 };
        let (wet, _) = self.delay2.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0);
        out = out * (1.0 - fx4_mix) + wet * fx4_mix;
      }
      self.fx4_reverb = None; self.fx4_crusher = None;
    } else if fx4_t == 6 {
      // Distortion: Drive (0..20db), Tone (0..1), Mix
      let dry = out;
      let drive_db = (fx4_p1.clamp(0.0, 1.0)) * 20.0;
      let g = (10.0_f32).powf(drive_db / 20.0);
      let x = (dry * g).tanh();
      let tone = fx4_p2.clamp(0.0, 1.0);
      let lp_amt = 0.3 + 0.6 * (1.0 - tone);
      self.fx4_wet_lp_l.set_hf_damp(lp_amt);
      let y_lp = self.fx4_wet_lp_l.tick(x);
      let y_hp = x - y_lp;
      let shaped = y_lp * (1.0 - tone) + y_hp * tone;
      out = dry * (1.0 - fx4_mix) + shaped * fx4_mix;
      self.fx4_reverb = None; self.fx4_crusher = None;
    } else if fx4_t == 7 {
      // Waveshaper
      let dry = out;
      let drive = fx4_p2.clamp(0.0, 1.0) * 10.0;
      let g = 1.0 + drive;
      let cur = fx4_p1.clamp(0.0, 1.0);
      let xin = dry * g;
      let shaped = if cur < 0.34 {
        xin.tanh()
      } else if cur < 0.67 {
        xin.clamp(-1.0, 1.0)
      } else {
        let m = (xin + 1.0).abs().rem_euclid(4.0);
        ((m - 2.0).abs() - 1.0).clamp(-1.0, 1.0)
      };
      out = dry * (1.0 - fx4_mix) + shaped * fx4_mix;
      self.fx4_reverb = None; self.fx4_crusher = None;
    } else if fx4_t == 8 {
      if self.fx4_crusher.is_none() { self.fx4_crusher = Some(Bitcrusher::new()); }
      if let Some(cr) = &mut self.fx4_crusher {
        let bits = 4.0 + fx4_p1.clamp(0.0, 1.0) * 12.0;
        let fac = 1.0 + fx4_p2.clamp(0.0, 1.0) * 15.0;
        cr.set_bits(bits as u8);
        cr.set_factor(fac as u32);
        cr.set_mix(fx4_mix);
        let mut lbuf = [out]; let mut rbuf = [out];
        cr.process(&mut lbuf, &mut rbuf);
        out = 0.5 * (lbuf[0] + rbuf[0]);
      }
    }
    // True 8-band peaking EQ (fixed centers), update coefficients only if gain changed
    // Skip processing if all gains are effectively zero
    let q = 1.0_f32; // moderate bandwidth
    let mut any_nonzero = false;
    for i in 0..8 {
      let db = params.get_f32_h(self.paths.eq_bands[i], 0.0).clamp(-12.0, 12.0);
      if (db - self.eq_last_db[i]).abs() > 1e-6 {
        self.eq_bands[i].set_peaking(self.sr, self.eq_centers[i], q, db);
        self.eq_last_db[i] = db;
      }
      if db.abs() > 1e-3 { any_nonzero = true; }
    }
    if any_nonzero {
      for i in 0..8 { out = self.eq_bands[i].process(out); }
    }
    // Start mono, then PAN, VOLUME, HAAS (stereoizer), COMP
    let mut l = out; let mut r = out;
    let pan = params.get_f32_h(self.paths.mix_pan, 0.0).clamp(-1.0, 1.0);
    let theta = (pan + 1.0) * std::f32::consts::FRAC_PI_4;
    let gl = theta.cos(); let gr = theta.sin();
    l *= gl; r *= gr;
    let vol = params.get_f32_h(self.paths.mix_volume, 1.0).clamp(0.0, 1.0);
    l *= vol; r *= vol;
    // Haas stereoizer: delay left by ~15ms mixed by haas amount, right dry
    let haas = params.get_f32_h(self.paths.mix_haas, 0.0).clamp(0.0, 1.0);
    if haas > 0.0005 {
      let rd = if self.haas_wr >= self.haas_d { self.haas_wr - self.haas_d } else { self.haas_wr + self.haas_len - self.haas_d };
      let delayed_l = self.haas_buf[rd];
      self.haas_buf[self.haas_wr] = l;
      self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; }
      l = l * (1.0 - haas) + delayed_l * haas;
    } else {
      // still push into buffer to keep pointer advancing
      self.haas_buf[self.haas_wr] = l;
      self.haas_wr += 1; if self.haas_wr >= self.haas_len { self.haas_wr = 0; }
    }
    let comp = params.get_f32_h(self.paths.mix_comp, 0.0).clamp(0.0, 1.0);
    if comp > 0.001 {
      let drive = 1.0 + 8.0 * comp;
      let id = 1.0 / drive.tanh();
      l = (l * drive).tanh() * id;
      r = (r * drive).tanh() * id;
    }
    (l, r)
    }
  }
}

pub struct Mixer {
  sr: f32,
  part_gains: [f32; 6],
}

impl Mixer {
  pub fn new(sr: f32) -> Self { Self { sr, part_gains: [1.0; 6] } }
  pub fn set_gain_db(&mut self, idx: usize, db: f32) { if idx < 6 { self.part_gains[idx] = db_to_gain(db.clamp(-12.0, 12.0)); } }
  pub fn mix(&self, parts: &mut [Part], params: &ParamStore, beat_phase: f32) -> (f32, f32) {
    let mut l = 0.0f32; let mut r = 0.0f32;
    for i in 0..parts.len().min(6) {
      let (pl, pr) = parts[i].render(params, i, beat_phase);
      // Robust gain composition: multiplicative with identity defaults; clamp to sensible range
      let pg = self.part_gains[i].clamp(0.0, 2.0);
      let param_g = db_to_gain(params.get_f32_h(parts[i].paths.mixer_gain_db, 0.0)).clamp(0.0, 2.0);
      let g = pg * param_g;
      let (pl, pr) = if pl.is_finite() && pr.is_finite() { (pl, pr) } else { (0.0, 0.0) };
      l += pl * g; r += pr * g;
    }
    let l = soft_clip(l);
    let r = soft_clip(r);
    (l, r)
  }
}

fn db_to_gain(db: f32) -> f32 { (10.0f32).powf(db / 20.0) }
fn soft_clip(x: f32) -> f32 { (x.tanh()).clamp(-1.0, 1.0) }

pub struct EngineGraph {
  pub parts: Vec<Part>,
  pub mixer: Mixer,
  pub sr: f32,
  preview_sampler: Sampler,
  preview_playing: bool,
  // tempo/transport
  bpm: f32,
  beat_phase: f32,
}

impl EngineGraph {
  pub fn new(sr: f32) -> Self {
    let mut parts = Vec::with_capacity(6);
    // 6-voice polyphony per part
  for i in 0..6 { parts.push(Part::new(sr, 6, i)); }
  init_playhead_states(parts.len());
    Self { 
      parts, 
      mixer: Mixer::new(sr), 
      sr,
      preview_sampler: Sampler::new(sr),
      preview_playing: false,
      bpm: 120.0,
      beat_phase: 0.0,
    }
  }
  
  pub fn load_preview_sample(&mut self, path: &str) -> Result<(), String> {
    self.preview_sampler.load_sample(path);
  // Use normalized velocity (0..1) now that sampler clamps internally; 0.85 gives headroom
  self.preview_sampler.note_on(60, 0.85, crate::engine::modules::sampler::RetrigMode::Immediate); // Trigger preview playback at moderate level
    self.preview_playing = true;
    Ok(())
  }
  
  pub fn stop_preview(&mut self) {
    self.preview_sampler.note_off(60);
    self.preview_playing = false;
  }
  
  pub fn render_frame(&mut self, params: &ParamStore) -> (f32, f32) { 
    // advance beat phase based on current bpm and sample rate (seconds per sample = 1/sr)
    let spb = 60.0f32 / self.bpm.max(1.0);
    // beats per sample
    let bps = (1.0 / self.sr) / spb;
    self.beat_phase = (self.beat_phase + bps).fract();

    let mut result = self.mixer.mix(&mut self.parts, params, self.beat_phase);

    // Update playhead states for any parts using sampler module (kind == 4)
    for (i, part) in self.parts.iter().enumerate() {
      let module = params.get_i32_h(part.paths.module_kind, 0);
      if module == 4 { // Sampler
        if let Some(state) = part.sampler.compute_playhead_state(params, &part.sampler_keys) {
          set_playhead_state(i, Some(state));
        } else {
          set_playhead_state(i, None);
        }
      } else if module == 5 { // Drum
        // No playhead; clear any previous
        set_playhead_state(i, None);
      }
    }
    
    // Add preview sample if playing
    if self.preview_playing {
      let preview_keys = SamplerParamKeys {
        module_kind: 0, // dummy hash
        sample_start: 0,
        sample_end: 0,
        pitch_semitones: 0,
        pitch_cents: 0,
        playback_mode: 0,
        loop_start: 0,
        loop_end: 0,
        loop_mode: 0,
        smoothness: 0,
        retrig_mode: 0,
        attack: 0,
        decay: 0,
        sustain: 0,
        release: 0,
      };
  let preview_out = self.preview_sampler.render_one(params, &preview_keys, self.beat_phase);
      result.0 += preview_out * 0.3; // Lower volume for preview
      result.1 += preview_out * 0.3;
      
      // Stop preview if sample finished
      if !self.preview_sampler.is_playing() {
        self.preview_playing = false;
      }
    }
    
    result
  }

  pub fn set_tempo(&mut self, bpm: f32) {
    let clamped = bpm.clamp(40.0, 300.0);
    self.bpm = clamped;
  }
}
