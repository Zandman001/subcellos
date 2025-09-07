use std::f32::consts::PI;

use crate::engine::params::{ParamStore, hash_path};
use crate::engine::dsp::{delay::SimpleDelay, mod_delay::ModDelay, phaser::Phaser, reverb::OnePoleLP, bitcrusher::Bitcrusher};
use crate::engine::modules::acid303::{Acid303, AcidParamKeys};
use crate::engine::modules::karplus_strong::{KarplusStrong, KSParamKeys};
use freeverb::Freeverb;

#[inline]
fn midi_to_freq(m: u8) -> f32 { 440.0 * (2.0_f32).powf((m as f32 - 69.0) / 12.0) }

#[derive(Clone, Copy, Debug)]
enum FilterType { LP, HP, BP, Notch }

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
  pub fn note_on(&mut self, note: u8, vel: f32) {
    self.active = true; self.note = note; self.base_freq = midi_to_freq(note); self.vel = vel; self.env_amp.gate_on(); self.env_mod.gate_on();
    // Reseed noise states per note for stability
    self.rng = (note as u32).wrapping_mul(747796405).wrapping_add(2891336453);
    self.pink = 0.0; self.brown = 0.0;
  }
  pub fn note_off(&mut self) { self.env_amp.gate_off(); self.env_mod.gate_off(); self.active = false; }
  pub fn render(&mut self, params: &ParamStore, paths: &ParamPaths, sr: f32, modf: &ModFrame) -> f32 {
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
    let mut filt1_m = modf.filt1;
    let mut filt2_m = modf.filt2;
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
        5 => filt1_m += v,
        6 => filt2_m += v,
        _ => {}
      }
    }
    let det_a = params.get_f32_h(paths.oscA_detune_cents, 0.0) + cents_a;
    let det_b = params.get_f32_h(paths.oscB_detune_cents, 0.0) + cents_b;
    let pw = params.get_f32_h(paths.oscA_pulse_width, 0.5).clamp(0.05, 0.95);
    let fm_ab = params.get_f32_h(paths.oscA_fm_to_B, 0.0);
    let fm_ba = params.get_f32_h(paths.oscB_fm_to_A, 0.0);
    // amp envelope already updated above
    let fa_t = params.get_i32_h(paths.filter1_type, 0);
    let fa_fc_base = params.get_f32_h(paths.filter1_cutoff_hz, 20000.0).clamp(20.0, 20000.0);
    let fa_fc = (fa_fc_base * (2.0_f32).powf(filt1_m * 3.0)).clamp(20.0, 20000.0);
    let fa_q = params
      .get_f32_h(paths.filter1_q, params.get_f32_h(paths.filter1_res_q, 0.707))
      .clamp(0.5, 20.0);
    let fb_t = params.get_i32_h(paths.filter2_type, 0);
    let fb_fc_base = params.get_f32_h(paths.filter2_cutoff_hz, 20000.0).clamp(20.0, 20000.0);
    let fb_fc = (fb_fc_base * (2.0_f32).powf(filt2_m * 3.0)).clamp(20.0, 20000.0);
    let fb_q = params
      .get_f32_h(paths.filter2_q, params.get_f32_h(paths.filter2_res_q, 0.707))
      .clamp(0.5, 20.0);
    // Update filters at a reduced rate to save CPU
    self.filt_upd_phase = self.filt_upd_phase.wrapping_add(1);
    if (self.filt_upd_phase & 0x07) == 0 { // every 8 samples
      if (fa_fc - self.last_fa_fc).abs() > 1e-3 || (fa_q - self.last_fa_q).abs() > 1e-3 {
        self.filt1.set_params(fa_fc, fa_q, sr);
        self.last_fa_fc = fa_fc; self.last_fa_q = fa_q;
      }
      if (fb_fc - self.last_fb_fc).abs() > 1e-3 || (fb_q - self.last_fb_q).abs() > 1e-3 {
        self.filt2.set_params(fb_fc, fb_q, sr);
        self.last_fb_fc = fb_fc; self.last_fb_q = fb_q;
      }
    }
    let shape_a = match sh_a { 1 => OscShape::Saw, 2 => OscShape::Square, 3 => OscShape::Tri, 4 => OscShape::Pulse, 5 => OscShape::NoiseWhite, 6 => OscShape::NoisePink, 7 => OscShape::NoiseBrown, _ => OscShape::Sine };
    let shape_b = match sh_b { 1 => OscShape::Saw, 2 => OscShape::Square, 3 => OscShape::Tri, 4 => OscShape::Pulse, 5 => OscShape::NoiseWhite, 6 => OscShape::NoisePink, 7 => OscShape::NoiseBrown, _ => OscShape::Sine };
    let dt_a = self.base_freq * (2.0_f32).powf(det_a / 1200.0) - self.base_freq;
    let dt_b = self.base_freq * (2.0_f32).powf(det_b / 1200.0) - self.base_freq;
    let env_amp = self.env_amp.next();
    // FM as phase modulation using last-frame cross-samples
    let pm_depth = 6.0; // radians, musical index
    let pm_a = (self.last_b * fm_ab * pm_depth) / (2.0 * PI); // convert to cycles
    let pm_b = (self.last_a * fm_ba * pm_depth) / (2.0 * PI);
    let mut b_s = if matches!(shape_b, OscShape::NoiseWhite|OscShape::NoisePink|OscShape::NoiseBrown) { self.next_noise(shape_b) } else { self.osc_b.next_pm(self.base_freq + dt_b, shape_b, pw, pm_b) };
    let mut a_s = if matches!(shape_a, OscShape::NoiseWhite|OscShape::NoisePink|OscShape::NoiseBrown) { self.next_noise(shape_a) } else { self.osc_a.next_pm(self.base_freq + dt_a, shape_a, pw, pm_a) };
    // Per-osc levels
    let lvl_a = (params.get_f32_h(paths.oscA_level, 0.7) + lvl_a_m).clamp(0.0, 1.0);
    let lvl_b = (params.get_f32_h(paths.oscB_level, 0.7) + lvl_b_m).clamp(0.0, 1.0);
    a_s *= lvl_a;
    b_s *= lvl_b;
    // Apply filter assignments per oscillator
    let mut a = a_s; let mut b = b_s;
    let fa_assign = params.get_i32_h(paths.filter1_assign, 0).clamp(0, 3);
    match fa_assign {
      1 => { let (lp, hp, bp, no) = self.filt1.process(a); a = match map_ft(fa_t) { FilterType::LP => lp, FilterType::HP => hp, FilterType::BP => bp, FilterType::Notch => no }; },
      2 => { let (lp, hp, bp, no) = self.filt1.process(b); b = match map_ft(fa_t) { FilterType::LP => lp, FilterType::HP => hp, FilterType::BP => bp, FilterType::Notch => no }; },
      3 => { let (lp, hp, bp, no) = self.filt1.process(a + b); let y = match map_ft(fa_t) { FilterType::LP => lp, FilterType::HP => hp, FilterType::BP => bp, FilterType::Notch => no }; a = y * 0.5; b = y * 0.5; },
      _ => {}
    }
    let fb_assign = params.get_i32_h(paths.filter2_assign, 0).clamp(0, 3);
    match fb_assign {
      1 => { let (lp, hp, bp, no) = self.filt2.process(a); a = match map_ft(fb_t) { FilterType::LP => lp, FilterType::HP => hp, FilterType::BP => bp, FilterType::Notch => no }; },
      2 => { let (lp, hp, bp, no) = self.filt2.process(b); b = match map_ft(fb_t) { FilterType::LP => lp, FilterType::HP => hp, FilterType::BP => bp, FilterType::Notch => no }; },
      3 => { let (lp, hp, bp, no) = self.filt2.process(a + b); let y = match map_ft(fb_t) { FilterType::LP => lp, FilterType::HP => hp, FilterType::BP => bp, FilterType::Notch => no }; a = y * 0.5; b = y * 0.5; },
      _ => {}
    }
    // Update last samples for next-frame FM
    self.last_a = a;
    self.last_b = b;
    let s = 0.5 * (a + b);
    s * env_amp * self.vel
  }
}

impl Voice {
  #[inline]
  fn rand01(&mut self) -> f32 {
    // LCG
    self.rng = self.rng.wrapping_mul(1664525).wrapping_add(1013904223);
    let v = ((self.rng >> 9) as f32) * (1.0 / 8388608.0); // 23 bits
    v
  }
  #[inline]
  fn next_noise(&mut self, shape: OscShape) -> f32 {
    let w = self.rand01() * 2.0 - 1.0; // white -1..1
    match shape {
      OscShape::NoiseWhite => w,
      OscShape::NoisePink => {
        // simple 1-pole lowpass on white
        self.pink = self.pink * 0.98 + w * 0.02;
        self.pink.clamp(-1.0, 1.0)
      }
      OscShape::NoiseBrown => {
        self.brown = (self.brown + w * 0.02).clamp(-1.0, 1.0);
        self.brown
      }
      _ => 0.0,
    }
  }
}

fn map_ft(t: i32) -> FilterType { match t { 1 => FilterType::HP, 2 => FilterType::BP, 3 => FilterType::Notch, _ => FilterType::LP } }

pub struct Part {
  voices: Vec<Voice>,
  sr: f32,
  idx: usize,
  next_voice: usize,
  // Mono Acid engine
  acid: Acid303,
  acid_keys: AcidParamKeys,
  // Mono Karplus-Strong engine
  karplus: KarplusStrong,
  karplus_keys: KSParamKeys,
  // Modulated delay lines for chorus/flanger
  delay1: ModDelay,
  delay2: ModDelay,
  // Simple delays for explicit TIME/FEEDBACK
  sdelay1: SimpleDelay,
  sdelay2: SimpleDelay,
  fx1_reverb: Option<Freeverb>,
  fx2_reverb: Option<Freeverb>,
  fx3_reverb: Option<Freeverb>,
  fx4_reverb: Option<Freeverb>,
  fx1_crusher: Option<Bitcrusher>,
  fx2_crusher: Option<Bitcrusher>,
  fx3_crusher: Option<Bitcrusher>,
  fx4_crusher: Option<Bitcrusher>,
  fx1_wet_lp_l: OnePoleLP,
  fx1_wet_lp_r: OnePoleLP,
  fx2_wet_lp_l: OnePoleLP,
  fx2_wet_lp_r: OnePoleLP,
  fx3_wet_lp_l: OnePoleLP,
  fx3_wet_lp_r: OnePoleLP,
  fx4_wet_lp_l: OnePoleLP,
  fx4_wet_lp_r: OnePoleLP,
  phaser1: Phaser,
  phaser2: Phaser,
  phaser3: Phaser,
  phaser4: Phaser,
  eq_lp: Svf,
  eq_hp: Svf,
  eq_bands: [Biquad; 8],
  eq_centers: [f32; 8],
  eq_last_db: [f32; 8],
  fx1_lfo: f32,
  fx2_lfo: f32,
  fx3_lfo: f32,
  fx4_lfo: f32,
  paths: ParamPaths,
  lfo_phase: f32,
  lfo_hold: f32,
  lfo_decim: u8,
  modf_last: ModFrame,
  // Haas delay (left channel buffer)
  haas_buf: Vec<f32>,
  haas_wr: usize,
  haas_len: usize,
  haas_d: usize,
}

#[derive(Clone)]
struct ParamPaths {
  // Osc / Env
  oscA_shape: u64, oscB_shape: u64,
  oscA_detune_cents: u64, oscB_detune_cents: u64,
  oscA_pulse_width: u64, oscA_fm_to_B: u64, oscB_fm_to_A: u64,
  amp_attack: u64, amp_decay: u64, amp_sustain: u64, amp_release: u64,
  // Mod envelope (used as modulation source)
  mod_attack: u64, mod_decay: u64, mod_sustain: u64, mod_release: u64,
  filter1_type: u64, filter1_cutoff_hz: u64, filter1_q: u64, filter1_res_q: u64, filter1_assign: u64,
  filter2_type: u64, filter2_cutoff_hz: u64, filter2_q: u64, filter2_res_q: u64, filter2_assign: u64,
  oscA_level: u64, oscB_level: u64,
  // LFO
  lfo_shape: u64, lfo_rate_hz: u64, lfo_amount: u64, lfo_drive: u64,
  lfo_dest: [u64; 5], lfo_row_amount: [u64; 5],
  // ENV mod matrix
  env_dest: [u64; 5], env_row_amount: [u64; 5],
  // FX
  fx1_type: u64, fx1_p1: u64, fx1_p2: u64, fx1_p3: u64,
  fx2_type: u64, fx2_p1: u64, fx2_p2: u64, fx2_p3: u64,
  fx3_type: u64, fx3_p1: u64, fx3_p2: u64, fx3_p3: u64,
  fx4_type: u64, fx4_p1: u64, fx4_p2: u64, fx4_p3: u64,
  // Mixer and EQ
  mix_width: u64, mix_pan: u64, mix_comp: u64, mix_volume: u64,
  eq_bands: [u64; 8],
  mixer_gain_db: u64,
  mix_haas: u64,
  // Module select and Acid303 params
  module_kind: u64,
  acid_wave: u64,
  acid_cutoff: u64,
  acid_reso: u64,
  acid_envmod: u64,
  acid_decay: u64,
  acid_accent: u64,
  acid_slide: u64,
  acid_drive: u64,
  acid_step_accent: u64,
  acid_step_slide: u64,
  // Karplus-Strong params
  ks_decay: u64,
  ks_damp: u64,
  ks_excite: u64,
  ks_tune: u64,
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
    }
  }
}

impl Part {
  pub fn new(sr: f32, poly: usize, idx: usize) -> Self {
    let mut voices = Vec::with_capacity(poly);
    for _ in 0..poly { voices.push(Voice::new(sr)); }
    // Allocate modulated delay buffers for FX and explicit delays for TIME/FEEDBACK
    let mut p = Self { voices, sr, idx, next_voice: 0,
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
      delay1: ModDelay::new(1500.0, sr), delay2: ModDelay::new(1500.0, sr),
      sdelay1: SimpleDelay::new(1200.0, sr), sdelay2: SimpleDelay::new(1200.0, sr),
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
      fx1_lfo: 0.0, fx2_lfo: 0.0, fx3_lfo: 0.0, fx4_lfo: 0.0, paths: ParamPaths::new(idx), lfo_phase: 0.0, lfo_hold: 0.0, lfo_decim: 0, modf_last: ModFrame { cents_a:0.0, cents_b:0.0, lvl_a:0.0, lvl_b:0.0, filt1:0.0, filt2:0.0 },
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
  pub fn note_on(&mut self, note: u8, vel: f32) {
    // Prevent stacking the same note: stop any existing voices with this note first
    for v in &mut self.voices { if v.note == note && v.is_active() { v.note_off(); } }
    let mut idx = None;
    for (i, v) in self.voices.iter().enumerate() { if !v.is_active() { idx = Some(i); break; } }
    let i = idx.unwrap_or_else(|| { let i = self.next_voice; self.next_voice = (self.next_voice + 1) % self.voices.len(); i });
    self.voices[i].note_on(note, vel);
    // Also feed mono Acid engine (render path will choose active module)
    self.acid.note_on(note, vel);
    // Also feed mono Karplus-Strong engine
    self.karplus.note_on(note, vel);
  }
  pub fn note_off(&mut self, note: u8) {
    // Stop all voices with this note to guarantee preview stops fully
    for v in &mut self.voices { if v.note == note && v.is_active() { v.note_off(); } }
    self.acid.note_off(note);
    self.karplus.note_off();
  }
  pub fn render(&mut self, params: &ParamStore, _part_idx: usize) -> (f32, f32) {
    // Module dispatch (0 = Analog, 1 = Acid303, 2 = KarplusStrong)
    let module = params.get_i32_h(self.paths.module_kind, 0);
    
    if module == 1 {
      // Acid303 mono voice sample
      let s = self.acid.render_one(params, &self.acid_keys);
      // Early-out if dry is silent and both FX mixes are ~zero (no tails needed)
      let fx1_t_peek = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_mix_peek = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      let fx2_t_peek = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_mix_peek = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      if s.abs() < 1e-9 && (fx1_t_peek <= 0 || fx1_mix_peek <= 0.0005) && (fx2_t_peek <= 0 || fx2_mix_peek <= 0.0005) {
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
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay1.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx3_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
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
          let base_ms = match fx3_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay1.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx3_mix) + wet * fx3_mix;
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
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay2.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx4_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
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
          let base_ms = match fx4_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay2.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx4_mix) + wet * fx4_mix;
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
      // Karplus-Strong mono voice sample
      let s = self.karplus.render_one(params, &self.karplus_keys);
      // Early-out if dry is silent and both FX mixes are ~zero (no tails needed)
      let fx1_t_peek = params.get_i32_h(self.paths.fx1_type, 0);
      let fx1_mix_peek = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
      let fx2_t_peek = params.get_i32_h(self.paths.fx2_type, 0);
      let fx2_mix_peek = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
      if s.abs() < 1e-9 && (fx1_t_peek <= 0 || fx1_mix_peek <= 0.0005) && (fx2_t_peek <= 0 || fx2_mix_peek <= 0.0005) {
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
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay1.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx3_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
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
          let base_ms = match fx3_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay1.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx3_mix) + wet * fx3_mix;
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
        let mut lbuf = [out]; let mut rbuf = [out]; self.sdelay2.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx4_mix, false); out = 0.5 * (lbuf[0] + rbuf[0]);
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
          let base_ms = match fx4_t { 4 => 2.0, 5 => 15.0, _ => 3.0 }; let (wet, _) = self.delay2.process_one(out, out, self.sr, rate, base_ms, depth_ms, 1.0); out = out * (1.0 - fx4_mix) + wet * fx4_mix;
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
    }
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
    let alpha = 1.0 - (-1.0/(0.01*self.sr)).exp();
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
    // Early-out if dry is silent and both FX mixes are ~zero (no tails needed)
    let fx1_t_peek = params.get_i32_h(self.paths.fx1_type, 0);
    let fx1_mix_peek = params.get_f32_h(self.paths.fx1_p3, 0.0).clamp(0.0, 1.0);
    let fx2_t_peek = params.get_i32_h(self.paths.fx2_type, 0);
    let fx2_mix_peek = params.get_f32_h(self.paths.fx2_p3, 0.0).clamp(0.0, 1.0);
    if s.abs() < 1e-9 && (fx1_t_peek <= 0 || fx1_mix_peek <= 0.0005) && (fx2_t_peek <= 0 || fx2_mix_peek <= 0.0005) {
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
      self.sdelay1.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx3_mix, false);
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
      self.sdelay2.process_block(&mut lbuf, &mut rbuf, self.sr, time_ms, fb, fx4_mix, false);
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

pub struct Mixer {
  sr: f32,
  part_gains: [f32; 6],
}

impl Mixer {
  pub fn new(sr: f32) -> Self { Self { sr, part_gains: [0.0; 6] } }
  pub fn set_gain_db(&mut self, idx: usize, db: f32) { if idx < 6 { self.part_gains[idx] = db_to_gain(db.clamp(-12.0, 12.0)); } }
  pub fn mix(&self, parts: &mut [Part], params: &ParamStore) -> (f32, f32) {
    let mut l = 0.0f32; let mut r = 0.0f32;
    for i in 0..parts.len().min(6) {
      let (pl, pr) = parts[i].render(params, i);
      let g = self.part_gains[i].max(0.0) + db_to_gain(params.get_f32_h(parts[i].paths.mixer_gain_db, 0.0));
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
}

impl EngineGraph {
  pub fn new(sr: f32) -> Self {
    let mut parts = Vec::with_capacity(6);
    // 6-voice polyphony per part
    for i in 0..6 { parts.push(Part::new(sr, 6, i)); }
    Self { parts, mixer: Mixer::new(sr), sr }
  }
  pub fn render_frame(&mut self, params: &ParamStore) -> (f32, f32) { self.mixer.mix(&mut self.parts, params) }
}
