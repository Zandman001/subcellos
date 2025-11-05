 use std::{thread, time::Duration, fs};
use std::path::{Path, PathBuf};

use crossbeam_channel::Sender;
use once_cell::sync::OnceCell;

use crate::engine::{audio::AudioEngine, messages::{EngineMsg, ParamValue}};
use crate::engine::modules::sampler::PlayheadState;
use crate::engine::state::get_playhead_state;
use crossbeam_channel::{unbounded as chan, Receiver};
use tauri::Emitter;

static ENGINE_TX: OnceCell<Sender<EngineMsg>> = OnceCell::new();

fn spawn_spectrum_emitter(app: tauri::AppHandle, rx: Receiver<Vec<f32>>) {
  std::thread::spawn(move || {
    while let Ok(buf) = rx.recv() {
      // Compute FFT magnitude and emit down to UI
      let n = buf.len();
      let pow2 = n.next_power_of_two();
      let mut output: Vec<rustfft::num_complex::Complex32> = buf.iter().map(|&x| rustfft::num_complex::Complex32::new(x, 0.0)).collect();
      output.resize(pow2, rustfft::num_complex::Complex32::new(0.0, 0.0));
      // Hann window to stabilize spectrum
      let n_win = n.max(1);
      for i in 0..n {
        let w = 0.5 * (1.0 - (std::f32::consts::TAU * (i as f32) / ((n_win - 1) as f32)).cos());
        output[i].re *= w;
      }
      let mut planner = rustfft::FftPlanner::<f32>::new();
      let fft = planner.plan_fft_forward(pow2);
      fft.process(&mut output);
      // Build ~128 log-spaced bins in [20..20000] Hz assuming recent SR ~ 44100/48000
      let sr = 48000.0f32; // approximate; UI uses log mapping so shape matters more than exact scale
      let bins = 128usize;
      let fmin = 20.0f32; let fmax = 20000.0f32;
      let mut mags = vec![0.0f32; bins];
      for i in 0..bins {
        let t = i as f32 / (bins - 1) as f32;
        let f = fmin * (fmax / fmin).powf(t);
        let k = ((f / sr) * pow2 as f32).round() as usize;
        let k = k.clamp(1, pow2/2 - 1);
        let c = output[k];
        let m = ((c.re * c.re + c.im * c.im).sqrt() / (pow2 as f32)).max(1e-9);
        mags[i] = m;
      }
      let _ = app.emit("eq_spectrum", mags);
    }
  });
}

fn spawn_meter_emitter(app: tauri::AppHandle, rx: Receiver<[f32;4]>) {
  std::thread::spawn(move || {
    // Simple smoothing for visual stability
    let mut last: Option<[f32;4]> = None;
    loop {
      let payload = match rx.recv() { Ok(v) => v, Err(_) => break };
      let smoothed = if let Some(prev) = last {
        let a = 0.6f32; // weight previous more
        [
          a*prev[0] + (1.0-a)*payload[0],
          a*prev[1] + (1.0-a)*payload[1],
          payload[2].max(prev[2]*0.95), // slight decay to peak if not increasing
          payload[3].max(prev[3]*0.95),
        ]
      } else { payload };
      last = Some(smoothed);
      // Convert to dBFS with floor
      let db_min = -80.0f32;
      let to_db = |x:f32| if x <= 1e-9 { db_min } else { 20.0 * x.log10().max(db_min/20.0) };
      let rms_l_db = to_db(smoothed[0].max(1e-9));
      let rms_r_db = to_db(smoothed[1].max(1e-9));
      let peak_l_db = to_db(smoothed[2].max(1e-9));
      let peak_r_db = to_db(smoothed[3].max(1e-9));
      let _ = app.emit("vu_meter", (rms_l_db, rms_r_db, peak_l_db, peak_r_db));
    }
  });
}

#[tauri::command]
pub fn start_audio(app: tauri::AppHandle) -> Result<(), String> {
  if ENGINE_TX.get().is_some() { return Ok(()); }
  let mut engine = Box::new(AudioEngine::new()?);
  // Set up spectrum channel and emitter thread
  let (stx, srx) = chan::<Vec<f32>>();
  engine.set_spectrum_sender(stx);
  spawn_spectrum_emitter(app.clone(), srx);
  // Set up meter channel and emitter thread
  let (mtx, mrx) = chan::<[f32;4]>();
  engine.set_meter_sender(mtx);
  spawn_meter_emitter(app.clone(), mrx);
  // no scope emitter
  let tx = engine.sender();
  engine.start()?;
  let _leaked: &'static mut AudioEngine = Box::leak(engine);
  let _ = ENGINE_TX.set(tx);
  Ok(())
}

#[tauri::command]
pub fn stop_audio() -> Result<(), String> {
  if let Some(tx) = ENGINE_TX.get() {
    let _ = tx.send(EngineMsg::Transport { playing: false });
  }
  Ok(())
}

#[tauri::command]
pub fn set_param(path: String, value: ParamValue) -> Result<(), String> {
  if let Some(tx) = ENGINE_TX.get() {
    let _ = tx.send(EngineMsg::SetParam { path, value });
    Ok(())
  } else { Err("engine not started".into()) }
}

#[tauri::command]
pub fn note_on(part: usize, note: u8, vel: f32) -> Result<(), String> {
  if let Some(tx) = ENGINE_TX.get() {
    let _ = tx.send(EngineMsg::NoteOn { part, note, vel });
    Ok(())
  } else { Err("engine not started".into()) }
}

#[tauri::command]
pub fn note_off(part: usize, note: u8) -> Result<(), String> {
  if let Some(tx) = ENGINE_TX.get() {
    let _ = tx.send(EngineMsg::NoteOff { part, note });
    Ok(())
  } else { Err("engine not started".into()) }
}

#[tauri::command]
pub fn set_tempo(bpm: f32) -> Result<(), String> {
  if let Some(tx) = ENGINE_TX.get() {
    let _ = tx.send(EngineMsg::SetTempo { bpm });
    Ok(())
  } else { Err("engine not started".into()) }
}

#[tauri::command]
pub fn set_transport(playing: bool) -> Result<(), String> {
  if let Some(tx) = ENGINE_TX.get() {
    let _ = tx.send(EngineMsg::Transport { playing });
    Ok(())
  } else { Err("engine not started".into()) }
}


#[tauri::command]
pub fn debug_ping() -> Result<(), String> {
  if let Some(tx) = ENGINE_TX.get() {
    let tx2 = tx.clone();
    let _ = tx.send(EngineMsg::NoteOn { part: 0, note: 60, vel: 0.8 });
    thread::spawn(move || {
      thread::sleep(Duration::from_millis(1000));
      let _ = tx2.send(EngineMsg::NoteOff { part: 0, note: 60 });
    });
    Ok(())
  } else { Err("engine not started".into()) }
}

#[tauri::command]
pub fn start_recording() -> Result<(), String> {
  if let Some(tx) = ENGINE_TX.get() {
    let _ = tx.send(EngineMsg::StartRecording);
    Ok(())
  } else { Err("engine not started".into()) }
}

#[tauri::command]
pub fn stop_recording() -> Result<String, String> {
  if let Some(tx) = ENGINE_TX.get() {
    let _ = tx.send(EngineMsg::StopRecording);
    // For now, return a mock filename - in real implementation this would
    // return the actual saved file path
    Ok("sample1.wav".to_string())
  } else { Err("engine not started".into()) }
}

#[tauri::command]
pub fn list_subsamples() -> Result<Vec<String>, String> {
  let documents_dir = dirs::document_dir()
    .ok_or("Could not find documents directory")?;
  
  let subsamples_dir = documents_dir.join("subsamples");
  
  // Create directory if it doesn't exist
  if !subsamples_dir.exists() {
    fs::create_dir_all(&subsamples_dir)
      .map_err(|e| format!("Failed to create subsamples directory: {}", e))?;
  }
  
  let mut samples = Vec::new();
  
  if let Ok(entries) = fs::read_dir(&subsamples_dir) {
    for entry in entries {
      if let Ok(entry) = entry {
        if let Some(filename) = entry.file_name().to_str() {
          let filename_lower = filename.to_lowercase();
          if filename_lower.ends_with(".wav") || 
             filename_lower.ends_with(".aiff") || 
             filename_lower.ends_with(".flac") || 
             filename_lower.ends_with(".mp3") {
            samples.push(filename.to_string());
          }
        }
      }
    }
  }
  
  samples.sort();
  Ok(samples)
}

fn resolve_subsample_path(documents_dir: &Path, rel: &str) -> Result<PathBuf, String> {
  if rel.is_empty() { return Err("invalid_sample_path".to_string()); }
  let rel_path = Path::new(rel);
  if rel_path.is_absolute() { return Err("invalid_sample_path".to_string()); }
  let base_dir = documents_dir.join("subsamples");
  let base_real = std::fs::canonicalize(&base_dir)
    .map_err(|e| format!("canonicalize_subsamples: {e}"))?;
  let candidate = base_dir.join(rel_path);
  let candidate_real = std::fs::canonicalize(&candidate)
    .map_err(|_| format!("Sample file not found: {}", rel))?;
  if !candidate_real.starts_with(&base_real) { return Err("invalid_sample_path".to_string()); }
  Ok(candidate_real)
}

#[tauri::command]
pub fn load_sample(part: usize, path: String) -> Result<(), String> {
  let documents_dir = dirs::document_dir()
    .ok_or("Could not find documents directory")?;
  
  let sample_path = resolve_subsample_path(&documents_dir, &path)?;
  
  if let Some(tx) = ENGINE_TX.get() {
    let path_str = sample_path.to_string_lossy().to_string();
    let _ = tx.send(EngineMsg::LoadSample { part, path: path_str });
    Ok(())
  } else { Err("engine not started".into()) }
}

#[tauri::command]
pub fn clear_sample(part: usize) -> Result<(), String> {
  if let Some(tx) = ENGINE_TX.get() {
    let _ = tx.send(EngineMsg::ClearSample { part });
    Ok(())
  } else { Err("engine not started".into()) }
}

#[tauri::command]
pub fn preview_sample(path: String) -> Result<(), String> {
  let documents_dir = dirs::document_dir()
    .ok_or("Could not find documents directory")?;
  let sample_path = resolve_subsample_path(&documents_dir, &path)?;
  
  if let Some(tx) = ENGINE_TX.get() {
    let path_str = sample_path.to_string_lossy().to_string();
    let _ = tx.send(EngineMsg::PreviewSample { path: path_str });
    Ok(())
  } else { Err("engine not started".into()) }
}

#[tauri::command]
pub fn stop_preview() -> Result<(), String> {
  if let Some(tx) = ENGINE_TX.get() {
    let _ = tx.send(EngineMsg::StopPreview);
    Ok(())
  } else { Err("engine not started".into()) }
}

#[tauri::command]
pub fn get_sample_waveform(path: String) -> Result<Vec<f32>, String> {
  let documents_dir = dirs::document_dir()
    .ok_or("Could not find documents directory")?;
  let sample_path = resolve_subsample_path(&documents_dir, &path)?;
  
  // Load sample and generate waveform overview
  use crate::engine::modules::sampler::Sampler;
  let mut sampler = Sampler::new(44100.0);
  sampler.load_sample(&sample_path.to_string_lossy());
  
  let waveform = sampler.get_waveform_overview(512); // 512 points for display
  Ok(waveform)
}

#[tauri::command]
pub fn get_sampler_playhead(_part: usize) -> Result<Option<PlayheadState>, String> {
  Ok(get_playhead_state(_part))
}

#[derive(serde::Serialize)]
pub struct SampleInfo {
  pub length_samples: usize,
  pub sample_rate: f32,
  pub channels: usize,
}

#[tauri::command]
pub fn get_sample_info(path: String) -> Result<SampleInfo, String> {
  let documents_dir = dirs::document_dir()
    .ok_or("Could not find documents directory")?;
  let sample_path = resolve_subsample_path(&documents_dir, &path)?;
  use crate::engine::modules::sampler::Sampler;
  let mut sampler = Sampler::new(44100.0);
  sampler.load_sample(&sample_path.to_string_lossy());
  let (length_samples, sample_rate, channels) = sampler.get_sample_info();
  Ok(SampleInfo { length_samples, sample_rate, channels })
}

// ---- Drum pack utilities ----
#[tauri::command]
pub fn list_drum_packs() -> Result<Vec<String>, String> {
  let documents_dir = dirs::document_dir().ok_or("Could not find documents directory")?;
  let drums_dir = documents_dir.join("Drums");
  if !drums_dir.exists() { return Ok(vec![]); }
  let mut packs = Vec::new();
  for ent in std::fs::read_dir(&drums_dir).map_err(|e| format!("read_dir: {e}"))? {
    if let Ok(ent) = ent { if ent.path().is_dir() { if let Some(name) = ent.file_name().to_str() { packs.push(name.to_string()); } } }
  }
  packs.sort();
  Ok(packs)
}

fn is_audio_file(name: &str) -> bool {
  let l = name.to_ascii_lowercase();
  l.ends_with(".wav") || l.ends_with(".aiff") || l.ends_with(".aif") || l.ends_with(".flac") || l.ends_with(".mp3")
}

fn validate_pack_name(pack: &str) -> Result<(), String> {
  if pack.is_empty() { return Err("invalid_pack_name".to_string()); }
  if !pack.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
    return Err("invalid_pack_name".to_string());
  }
  Ok(())
}

fn resolve_pack_dir(documents_dir: &Path, pack: &str) -> Result<PathBuf, String> {
  validate_pack_name(pack)?;
  let drums_dir = documents_dir.join("Drums");
  if !drums_dir.exists() { return Err("pack_not_found".to_string()); }
  let pack_dir = drums_dir.join(pack);
  if !pack_dir.exists() { return Err("pack_not_found".to_string()); }
  let drums_real = std::fs::canonicalize(&drums_dir)
    .map_err(|e| format!("canonicalize_drums: {e}"))?;
  let pack_real = std::fs::canonicalize(&pack_dir)
    .map_err(|e| format!("canonicalize_pack: {e}"))?;
  if !pack_real.starts_with(&drums_real) { return Err("invalid_pack_name".to_string()); }
  Ok(pack_real)
}

#[tauri::command]
pub fn list_drum_samples(pack: String) -> Result<Vec<String>, String> {
  let documents_dir = dirs::document_dir().ok_or("Could not find documents directory")?;
  let pack_dir = resolve_pack_dir(&documents_dir, &pack)?;
  let mut files = Vec::new();
  for ent in std::fs::read_dir(&pack_dir).map_err(|e| format!("read_dir: {e}"))? {
    if let Ok(ent) = ent { if ent.path().is_file() { if let Some(name) = ent.file_name().to_str() { if is_audio_file(name) { files.push(name.to_string()); } } } }
  }
  files.sort();
  Ok(files)
}

#[tauri::command]
pub fn load_drum_pack(part: usize, pack: String) -> Result<(), String> {
  let documents_dir = dirs::document_dir().ok_or("Could not find documents directory")?;
  let pack_dir = resolve_pack_dir(&documents_dir, &pack)?;
  let mut paths: Vec<String> = Vec::new();
  for ent in std::fs::read_dir(&pack_dir).map_err(|e| format!("read_dir: {e}"))? {
    if let Ok(ent) = ent { if ent.path().is_file() { if let Some(name) = ent.file_name().to_str() { if is_audio_file(name) { paths.push(ent.path().to_string_lossy().to_string()); } } } }
  }
  paths.sort();
  if let Some(tx) = ENGINE_TX.get() {
    let _ = tx.send(EngineMsg::LoadDrumPack { part, paths });
    Ok(())
  } else { Err("engine not started".into()) }
}
