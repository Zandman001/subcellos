use crate::engine::params::ParamStore;

#[derive(Clone)]
struct DelayLine {
    buffer: Vec<f32>,
    write_pos: usize,
    length: usize,
}

impl DelayLine {
    fn new(max_length: usize) -> Self {
        Self {
            buffer: vec![0.0; max_length],
            write_pos: 0,
            length: max_length,
        }
    }

    fn set_length(&mut self, length: usize) {
        self.length = length.min(self.buffer.len()).max(1);
        if self.write_pos >= self.length {
            self.write_pos = 0;
        }
    }

    fn read(&self) -> f32 {
        let read_pos = if self.write_pos >= self.length { 
            self.write_pos - self.length 
        } else { 
            self.write_pos + self.buffer.len() - self.length 
        } % self.buffer.len();
        self.buffer[read_pos]
    }

    fn write(&mut self, sample: f32) {
        self.buffer[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.buffer.len();
    }

    fn clear(&mut self) {
        self.buffer.fill(0.0);
        self.write_pos = 0;
    }
}

#[derive(Clone)]
struct OnePoleLP {
    y1: f32,
    a: f32,
}

impl OnePoleLP {
    fn new() -> Self {
        Self { y1: 0.0, a: 0.5 }
    }

    fn set_cutoff(&mut self, cutoff: f32, sr: f32) {
        // Simple one-pole lowpass: y[n] = a*x[n] + (1-a)*y[n-1]
        // where a = 2 * pi * fc / sr (for small fc/sr)
        let normalized_cutoff = (cutoff / sr).clamp(0.0001, 0.4);
        self.a = (2.0 * std::f32::consts::PI * normalized_cutoff).clamp(0.0001, 0.9);
    }

    fn process(&mut self, input: f32) -> f32 {
        self.y1 = self.a * input + (1.0 - self.a) * self.y1;
        self.y1
    }
}

#[derive(Clone)]
pub struct KarplusStrong {
    sr: f32,
    delay_line: DelayLine,
    filter: OnePoleLP,
    excite_counter: u32,
    excite_length: u32,
    gate: bool,
    just_triggered: bool,
    rng: u32,
    base_note: u8,
    last_tune: f32,
}

#[derive(Clone)]
pub struct KSParamKeys {
    #[allow(dead_code)]
    pub module_kind: u64,
    pub decay: u64,
    pub damp: u64,
    pub excite: u64,
    pub tune: u64,
}

impl KarplusStrong {
    pub fn new(sr: f32) -> Self {
        // Max delay for ~27 Hz (lowest MIDI note ~27.5 Hz)
        let max_delay_samples = (sr / 25.0) as usize;
        
        Self {
            sr,
            delay_line: DelayLine::new(max_delay_samples),
            filter: OnePoleLP::new(),
            excite_counter: 0,
            excite_length: 0,
            gate: false,
            just_triggered: false,
            rng: 0x12345678,
            base_note: 60, // Default to middle C
            last_tune: 0.5, // Default to no detune
        }
    }

    pub fn note_on(&mut self, note: u8, _vel: f32) {
        self.gate = true;
        self.just_triggered = true;
        
        // Store the base note for tuning calculations
        self.base_note = note;
        
        // Calculate delay length for pitch with current tune setting
        // Don't reset tune to 0.5, keep the current tune value
        let current_tune = self.last_tune;
        self.update_pitch(current_tune);
        
        // Clear the delay buffer for a clean start
        self.delay_line.clear();
        
        // Reset excitation
        self.excite_counter = 0;
    }

    fn update_pitch(&mut self, tune_param: f32) {
        // tune_param is 0..1, map to ±50 cents
        let tune_cents = (tune_param - 0.5) * 100.0; // ±50 cents
        
        // Calculate frequency with tuning offset
        let base_freq = 440.0 * (2.0_f32).powf((self.base_note as f32 - 69.0) / 12.0);
        let tuned_freq = base_freq * (2.0_f32).powf(tune_cents / 1200.0);
        
        // Calculate delay length
        let delay_samples = (self.sr / tuned_freq) as usize;
        self.delay_line.set_length(delay_samples.max(1));
    }

    pub fn note_off(&mut self) {
        self.gate = false;
    }

    pub fn render_one(&mut self, params: &ParamStore, keys: &KSParamKeys) -> f32 {
        // Read parameters (normalized 0..1)
        let decay = params.get_f32_h(keys.decay, 0.7).clamp(0.0, 1.0);
        let damp = params.get_f32_h(keys.damp, 0.5).clamp(0.0, 1.0);
        let excite = params.get_f32_h(keys.excite, 0.5).clamp(0.0, 1.0);
        let tune = params.get_f32_h(keys.tune, 0.5).clamp(0.0, 1.0);

        // Map parameters
        let feedback = 0.85 + decay * 0.14; // 0.85 to 0.99 (increased minimum for better sustain)
        let cutoff_hz = 1000.0 + damp * 10000.0; // 1kHz to 11kHz (higher range for less aggressive filtering)
        let excite_samples = (20.0 + excite * 100.0) as u32; // 20 to 120 samples (more reasonable range)
        
        // Update pitch only when note is triggered or tune changes significantly
        // This avoids constant delay line adjustments during playback which causes instability
        if self.just_triggered || (tune - self.last_tune).abs() > 0.005 {
            self.update_pitch(tune);
            self.last_tune = tune;
        }

        // Set filter cutoff
        self.filter.set_cutoff(cutoff_hz, self.sr);

        // Handle excitation on trigger
        if self.just_triggered {
            self.excite_length = excite_samples;
            self.just_triggered = false;
        }

        // Read from delay line (this is our output)
        let delayed = self.delay_line.read();
        
        // Generate excitation noise if still in excitation phase
        let excitation = if self.excite_counter < self.excite_length {
            let noise = (self.rand01() * 2.0 - 1.0) * 0.3; // White noise ±0.3 (reduced amplitude)
            self.excite_counter += 1;
            noise
        } else {
            0.0
        };
        
        // Create feedback signal: delayed output * feedback + excitation
        let feedback_signal = delayed * feedback + excitation;
        
        // Apply lowpass filter to the feedback signal
        let filtered = self.filter.process(feedback_signal);
        
        // Write filtered signal back to delay line
        self.delay_line.write(filtered);
        
        // Return the delayed signal as our output
        delayed
    }

    fn rand01(&mut self) -> f32 {
        // Simple linear congruential generator
        self.rng = self.rng.wrapping_mul(1103515245).wrapping_add(12345);
        ((self.rng >> 8) & 0xffffff) as f32 / 16777216.0
    }
}