use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::{unbounded, Receiver, Sender, TryRecvError};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

use super::{graph::EngineGraph, messages::EngineMsg, params::{ParamStore}};

pub struct AudioEngine {
  tx: Sender<EngineMsg>,
  rx: Receiver<EngineMsg>,
  pub sr: f32,
  graph: Option<EngineGraph>,
  params: Option<ParamStore>,
  stream: Option<cpal::Stream>,
  spec_tx: Option<Sender<Vec<f32>>>,
  spec_buf: Vec<f32>,
  recording: bool,
  recorded_samples: Vec<f32>,
}

impl AudioEngine {
  pub fn new() -> Result<Self, String> {
    let (tx, rx) = unbounded();
    // Default sample rate preference: prefer 44100 (more compatible), then 48000
    let host = cpal::default_host();
    let device = host.default_output_device().ok_or_else(|| "no output device".to_string())?;
    // Pick config near 48k, 2 channels, f32
    let mut chosen_cfg: Option<cpal::SupportedStreamConfig> = None;
    if let Ok(mut supported) = device.supported_output_configs() {
      // prefer 44100 first
      for cfg_range in supported.by_ref() {
        if cfg_range.channels() != 2 { continue; }
        if cfg_range.sample_format() != cpal::SampleFormat::F32 { continue; }
        let sr = 44_100u32;
        if cfg_range.min_sample_rate().0 <= sr && cfg_range.max_sample_rate().0 >= sr {
          chosen_cfg = Some(cfg_range.with_sample_rate(cpal::SampleRate(sr)));
          break;
        }
      }
      // then 48000
      if chosen_cfg.is_none() {
        if let Ok(supported2) = device.supported_output_configs() {
          for cfg_range in supported2 {
            if cfg_range.channels() != 2 { continue; }
            if cfg_range.sample_format() != cpal::SampleFormat::F32 { continue; }
            let sr = 48_000u32;
            if cfg_range.min_sample_rate().0 <= sr && cfg_range.max_sample_rate().0 >= sr {
              chosen_cfg = Some(cfg_range.with_sample_rate(cpal::SampleRate(sr)));
              break;
            }
          }
        }
      }
      if chosen_cfg.is_none() {
        for cfg_range in supported {
          if cfg_range.channels() == 2 && cfg_range.sample_format() == cpal::SampleFormat::F32 {
            chosen_cfg = Some(cfg_range.with_max_sample_rate());
            break;
          }
        }
      }
    }
    let config = if let Some(cfg) = chosen_cfg { cfg } else { device.default_output_config().map_err(|e| e.to_string())? };
    let sr = config.sample_rate().0 as f32;

    Ok(Self {
      tx,
      rx,
      sr,
      graph: Some(EngineGraph::new(sr)),
      params: Some(ParamStore::new()),
      stream: None,
      spec_tx: None,
      spec_buf: Vec::with_capacity(4096),
      recording: false,
      recorded_samples: Vec::new(),
    })
  }

  pub fn set_spectrum_sender(&mut self, tx: Sender<Vec<f32>>) { self.spec_tx = Some(tx); }

  pub fn start(&mut self) -> Result<(), String> {
    if self.stream.is_some() { return Ok(()); }
    let host = cpal::default_host();
    let device = host.default_output_device().ok_or_else(|| "no output device".to_string())?;
    let mut chosen_cfg: Option<cpal::SupportedStreamConfig> = None;
    if let Ok(mut supported) = device.supported_output_configs() {
      // prefer 44100 first
      for cfg_range in supported.by_ref() {
        if cfg_range.channels() != 2 { continue; }
        if cfg_range.sample_format() != cpal::SampleFormat::F32 { continue; }
        let sr = 44_100u32;
        if cfg_range.min_sample_rate().0 <= sr && cfg_range.max_sample_rate().0 >= sr {
          chosen_cfg = Some(cfg_range.with_sample_rate(cpal::SampleRate(sr)));
          break;
        }
      }
      // then 48000
      if chosen_cfg.is_none() {
        if let Ok(supported2) = device.supported_output_configs() {
          for cfg_range in supported2 {
            if cfg_range.channels() != 2 { continue; }
            if cfg_range.sample_format() != cpal::SampleFormat::F32 { continue; }
            let sr = 48_000u32;
            if cfg_range.min_sample_rate().0 <= sr && cfg_range.max_sample_rate().0 >= sr {
              chosen_cfg = Some(cfg_range.with_sample_rate(cpal::SampleRate(sr)));
              break;
            }
          }
        }
      }
      if chosen_cfg.is_none() {
        for cfg_range in supported {
          if cfg_range.channels() == 2 && cfg_range.sample_format() == cpal::SampleFormat::F32 {
            chosen_cfg = Some(cfg_range.with_max_sample_rate());
            break;
          }
        }
      }
    }
    let config = if let Some(cfg) = chosen_cfg { cfg } else { device.default_output_config().map_err(|e| e.to_string())? };
    let mut cfg: cpal::StreamConfig = config.clone().into();
    // Request a larger buffer for better stability; reduce underruns
    cfg.buffer_size = cpal::BufferSize::Fixed(1024);
    self.sr = cfg.sample_rate.0 as f32;

    let rx = self.rx.clone();
    // Move engine state into the audio thread. Keep None in self.
    let mut graph = self.graph.take().unwrap_or_else(|| EngineGraph::new(self.sr));
    let mut params = self.params.take().unwrap_or_else(|| ParamStore::new());
    let mut spec_tx = self.spec_tx.clone();
    let mut spec_buf = Vec::<f32>::with_capacity(4096);
    let mut recording = false;
    let mut recorded_samples = Vec::<f32>::new();

    let err_fn = |e: cpal::StreamError| eprintln!("stream error: {e}");
    let mut playing = true;
    
    let err_fn = |e| eprintln!("stream error: {e}");
    let mut playing = true;
    let stream = device.build_output_stream(&cfg, move |data: &mut [f32], _| {
      // Drain messages without blocking (tight cap to avoid starving audio)
      let mut drained = 0usize;
      loop {
        match rx.try_recv() {
          Ok(msg) => apply_msg(&mut graph, &mut params, msg, &mut playing, &mut recording, &mut recorded_samples),
          Err(TryRecvError::Empty) => break,
          Err(TryRecvError::Disconnected) => break,
        }
        drained += 1;
        if drained >= 24 { break; }
      }
      // Render frames
      if playing {
        for frame in data.chunks_mut(2) {
          let (l, r) = graph.render_frame(&params);
          frame[0] = l;
          if frame.len() > 1 { frame[1] = r; }
          // accumulate mono for spectrum
          let mono = 0.5 * (l + r);
          if spec_buf.len() < 2048 { spec_buf.push(mono); }
          
          // Record if recording is active
          if recording {
            recorded_samples.push(mono);
          }
        }
        if spec_buf.len() >= 2048 {
          if let Some(tx) = spec_tx.as_ref() {
            // non-blocking send of a copy
            let mut out = Vec::with_capacity(2048);
            out.extend_from_slice(&spec_buf[0..2048]);
            let _ = tx.try_send(out);
          }
          spec_buf.clear();
        }
      } else {
        for frame in data.chunks_mut(2) {
          frame[0] = 0.0; if frame.len() > 1 { frame[1] = 0.0; }
        }
      }
    }, err_fn, None).map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    self.stream = Some(stream);
    Ok(())
  }

  pub fn stop(&mut self) {
    self.stream.take();
  }

  pub fn sender(&self) -> Sender<EngineMsg> { self.tx.clone() }
}

fn apply_msg(graph: &mut EngineGraph, params: &mut ParamStore, msg: EngineMsg, playing: &mut bool, recording: &mut bool, recorded_samples: &mut Vec<f32>) {
  match msg {
    EngineMsg::SetParam { path, value } => { params.set(path, value) },
    EngineMsg::NoteOn { part, note, vel } => {
      if part < graph.parts.len() { graph.parts[part].note_on(note, vel); }
    }
    EngineMsg::NoteOff { part, note } => {
      if part < graph.parts.len() { graph.parts[part].note_off(note); }
    }
    EngineMsg::SetTempo { .. } => {}
    EngineMsg::Transport { playing: p } => { *playing = p; }
    EngineMsg::StartRecording => {
      *recording = true;
      recorded_samples.clear();
    }
    EngineMsg::StopRecording => {
      *recording = false;
      // Save recorded samples to file
      if !recorded_samples.is_empty() {
        if let Err(e) = save_recorded_samples(recorded_samples) {
          eprintln!("Failed to save recording: {}", e);
        }
      }
    }
    EngineMsg::LoadSample { part, path } => {
      if part < graph.parts.len() {
        if let Err(e) = graph.parts[part].load_sample(&path) {
          eprintln!("Failed to load sample: {}", e);
        }
      }
    }
    EngineMsg::PreviewSample { path } => {
      if let Err(e) = graph.load_preview_sample(&path) {
        eprintln!("Failed to load preview sample: {}", e);
      }
    }
    EngineMsg::StopPreview => {
      graph.stop_preview();
    }
    EngineMsg::Quit => {}
  }
}

fn save_recorded_samples(samples: &[f32]) -> Result<(), String> {
  // Create subsamples directory in Documents
  let documents_path = dirs::document_dir().ok_or("Could not find Documents directory")?;
  let subsamples_path = documents_path.join("subsamples");
  
  // Create directory if it doesn't exist
  fs::create_dir_all(&subsamples_path).map_err(|e| format!("Failed to create subsamples directory: {}", e))?;
  
  // Find next available sample number
  let mut sample_num = 1;
  loop {
    let filename = format!("sample{}.wav", sample_num);
    let file_path = subsamples_path.join(&filename);
    if !file_path.exists() {
      break;
    }
    sample_num += 1;
  }
  
  let filename = format!("sample{}.wav", sample_num);
  let file_path = subsamples_path.join(&filename);
  
  // Write WAV file (simple 44.1kHz mono format)
  write_wav_file(&file_path, samples, 44100.0)?;
  
  println!("Saved recording to: {}", file_path.display());
  Ok(())
}

fn write_wav_file(path: &PathBuf, samples: &[f32], sample_rate: f32) -> Result<(), String> {
  let mut file = File::create(path).map_err(|e| format!("Failed to create WAV file: {}", e))?;
  
  let num_samples = samples.len() as u32;
  let byte_rate = (sample_rate * 2.0) as u32; // 16-bit mono
  let data_size = num_samples * 2; // 16-bit samples
  let file_size = 36 + data_size;
  
  // WAV header
  file.write_all(b"RIFF").map_err(|e| format!("Failed to write WAV header: {}", e))?;
  file.write_all(&file_size.to_le_bytes()).map_err(|e| format!("Failed to write file size: {}", e))?;
  file.write_all(b"WAVE").map_err(|e| format!("Failed to write WAVE: {}", e))?;
  
  // Format chunk
  file.write_all(b"fmt ").map_err(|e| format!("Failed to write fmt: {}", e))?;
  file.write_all(&16u32.to_le_bytes()).map_err(|e| format!("Failed to write fmt size: {}", e))?;
  file.write_all(&1u16.to_le_bytes()).map_err(|e| format!("Failed to write audio format: {}", e))?; // PCM
  file.write_all(&1u16.to_le_bytes()).map_err(|e| format!("Failed to write channels: {}", e))?; // Mono
  file.write_all(&(sample_rate as u32).to_le_bytes()).map_err(|e| format!("Failed to write sample rate: {}", e))?;
  file.write_all(&byte_rate.to_le_bytes()).map_err(|e| format!("Failed to write byte rate: {}", e))?;
  file.write_all(&2u16.to_le_bytes()).map_err(|e| format!("Failed to write block align: {}", e))?; // 16-bit mono
  file.write_all(&16u16.to_le_bytes()).map_err(|e| format!("Failed to write bits per sample: {}", e))?;
  
  // Data chunk
  file.write_all(b"data").map_err(|e| format!("Failed to write data chunk: {}", e))?;
  file.write_all(&data_size.to_le_bytes()).map_err(|e| format!("Failed to write data size: {}", e))?;
  
  // Convert f32 samples to 16-bit PCM
  for &sample in samples {
    let sample_16 = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
    file.write_all(&sample_16.to_le_bytes()).map_err(|e| format!("Failed to write sample data: {}", e))?;
  }
  
  Ok(())
}

// Intentionally not Clone; engine state moves into the audio callback.
