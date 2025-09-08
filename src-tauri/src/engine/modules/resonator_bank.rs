use std::f32::consts::PI;
use crate::engine::params::ParamStore;

// Helper functions
#[inline]
fn midi_to_freq(m: u8) -> f32 { 440.0 * 2f32.powf((m as f32 - 69.0) / 12.0) }

#[inline]
fn cents_to_ratio(c: f32) -> f32 { 2f32.powf(c / 1200.0) }

#[inline]
fn db_to_gain(db: f32) -> f32 { 10f32.powf(db / 20.0) }

// Simple exciter for generating different types of excitation
#[derive(Clone)]
pub struct Exciter {
    noise_state: u32,
    impulse_counter: u32,
}

impl Exciter {
    pub fn new() -> Self {
        Self {
            noise_state: 1,
            impulse_counter: 0,
        }
    }

    fn reset(&mut self) {
        self.impulse_counter = 10; // Start impulse for 10 samples
    }

    fn white_noise(&mut self) -> f32 {
        self.noise_state = self.noise_state.wrapping_mul(1103515245).wrapping_add(12345);
        ((self.noise_state >> 16) as i16 as f32) / 32768.0
    }

    fn process(&mut self, exciter_type: i32, amount: f32, noise_color: f32, 
               strike_rate: f32, sr: f32, triggered: bool) -> f32 {
        let mut signal = 0.0;
        
        match exciter_type {
            0 => { // Impulse
                if triggered {
                    self.impulse_counter = 10; // Reset impulse duration
                }
                if self.impulse_counter > 0 {
                    signal = amount * 5.0; // Boost impulse amplitude for better resonator excitation
                    self.impulse_counter -= 1;
                }
            },
            1 => { // Noise
                let noise = self.white_noise() * amount;
                // Apply color filtering
                if noise_color.abs() > 0.01 {
                    // Simple one-pole filter for color
                    signal = noise; // For now, just pass through
                } else {
                    signal = noise;
                }
            },
            _ => {
                signal = 0.0;
            }
        }
        
        // Auto-retrigger (strike rate)
        if strike_rate > 0.01 {
            // Simple auto-trigger implementation
            signal += amount * 0.1; // Small continuous excitation
        }
        
        signal
    }
}

// Simple biquad for resonators
#[derive(Clone, Copy)]
pub struct Biquad {
    b0: f32, b1: f32, b2: f32,
    a1: f32, a2: f32,
    x1: f32, x2: f32,
    y1: f32, y2: f32,
}

impl Biquad {
    pub fn new() -> Self {
        Self {
            b0: 1.0, b1: 0.0, b2: 0.0,
            a1: 0.0, a2: 0.0,
            x1: 0.0, x2: 0.0,
            y1: 0.0, y2: 0.0,
        }
    }

    pub fn set_bandpass(&mut self, freq: f32, q: f32, sr: f32) {
        let w = 2.0 * PI * freq / sr;
        let cosw = w.cos();
        let sinw = w.sin();
        let alpha = sinw / (2.0 * q);
        
        let norm = 1.0 / (1.0 + alpha);
        self.b0 = alpha * norm;
        self.b1 = 0.0;
        self.b2 = -alpha * norm;
        self.a1 = -2.0 * cosw * norm;
        self.a2 = (1.0 - alpha) * norm;
    }

    pub fn process(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.b1 * self.x1 + self.b2 * self.x2
                   - self.a1 * self.y1 - self.a2 * self.y2;
        
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = output;
        
        output
    }
}

// Single voice for polyphonic resonator bank
#[derive(Clone)]
pub struct ResonatorVoice {
    sr: f32,
    note: u8,
    velocity: f32,
    gate: bool,
    just_triggered: bool,
    
    // Resonator bank
    resonators: Vec<Biquad>,
    resonator_gains: Vec<f32>,
    
    // Excitation
    exciter: Exciter,
    
    // Output processing
    limiter_state: f32,
}

impl ResonatorVoice {
    pub fn new(sr: f32) -> Self {
        let max_resonators = 8;
        
        Self {
            sr,
            note: 60,
            velocity: 0.0,
            gate: false,
            just_triggered: false,
            resonators: vec![Biquad::new(); max_resonators],
            resonator_gains: vec![0.0; max_resonators],
            exciter: Exciter::new(),
            limiter_state: 0.0,
        }
    }

    pub fn is_active(&self) -> bool {
        self.gate || self.limiter_state.abs() > 1e-6
    }

    pub fn note_on(&mut self, note: u8, velocity: f32) {
        self.note = note;
        self.velocity = velocity;
        self.gate = true;
        self.just_triggered = true;
        self.exciter.reset();
    }

    pub fn note_off(&mut self) {
        self.gate = false;
    }

    pub fn render(&mut self, params: &ParamStore, param_keys: &ResonatorParamKeys) -> f32 {
        // Get parameters
        let pitch_offset = params.get_f32_h(param_keys.pitch, 0.0); // ±1 for ±48 semitones
        let decay = params.get_f32_h(param_keys.decay, 0.5);
        let brightness = params.get_f32_h(param_keys.brightness, 0.5);
        let bank_size = params.get_i32_h(param_keys.bank_size, 8).max(1).min(8) as usize;
        let mode = params.get_i32_h(param_keys.mode, 0);
        let inharmonicity = params.get_f32_h(param_keys.inharmonicity, 0.1);
        let feedback = params.get_f32_h(param_keys.feedback, 0.3);
        let drive = params.get_f32_h(param_keys.drive, 0.0);
        let exciter_type = params.get_i32_h(param_keys.exciter_type, 0);
        let exciter_amount = params.get_f32_h(param_keys.exciter_amount, 0.5);
        let noise_color = params.get_f32_h(param_keys.noise_color, 0.0);
        let strike_rate = params.get_f32_h(param_keys.strike_rate, 0.0);
        let velocity_sens = params.get_f32_h(param_keys.velocity_sens, 0.5);
        let output_gain_db = params.get_f32_h(param_keys.output_gain, 0.0);

        // Calculate base frequency with pitch offset
        let note_freq = midi_to_freq(self.note);
        let base_freq = note_freq * cents_to_ratio(pitch_offset * 4800.0); // ±48 semitones
        
        // Update resonator bank based on mode
        match mode {
            0 => { // Modal mode - harmonic resonators
                for i in 0..bank_size {
                    let partial = i as f32 + 1.0;
                    let harmonic_freq = base_freq * partial;
                    
                    // Add inharmonicity (detunes higher harmonics)
                    let detune_cents = inharmonicity * partial * partial * 10.0;
                    let freq = harmonic_freq * cents_to_ratio(detune_cents);
                    
                    // Higher partials decay faster (brightness control)
                    let decay_factor = 1.0 - brightness * 0.8 * (i as f32 / bank_size as f32);
                    let q = 5.0 + decay * 45.0 * decay_factor;
                    
                    self.resonators[i].set_bandpass(freq.min(self.sr * 0.45), q, self.sr);
                    
                    // Amplitude rolloff for higher partials
                    let gain = (1.0 / (partial + brightness * partial * 2.0)).sqrt();
                    self.resonator_gains[i] = gain;
                }
            },
            1 => { // Comb mode - single resonator with feedback
                if bank_size > 0 {
                    let filter_freq = base_freq * (1.0 + brightness * 2.0);
                    let q = 2.0 + decay * 8.0;
                    self.resonators[0].set_bandpass(filter_freq.min(self.sr * 0.45), q, self.sr);
                    self.resonator_gains[0] = 1.0;
                    
                    // Disable other resonators
                    for i in 1..bank_size {
                        self.resonator_gains[i] = 0.0;
                    }
                }
            },
            _ => { // Default to modal mode
                for i in 0..bank_size {
                    let partial = i as f32 + 1.0;
                    let harmonic_freq = base_freq * partial;
                    let q = 5.0 + decay * 45.0;
                    
                    self.resonators[i].set_bandpass(harmonic_freq.min(self.sr * 0.45), q, self.sr);
                    self.resonator_gains[i] = 1.0 / partial.sqrt();
                }
            }
        }
        
        // Generate excitation with velocity sensitivity
        let vel_factor = 1.0 - velocity_sens + velocity_sens * self.velocity;
        let exc_amount = exciter_amount * vel_factor;
        let excitation = self.exciter.process(
            exciter_type, exc_amount, noise_color, 
            strike_rate, self.sr, self.just_triggered
        );
        
        self.just_triggered = false;
        
        // Apply drive/saturation
        let driven_excitation = if drive > 0.01 {
            let gain = 1.0 + drive * 10.0;
            (excitation * gain).tanh() / gain.tanh()
        } else {
            excitation
        };
        
        // Process through resonator bank
        let mut output = 0.0;
        
        if mode == 1 && bank_size > 0 { // Comb mode with feedback
            let resonator_out = self.resonators[0].process(driven_excitation + output * feedback.min(0.95));
            output = resonator_out;
        } else { // Modal mode
            for i in 0..bank_size {
                if self.resonator_gains[i] > 0.001 {
                    let resonator_out = self.resonators[i].process(driven_excitation);
                    output += resonator_out * self.resonator_gains[i];
                }
            }
        }
        
        // Apply output gain
        output *= db_to_gain(output_gain_db);
        
        // Update limiter state for voice activity detection
        self.limiter_state = output;
        
        output
    }
}

// Parameter keys for the resonator bank
#[derive(Clone)]
pub struct ResonatorParamKeys {
    pub module_kind: u64,
    pub pitch: u64,
    pub decay: u64,
    pub brightness: u64,
    pub bank_size: u64,
    pub mode: u64,
    pub inharmonicity: u64,
    pub feedback: u64,
    pub drive: u64,
    pub exciter_type: u64,
    pub exciter_amount: u64,
    pub noise_color: u64,
    pub strike_rate: u64,
    pub stereo_width: u64,
    pub randomize: u64,
    pub velocity_sens: u64,
    pub output_gain: u64,
}

// Main ResonatorBank structure with polyphonic voices
#[derive(Clone)]
pub struct ResonatorBank {
    sr: f32,
    voices: [ResonatorVoice; 3], // 3-voice polyphony
    voice_allocator: usize,
}

impl ResonatorBank {
    pub fn new(sr: f32) -> Self {
        Self {
            sr,
            voices: [
                ResonatorVoice::new(sr),
                ResonatorVoice::new(sr),
                ResonatorVoice::new(sr),
            ],
            voice_allocator: 0,
        }
    }

    pub fn note_on(&mut self, note: u8, velocity: f32) {
        // Find a free voice or steal the oldest
        let voice_idx = self.find_free_voice().unwrap_or_else(|| {
            let idx = self.voice_allocator;
            self.voice_allocator = (self.voice_allocator + 1) % 3;
            idx
        });
        
        self.voices[voice_idx].note_on(note, velocity);
    }

    pub fn note_off(&mut self, note: u8) {
        // Find the voice playing this note
        for voice in &mut self.voices {
            if voice.gate && voice.note == note {
                voice.note_off();
                break;
            }
        }
    }

    fn find_free_voice(&self) -> Option<usize> {
        for (i, voice) in self.voices.iter().enumerate() {
            if !voice.is_active() {
                return Some(i);
            }
        }
        None
    }

    pub fn render_one(&mut self, params: &ParamStore, param_keys: &ResonatorParamKeys) -> f32 {
        let mut output = 0.0;
        
        for voice in &mut self.voices {
            if voice.is_active() {
                output += voice.render(params, param_keys);
            }
        }
        
        // Simple voice limiting
        output = output.clamp(-1.0, 1.0);
        
        output
    }
}
