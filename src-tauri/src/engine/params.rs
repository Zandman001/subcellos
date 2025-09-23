use std::collections::HashMap;

use super::messages::ParamValue;

#[derive(Clone)]
pub struct ParamStore {
  pub map: HashMap<String, ParamValue>,
  map_h: HashMap<u64, ParamValue>,
}

impl ParamStore {
  pub fn new() -> Self {
  Self { map: HashMap::new(), map_h: HashMap::new() }
  }
  pub fn set(&mut self, path: String, v: ParamValue) {
    let h = fast_hash(&path);
    self.map_h.insert(h, v.clone());
    self.map.insert(path, v);
  }
  #[allow(dead_code)]
  pub fn get_f32(&self, path: &str, default: f32) -> f32 {
    match self.map.get(path) { Some(ParamValue::F32(v)) => *v, _ => default }
  }
  #[allow(dead_code)]
  pub fn get_i32(&self, path: &str, default: i32) -> i32 {
    match self.map.get(path) { Some(ParamValue::I32(v)) => *v, _ => default }
  }
  pub fn get_f32_h(&self, key: u64, default: f32) -> f32 {
    match self.map_h.get(&key) { Some(ParamValue::F32(v)) => *v, _ => default }
  }
  pub fn get_i32_h(&self, key: u64, default: i32) -> i32 {
    match self.map_h.get(&key) { Some(ParamValue::I32(v)) => *v, _ => default }
  }
  #[allow(dead_code)]
  pub fn get_bool(&self, path: &str, default: bool) -> bool {
    match self.map.get(path) { Some(ParamValue::Bool(v)) => *v, _ => default }
  }
  #[allow(dead_code)]
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
