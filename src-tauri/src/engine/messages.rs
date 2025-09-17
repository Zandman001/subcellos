use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
pub enum ParamValue {
  F32(f32),
  I32(i32),
  Bool(bool),
  Str(String),
}

#[derive(Clone, Debug, Deserialize)]
pub enum EngineMsg {
  SetParam { path: String, value: ParamValue },
  NoteOn { part: usize, note: u8, vel: f32 },
  NoteOff { part: usize, note: u8 },
  SetTempo { bpm: f32 },
  Transport { playing: bool },
  StartRecording,
  StopRecording,
  LoadSample { part: usize, path: String },
  ClearSample { part: usize },
  PreviewSample { path: String },
  StopPreview,
  Quit,
}

