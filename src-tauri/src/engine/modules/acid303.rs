use std::f32::consts::PI;

use crate::engine::params::ParamStore;

#[inline]
fn midi_to_freq(m: u8) -> f32 { 440.0 * (2.0_f32).powf((m as f32 - 69.0) / 12.0) }

#[inline]
fn map_cutoff_norm(n: f32) -> f32 {
  // Map [0..1] to ~[20..10000] Hz perceptually
  let n = n.clamp(0.0, 1.0);
  20.0f32 * (10.0f32).powf(n * ((10000.0f32/20.0f32).log10()))
}

#[inline]
fn map_decay_ms(n: f32) -> f32 {
  // Map [0..1] to [5..800] ms with perceptual skew
  let n = n.clamp(0.0, 1.0);
  let min: f32 = 5.0; let max: f32 = 800.0;
  min * (max / min).powf(n)
}

#[derive(Clone)]
struct Wavetable {
  saw: [f32; 256],
  square: [f32; 256],
}

impl Wavetable {
  fn new() -> Self {
    let mut saw = [0.0f32; 256];
    let mut square = [0.0f32; 256];
    for i in 0..256 {
      let p = i as f32 / 256.0;
      saw[i] = 2.0 * (p - 0.5);
      square[i] = if p < 0.5 { 1.0 } else { -1.0 };
    }
    Self { saw, square }
  }
  #[inline]
  fn sample(&self, phase: f32, blend: f32) -> f32 {
    // phase 0..1, blend 0=saw..1=square, linear interp
    let idx = (phase.fract() * 256.0).clamp(0.0, 255.999);
    let i0 = idx as usize;
    let i1 = (i0 + 1) & 255;
    let t = idx - i0 as f32;
    let s_saw = self.saw[i0] + (self.saw[i1] - self.saw[i0]) * t;
    let s_sq = self.square[i0] + (self.square[i1] - self.square[i0]) * t;
    // Equal-power crossfade to avoid perceived pitch jump around mid-blend
    let w2 = blend.clamp(0.0, 1.0).sqrt();
    let w1 = (1.0 - blend.clamp(0.0, 1.0)).sqrt();
    s_saw * w1 + s_sq * w2
  }
}

#[derive(Clone)]
struct BiquadLP {
  b0: f32, b1: f32, b2: f32, a1: f32, a2: f32,
  z1: f32, z2: f32,
}

impl BiquadLP {
  fn new() -> Self { Self { b0:1.0, b1:0.0, b2:0.0, a1:0.0, a2:0.0, z1:0.0, z2:0.0 } }
  fn set(&mut self, sr: f32, freq: f32, q: f32) {
    let f = (freq / sr).clamp(0.0005, 0.49);
    let w0 = 2.0 * PI * f;
    let cosw = w0.cos();
    let sinw = w0.sin();
    let alpha = sinw / (2.0 * q.max(0.1));
    let b0 = (1.0 - cosw) * 0.5;
    let b1 = 1.0 - cosw;
    let b2 = (1.0 - cosw) * 0.5;
    let a0 = 1.0 + alpha;
    let a1 = -2.0 * cosw;
    let a2 = 1.0 - alpha;
    self.b0 = b0 / a0;
    self.b1 = b1 / a0;
    self.b2 = b2 / a0;
    self.a1 = a1 / a0;
    self.a2 = a2 / a0;
  }
  #[inline]
  fn process(&mut self, x: f32) -> f32 {
    // Direct Form I
    let y = self.b0 * x + self.z1;
    self.z1 = self.b1 * x - self.a1 * y + self.z2;
    self.z2 = self.b2 * x - self.a2 * y;
    y
  }
}

#[derive(Clone)]
pub struct AcidParamKeys {
  #[allow(dead_code)] pub module_kind: u64,
  pub wave: u64,
  pub cutoff: u64,
  pub reso: u64,
  pub envmod: u64,
  pub decay: u64,
  pub accent: u64,
  pub slide: u64,
  pub drive: u64,
  #[allow(dead_code)] pub step_accent: u64,
  #[allow(dead_code)] pub step_slide: u64,
}

#[derive(Clone)]
pub struct Acid303 {
  sr: f32,
  wt: Wavetable,
  phase: f32,
  freq: f32,
  target_freq: f32,
  glide_alpha: f32,
  env: f32,
  decay_alpha: f32,
  attack_alpha: f32,
  in_attack: bool,
  gate: bool,
  just_triggered: bool,
  current_note: Option<u8>,  // Track current note for proper legato detection
  filt: BiquadLP,
  // Accent smoothing for TB-303 style global accent behavior
  accent_smooth: f32,
  accent_smooth_alpha: f32,
}

impl Acid303 {
  pub fn new(sr: f32) -> Self {
    // TB-303 style envelope: 3ms attack, 8ms release
    let attack_ms = 3.0;
    let attack_alpha = 1.0 - (-1.0 / ((attack_ms / 1000.0) * sr)).exp();
    
    // Accent smoothing: 3ms time constant for smooth parameter changes
    let accent_smooth_alpha = 1.0 - (-1.0 / (sr * 0.003)).exp();
    
    Self {
      sr,
      wt: Wavetable::new(),
      phase: 0.0,
      freq: 110.0,
      target_freq: 110.0,
      glide_alpha: 0.0,
      env: 0.0,
      decay_alpha: 1.0 - (-1.0 / (0.180 * sr)).exp(), // ~180 ms default
      attack_alpha,
      in_attack: false,
      gate: false,
      just_triggered: false,
      current_note: None,  // Initialize to no note
      filt: BiquadLP::new(),
      accent_smooth: 0.0,
      accent_smooth_alpha,
    }
  }

  pub fn note_on(&mut self, note: u8, _vel: f32) {
    self.target_freq = midi_to_freq(note);
    
    // Legato detection: only treat as legato if:
    // 1. A note is already gated AND
    // 2. It's a DIFFERENT note (same note = retrigger)
    let is_legato = self.gate && self.current_note.is_some() && self.current_note != Some(note);
    
    self.gate = true;
    self.current_note = Some(note);
    self.just_triggered = true;
    
    // Only retrigger envelope if this is NOT legato
    if !is_legato {
      self.env = 0.0;  // Start from 0 for attack phase
      self.in_attack = true;
    }
  }

  pub fn note_off(&mut self, _note: u8) {
    self.gate = false;
    self.current_note = None;  // Clear current note
    self.in_attack = false;  // Exit attack if in progress
  }

  #[inline]
  fn update_envelope(&mut self) -> f32 {
    if self.in_attack {
      // TB-303 style fast attack (3ms)
      self.env += (1.0 - self.env) * self.attack_alpha;
      if self.env >= 0.999 {
        self.env = 1.0;
        self.in_attack = false;
      }
    } else if self.gate {
      // Sustain phase - decay envelope toward zero
      self.env += (0.0 - self.env) * self.decay_alpha;
    } else {
      // Release phase - fast release (8ms)
      let release_alpha = 1.0 - (-1.0 / ((8.0 / 1000.0) * self.sr)).exp();
      self.env += (0.0 - self.env) * release_alpha;
    }
    
    if self.env < 1e-6 { self.env = 0.0; }
    self.env
  }

  #[inline]
  fn soft_clip_drive(x: f32, amt: f32) -> f32 {
    if amt <= 1e-4 { return x; }
    let g = 1.0 + 10.0 * amt.clamp(0.0, 1.0);
    let y = (x * g).tanh();
    let norm = 1.0 / g.tanh();
    (y * norm).clamp(-1.0, 1.0)
  }

  pub fn render_one(&mut self, params: &ParamStore, keys: &AcidParamKeys) -> f32 {
    // Read macro params (normalized where applicable)
    let wave = params.get_f32_h(keys.wave, 0.0).clamp(0.0, 1.0);
    let cutoff_n = params.get_f32_h(keys.cutoff,  (20.0f32).log10() / (10000.0f32/20.0).log10());
    let reso = params.get_f32_h(keys.reso, 0.5).clamp(0.0, 1.0);
    let envmod = params.get_f32_h(keys.envmod, 0.6).clamp(0.0, 1.0);
    let decay_n = params.get_f32_h(keys.decay, 0.5).clamp(0.0, 1.0);
    let accent_amt = params.get_f32_h(keys.accent, 0.7).clamp(0.0, 1.0);
    let slide_n = params.get_f32_h(keys.slide, 0.4).clamp(0.0, 1.0);
    let drive = params.get_f32_h(keys.drive, 0.3).clamp(0.0, 1.0);

    // Smooth accent parameter (TB-303 style global accent behavior)
    self.accent_smooth += (accent_amt - self.accent_smooth) * self.accent_smooth_alpha;
    let a_s = self.accent_smooth;

    // Apply TB-303 accent boosts to all parameters
    // 1. Cutoff boost (multiplicative)
    let cutoff_eff = cutoff_n * (1.0 + 0.5 * a_s);
    
    // 2. Filter envelope depth boost
    let envmod_eff = envmod * (1.0 + 0.7 * a_s);
    
    // 3. Resonance emphasis (clamped)
    let reso_eff = (reso + 0.25 * a_s).min(0.98);
    
    // 4. Amp pre-drive gain boost (~+3 to +6 dB range)
    let pre_gain_eff = 1.0 + 1.5 * a_s;
    
    // 5. Slightly longer decay
    let decay_ms_base = map_decay_ms(decay_n).max(1.0);
    let decay_ms_eff = decay_ms_base * (1.0 + 0.25 * a_s);
    
    // Update decay alpha with accent-modified timing
    self.decay_alpha = 1.0 - (-1.0 / ((decay_ms_eff / 1000.0) * self.sr)).exp();

    // Update glide coefficient per frame from Slide parameter
    let glide_ms = (slide_n * 300.0).max(0.0);
    if glide_ms <= 1e-3 { 
      self.glide_alpha = 0.0; 
    } else { 
      self.glide_alpha = (-1.0 / ((glide_ms / 1000.0) * self.sr)).exp(); 
    }

    // Handle note trigger logic - simplified without step_slide complexity
    if self.just_triggered {
      self.just_triggered = false;
      // Note: envelope and legato logic is now handled in note_on()
    }

    // Update frequency with glide if slide parameter > 0 and gate is active
    // This creates smooth pitch transitions between notes when slide is enabled
    if self.gate && self.glide_alpha > 0.0 {
      self.freq = self.freq * self.glide_alpha + self.target_freq * (1.0 - self.glide_alpha);
    } else {
      self.freq = self.target_freq;
    }
    let ph_inc = (self.freq / self.sr).clamp(0.0, 0.5);
    self.phase = (self.phase + ph_inc) % 1.0;
    let mut osc = self.wt.sample(self.phase, wave);

    // Apply pre-gain boost from accent
    osc *= pre_gain_eff;

    // Shared decay env
    let env = self.update_envelope();

    // Filter cutoff: use accent-boosted cutoff and envmod
    let mut cutoff_hz = map_cutoff_norm(cutoff_eff.clamp(0.0, 1.0));
    let env_hz = cutoff_hz * (2.0_f32).powf(envmod_eff * env * 3.0);
    cutoff_hz = cutoff_hz.max(20.0).min(10000.0);
    cutoff_hz = (cutoff_hz + env_hz).min(12000.0);

    // Use accent-boosted resonance
    let mut q = 0.6 + reso_eff * 12.0; // 0.6..12.6
    q = q.clamp(0.5, 18.0);
    self.filt.set(self.sr, cutoff_hz, q);

    // Feed filter
    let mut y = self.filt.process(osc);
    
    // Post-filter drive (with original drive parameter)
    y = Self::soft_clip_drive(y, drive);
    
    // Amp from env (303 short decay)
    y *= env;

    // Denormal protection
    if !y.is_finite() || y.abs() < 1e-24 { y = 0.0; }
    y
  }
}
