use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use crossbeam_channel::{unbounded, Receiver, Sender, TryRecvError};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use super::{graph::EngineGraph, messages::EngineMsg, params::ParamStore};

struct TransportDebug {
    target: Option<PathBuf>,
    pending: Vec<u64>,
    flush_threshold: usize,
    last_tick_sample: Option<u64>,
    disabled: bool,
}

impl TransportDebug {
    fn new() -> Self {
        let target = std::env::var("SUBCELLOS_TICK_LOG").ok().map(|raw| {
            let trimmed = raw.trim();
            if trimmed.is_empty() {
                PathBuf::from("transport_ticks.log")
            } else {
                PathBuf::from(trimmed)
            }
        });
        Self {
            target,
            pending: Vec::with_capacity(512),
            flush_threshold: 4096,
            last_tick_sample: None,
            disabled: false,
        }
    }

    #[inline]
    fn enabled(&self) -> bool {
        self.target.is_some() && !self.disabled
    }

    #[inline]
    fn has_pending(&self) -> bool {
        !self.pending.is_empty()
    }

    fn record(&mut self, sample_idx: u64) {
        if !self.enabled() {
            return;
        }
        if let Some(prev) = self.last_tick_sample {
            self.pending.push(sample_idx.saturating_sub(prev));
        }
        self.last_tick_sample = Some(sample_idx);
        if self.pending.len() >= self.flush_threshold {
            self.flush();
        }
    }

    fn flush(&mut self) {
        if !self.enabled() {
            self.pending.clear();
            return;
        }
        let Some(path) = self.target.as_ref() else {
            return;
        };
        if self.pending.is_empty() {
            return;
        }
        match OpenOptions::new().create(true).append(true).open(path) {
            Ok(mut file) => {
                for delta in self.pending.drain(..) {
                    let _ = writeln!(file, "{delta}");
                }
            }
            Err(_) => {
                self.disabled = true;
                self.pending.clear();
            }
        }
    }
}

struct TransportClock {
    sr: f32,
    bpm: f32,
    beats_per_sample: f64,
    phase: f64,
    running: bool,
    sample_counter: u64,
    debug: TransportDebug,
}

impl TransportClock {
    fn new(sr: f32, bpm: f32) -> Self {
        let mut clock = Self {
            sr: sr.max(1.0),
            bpm: bpm.clamp(40.0, 300.0),
            beats_per_sample: 0.0,
            phase: 0.0,
            running: true,
            sample_counter: 0,
            debug: TransportDebug::new(),
        };
        clock.update_coeff();
        clock
    }

    #[inline]
    fn update_coeff(&mut self) {
        self.beats_per_sample = (self.bpm as f64 / 60.0) / (self.sr as f64);
    }

    fn set_bpm(&mut self, bpm: f32) {
        self.bpm = bpm.clamp(40.0, 300.0);
        self.update_coeff();
    }

    #[inline]
    fn set_running(&mut self, running: bool) {
        self.running = running;
    }

    fn phase_for_next_sample(&mut self) -> f32 {
        if self.running {
            let mut next = self.phase + self.beats_per_sample;
            if next >= 1.0 {
                let wraps = next.floor() as u64;
                next -= wraps as f64;
                let sample_index = self.sample_counter.wrapping_add(1);
                if wraps > 0 {
                    self.debug.record(sample_index);
                }
            }
            self.phase = next;
            self.sample_counter = self.sample_counter.wrapping_add(1);
        }
        self.phase as f32
    }

    fn flush_debug(&mut self) {
        if self.debug.has_pending() {
            self.debug.flush();
        }
    }
}

pub struct AudioEngine {
    tx: Sender<EngineMsg>,
    rx: Receiver<EngineMsg>,
    pub sr: f32,
    graph: Option<EngineGraph>,
    params: Option<ParamStore>,
    stream: Option<cpal::Stream>,
    last_device_name: Option<String>,
    spec_tx: Option<Sender<Vec<f32>>>,
    // Meter sender for RMS/peak (L/R)
    meter_tx: Option<Sender<[f32; 4]>>,
    #[allow(dead_code)]
    spec_buf: Vec<f32>,
    #[allow(dead_code)]
    recording: bool,
    #[allow(dead_code)]
    recorded_samples: Vec<f32>,
}

impl AudioEngine {
    pub fn new() -> Result<Self, String> {
        let (tx, rx) = unbounded();
        // Default sample rate preference: prefer 44100 (more compatible), then 48000
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "no output device".to_string())?;
        // Pick config near 48k, 2 channels, f32
        let mut chosen_cfg: Option<cpal::SupportedStreamConfig> = None;
        if let Ok(mut supported) = device.supported_output_configs() {
            // On Linux/ALSA, 48k is often more stable than 44.1k. Prefer 48k first, then 44.1k.
            for cfg_range in supported.by_ref() {
                if cfg_range.channels() != 2 {
                    continue;
                }
                if cfg_range.sample_format() != cpal::SampleFormat::F32 {
                    continue;
                }
                let sr = 48_000u32;
                if cfg_range.min_sample_rate().0 <= sr && cfg_range.max_sample_rate().0 >= sr {
                    chosen_cfg = Some(cfg_range.with_sample_rate(cpal::SampleRate(sr)));
                    break;
                }
            }
            // then 44100
            if chosen_cfg.is_none() {
                if let Ok(supported2) = device.supported_output_configs() {
                    for cfg_range in supported2 {
                        if cfg_range.channels() != 2 {
                            continue;
                        }
                        if cfg_range.sample_format() != cpal::SampleFormat::F32 {
                            continue;
                        }
                        let sr = 44_100u32;
                        if cfg_range.min_sample_rate().0 <= sr
                            && cfg_range.max_sample_rate().0 >= sr
                        {
                            chosen_cfg = Some(cfg_range.with_sample_rate(cpal::SampleRate(sr)));
                            break;
                        }
                    }
                }
            }
            if chosen_cfg.is_none() {
                for cfg_range in supported {
                    if cfg_range.channels() == 2
                        && cfg_range.sample_format() == cpal::SampleFormat::F32
                    {
                        chosen_cfg = Some(cfg_range.with_max_sample_rate());
                        break;
                    }
                }
            }
        }
        let config = if let Some(cfg) = chosen_cfg {
            cfg
        } else {
            device.default_output_config().map_err(|e| e.to_string())?
        };
        let sr = config.sample_rate().0 as f32;

        Ok(Self {
            tx,
            rx,
            sr,
            graph: Some(EngineGraph::new(sr)),
            params: Some(ParamStore::new()),
            stream: None,
            last_device_name: None,
            spec_tx: None,
            meter_tx: None,
            spec_buf: Vec::with_capacity(4096),
            recording: false,
            recorded_samples: Vec::new(),
        })
    }

    pub fn set_spectrum_sender(&mut self, tx: Sender<Vec<f32>>) {
        self.spec_tx = Some(tx);
    }
    pub fn set_meter_sender(&mut self, tx: Sender<[f32; 4]>) {
        self.meter_tx = Some(tx);
    }

    pub fn start(&mut self) -> Result<(), String> {
        // If a stream exists but default output device changed (e.g., Bluetooth headphones),
        // re-create the stream on the new default.
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| "no output device".to_string())?;
        let device_name = device.name().unwrap_or_else(|_| "unknown".to_string());
        if let (Some(_stream), Some(prev)) = (self.stream.as_ref(), self.last_device_name.as_ref())
        {
            if &device_name == prev {
                // Already bound to the current default device
                return Ok(());
            } else {
                // Drop old stream to allow rebinding
                self.stream.take();
            }
        }
        let mut chosen_cfg: Option<cpal::SupportedStreamConfig> = None;
        if let Ok(mut supported) = device.supported_output_configs() {
            // prefer 44100 first
            for cfg_range in supported.by_ref() {
                if cfg_range.channels() != 2 {
                    continue;
                }
                if cfg_range.sample_format() != cpal::SampleFormat::F32 {
                    continue;
                }
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
                        if cfg_range.channels() != 2 {
                            continue;
                        }
                        if cfg_range.sample_format() != cpal::SampleFormat::F32 {
                            continue;
                        }
                        let sr = 48_000u32;
                        if cfg_range.min_sample_rate().0 <= sr
                            && cfg_range.max_sample_rate().0 >= sr
                        {
                            chosen_cfg = Some(cfg_range.with_sample_rate(cpal::SampleRate(sr)));
                            break;
                        }
                    }
                }
            }
            if chosen_cfg.is_none() {
                for cfg_range in supported {
                    if cfg_range.channels() == 2
                        && cfg_range.sample_format() == cpal::SampleFormat::F32
                    {
                        chosen_cfg = Some(cfg_range.with_max_sample_rate());
                        break;
                    }
                }
            }
        }
        let config = if let Some(cfg) = chosen_cfg {
            cfg
        } else {
            device.default_output_config().map_err(|e| e.to_string())?
        };
        let mut cfg: cpal::StreamConfig = config.clone().into();
        // Request a larger buffer for better stability; reduce underruns
        cfg.buffer_size = cpal::BufferSize::Fixed(2048);
        self.sr = cfg.sample_rate.0 as f32;

        let rx = self.rx.clone();
        // Move engine state into the audio thread. Keep None in self.
        let mut graph = self
            .graph
            .take()
            .unwrap_or_else(|| EngineGraph::new(self.sr));
        let mut params = self.params.take().unwrap_or_else(|| ParamStore::new());
        let mut transport = TransportClock::new(self.sr, graph.tempo());
        transport.set_running(true);
        let spec_tx = self.spec_tx.clone();
        let meter_tx = self.meter_tx.clone();
        let mut spec_buf = Vec::<f32>::with_capacity(4096);
        let mut recording = false;
        let mut recorded_samples = Vec::<f32>::new();
        // Meter accumulators (separate from spectrum)
        let mut m_sum_l_sq: f64 = 0.0;
        let mut m_sum_r_sq: f64 = 0.0;
        let mut m_peak_l: f32 = 0.0;
        let mut m_peak_r: f32 = 0.0;
        let mut m_count: usize = 0;

        let err_fn = |e| eprintln!("stream error: {e}");
        let mut playing = true;
        transport.set_running(playing);
        let stream = device
            .build_output_stream(
                &cfg,
                move |data: &mut [f32], _| {
                    // Drain messages without blocking (tight cap to avoid starving audio)
                    let mut drained = 0usize;
                    loop {
                        match rx.try_recv() {
                            Ok(msg) => apply_msg(
                                &mut graph,
                                &mut params,
                                &mut transport,
                                msg,
                                &mut playing,
                                &mut recording,
                                &mut recorded_samples,
                            ),
                            Err(TryRecvError::Empty) => break,
                            Err(TryRecvError::Disconnected) => break,
                        }
                        drained += 1;
                        if drained >= 1024 {
                            // Stay responsive in pathological cases, but allow large bursts to drain fully.
                            break;
                        }
                    }
                    // Render frames
                    if playing {
                        for frame in data.chunks_mut(2) {
                            let beat_phase = transport.phase_for_next_sample();
                            let (l, r) = graph.render_frame(&params, beat_phase);
                            frame[0] = l;
                            if frame.len() > 1 {
                                frame[1] = r;
                            }
                            // accumulate mono for spectrum
                            let mono = 0.5 * (l + r);
                            if spec_buf.len() < 2048 {
                                spec_buf.push(mono);
                            }
                            // accumulate for metering (use a shorter window ~1024 samples)
                            m_sum_l_sq += (l as f64) * (l as f64);
                            m_sum_r_sq += (r as f64) * (r as f64);
                            let al = l.abs();
                            let ar = r.abs();
                            if al > m_peak_l {
                                m_peak_l = al;
                            }
                            if ar > m_peak_r {
                                m_peak_r = ar;
                            }
                            m_count += 1;

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
                        // Emit meter roughly every 1024 samples to target ~40-50 Hz at common SRs
                        if m_count >= 1024 {
                            if let Some(mtx) = meter_tx.as_ref() {
                                let n = m_count as f32;
                                let rms_l = (m_sum_l_sq / (n as f64)).sqrt() as f32;
                                let rms_r = (m_sum_r_sq / (n as f64)).sqrt() as f32;
                                let payload = [
                                    rms_l.max(0.0),
                                    rms_r.max(0.0),
                                    m_peak_l.max(0.0),
                                    m_peak_r.max(0.0),
                                ];
                                let _ = mtx.try_send(payload);
                            }
                            m_sum_l_sq = 0.0;
                            m_sum_r_sq = 0.0;
                            m_peak_l = 0.0;
                            m_peak_r = 0.0;
                            m_count = 0;
                        }
                    } else {
                        for frame in data.chunks_mut(2) {
                            let _ = transport.phase_for_next_sample();
                            frame[0] = 0.0;
                            if frame.len() > 1 {
                                frame[1] = 0.0;
                            }
                        }
                    }
                    transport.flush_debug();
                },
                err_fn,
                None,
            )
            .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        self.last_device_name = Some(device_name);
        self.stream = Some(stream);
        Ok(())
    }

    #[allow(dead_code)]
    pub fn stop(&mut self) {
        self.stream.take();
    }

    pub fn sender(&self) -> Sender<EngineMsg> {
        self.tx.clone()
    }
}

fn apply_msg(
    graph: &mut EngineGraph,
    params: &mut ParamStore,
    transport: &mut TransportClock,
    msg: EngineMsg,
    playing: &mut bool,
    recording: &mut bool,
    recorded_samples: &mut Vec<f32>,
) {
    match msg {
        EngineMsg::SetParam { path, value } => params.set(path, value),
        EngineMsg::NoteOn { part, note, vel } => {
            if part < graph.parts.len() {
                graph.parts[part].note_on(&params, note, vel);
            }
        }
        EngineMsg::NoteOff { part, note } => {
            if part < graph.parts.len() {
                graph.parts[part].note_off(note);
            }
        }
        EngineMsg::SetTempo { bpm } => {
            graph.set_tempo(bpm);
            transport.set_bpm(bpm);
        }
        EngineMsg::Transport { playing: p } => {
            *playing = p;
            transport.set_running(p);
        }
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
        EngineMsg::ClearSample { part } => {
            if part < graph.parts.len() {
                graph.parts[part].clear_sample();
            }
        }
        EngineMsg::PreviewSample { path } => {
            if let Err(e) = graph.load_preview_sample(&path) {
                eprintln!("Failed to load preview sample: {}", e);
            }
        }
        EngineMsg::LoadDrumPack { part, paths } => {
            if part < graph.parts.len() {
                graph.parts[part].load_drum_pack(&paths);
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
    fs::create_dir_all(&subsamples_path)
        .map_err(|e| format!("Failed to create subsamples directory: {}", e))?;

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
    file.write_all(b"RIFF")
        .map_err(|e| format!("Failed to write WAV header: {}", e))?;
    file.write_all(&file_size.to_le_bytes())
        .map_err(|e| format!("Failed to write file size: {}", e))?;
    file.write_all(b"WAVE")
        .map_err(|e| format!("Failed to write WAVE: {}", e))?;

    // Format chunk
    file.write_all(b"fmt ")
        .map_err(|e| format!("Failed to write fmt: {}", e))?;
    file.write_all(&16u32.to_le_bytes())
        .map_err(|e| format!("Failed to write fmt size: {}", e))?;
    file.write_all(&1u16.to_le_bytes())
        .map_err(|e| format!("Failed to write audio format: {}", e))?; // PCM
    file.write_all(&1u16.to_le_bytes())
        .map_err(|e| format!("Failed to write channels: {}", e))?; // Mono
    file.write_all(&(sample_rate as u32).to_le_bytes())
        .map_err(|e| format!("Failed to write sample rate: {}", e))?;
    file.write_all(&byte_rate.to_le_bytes())
        .map_err(|e| format!("Failed to write byte rate: {}", e))?;
    file.write_all(&2u16.to_le_bytes())
        .map_err(|e| format!("Failed to write block align: {}", e))?; // 16-bit mono
    file.write_all(&16u16.to_le_bytes())
        .map_err(|e| format!("Failed to write bits per sample: {}", e))?;

    // Data chunk
    file.write_all(b"data")
        .map_err(|e| format!("Failed to write data chunk: {}", e))?;
    file.write_all(&data_size.to_le_bytes())
        .map_err(|e| format!("Failed to write data size: {}", e))?;

    // Convert f32 samples to 16-bit PCM
    for &sample in samples {
        let sample_16 = (sample.clamp(-1.0, 1.0) * 32767.0) as i16;
        file.write_all(&sample_16.to_le_bytes())
            .map_err(|e| format!("Failed to write sample data: {}", e))?;
    }

    Ok(())
}

// Intentionally not Clone; engine state moves into the audio callback.
