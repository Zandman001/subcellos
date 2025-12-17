// Korus - 6-voice polyphonic Juno-style synthesizer
//
// Features:
// - DCO with Saw/Pulse crossfade, PWM, Sub oscillator, Noise
// - Juno-style 4-pole (24dB) lowpass filter with resonance
// - Single ADSR envelope (shared amp/filter)
// - LFO for PWM and filter modulation
// - BBD-style stereo chorus

use std::f32::consts::PI;
use crate::engine::params::ParamStore;

const TAU: f32 = 2.0 * PI;
const NUM_VOICES: usize = 6;

// ─── Juno-style 4-pole Lowpass Filter ───────────────────────────────────────
// Cascade of 4 one-pole sections with resonance feedback
// Warm, smooth character with nice self-oscillation at high resonance

struct Juno4Pole {
    s: [f32; 4],  // 4 filter stages
    sr: f32,
}

impl Juno4Pole {
    fn new(sr: f32) -> Self {
        Self { s: [0.0; 4], sr }
    }

    #[inline]
    fn process(&mut self, input: f32, cutoff_hz: f32, reso: f32) -> f32 {
        // Clamp cutoff to safe range
        let fc = (cutoff_hz / self.sr).clamp(0.001, 0.49);
        let g = (PI * fc).tan();
        
        // Resonance feedback (k = 0 to 4 for self-oscillation)
        let k = reso * 4.0;
        
        // Feedback from 4th stage output (inverted for negative feedback)
        let fb = self.s[3].tanh() * k;
        let x = (input - fb).clamp(-5.0, 5.0);
        
        // Process through 4 cascaded one-pole lowpass stages
        let mut sig = x;
        for i in 0..4 {
            let v = (sig - self.s[i]) * g / (1.0 + g);
            let y = v + self.s[i];
            self.s[i] = y + v;
            sig = y;
        }
        
        self.s[3]
    }

    fn reset(&mut self) {
        self.s = [0.0; 4];
    }
}

// ─── BBD-style Stereo Chorus ────────────────────────────────────────────────
// Classic Juno chorus: dual delay lines with LFO modulation
// Creates that warm, shimmering stereo spread

struct BbdChorus {
    buf_l: Vec<f32>,
    buf_r: Vec<f32>,
    write_pos: usize,
    lfo_phase: f32,
    sr: f32,
}

impl BbdChorus {
    fn new(sr: f32) -> Self {
        // ~15ms buffer for delay modulation headroom
        let buf_size = ((sr * 0.015) as usize).max(256);
        Self {
            buf_l: vec![0.0; buf_size],
            buf_r: vec![0.0; buf_size],
            write_pos: 0,
            lfo_phase: 0.0,
            sr,
        }
    }

    #[inline]
    fn read_interpolated(&self, delay_samples: f32, buf: &[f32]) -> f32 {
        let len = buf.len();
        let delay_clamped = delay_samples.clamp(1.0, (len - 2) as f32);
        let read_pos = (self.write_pos as f32 - delay_clamped + len as f32) % len as f32;
        
        let idx0 = read_pos.floor() as usize % len;
        let idx1 = (idx0 + 1) % len;
        let frac = read_pos.fract();
        
        buf[idx0] * (1.0 - frac) + buf[idx1] * frac
    }

    #[inline]
    fn process(&mut self, in_l: f32, in_r: f32, depth: f32, rate: f32) -> (f32, f32) {
        if depth < 0.001 {
            return (in_l, in_r);
        }

        // LFO for delay time modulation (0.1 - 5 Hz)
        let lfo_hz = 0.1 + rate * 4.9;
        self.lfo_phase += lfo_hz / self.sr;
        if self.lfo_phase >= 1.0 { self.lfo_phase -= 1.0; }
        
        // Sine LFO with quadrature offset for stereo
        let lfo_l = (self.lfo_phase * TAU).sin();
        let lfo_r = ((self.lfo_phase + 0.25) * TAU).sin(); // 90 degree offset
        
        // Base delay ~3ms, modulated +/-1.5ms
        let base_delay = 0.003 * self.sr;
        let mod_depth = 0.0015 * self.sr * depth;
        
        let delay_l = base_delay + lfo_l * mod_depth;
        let delay_r = base_delay + lfo_r * mod_depth;
        
        // Read wet signal from delay lines
        let wet_l = self.read_interpolated(delay_l, &self.buf_l);
        let wet_r = self.read_interpolated(delay_r, &self.buf_r);
        
        // Write to delay lines (mono input for classic Juno behavior)
        let mono_in = (in_l + in_r) * 0.5;
        self.buf_l[self.write_pos] = mono_in;
        self.buf_r[self.write_pos] = mono_in;
        self.write_pos = (self.write_pos + 1) % self.buf_l.len();
        
        // Mix: dry center, wet adds stereo width
        let mix = depth * 0.7; // Juno chorus is fairly subtle
        (
            in_l + wet_l * mix,
            in_r + wet_r * mix
        )
    }
}

// ─── ADSR Envelope ──────────────────────────────────────────────────────────

struct KorusEnv {
    sr: f32,
    value: f32,
    gate: bool,
    stage: EnvStage,
}

#[derive(Clone, Copy, PartialEq)]
enum EnvStage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

impl KorusEnv {
    fn new(sr: f32) -> Self {
        Self {
            sr,
            value: 0.0,
            gate: false,
            stage: EnvStage::Idle,
        }
    }

    fn gate_on(&mut self) {
        self.gate = true;
        self.stage = EnvStage::Attack;
    }

    fn gate_off(&mut self) {
        self.gate = false;
        if self.stage != EnvStage::Idle {
            self.stage = EnvStage::Release;
        }
    }

    fn retrigger(&mut self) {
        self.gate = true;
        self.stage = EnvStage::Attack;
        // Don't reset value - attack from current level for click-free retrigger
    }

    #[inline]
    fn process(&mut self, a: f32, d: f32, s: f32, r: f32) -> f32 {
        let a_time = a.max(0.001);
        let d_time = d.max(0.001);
        let r_time = r.max(0.001);
        let s_level = s.clamp(0.0, 1.0);

        match self.stage {
            EnvStage::Idle => {
                self.value = 0.0;
            }
            EnvStage::Attack => {
                let rate = 1.0 / (a_time * self.sr);
                self.value += rate;
                if self.value >= 1.0 {
                    self.value = 1.0;
                    self.stage = EnvStage::Decay;
                }
            }
            EnvStage::Decay => {
                let rate = (1.0 - s_level) / (d_time * self.sr);
                self.value -= rate;
                if self.value <= s_level {
                    self.value = s_level;
                    self.stage = EnvStage::Sustain;
                }
            }
            EnvStage::Sustain => {
                self.value = s_level;
            }
            EnvStage::Release => {
                let rate = self.value.max(0.001) / (r_time * self.sr);
                self.value -= rate;
                if self.value <= 0.0 {
                    self.value = 0.0;
                    self.stage = EnvStage::Idle;
                }
            }
        }

        self.value
    }

    fn is_active(&self) -> bool {
        self.stage != EnvStage::Idle || self.value > 1e-5
    }
}

// ─── Korus Voice ────────────────────────────────────────────────────────────

struct KorusVoice {
    active: bool,
    note: u8,
    age: u64,
    freq: f32,
    phase: f32,      // Main oscillator
    sub_phase: f32,  // Sub oscillator (1 octave down)
    env: KorusEnv,
    filter: Juno4Pole,
    sr: f32,
}

impl KorusVoice {
    fn new(sr: f32) -> Self {
        Self {
            active: false,
            note: 0,
            age: 0,
            freq: 440.0,
            phase: 0.0,
            sub_phase: 0.0,
            env: KorusEnv::new(sr),
            filter: Juno4Pole::new(sr),
            sr,
        }
    }

    fn note_on(&mut self, note: u8) {
        self.active = true;
        self.note = note;
        self.age = 0;
        self.freq = 440.0 * (2.0_f32).powf((note as f32 - 69.0) / 12.0);
        // Don't reset phase for warmer sound (free-running oscillators)
        self.env.gate_on();
    }

    fn retrigger(&mut self) {
        self.active = true;
        self.age = 0;
        self.env.retrigger();
    }

    fn note_off(&mut self) {
        self.env.gate_off();
    }

    fn is_active(&self) -> bool {
        self.active || self.env.is_active()
    }

    #[inline]
    fn render(
        &mut self,
        wave: f32,       // 0 = saw, 1 = pulse
        pwm: f32,        // pulse width
        sub_level: f32,
        noise_level: f32,
        cutoff: f32,
        reso: f32,
        env_amt: f32,
        lfo_filter: f32,
        lfo_value: f32,  // current LFO value (-1 to 1)
        a: f32, d: f32, s: f32, r: f32,
        rng: &mut u32,
    ) -> f32 {
        if !self.is_active() {
            return 0.0;
        }

        self.age += 1;

        // Process envelope
        let env = self.env.process(a, d, s, r);
        
        if env < 1e-6 {
            self.active = false;
            return 0.0;
        }

        // ─── Oscillator ───
        
        // Advance phases
        let phase_inc = self.freq / self.sr;
        self.phase += phase_inc;
        if self.phase >= 1.0 { self.phase -= 1.0; }
        
        self.sub_phase += phase_inc * 0.5; // Sub is 1 octave down
        if self.sub_phase >= 1.0 { self.sub_phase -= 1.0; }

        // Saw wave (naive but sounds fine with filter)
        let saw = self.phase * 2.0 - 1.0;
        
        // Pulse wave with PWM
        let pw = 0.05 + pwm * 0.9; // 5% to 95% duty cycle
        let pulse = if self.phase < pw { 1.0 } else { -1.0 };
        
        // Crossfade saw/pulse
        let main_osc = saw * (1.0 - wave) + pulse * wave;
        
        // Sub oscillator (square, 1 octave down)
        let sub = if self.sub_phase < 0.5 { 1.0 } else { -1.0 };
        
        // Noise (simple xorshift)
        *rng ^= *rng << 13;
        *rng ^= *rng >> 17;
        *rng ^= *rng << 5;
        let noise = (*rng as f32 / u32::MAX as f32) * 2.0 - 1.0;
        
        // Mix oscillators
        let osc_out = main_osc + sub * sub_level + noise * noise_level;

        // ─── Filter ───
        
        // Calculate filter cutoff with envelope and LFO modulation
        // Map normalized cutoff (0-1) to Hz (20 - 20000, logarithmic)
        let base_hz = 20.0 * (1000.0_f32).powf(cutoff);
        
        // Envelope modulation (positive only, like Juno)
        let env_mod = env * env_amt * base_hz * 2.0;
        
        // LFO modulation (bipolar)
        let lfo_mod = lfo_value * lfo_filter * base_hz * 0.5;
        
        let final_cutoff = (base_hz + env_mod + lfo_mod).clamp(20.0, 20000.0);
        
        let filtered = self.filter.process(osc_out, final_cutoff, reso);

        // Apply envelope as VCA
        filtered * env
    }
}

// ─── Param Keys ─────────────────────────────────────────────────────────────

pub struct KorusParamKeys {
    // OSC subpage
    pub wave: u64,
    pub pwm: u64,
    pub sub: u64,
    pub noise: u64,
    // FILTER subpage
    pub cutoff: u64,
    pub reso: u64,
    pub env_amt: u64,
    pub lfo_filter: u64,
    // ENV subpage
    pub attack: u64,
    pub decay: u64,
    pub sustain: u64,
    pub release: u64,
    // MOD subpage
    pub lfo_rate: u64,
    pub lfo_pwm: u64,
    pub chorus: u64,
    pub chorus_rate: u64,
}

impl KorusParamKeys {
    pub fn new(part: usize) -> Self {
        use crate::engine::params::path_hash;
        let p = |name: &str| path_hash(&format!("part/{}/korus/{}", part, name));
        Self {
            wave: p("wave"),
            pwm: p("pwm"),
            sub: p("sub"),
            noise: p("noise"),
            cutoff: p("cutoff"),
            reso: p("reso"),
            env_amt: p("env_amt"),
            lfo_filter: p("lfo_filter"),
            attack: p("attack"),
            decay: p("decay"),
            sustain: p("sustain"),
            release: p("release"),
            lfo_rate: p("lfo_rate"),
            lfo_pwm: p("lfo_pwm"),
            chorus: p("chorus"),
            chorus_rate: p("chorus_rate"),
        }
    }
}

// ─── Main Korus Synth ───────────────────────────────────────────────────────

pub struct Korus {
    sr: f32,
    voices: [KorusVoice; NUM_VOICES],
    next_voice: usize,
    lfo_phase: f32,
    chorus: BbdChorus,
    rng: u32,
}

impl Korus {
    pub fn new(sr: f32) -> Self {
        Self {
            sr,
            voices: std::array::from_fn(|_| KorusVoice::new(sr)),
            next_voice: 0,
            lfo_phase: 0.0,
            chorus: BbdChorus::new(sr),
            rng: 0x12345678,
        }
    }

    pub fn note_on(&mut self, note: u8, _vel: f32) {
        // Check if same note is already playing - retrigger it
        for voice in &mut self.voices {
            if voice.note == note && voice.is_active() {
                voice.retrigger();
                return;
            }
        }

        // Find first free voice
        let mut idx = None;
        for (i, voice) in self.voices.iter().enumerate() {
            if !voice.is_active() {
                idx = Some(i);
                break;
            }
        }

        // If no free voice, steal oldest
        let i = idx.unwrap_or_else(|| {
            let mut oldest_idx = 0;
            let mut oldest_age = 0u64;
            for (i, voice) in self.voices.iter().enumerate() {
                if voice.age > oldest_age {
                    oldest_age = voice.age;
                    oldest_idx = i;
                }
            }
            oldest_idx
        });

        self.voices[i].note_on(note);
    }

    pub fn note_off(&mut self, note: u8) {
        for voice in &mut self.voices {
            if voice.note == note && voice.active {
                voice.note_off();
            }
        }
    }

    /// Render one stereo sample pair
    #[inline]
    pub fn render_one(&mut self, params: &ParamStore, keys: &KorusParamKeys) -> (f32, f32) {
        // Read parameters
        let wave = params.get_f32_h(keys.wave, 0.0).clamp(0.0, 1.0);
        let pwm_base = params.get_f32_h(keys.pwm, 0.5).clamp(0.0, 1.0);
        let sub = params.get_f32_h(keys.sub, 0.0).clamp(0.0, 1.0);
        let noise = params.get_f32_h(keys.noise, 0.0).clamp(0.0, 1.0);
        
        let cutoff = params.get_f32_h(keys.cutoff, 0.7).clamp(0.0, 1.0);
        let reso = params.get_f32_h(keys.reso, 0.0).clamp(0.0, 1.0);
        let env_amt = params.get_f32_h(keys.env_amt, 0.3).clamp(0.0, 1.0);
        let lfo_filter = params.get_f32_h(keys.lfo_filter, 0.0).clamp(0.0, 1.0);
        
        let attack = params.get_f32_h(keys.attack, 0.01).clamp(0.001, 10.0);
        let decay = params.get_f32_h(keys.decay, 0.2).clamp(0.001, 10.0);
        let sustain = params.get_f32_h(keys.sustain, 0.8).clamp(0.0, 1.0);
        let release = params.get_f32_h(keys.release, 0.3).clamp(0.001, 10.0);
        
        let lfo_rate = params.get_f32_h(keys.lfo_rate, 0.3).clamp(0.0, 1.0);
        let lfo_pwm = params.get_f32_h(keys.lfo_pwm, 0.0).clamp(0.0, 1.0);
        let chorus_depth = params.get_f32_h(keys.chorus, 0.5).clamp(0.0, 1.0);
        let chorus_rate = params.get_f32_h(keys.chorus_rate, 0.3).clamp(0.0, 1.0);

        // Update LFO (0.1 - 10 Hz)
        let lfo_hz = 0.1 + lfo_rate * 9.9;
        self.lfo_phase += lfo_hz / self.sr;
        if self.lfo_phase >= 1.0 { self.lfo_phase -= 1.0; }
        let lfo_value = (self.lfo_phase * TAU).sin();

        // Apply LFO to PWM
        let pwm = (pwm_base + lfo_value * lfo_pwm * 0.4).clamp(0.05, 0.95);

        // Render all voices
        let mut mix = 0.0;
        for voice in &mut self.voices {
            mix += voice.render(
                wave, pwm, sub, noise,
                cutoff, reso, env_amt, lfo_filter, lfo_value,
                attack, decay, sustain, release,
                &mut self.rng,
            );
        }

        // Scale down for headroom
        mix *= 0.25;

        // Process through chorus (mono in, stereo out)
        let (out_l, out_r) = self.chorus.process(mix, mix, chorus_depth, chorus_rate);

        // Soft clip for warmth
        (out_l.tanh(), out_r.tanh())
    }
}
