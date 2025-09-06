pub struct Bitcrusher {
  bits: u8,      // 4..16
  factor: u32,   // 1..16
  mix: f32,      // 0..1
  hold_l: f32,
  hold_r: f32,
  cnt: u32,
  lp_l: f32,
  lp_r: f32,
  a: f32,
}

impl Bitcrusher {
  pub fn new() -> Self {
    Self { bits: 12, factor: 1, mix: 0.0, hold_l: 0.0, hold_r: 0.0, cnt: 0, lp_l: 0.0, lp_r: 0.0, a: 0.2 }
  }
  pub fn set_bits(&mut self, b: u8) { self.bits = b.max(4).min(16); }
  pub fn set_factor(&mut self, f: u32) { self.factor = f.max(1).min(16); }
  pub fn set_mix(&mut self, m: f32) { self.mix = m.clamp(0.0, 1.0); }

  #[inline]
  fn quantize(x: f32, bits: u8) -> f32 {
    let levels = (1u32 << (bits as u32)) as f32;
    let half = levels / 2.0;
    let v = (x * half).round() / half;
    v.clamp(-1.0, 1.0)
  }

  pub fn process(&mut self, l: &mut [f32], r: &mut [f32]) {
    if self.mix <= 0.0001 || (self.bits >= 16 && self.factor <= 1) { return; }
    let mix = self.mix; let dry = 1.0 - mix;
    let mut cnt = self.cnt;
    for n in 0..l.len() {
      if cnt == 0 {
        self.hold_l = Self::quantize(l[n], self.bits);
        self.hold_r = Self::quantize(r[n], self.bits);
      }
      cnt += 1; if cnt >= self.factor { cnt = 0; }
      // simple post LP (one-pole)
      self.lp_l += self.a * (self.hold_l - self.lp_l);
      self.lp_r += self.a * (self.hold_r - self.lp_r);
      l[n] = dry * l[n] + mix * self.lp_l;
      r[n] = dry * r[n] + mix * self.lp_r;
    }
    self.cnt = cnt;
  }
}

