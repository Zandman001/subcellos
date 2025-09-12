use std::f32::consts::PI;
use std::sync::{Arc, Mutex};
use std::path::Path;
use std::fs::File;
use crate::engine::params::ParamStore;
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

// Helper functions
#[inline]
fn midi_to_freq(m: u8) -> f32 { 440.0 * 2f32.powf((m as f32 - 69.0) / 12.0) }

#[inline]
fn cents_to_ratio(c: f32) -> f32 { 2f32.powf(c / 1200.0) }

#[inline]
fn db_to_gain(db: f32) -> f32 { 10f32.powf(db / 20.0) }

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 { a + (b - a) * t }

#[inline]
fn hann_window(t: f32) -> f32 {
    0.5 * (1.0 - (2.0 * PI * t).cos())
}

// Simple 4-point cubic interpolation for high-quality resampling
fn cubic_interpolate(y0: f32, y1: f32, y2: f32, y3: f32, frac: f32) -> f32 {
    let a = y3 - y2 - y0 + y1;
    let b = y0 - y1 - a;
    let c = y2 - y0;
    let d = y1;
    a * frac * frac * frac + b * frac * frac + c * frac + d
}

#[derive(Clone, Copy, PartialEq)]
pub enum PlaybackMode {
    OneShot,
    Loop,
    Keytrack,
}

impl PlaybackMode {
    pub fn from_index(index: i32) -> Self {
        match index {
            0 => PlaybackMode::OneShot,
            1 => PlaybackMode::Loop,
            2 => PlaybackMode::Keytrack,
            _ => PlaybackMode::OneShot,
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum LoopMode {
    Forward,
    PingPong,
}

impl LoopMode {
    pub fn from_index(index: i32) -> Self {
        match index {
            0 => LoopMode::Forward,
            1 => LoopMode::PingPong,
            _ => LoopMode::Forward,
        }
    }
}

// Sample buffer with metadata
#[derive(Clone)]
pub struct SampleBuffer {
    pub data: Vec<f32>,
    pub channels: usize,
    pub sample_rate: f32,
    pub length_samples: usize,
}

impl SampleBuffer {
    pub fn new() -> Self {
        Self {
            data: Vec::new(),
            channels: 1,
            sample_rate: 44100.0,
            length_samples: 0,
        }
    }

    pub fn clear(&mut self) {
        self.data.clear();
        self.length_samples = 0;
    }

    pub fn is_empty(&self) -> bool {
        self.length_samples == 0
    }

    // Get sample at position with channel handling
    pub fn get_sample(&self, position: f32, channel: usize) -> f32 {
        if self.is_empty() || position < 0.0 {
            return 0.0;
        }

        let pos_samples = position.floor() as usize;
        if pos_samples >= self.length_samples {
            return 0.0;
        }

        let channel_offset = if self.channels == 1 { 0 } else { channel % self.channels };
        let index = pos_samples * self.channels + channel_offset;
        
        if index < self.data.len() {
            self.data[index]
        } else {
            0.0
        }
    }

    // High-quality cubic interpolated sample reading
    pub fn get_sample_interpolated(&self, position: f32, channel: usize) -> f32 {
        if self.is_empty() || position < 0.0 {
            return 0.0;
        }

        let pos_int = position.floor() as usize;
        let frac = position - pos_int as f32;

        if pos_int + 3 >= self.length_samples {
            return self.get_sample(position, channel);
        }

        let channel_offset = if self.channels == 1 { 0 } else { channel % self.channels };
        
        // Get 4 surrounding samples for cubic interpolation
        let y0 = if pos_int > 0 { 
            self.data[(pos_int - 1) * self.channels + channel_offset] 
        } else { 
            self.data[pos_int * self.channels + channel_offset] 
        };
        let y1 = self.data[pos_int * self.channels + channel_offset];
        let y2 = self.data[(pos_int + 1) * self.channels + channel_offset];
        let y3 = self.data[(pos_int + 2) * self.channels + channel_offset];

        cubic_interpolate(y0, y1, y2, y3, frac)
    }
}

// ADSR envelope
#[derive(Clone)]
struct Envelope {
    sr: f32,
    stage: EnvelopeStage,
    level: f32,
    target: f32,
    rate: f32,
    attack_ms: f32,
    decay_ms: f32,
    sustain_level: f32,
    release_ms: f32,
}

#[derive(Clone, Copy, PartialEq)]
enum EnvelopeStage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

impl Envelope {
    fn new(sr: f32) -> Self {
        Self {
            sr,
            stage: EnvelopeStage::Idle,
            level: 0.0,
            target: 0.0,
            rate: 0.0,
            attack_ms: 10.0,
            decay_ms: 100.0,
            sustain_level: 0.7,
            release_ms: 200.0,
        }
    }

    fn set_adsr(&mut self, attack_ms: f32, decay_ms: f32, sustain_level: f32, release_ms: f32) {
        self.attack_ms = attack_ms.max(1.0);
        self.decay_ms = decay_ms.max(1.0);
        self.sustain_level = sustain_level.clamp(0.0, 1.0);
        self.release_ms = release_ms.max(1.0);
    }

    fn note_on(&mut self) {
        self.stage = EnvelopeStage::Attack;
        self.target = 1.0;
        self.rate = 1.0 / (self.attack_ms * 0.001 * self.sr);
    }

    fn note_off(&mut self) {
        self.stage = EnvelopeStage::Release;
        self.target = 0.0;
        self.rate = 1.0 / (self.release_ms * 0.001 * self.sr);
    }

    fn process(&mut self) -> f32 {
        match self.stage {
            EnvelopeStage::Idle => 0.0,
            EnvelopeStage::Attack => {
                self.level += self.rate;
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.stage = EnvelopeStage::Decay;
                    self.target = self.sustain_level;
                    self.rate = (1.0 - self.sustain_level) / (self.decay_ms * 0.001 * self.sr);
                }
                self.level
            },
            EnvelopeStage::Decay => {
                self.level -= self.rate;
                if self.level <= self.sustain_level {
                    self.level = self.sustain_level;
                    self.stage = EnvelopeStage::Sustain;
                }
                self.level
            },
            EnvelopeStage::Sustain => self.sustain_level,
            EnvelopeStage::Release => {
                self.level -= self.rate;
                if self.level <= 0.0 {
                    self.level = 0.0;
                    self.stage = EnvelopeStage::Idle;
                }
                self.level
            },
        }
    }

    fn is_active(&self) -> bool {
        !matches!(self.stage, EnvelopeStage::Idle)
    }
}

// Single voice for polyphonic sampler
#[derive(Clone)]
pub struct SamplerVoice {
    sr: f32,
    note: u8,
    velocity: f32,
    gate: bool,
    just_triggered: bool,
    
    // Playback state
    position: f32,      // Current position in samples
    pitch_ratio: f32,   // Playback speed ratio for pitch shifting
    direction: f32,     // 1.0 for forward, -1.0 for reverse (ping-pong)
    
    // Envelope
    envelope: Envelope,
    
    // De-click ramp for smooth parameter changes
    declick_ramp: f32,
    declick_target: f32,
    declick_rate: f32,
}

impl SamplerVoice {
    pub fn new(sr: f32) -> Self {
        Self {
            sr,
            note: 60,
            velocity: 0.0,
            gate: false,
            just_triggered: false,
            position: 0.0,
            pitch_ratio: 1.0,
            direction: 1.0,
            envelope: Envelope::new(sr),
            declick_ramp: 1.0,
            declick_target: 1.0,
            declick_rate: 0.0,
        }
    }

    pub fn note_on(&mut self, note: u8, velocity: f32) {
        self.note = note;
    // Clamp velocity to a 0..1 range to avoid extreme scaling causing distortion
    self.velocity = velocity.clamp(0.0, 1.0);
        self.gate = true;
        self.just_triggered = true;
        self.position = 0.0;
        self.direction = 1.0;
        self.envelope.note_on();
    }

    pub fn note_off(&mut self, _note: u8) {
        self.gate = false;
        self.envelope.note_off();
    }

    pub fn render(&mut self, buffer: &SampleBuffer, params: &ParamStore, param_keys: &SamplerParamKeys) -> f32 {
        if buffer.is_empty() {
            return 0.0;
        }

        // Get parameters
        let sample_start = params.get_f32_h(param_keys.sample_start, 0.0).clamp(0.0, 1.0);
        let sample_end = params.get_f32_h(param_keys.sample_end, 1.0).clamp(0.0, 1.0);
        let pitch_semitones = params.get_f32_h(param_keys.pitch_semitones, 0.0);
        let pitch_cents = params.get_f32_h(param_keys.pitch_cents, 0.0);
        let playback_mode = PlaybackMode::from_index(params.get_i32_h(param_keys.playback_mode, 0));
        
        let loop_start = params.get_f32_h(param_keys.loop_start, 0.0).clamp(0.0, 1.0);
        let loop_end = params.get_f32_h(param_keys.loop_end, 1.0).clamp(0.0, 1.0);
        let loop_mode = LoopMode::from_index(params.get_i32_h(param_keys.loop_mode, 0));
        let smoothness_ms = params.get_f32_h(param_keys.smoothness, 0.0).max(0.0);
        
        let attack_ms = params.get_f32_h(param_keys.attack, 10.0);
        let decay_ms = params.get_f32_h(param_keys.decay, 100.0);
        let sustain = params.get_f32_h(param_keys.sustain, 0.7);
        let release_ms = params.get_f32_h(param_keys.release, 200.0);

        // Update envelope parameters
        self.envelope.set_adsr(attack_ms, decay_ms, sustain, release_ms);

        // Calculate sample bounds
        let start_pos = sample_start * buffer.length_samples as f32;
        let end_pos = sample_end * buffer.length_samples as f32;
        
        // Calculate pitch ratio
        let total_pitch = pitch_semitones + pitch_cents / 100.0;
        let mut pitch_ratio = cents_to_ratio(total_pitch * 100.0);
        
        // Apply keytrack if enabled
        if matches!(playback_mode, PlaybackMode::Keytrack) {
            let root_note = 60; // C4 as default root note
            let note_offset = self.note as f32 - root_note as f32;
            pitch_ratio *= cents_to_ratio(note_offset * 100.0);
        }

        self.pitch_ratio = pitch_ratio;

        // Reset position if just triggered
        if self.just_triggered {
            self.position = start_pos;
            self.just_triggered = false;
        }

        // Check if voice should be active
        if !self.envelope.is_active() && !self.gate {
            return 0.0;
        }

        // Sample playback logic
        let mut output = 0.0;
        
        match playback_mode {
            PlaybackMode::OneShot => {
                if self.position < end_pos {
                    output = buffer.get_sample_interpolated(self.position, 0);
                    self.position += self.pitch_ratio;
                } else {
                    self.envelope.note_off();
                }
            },
            PlaybackMode::Loop => {
                let loop_start_pos = start_pos + (loop_start * (end_pos - start_pos));
                let loop_end_pos = start_pos + (loop_end * (end_pos - start_pos));
                
                if self.position >= loop_start_pos && self.position <= loop_end_pos {
                    output = buffer.get_sample_interpolated(self.position, 0);
                    
                    match loop_mode {
                        LoopMode::Forward => {
                            self.position += self.pitch_ratio * self.direction;
                            if self.position >= loop_end_pos {
                                self.position = loop_start_pos + (self.position - loop_end_pos);
                            }
                        },
                        LoopMode::PingPong => {
                            self.position += self.pitch_ratio * self.direction;
                            if self.position >= loop_end_pos {
                                self.direction = -1.0;
                                self.position = loop_end_pos - (self.position - loop_end_pos);
                            } else if self.position <= loop_start_pos {
                                self.direction = 1.0;
                                self.position = loop_start_pos + (loop_start_pos - self.position);
                            }
                        },
                        // No ShortXfade mode; only Forward and PingPong are supported.
                    }
                } else {
                    // Outside loop region, play normally
                    if self.position < end_pos {
                        output = buffer.get_sample_interpolated(self.position, 0);
                        self.position += self.pitch_ratio;
                    } else {
                        self.envelope.note_off();
                    }
                }
            },
            PlaybackMode::Keytrack => {
                if self.position < end_pos {
                    output = buffer.get_sample_interpolated(self.position, 0);
                    self.position += self.pitch_ratio;
                } else {
                    self.envelope.note_off();
                }
            },
        }

        // Apply envelope
        let env_level = self.envelope.process();
        output *= env_level * self.velocity;

        // Apply de-click ramp if parameters changed
        self.declick_ramp += (self.declick_target - self.declick_ramp) * self.declick_rate;
        output *= self.declick_ramp;

        output
    }

    pub fn is_active(&self) -> bool {
        self.envelope.is_active()
    }

    pub fn position(&self) -> f32 { self.position }
    pub fn direction(&self) -> f32 { self.direction }
}

// Parameter keys for the sampler
#[derive(Clone)]
pub struct SamplerParamKeys {
    pub module_kind: u64,
    // Sample parameters
    pub sample_start: u64,
    pub sample_end: u64,
    pub pitch_semitones: u64,
    pub pitch_cents: u64,
    pub playback_mode: u64,
    // Loop parameters
    pub loop_start: u64,
    pub loop_end: u64,
    pub loop_mode: u64,
    pub smoothness: u64,
    // Envelope parameters
    pub attack: u64,
    pub decay: u64,
    pub sustain: u64,
    pub release: u64,
}

// Main Sampler structure with polyphonic voices
#[derive(Clone)]
pub struct Sampler {
    sr: f32,
    voices: Vec<SamplerVoice>,
    voice_allocator: usize,
    sample_buffer: Arc<Mutex<SampleBuffer>>,
    recording: bool,
    record_buffer: Vec<f32>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct PlayheadState {
    pub position_rel: f32,      // 0..1 inside trimmed sample region
    pub loop_start_rel: f32,     // 0..1 relative to trimmed region
    pub loop_end_rel: f32,       // 0..1 relative to trimmed region
    pub loop_mode: i32,          // 0 forward, 1 pingpong
    pub direction: f32,          // 1 or -1 (current traversal)
    pub playing: bool,
}

impl Sampler {
    pub fn new(sr: f32) -> Self {
        let max_voices = 8;
        Self {
            sr,
            voices: (0..max_voices).map(|_| SamplerVoice::new(sr)).collect(),
            voice_allocator: 0,
            sample_buffer: Arc::new(Mutex::new(SampleBuffer::new())),
            recording: false,
            record_buffer: Vec::new(),
        }
    }

    pub fn note_on(&mut self, note: u8, velocity: f32) {
        // Find available voice or steal oldest
        let voice_idx = self.find_available_voice();
        self.voices[voice_idx].note_on(note, velocity);
    }

    pub fn note_off(&mut self, note: u8) {
        // Release all voices with matching note
        for voice in &mut self.voices {
            if voice.note == note && voice.gate {
                voice.note_off(note);
            }
        }
    }

    fn find_available_voice(&mut self) -> usize {
        // Find inactive voice
        for (i, voice) in self.voices.iter().enumerate() {
            if !voice.is_active() {
                return i;
            }
        }
        
        // All voices active, steal the oldest (round-robin)
        let idx = self.voice_allocator;
        self.voice_allocator = (self.voice_allocator + 1) % self.voices.len();
        idx
    }

    pub fn render_one(&mut self, params: &ParamStore, param_keys: &SamplerParamKeys) -> f32 {
        let buffer = self.sample_buffer.lock().unwrap();
        let mut output = 0.0;

        // Sum all active voices
        for voice in &mut self.voices {
            if voice.is_active() {
                output += voice.render(&buffer, params, param_keys);
            }
        }

        // Soft limiting to prevent clipping
        output = output.tanh() * 0.8;
        output
    }

    pub fn is_playing(&self) -> bool {
        self.voices.iter().any(|voice| voice.is_active())
    }

    pub fn start_recording(&mut self) {
        self.recording = true;
        self.record_buffer.clear();
    }

    pub fn stop_recording(&mut self) {
        self.recording = false;
        if !self.record_buffer.is_empty() {
            // Copy recorded data to sample buffer
            let mut buffer = self.sample_buffer.lock().unwrap();
            buffer.data = self.record_buffer.clone();
            buffer.length_samples = self.record_buffer.len();
            buffer.channels = 1; // Mono recording for now
            buffer.sample_rate = self.sr;
        }
    }

    pub fn record_input(&mut self, input: f32) {
        if self.recording {
            self.record_buffer.push(input);
        }
    }

    pub fn load_sample(&mut self, file_path: &str) {
        match self.load_audio_file(file_path) {
            Ok(_) => {
                // Normalize peak to ~0.9 to avoid clipping and keep consistent preview loudness
                if let Ok(mut buffer) = self.sample_buffer.lock() {
                    let mut peak = 0.0f32;
                    for &s in &buffer.data { let a = s.abs(); if a > peak { peak = a; } }
                    if peak > 0.0001 {
                        let norm = 0.9 / peak;
                        if norm < 1.5 { // avoid over-amplifying very quiet samples drastically here
                            for s in &mut buffer.data { *s *= norm; }
                        }
                    }
                }
                println!("Successfully loaded sample: {}", file_path)
            },
            Err(e) => eprintln!("Failed to load sample {}: {}", file_path, e),
        }
    }

    fn load_audio_file(&mut self, file_path: &str) -> Result<(), Box<dyn std::error::Error>> {
        // Open the file
        let file = File::open(file_path)?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        // Create a probe hint using the file extension
        let mut hint = Hint::new();
        if let Some(extension) = Path::new(file_path).extension() {
            if let Some(extension_str) = extension.to_str() {
                hint.with_extension(extension_str);
            }
        }

        // Use the default options for metadata and format readers
        let meta_opts: MetadataOptions = Default::default();
        let fmt_opts: FormatOptions = Default::default();

        // Probe the media source
        let probed = symphonia::default::get_probe().format(&hint, mss, &fmt_opts, &meta_opts)?;

        // Get the instantiated format reader
        let mut format = probed.format;

        // Find the first audio track with a known (decodeable) codec
        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or("no supported audio tracks")?;

        // Use the default options for the decoder
        let dec_opts: DecoderOptions = Default::default();

        // Create a decoder for the track
        let mut decoder = symphonia::default::get_codecs().make(&track.codec_params, &dec_opts)?;

        // Store the track identifier, it will be used to filter packets
        let track_id = track.id;

        let mut sample_buf: Vec<f32> = Vec::new();
        let mut sample_rate = 44100.0;
        let mut channels = 1;

        // The decode loop
        loop {
            // Get the next packet from the media format
            let packet = match format.next_packet() {
                Ok(packet) => packet,
                Err(Error::ResetRequired) => {
                    // The track list has been changed. Re-examine it and create a new set of decoders,
                    // then restart the decode loop. This is an advanced feature and it is not
                    // unreasonable to consider this "the end of the stream". As of v0.5.0, the only
                    // use for this is for chained OGG physical streams.
                    break;
                }
                Err(Error::IoError(_)) => {
                    // The packet reader has reached the end of file, exit the decode loop.
                    break;
                }
                Err(err) => {
                    // A unrecoverable error occurred, halt decoding.
                    return Err(Box::new(err));
                }
            };

            // Consume any new metadata that has been read since the last packet
            while !format.metadata().is_latest() {
                // Pop the latest metadata
                format.metadata().pop();
            }

            // If the packet does not belong to the selected track, skip over it
            if packet.track_id() != track_id {
                continue;
            }

            // Decode the packet into an AudioBufferRef
            match decoder.decode(&packet)? {
                AudioBufferRef::F32(buf) => {
                    sample_rate = buf.spec().rate as f32;
                    channels = buf.spec().channels.count();
                    
                    // Convert to mono if stereo
                    if channels == 1 {
                        // Mono - just copy the samples
                        sample_buf.extend_from_slice(buf.chan(0));
                    } else if channels == 2 {
                        // Stereo - mix to mono
                        let left = buf.chan(0);
                        let right = buf.chan(1);
                        for (l, r) in left.iter().zip(right.iter()) {
                            sample_buf.push((l + r) * 0.5);
                        }
                    } else {
                        // Multi-channel - just take the first channel
                        sample_buf.extend_from_slice(buf.chan(0));
                    }
                }
                AudioBufferRef::U8(buf) => {
                    sample_rate = buf.spec().rate as f32;
                    channels = buf.spec().channels.count();
                    
                    if channels == 1 {
                        for &sample in buf.chan(0) {
                            sample_buf.push((sample as f32 - 128.0) / 128.0);
                        }
                    } else if channels == 2 {
                        let left = buf.chan(0);
                        let right = buf.chan(1);
                        for (&l, &r) in left.iter().zip(right.iter()) {
                            let l_f = (l as f32 - 128.0) / 128.0;
                            let r_f = (r as f32 - 128.0) / 128.0;
                            sample_buf.push((l_f + r_f) * 0.5);
                        }
                    } else {
                        for &sample in buf.chan(0) {
                            sample_buf.push((sample as f32 - 128.0) / 128.0);
                        }
                    }
                }
                AudioBufferRef::U16(buf) => {
                    sample_rate = buf.spec().rate as f32;
                    channels = buf.spec().channels.count();
                    
                    if channels == 1 {
                        for &sample in buf.chan(0) {
                            sample_buf.push((sample as f32 - 32768.0) / 32768.0);
                        }
                    } else if channels == 2 {
                        let left = buf.chan(0);
                        let right = buf.chan(1);
                        for (&l, &r) in left.iter().zip(right.iter()) {
                            let l_f = (l as f32 - 32768.0) / 32768.0;
                            let r_f = (r as f32 - 32768.0) / 32768.0;
                            sample_buf.push((l_f + r_f) * 0.5);
                        }
                    } else {
                        for &sample in buf.chan(0) {
                            sample_buf.push((sample as f32 - 32768.0) / 32768.0);
                        }
                    }
                }
                AudioBufferRef::U24(buf) => {
                    sample_rate = buf.spec().rate as f32;
                    channels = buf.spec().channels.count();
                    
                    if channels == 1 {
                        for &sample in buf.chan(0) {
                            let sample_u32 = sample.inner();
                            sample_buf.push((sample_u32 as f32 - 8388608.0) / 8388608.0);
                        }
                    } else if channels == 2 {
                        let left = buf.chan(0);
                        let right = buf.chan(1);
                        for (&l, &r) in left.iter().zip(right.iter()) {
                            let l_u32 = l.inner();
                            let r_u32 = r.inner();
                            let l_f = (l_u32 as f32 - 8388608.0) / 8388608.0;
                            let r_f = (r_u32 as f32 - 8388608.0) / 8388608.0;
                            sample_buf.push((l_f + r_f) * 0.5);
                        }
                    } else {
                        for &sample in buf.chan(0) {
                            let sample_u32 = sample.inner();
                            sample_buf.push((sample_u32 as f32 - 8388608.0) / 8388608.0);
                        }
                    }
                }
                AudioBufferRef::U32(buf) => {
                    sample_rate = buf.spec().rate as f32;
                    channels = buf.spec().channels.count();
                    
                    if channels == 1 {
                        for &sample in buf.chan(0) {
                            sample_buf.push((sample as f32 - 2147483648.0) / 2147483648.0);
                        }
                    } else if channels == 2 {
                        let left = buf.chan(0);
                        let right = buf.chan(1);
                        for (&l, &r) in left.iter().zip(right.iter()) {
                            let l_f = (l as f32 - 2147483648.0) / 2147483648.0;
                            let r_f = (r as f32 - 2147483648.0) / 2147483648.0;
                            sample_buf.push((l_f + r_f) * 0.5);
                        }
                    } else {
                        for &sample in buf.chan(0) {
                            sample_buf.push((sample as f32 - 2147483648.0) / 2147483648.0);
                        }
                    }
                }
                AudioBufferRef::S8(buf) => {
                    sample_rate = buf.spec().rate as f32;
                    channels = buf.spec().channels.count();
                    
                    if channels == 1 {
                        for &sample in buf.chan(0) {
                            sample_buf.push(sample as f32 / 128.0);
                        }
                    } else if channels == 2 {
                        let left = buf.chan(0);
                        let right = buf.chan(1);
                        for (&l, &r) in left.iter().zip(right.iter()) {
                            let l_f = l as f32 / 128.0;
                            let r_f = r as f32 / 128.0;
                            sample_buf.push((l_f + r_f) * 0.5);
                        }
                    } else {
                        for &sample in buf.chan(0) {
                            sample_buf.push(sample as f32 / 128.0);
                        }
                    }
                }
                AudioBufferRef::S16(buf) => {
                    sample_rate = buf.spec().rate as f32;
                    channels = buf.spec().channels.count();
                    
                    if channels == 1 {
                        for &sample in buf.chan(0) {
                            sample_buf.push(sample as f32 / 32768.0);
                        }
                    } else if channels == 2 {
                        let left = buf.chan(0);
                        let right = buf.chan(1);
                        for (&l, &r) in left.iter().zip(right.iter()) {
                            let l_f = l as f32 / 32768.0;
                            let r_f = r as f32 / 32768.0;
                            sample_buf.push((l_f + r_f) * 0.5);
                        }
                    } else {
                        for &sample in buf.chan(0) {
                            sample_buf.push(sample as f32 / 32768.0);
                        }
                    }
                }
                AudioBufferRef::S24(buf) => {
                    sample_rate = buf.spec().rate as f32;
                    channels = buf.spec().channels.count();
                    
                    if channels == 1 {
                        for &sample in buf.chan(0) {
                            let sample_i32 = sample.inner();
                            sample_buf.push(sample_i32 as f32 / 8388608.0);
                        }
                    } else if channels == 2 {
                        let left = buf.chan(0);
                        let right = buf.chan(1);
                        for (&l, &r) in left.iter().zip(right.iter()) {
                            let l_i32 = l.inner();
                            let r_i32 = r.inner();
                            let l_f = l_i32 as f32 / 8388608.0;
                            let r_f = r_i32 as f32 / 8388608.0;
                            sample_buf.push((l_f + r_f) * 0.5);
                        }
                    } else {
                        for &sample in buf.chan(0) {
                            let sample_i32 = sample.inner();
                            sample_buf.push(sample_i32 as f32 / 8388608.0);
                        }
                    }
                }
                AudioBufferRef::S32(buf) => {
                    sample_rate = buf.spec().rate as f32;
                    channels = buf.spec().channels.count();
                    
                    if channels == 1 {
                        for &sample in buf.chan(0) {
                            sample_buf.push(sample as f32 / 2147483648.0);
                        }
                    } else if channels == 2 {
                        let left = buf.chan(0);
                        let right = buf.chan(1);
                        for (&l, &r) in left.iter().zip(right.iter()) {
                            let l_f = l as f32 / 2147483648.0;
                            let r_f = r as f32 / 2147483648.0;
                            sample_buf.push((l_f + r_f) * 0.5);
                        }
                    } else {
                        for &sample in buf.chan(0) {
                            sample_buf.push(sample as f32 / 2147483648.0);
                        }
                    }
                }
                AudioBufferRef::F64(buf) => {
                    sample_rate = buf.spec().rate as f32;
                    channels = buf.spec().channels.count();
                    
                    if channels == 1 {
                        for &sample in buf.chan(0) {
                            sample_buf.push(sample as f32);
                        }
                    } else if channels == 2 {
                        let left = buf.chan(0);
                        let right = buf.chan(1);
                        for (&l, &r) in left.iter().zip(right.iter()) {
                            sample_buf.push((l as f32 + r as f32) * 0.5);
                        }
                    } else {
                        for &sample in buf.chan(0) {
                            sample_buf.push(sample as f32);
                        }
                    }
                }
            }
        }

        // Update the sample buffer
        if !sample_buf.is_empty() {
            let mut buffer = self.sample_buffer.lock().unwrap();
            buffer.data = sample_buf;
            buffer.length_samples = buffer.data.len();
            buffer.sample_rate = sample_rate;
            buffer.channels = 1; // We convert everything to mono
        }

        Ok(())
    }

    pub fn get_waveform_overview(&self, samples: usize) -> Vec<f32> {
        let buffer = self.sample_buffer.lock().unwrap();
        if buffer.is_empty() {
            return vec![0.0; samples];
        }

        let mut overview = Vec::with_capacity(samples);
        let step = buffer.length_samples as f32 / samples as f32;
        
        for i in 0..samples {
            let pos = (i as f32 * step) as usize;
            if pos < buffer.length_samples {
                overview.push(buffer.data[pos]);
            } else {
                overview.push(0.0);
            }
        }
        
        overview
    }

    pub fn get_sample_info(&self) -> (usize, f32, usize) {
        let buffer = self.sample_buffer.lock().unwrap();
        (buffer.length_samples, buffer.sample_rate, buffer.channels)
    }

    // Compute current playhead state from first active voice.
    pub fn compute_playhead_state(&self, params: &ParamStore, keys: &SamplerParamKeys) -> Option<PlayheadState> {
        // Find first active voice
        let voice = self.voices.iter().find(|v| v.is_active())?; // if none active return None
        let buffer = self.sample_buffer.lock().ok()?;
        if buffer.is_empty() { return None; }

        // Fetch parameters (same normalization as render)
        let sample_start = params.get_f32_h(keys.sample_start, 0.0).clamp(0.0, 1.0);
        let sample_end = params.get_f32_h(keys.sample_end, 1.0).clamp(0.0, 1.0);
        let region_span = (sample_end - sample_start).max(0.00001);
        let loop_start = params.get_f32_h(keys.loop_start, 0.0).clamp(0.0, 1.0);
        let loop_end = params.get_f32_h(keys.loop_end, 1.0).clamp(0.0, 1.0);
        let loop_mode = params.get_i32_h(keys.loop_mode, 0);

        // Absolute sample positions
        let start_pos = sample_start * buffer.length_samples as f32;
        let end_pos = sample_end * buffer.length_samples as f32;
        let loop_start_pos = start_pos + loop_start * (end_pos - start_pos);
        let loop_end_pos = start_pos + loop_end * (end_pos - start_pos);

        let pos = voice.position();
        // Normalize inside trimmed region
        let clamped = pos.clamp(start_pos, end_pos);
        let rel = (clamped - start_pos) / (end_pos - start_pos + 1e-9);

        let loop_start_rel = (loop_start_pos - start_pos) / (end_pos - start_pos + 1e-9);
        let loop_end_rel = (loop_end_pos - start_pos) / (end_pos - start_pos + 1e-9);
        Some(PlayheadState {
            position_rel: rel.max(0.0).min(1.0),
            loop_start_rel: loop_start_rel.max(0.0).min(1.0),
            loop_end_rel: loop_end_rel.max(0.0).min(1.0),
            loop_mode,
            direction: voice.direction(),
            playing: true,
        })
    }
}
