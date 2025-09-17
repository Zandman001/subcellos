use std::fs::File;
use std::path::Path;

use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::engine::params::{hash_path, ParamStore};

pub const MAX_DRUM_SLOTS: usize = 32;
const MAX_DRUM_VOICES: usize = 64;

#[derive(Clone)]
struct DrumSample {
  data: Vec<f32>,
  sample_rate: f32,
  len: usize,
}

impl DrumSample {
  fn empty() -> Self { Self { data: Vec::new(), sample_rate: 44100.0, len: 0 } }
  fn sample_at(&self, pos: f32) -> f32 {
    if self.len == 0 || pos < 0.0 { return 0.0; }
    let idx = pos.floor() as usize;
    if idx >= self.len { return 0.0; }
    let next = (idx + 1).min(self.len.saturating_sub(1));
    let frac = pos - idx as f32;
    let a = self.data[idx];
    let b = self.data[next];
    a + (b - a) * frac
  }
}

#[derive(Clone, Copy)]
struct DrumVoice {
  slot: usize,
  position: f32,
  velocity: f32,
  active: bool,
}

impl DrumVoice {
  fn new() -> Self { Self { slot: 0, position: 0.0, velocity: 0.0, active: false } }
}

pub struct DrumParamKeys {
  pub module_kind: u64,
  pub slot_volume: [u64; MAX_DRUM_SLOTS],
  pub slot_pan: [u64; MAX_DRUM_SLOTS],
  pub slot_semitones: [u64; MAX_DRUM_SLOTS],
  pub slot_fine: [u64; MAX_DRUM_SLOTS],
}

impl DrumParamKeys {
  pub fn new(part_idx: usize) -> Self {
    let mut slot_volume = [0u64; MAX_DRUM_SLOTS];
    let mut slot_pan = [0u64; MAX_DRUM_SLOTS];
    let mut slot_semitones = [0u64; MAX_DRUM_SLOTS];
    let mut slot_fine = [0u64; MAX_DRUM_SLOTS];
    for i in 0..MAX_DRUM_SLOTS {
      let base = format!("part/{}/drum/slot/{}", part_idx, i);
      slot_volume[i] = hash_path(&format!("{}/volume", base));
      slot_pan[i] = hash_path(&format!("{}/pan", base));
      slot_semitones[i] = hash_path(&format!("{}/pitch_semitones", base));
      slot_fine[i] = hash_path(&format!("{}/pitch_fine", base));
    }
    Self {
      module_kind: hash_path(&format!("part/{}/module_kind", part_idx)),
      slot_volume,
      slot_pan,
      slot_semitones,
      slot_fine,
    }
  }
}

#[derive(Default)]
pub struct DrumRenderFrame {
  pub mono: f32,
  pub pan_accum: f32,
  pub energy: f32,
}

pub struct DrumPlayer {
  sr: f32,
  samples: Vec<DrumSample>,
  sample_names: Vec<String>,
  voices: Vec<DrumVoice>,
  next_voice: usize,
}

impl DrumPlayer {
  pub fn new(sr: f32) -> Self {
    Self {
      sr,
      samples: Vec::new(),
      sample_names: Vec::new(),
      voices: (0..MAX_DRUM_VOICES).map(|_| DrumVoice::new()).collect(),
      next_voice: 0,
    }
  }

  pub fn clear(&mut self) {
    self.samples.clear();
    self.sample_names.clear();
    for v in &mut self.voices { *v = DrumVoice::new(); }
  }

  pub fn load_pack(&mut self, paths: &[String]) {
    self.clear();
    for path in paths.iter().take(MAX_DRUM_SLOTS) {
      match Self::decode_sample(path) {
        Ok(sample) => {
          let name = Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| path.clone());
          self.samples.push(sample);
          self.sample_names.push(name);
        }
        Err(err) => {
          eprintln!("[drum] failed to load {}: {}", path, err);
          self.samples.push(DrumSample::empty());
          self.sample_names.push(path.clone());
        }
      }
    }
  }

  pub fn sample_names(&self) -> &[String] { &self.sample_names }

  pub fn note_on(&mut self, note: u8, vel: f32) {
    if self.samples.is_empty() { return; }
    let slot = self.slot_for_note(note);
    if slot >= self.samples.len() { return; }
    let velocity = vel.clamp(0.0, 1.0);
    // find free voice
    if let Some(v) = self.voices.iter_mut().find(|v| !v.active) {
      *v = DrumVoice { slot, position: 0.0, velocity, active: true };
      return;
    }
    // steal next voice (simple round robin)
    let idx = self.next_voice;
    self.next_voice = (self.next_voice + 1) % self.voices.len();
    self.voices[idx] = DrumVoice { slot, position: 0.0, velocity, active: true };
  }

  pub fn note_off(&mut self, note: u8) {
    if self.samples.is_empty() { return; }
    let slot = self.slot_for_note(note);
    for v in &mut self.voices {
      if v.active && v.slot == slot { v.active = false; }
    }
  }

  pub fn render(&mut self, params: &ParamStore, keys: &DrumParamKeys) -> DrumRenderFrame {
    if self.samples.is_empty() {
      return DrumRenderFrame::default();
    }

    let mut frame = DrumRenderFrame::default();
    for voice in &mut self.voices {
      if !voice.active { continue; }
      let slot = voice.slot;
      let sample = match self.samples.get(slot) { Some(s) if s.len > 0 => s, _ => { voice.active = false; continue; } };

      let amp = sample.sample_at(voice.position);
      if amp.abs() < 1e-6 { voice.position += 1.0; }

      let volume = params.get_f32_h(keys.slot_volume[slot], 0.85).clamp(0.0, 1.5);
      let pan_norm = params.get_f32_h(keys.slot_pan[slot], 0.5).clamp(0.0, 1.0);
      let semis = params.get_f32_h(keys.slot_semitones[slot], 0.0);
      let fine = params.get_f32_h(keys.slot_fine[slot], 0.0);
      let total_semi = semis + fine / 100.0;
      let ratio = (2.0_f32).powf(total_semi / 12.0);
      let base_step = (sample.sample_rate / self.sr).max(0.01);
      let step = (base_step * ratio).clamp(0.01, 64.0);

      let amp_scaled = amp * volume * voice.velocity;
      let pan = (pan_norm * 2.0) - 1.0; // -1..1
      frame.mono += amp_scaled;
      frame.pan_accum += amp_scaled * pan;
      frame.energy += amp_scaled.abs();

      voice.position += step;
      if voice.position >= sample.len as f32 {
        voice.active = false;
      }
    }
    frame
  }

  fn slot_for_note(&self, note: u8) -> usize {
    if self.samples.is_empty() { return 0; }
    let count = self.samples.len();
    let base = 36u8; // C2 typical drum root
    if note >= base {
      let idx = (note - base) as usize;
      idx % count
    } else {
      (note as usize) % count
    }
  }

  fn decode_sample(path: &str) -> Result<DrumSample, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
      hint.with_extension(ext);
    }
    let meta_opts: MetadataOptions = Default::default();
    let fmt_opts: FormatOptions = Default::default();
    let probed = symphonia::default::get_probe()
      .format(&hint, mss, &fmt_opts, &meta_opts)
      .map_err(|e| e.to_string())?;
    let mut reader = probed.format;
    let track = reader
      .tracks()
      .iter()
      .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
      .ok_or_else(|| "no supported audio tracks".to_string())?;
    let dec_opts: DecoderOptions = Default::default();
    let mut decoder = symphonia::default::get_codecs()
      .make(&track.codec_params, &dec_opts)
      .map_err(|e| e.to_string())?;
    let track_id = track.id;

    let mut data = Vec::<f32>::new();
    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(44100) as f32;

    loop {
      let packet = match reader.next_packet() {
        Ok(packet) => packet,
        Err(Error::ResetRequired) => break,
        Err(Error::IoError(_)) => break,
        Err(err) => return Err(err.to_string()),
      };

      while !reader.metadata().is_latest() { reader.metadata().pop(); }
      if packet.track_id() != track_id { continue; }

      match decoder.decode(&packet).map_err(|e| e.to_string())? {
        AudioBufferRef::F32(buf) => {
          let b = buf.as_ref();
            sample_rate = b.spec().rate as f32;
            let ch = b.spec().channels.count();
            if ch == 1 {
              data.extend_from_slice(b.chan(0));
            } else if ch >= 2 {
              let left = b.chan(0);
              let right = b.chan(1);
              for (&l, &r) in left.iter().zip(right.iter()) {
                data.push((l + r) * 0.5);
              }
            }
        }
        AudioBufferRef::U8(buf) => {
          let b = buf.as_ref();
          sample_rate = b.spec().rate as f32;
          let ch = b.spec().channels.count();
          if ch == 1 {
            for &s in b.chan(0) {
              data.push((s as f32 - 128.0) / 128.0);
            }
          } else if ch >= 2 {
            let left = b.chan(0);
            let right = b.chan(1);
            for (&l, &r) in left.iter().zip(right.iter()) {
              let lf = (l as f32 - 128.0) / 128.0;
              let rf = (r as f32 - 128.0) / 128.0;
              data.push((lf + rf) * 0.5);
            }
          }
        }
        AudioBufferRef::U16(buf) => {
          let b = buf.as_ref();
          sample_rate = b.spec().rate as f32;
          let ch = b.spec().channels.count();
          if ch == 1 {
            for &s in b.chan(0) {
              data.push((s as f32 - 32768.0) / 32768.0);
            }
          } else if ch >= 2 {
            let left = b.chan(0);
            let right = b.chan(1);
            for (&l, &r) in left.iter().zip(right.iter()) {
              let lf = (l as f32 - 32768.0) / 32768.0;
              let rf = (r as f32 - 32768.0) / 32768.0;
              data.push((lf + rf) * 0.5);
            }
          }
        }
        other => {
          return Err(format!("unsupported format: {:?}", other.spec()));
        }
      }
    }

    if data.is_empty() {
      return Err("empty sample".to_string());
    }

    let peak = data.iter().fold(0.0f32, |acc, &s| acc.max(s.abs()));
    if peak > 0.0001 {
      let norm = (0.9 / peak).min(2.0);
      for s in &mut data { *s *= norm; }
    }

    Ok(DrumSample { len: data.len(), data, sample_rate })
  }
}
