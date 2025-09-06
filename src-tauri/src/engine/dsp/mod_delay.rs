pub struct ModDelay {
  buf_l: Vec<f32>,
  buf_r: Vec<f32>,
  wr: usize,
  len: usize,
  phase_l: f32,
  phase_r: f32,
}

impl ModDelay {
  pub fn new(max_ms: f32, sr: f32) -> Self {
    let len = (((max_ms / 1000.0) * sr).ceil().max(64.0)) as usize;
    Self {
      buf_l: vec![0.0; len],
      buf_r: vec![0.0; len],
      wr: 0,
      len,
      // LFO phases are normalized cycles in [0,1)
      phase_l: 0.0,
      phase_r: 0.33,
    }
  }

  #[inline]
  fn read_at(buf: &[f32], idx: f32) -> f32 {
    let len = buf.len() as i32;
    let i0 = idx.floor() as i32;
    let frac = idx - i0 as f32;
    let i1 = i0 + 1;
    let wrap = |i: i32| -> usize { ((i % len + len) % len) as usize };
    let s0 = buf[wrap(i0)];
    let s1 = buf[wrap(i1)];
    s0 + (s1 - s0) * frac
  }

  #[inline]
  pub fn process_one(&mut self, l: f32, r: f32, sr: f32, rate_hz: f32, base_ms: f32, depth_ms: f32, mix: f32) -> (f32, f32) {
    let mix = mix.clamp(0.0, 1.0);
    // Advance LFO phase in cycles and wrap into [0,1)
    let dp = rate_hz / sr;
    // write
    self.buf_l[self.wr] = l;
    self.buf_r[self.wr] = r;
    // compute delays (samples)
    let to_samp = |ms: f32| (ms / 1000.0) * sr;
    let base = to_samp(base_ms);
    let depth = to_samp(depth_ms);
    let lfo_l = (core::f32::consts::TAU * self.phase_l).sin();
    let lfo_r = (core::f32::consts::TAU * self.phase_r).sin();
    let dl = base + ((lfo_l * 0.5 + 0.5) * depth);
    let dr = base + ((lfo_r * 0.5 + 0.5) * depth);
    let rl = (self.wr as f32) - dl;
    let rr = (self.wr as f32) - dr;
    let yl = Self::read_at(&self.buf_l, rl);
    let yr = Self::read_at(&self.buf_r, rr);
    // advance lfo and pointer
    self.phase_l = (self.phase_l + dp).fract();
    self.phase_r = (self.phase_r + dp).fract();
    self.wr += 1; if self.wr >= self.len { self.wr = 0; }
    // wet/dry
    let l_out = l * (1.0 - mix) + yl * mix;
    let r_out = r * (1.0 - mix) + yr * mix;
    (l_out, r_out)
  }
}
