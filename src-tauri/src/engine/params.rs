use std::collections::HashMap;

use super::messages::ParamValue;

#[derive(Clone)]
pub struct LagParam {
  pub current: f32,
  pub target: f32,
  pub alpha: f32,
}

impl LagParam {
  pub fn new(v: f32, sr: f32, ms: f32) -> Self {
    let a = lag_alpha(sr, ms);
    Self { current: v, target: v, alpha: a }
  }
  pub fn set_target(&mut self, v: f32) { self.target = v; }
  pub fn update(&mut self) -> f32 {
    self.current += (self.target - self.current) * self.alpha;
    self.current
  }
  pub fn update_n(&mut self, n: usize) -> f32 {
    for _ in 0..n { self.update(); }
    self.current
  }
  pub fn update_time(&mut self, sr: f32, ms: f32) { self.alpha = lag_alpha(sr, ms) }
}

fn lag_alpha(sr: f32, ms: f32) -> f32 {
  let t = (ms / 1000.0).max(0.001).min(0.010);
  let rc = t;
  let dt = 1.0 / sr;
  (dt / (rc + dt)).min(1.0)
}

#[derive(Clone)]
pub struct ParamStore {
  pub map: HashMap<String, ParamValue>,
  pub lag_ms: f32,
  map_h: HashMap<u64, ParamValue>,
}

impl ParamStore {
  pub fn new() -> Self {
    Self { map: HashMap::new(), lag_ms: 0.005, map_h: HashMap::new() }
  }
  pub fn set(&mut self, path: String, v: ParamValue) {
    let h = fast_hash(&path);
    self.map_h.insert(h, v.clone());
    self.map.insert(path, v);
  }
  pub fn get_f32(&self, path: &str, default: f32) -> f32 {
    match self.map.get(path) { Some(ParamValue::F32(v)) => *v, _ => default }
  }
  pub fn get_i32(&self, path: &str, default: i32) -> i32 {
    match self.map.get(path) { Some(ParamValue::I32(v)) => *v, _ => default }
  }
  pub fn get_f32_h(&self, key: u64, default: f32) -> f32 {
    match self.map_h.get(&key) { Some(ParamValue::F32(v)) => *v, _ => default }
  }
  pub fn get_i32_h(&self, key: u64, default: i32) -> i32 {
    match self.map_h.get(&key) { Some(ParamValue::I32(v)) => *v, _ => default }
  }
  pub fn get_bool(&self, path: &str, default: bool) -> bool {
    match self.map.get(path) { Some(ParamValue::Bool(v)) => *v, _ => default }
  }
  pub fn get_str<'a>(&'a self, path: &str, default: &'a str) -> &'a str {
    match self.map.get(path) { Some(ParamValue::Str(v)) => v.as_str(), _ => default }
  }
}

#[inline]
fn fast_hash(s: &str) -> u64 {
  // FNV-1a 64-bit
  let mut hash: u64 = 0xcbf29ce484222325; // offset basis
  for b in s.as_bytes() {
    hash ^= *b as u64;
    hash = hash.wrapping_mul(0x100000001b3);
  }
  hash
}

// Helper to expose hash for other modules
pub fn hash_path(path: &str) -> u64 { fast_hash(path) }
