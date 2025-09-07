use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::{unbounded, Receiver, Sender, TryRecvError};

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

    let err_fn = |e: cpal::StreamError| eprintln!("stream error: {e}");
    let mut playing = true;
    
    let err_fn = |e| eprintln!("stream error: {e}");
    let mut playing = true;
    let stream = device.build_output_stream(&cfg, move |data: &mut [f32], _| {
      // Drain messages without blocking (tight cap to avoid starving audio)
      let mut drained = 0usize;
      loop {
        match rx.try_recv() {
          Ok(msg) => apply_msg(&mut graph, &mut params, msg, &mut playing),
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

fn apply_msg(graph: &mut EngineGraph, params: &mut ParamStore, msg: EngineMsg, playing: &mut bool) {
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
    EngineMsg::Quit => {}
  }
}

// Intentionally not Clone; engine state moves into the audio callback.
