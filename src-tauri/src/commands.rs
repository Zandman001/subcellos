 use std::{thread, time::Duration, path::PathBuf, fs};

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

#[tauri::command]
pub fn start_audio(app: tauri::AppHandle) -> Result<(), String> {
  if ENGINE_TX.get().is_some() { return Ok(()); }
  let mut engine = Box::new(AudioEngine::new()?);
  // Set up spectrum channel and emitter thread
  let (stx, srx) = chan::<Vec<f32>>();
  engine.set_spectrum_sender(stx);
  spawn_spectrum_emitter(app.clone(), srx);
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

#[tauri::command]
pub fn load_sample(part: usize, path: String) -> Result<(), String> {
  let documents_dir = dirs::document_dir()
    .ok_or("Could not find documents directory")?;
  
  let sample_path = documents_dir.join("subsamples").join(&path);
  
  if !sample_path.exists() {
    return Err(format!("Sample file not found: {}", path));
  }
  
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
  
  let sample_path = documents_dir.join("subsamples").join(&path);
  
  if !sample_path.exists() {
    return Err(format!("Sample file not found: {}", path));
  }
  
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
  
  let sample_path = documents_dir.join("subsamples").join(&path);
  
  if !sample_path.exists() {
    return Err(format!("Sample file not found: {}", path));
  }
  
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
  let sample_path = documents_dir.join("subsamples").join(&path);
  if !sample_path.exists() {
    return Err(format!("Sample file not found: {}", path));
  }
  use crate::engine::modules::sampler::Sampler;
  let mut sampler = Sampler::new(44100.0);
  sampler.load_sample(&sample_path.to_string_lossy());
  let (length_samples, sample_rate, channels) = sampler.get_sample_info();
  Ok(SampleInfo { length_samples, sample_rate, channels })
}
