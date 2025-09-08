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
#[derive(Clone, Copy)]
struct Exciter {
    noise_state: u32,
    impulse_counter: u32,
    noise_lp: f32,
    strike_counter: u32,
}

impl Exciter {
    pub fn new() -> Self {
        Self {
            noise_state: 1,
            impulse_counter: 0,
            noise_lp: 0.0,
            strike_counter: 0,
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
                signal = self.white_noise() * amount;
            },
            2 => {
                // Click exciter - brief burst of high frequency content
                if triggered {
                    self.impulse_counter = (sr * 0.001).max(1.0) as u32; // 1ms click
                }
                
                if self.impulse_counter > 0 {
                    self.impulse_counter -= 1;
                    // Generate click with alternating polarity for high-freq content
                    let click_sample = if self.impulse_counter % 2 == 0 { 1.0 } else { -1.0 };
                    // Apply exponential decay over the click duration
                    let decay_factor = self.impulse_counter as f32 / (sr * 0.001).max(1.0);
                    signal = click_sample * amount * 8.0 * decay_factor;
                } else {
                    signal = 0.0;
                }
            },
            _ => {
                signal = 0.0;
            }
        }
        
        // Apply color filtering to all exciter types - noise_color ranges from -1 to +1
        if noise_color.abs() > 0.01 {
            // More aggressive filtering for audible effect
            let alpha = 0.05 + noise_color.abs() * 0.6; // 0.05 to 0.65 filter strength
            if noise_color > 0.0 {
                // Positive = highpass (brighter) - let high frequencies through
                self.noise_lp = self.noise_lp * (1.0 - alpha) + signal * alpha;
                signal = signal - self.noise_lp; // Highpass
            } else {
                // Negative = lowpass (darker) - smooth out high frequencies  
                self.noise_lp = self.noise_lp * (1.0 - alpha) + signal * alpha;
                signal = self.noise_lp; // Lowpass
            }
        }
        
        // Auto-retrigger (strike rate) - creates rhythmic re-excitation
        if strike_rate > 0.01 {
            // Convert strike rate to Hz (0-1 maps to 0.5-10 Hz for more musical control)
            let strike_hz = 0.5 + strike_rate * 9.5;
            let samples_per_strike = (sr / strike_hz).max(1.0);
            
            // Use separate strike counter
            self.strike_counter = (self.strike_counter + 1) % samples_per_strike as u32;
            if self.strike_counter == 0 {
                // Generate more noticeable periodic excitation bursts
                signal += amount * 0.7; // Stronger auto-excitation for audible effect
            }
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
    
    // Parameter caching to avoid expensive recalculations
    last_pitch: f32,
    last_decay: f32,
    last_brightness: f32,
    last_bank_size: usize,
    last_mode: i32,
    last_inharmonicity: f32,
    last_randomize: f32,
    last_body_blend: f32,
    
    // Body blend partial weights (precomputed for performance)
    partial_weights: Vec<f32>,
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
            // Initialize cache with invalid values to force first update
            last_pitch: -999.0,
            last_decay: -999.0,
            last_brightness: -999.0,
            last_bank_size: 999,
            last_mode: -999,
            last_inharmonicity: -999.0,
            last_randomize: -999.0,
            last_body_blend: -999.0,
            
            // Initialize partial weights
            partial_weights: vec![1.0; max_resonators],
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

    // Compute partial weights for body blend between "stringy" and "plate/glass" materials
    fn compute_partial_weights(&mut self, body_blend: f32, bank_size: usize) {
        for i in 0..bank_size {
            let partial = i as f32 + 1.0;
            
            // String curve: 1/(i+1)^1.2 with slight odd-harmonic bias
            let string_weight = 1.0 / partial.powf(1.2);
            let odd_bias = if i % 2 == 0 { 1.05 } else { 1.0 }; // Slight boost for odd harmonics (1st, 3rd, 5th...)
            let string_weight = string_weight * odd_bias;
            
            // Plate curve: 1/(i+1)^0.6 with high-shelf boost for higher partials
            let plate_weight = 1.0 / partial.powf(0.6);
            let high_shelf = if i >= 7 { 1.5 } else { 1.0 }; // +3dB boost for partial 8+ (index 7+)
            let plate_weight = plate_weight * high_shelf;
            
            // Interpolate between curves
            let weight = string_weight * (1.0 - body_blend) + plate_weight * body_blend;
            self.partial_weights[i] = weight;
        }
        
        // Normalize weights so sum approximately equals bank_size for consistent loudness
        let sum: f32 = self.partial_weights[0..bank_size].iter().sum();
        if sum > 0.001 {
            let normalization = bank_size as f32 / sum;
            for i in 0..bank_size {
                self.partial_weights[i] *= normalization;
            }
        }
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
        let _stereo_width = params.get_f32_h(param_keys.stereo_width, 0.0);
        let randomize = params.get_f32_h(param_keys.randomize, 0.0);
        let body_blend = params.get_f32_h(param_keys.body_blend, 0.4);
        let output_gain_db = params.get_f32_h(param_keys.output_gain, 0.0);

        // Calculate base frequency with pitch offset
        let note_freq = midi_to_freq(self.note);
        let base_freq = note_freq * cents_to_ratio(pitch_offset * 4800.0); // ±48 semitones
        
        // Only update resonator frequencies if parameters have changed (performance optimization)
        let params_changed = pitch_offset != self.last_pitch || 
                            decay != self.last_decay ||
                            brightness != self.last_brightness ||
                            bank_size != self.last_bank_size ||
                            mode != self.last_mode ||
                            inharmonicity != self.last_inharmonicity ||
                            randomize != self.last_randomize ||
                            body_blend != self.last_body_blend;
        
        if params_changed || self.just_triggered {
            // Update cache
            self.last_pitch = pitch_offset;
            self.last_decay = decay;
            self.last_brightness = brightness;
            self.last_bank_size = bank_size;
            self.last_mode = mode;
            self.last_inharmonicity = inharmonicity;
            self.last_randomize = randomize;
            self.last_body_blend = body_blend;
            
            // Compute partial weights for body blend
            self.compute_partial_weights(body_blend, bank_size);
            
            // Update resonator bank based on mode
            match mode {
            0 => { // Modal mode - harmonic resonators
                for i in 0..bank_size {
                    let partial = i as f32 + 1.0;
                    let harmonic_freq = base_freq * partial;
                    
                    // Add inharmonicity (detunes higher harmonics)
                    // inharmonicity comes as 0-2 range from UI, scale appropriately
                    let detune_cents = inharmonicity * partial * partial * 5.0; // Reduced scaling
                    
                    // Add randomization to frequency
                    let random_detune = if randomize > 0.01 {
                        // Use voice note as seed for consistent randomness per voice
                        let seed = (self.note as f32 * 17.0 + i as f32 * 23.0) % 1000.0;
                        let random_factor = (seed.sin() * 2.0 - 1.0) * randomize * 50.0; // ±50 cents max
                        random_factor
                    } else {
                        0.0
                    };
                    
                    let freq = harmonic_freq * cents_to_ratio(detune_cents + random_detune);
                    
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
        } // Close the if params_changed block
        
        // Generate excitation (velocity now only affects note-on amplitude via global MIDI routing)
        let excitation = self.exciter.process(
            exciter_type, exciter_amount, noise_color, 
            strike_rate, self.sr, self.just_triggered
        );
        
        self.just_triggered = false;
        
        // Apply drive/saturation
        let driven_excitation = if drive > 0.01 {
            // Simple but effective drive: 0-1 maps to 1x-5x gain
            let gain = 1.0 + drive * 4.0;
            let driven = excitation * gain;
            // Simple tanh saturation - predictable and musical
            driven.tanh()
        } else {
            excitation
        };
        
        // Process through resonator bank
        let mut output = 0.0;
        
        if mode == 1 && bank_size > 0 { // Comb mode with feedback
            // Scale feedback to be more audible (0-1 UI range to 0-0.98 for stability)
            let scaled_feedback = feedback * 0.98;
            let resonator_out = self.resonators[0].process(driven_excitation + output * scaled_feedback);
            // Apply simple spectral tilt based on body blend (0 = warmer, 1 = brighter)
            let body_tilt = 0.7 + body_blend * 0.6; // Range from 0.7 to 1.3
            output = resonator_out * body_tilt;
        } else { // Modal mode - feedback adds inter-resonator coupling
            let scaled_feedback = feedback * 0.3; // Lower feedback for stability in modal mode
            for i in 0..bank_size {
                if self.resonator_gains[i] > 0.001 {
                    // Add feedback from current output to create coupling between resonators
                    let input = driven_excitation + output * scaled_feedback;
                    let resonator_out = self.resonators[i].process(input);
                    // Apply both resonator gain and body blend weight
                    let combined_gain = self.resonator_gains[i] * self.partial_weights[i];
                    output += resonator_out * combined_gain;
                }
            }
        }
        
        // Apply output gain (±1 range for ±24dB)
        output *= db_to_gain(output_gain_db * 24.0);
        
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
    pub body_blend: u64,
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
