pub struct Smooth { pub y: f32, a: f32 }
impl Smooth {
  pub fn new(sr: f32, ms: f32) -> Self {
    let a = (-1.0 / (ms * 0.001 * sr)).exp();
    Self { y: 0.0, a }
  }
  #[inline]
  pub fn set_tau(&mut self, sr: f32, ms: f32) { self.a = (-1.0 / (ms * 0.001 * sr)).exp(); }
  #[inline]
  pub fn next(&mut self, target: f32) -> f32 { self.y = self.a * self.y + (1.0 - self.a) * target; self.y }
}

pub struct SimpleDelay {
  buf_l: Vec<f32>,
  buf_r: Vec<f32>,
  wr_l: usize,
  wr_r: usize,
  len_l: usize,
  len_r: usize,
  time_samp: Smooth,
  fb: Smooth,
  wet: Smooth,
}

impl SimpleDelay {
  pub fn new(max_ms: f32, sr: f32) -> Self {
    let len_l = (((max_ms / 1000.0) * sr).ceil().max(64.0)) as usize;
    // Slightly longer right buffer to avoid identical wrap alignment
    let len_r = ((((max_ms / 1000.0) * sr) * 1.03).ceil().max(64.0)) as usize;
    Self {
      buf_l: vec![0.0; len_l],
      buf_r: vec![0.0; len_r],
      wr_l: 0,
      wr_r: 0,
      len_l,
      len_r,
      time_samp: Smooth::new(sr, 15.0),
      fb: Smooth::new(sr, 8.0),
      wet: Smooth::new(sr, 8.0),
    }
  }
  #[inline]
  fn wrap(len: usize, i: i32) -> usize { let m = len as i32; let mut k = i % m; if k < 0 { k += m; } k as usize }
  #[inline]
  fn lerp(buf: &[f32], idx: f32, len: usize) -> f32 { let i0 = idx.floor() as i32; let frac = idx - i0 as f32; let i1 = i0 + 1; let s0 = buf[Self::wrap(len, i0)]; let s1 = buf[Self::wrap(len, i1)]; s0 + (s1 - s0) * frac }

  pub fn process_block(&mut self, l: &mut [f32], r: &mut [f32], sr: f32, time_ms: f32, feedback: f32, mix: f32, ping_pong: bool) {
    let max_len = self.len_l.min(self.len_r).saturating_sub(2) as f32;
    let target_samp = ((time_ms / 1000.0) * sr).clamp(1.0, max_len);
    let fb_t = feedback.clamp(0.0, 0.98);
    let wet_t = mix.clamp(0.0, 1.0);
    for n in 0..l.len() {
      let d = self.time_samp.next(target_samp);
      let fb = self.fb.next(fb_t);
      let wet = self.wet.next(wet_t);
      let dry = 1.0 - wet;
      // read delayed BEFORE writing (per-channel pointers)
      let rd_l = (self.wr_l as f32) - d;
      let rd_r = (self.wr_r as f32) - d;
      let yl = Self::lerp(&self.buf_l, rd_l, self.len_l);
      let yr = Self::lerp(&self.buf_r, rd_r, self.len_r);
      // tap dry
      let dl = l[n]; let dr = r[n];
      // write using previous delayed sample (no instantaneous feedback)
      if ping_pong {
        self.buf_l[self.wr_l] = dl + yr * fb;
        self.buf_r[self.wr_r] = dr + yl * fb;
      } else {
        self.buf_l[self.wr_l] = dl + yl * fb;
        self.buf_r[self.wr_r] = dr + yr * fb;
      }
      // mix
      l[n] = dl * dry + yl * wet;
      r[n] = dr * dry + yr * wet;
      // advance
      self.wr_l += 1; if self.wr_l >= self.len_l { self.wr_l = 0; }
      self.wr_r += 1; if self.wr_r >= self.len_r { self.wr_r = 0; }
    }
  }
}
