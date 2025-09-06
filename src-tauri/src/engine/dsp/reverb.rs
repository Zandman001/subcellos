pub struct Smooth { pub y: f32, a: f32 }
impl Smooth {
  pub fn new(sr: f32, ms: f32) -> Self { let a = (-1.0 / (ms * 0.001 * sr)).exp(); Self { y: 0.0, a } }
  #[inline] pub fn set_tau(&mut self, sr: f32, ms: f32) { self.a = (-1.0 / (ms * 0.001 * sr)).exp(); }
  #[inline] pub fn next(&mut self, target: f32) -> f32 { self.y = self.a * self.y + (1.0 - self.a) * target; self.y }
}

pub struct OnePoleLP { a: f32, y: f32 }
impl OnePoleLP {
  pub fn new() -> Self { Self { a: 0.5, y: 0.0 } }
  #[inline] pub fn set_hf_damp(&mut self, amt: f32) { self.a = 0.3 + 0.6 * amt.clamp(0.0, 1.0); }
  #[inline] pub fn tick(&mut self, x: f32) -> f32 { self.y += self.a * (x - self.y); self.y }
}

pub struct SimpleVerb {
  // pre-delay
  pre_l: Vec<f32>, pre_r: Vec<f32>, pre_wl: usize, pre_wr: usize,
  // combs
  comb_l: [Vec<f32>; 8], comb_r: [Vec<f32>; 8],
  idx_cl: [usize; 8], idx_cr: [usize; 8],
  lp_cl: [OnePoleLP; 8], lp_cr: [OnePoleLP; 8],
  fb: [f32; 8],
  // allpasses
  ap_l: [Vec<f32>; 4], ap_r: [Vec<f32>; 4],
  idx_al: [usize; 4], idx_ar: [usize; 4],
  ap_coef: f32,
  // tiny AP modulation
  lfo_ph: f32, lfo_rate: f32, lfo_amt_samp: f32,
  // smoothed params
  damp: Smooth,
  fb_s: Smooth,
  sr: f32,
}

impl SimpleVerb {
  pub fn new(sr: f32) -> Self {
    let mk = |ms: f32| vec![0.0; ((ms * sr) as usize).max(64)];
    Self {
      pre_l: mk(0.020), pre_r: mk(0.023), pre_wl: 0, pre_wr: 0,
      // Approximate Freeverb-style lengths; decorrelated L/R
      comb_l: [mk(0.1116), mk(0.1188), mk(0.1277), mk(0.1356), mk(0.1427), mk(0.1491), mk(0.1557), mk(0.1617)],
      comb_r: [mk(0.1136), mk(0.1207), mk(0.1300), mk(0.1379), mk(0.1449), mk(0.1513), mk(0.1582), mk(0.1637)],
      idx_cl: [0; 8], idx_cr: [0; 8],
      lp_cl: [OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new()],
      lp_cr: [OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new(), OnePoleLP::new()],
      ap_l: [mk(0.012), mk(0.0083), mk(0.005), mk(0.0017)],
      ap_r: [mk(0.010), mk(0.0091), mk(0.006), mk(0.0023)],
      idx_al: [0; 4], idx_ar: [0; 4],
      fb: [0.8; 8],
      ap_coef: 0.6,
      lfo_ph: 0.0, lfo_rate: 0.15, lfo_amt_samp: 0.0002 * sr,
      damp: Smooth::new(sr, 50.0),
      fb_s: Smooth::new(sr, 50.0),
      sr,
    }
  }

  pub fn set_params(&mut self, sr: f32, decay_s: f32, room: f32) {
    // map to feedback & damping with smoothing
    let g = (1.0 - (1.0 / (decay_s.clamp(0.2, 8.0) * 30.0))).clamp(0.5, 0.98);
    let d = (0.2 + 0.8 * room.clamp(0.0, 1.0)).clamp(0.2, 1.0);
    self.fb_s.set_tau(sr, 50.0);
    self.damp.set_tau(sr, 50.0);
    let gg = self.fb_s.next(g);
    let dd = self.damp.next(d);
    for i in 0..8 { self.fb[i] = gg; self.lp_cl[i].set_hf_damp(dd); self.lp_cr[i].set_hf_damp(dd); }
  }

  pub fn process_block(&mut self, l: &mut [f32], r: &mut [f32], mix: f32) {
    let wet = mix.clamp(0.0, 1.0);
    let dry = 1.0 - wet;
    let tau = core::f32::consts::TAU;
    for n in 0..l.len() {
      // pre-delay
      let dl = l[n]; let dr = r[n];
      let yl0 = self.pre_l[self.pre_wl];
      let yr0 = self.pre_r[self.pre_wr];
      self.pre_l[self.pre_wl] = dl; self.pre_r[self.pre_wr] = dr;
      self.pre_wl = (self.pre_wl + 1) % self.pre_l.len();
      self.pre_wr = (self.pre_wr + 1) % self.pre_r.len();

      // combs with internal HF damping
      let mut acc_l = 0.0; let mut acc_r = 0.0;
      for i in 0..8 {
        let il = self.idx_cl[i]; let ir = self.idx_cr[i];
        let cl = self.comb_l[i][il];
        let cr = self.comb_r[i][ir];
        let inl = self.lp_cl[i].tick(yl0);
        let inr = self.lp_cr[i].tick(yr0);
        self.comb_l[i][il] = inl + cl * self.fb[i];
        self.comb_r[i][ir] = inr + cr * self.fb[i];
        acc_l += cl; acc_r += cr;
        self.idx_cl[i] = (il + 1) % self.comb_l[i].len();
        self.idx_cr[i] = (ir + 1) % self.comb_r[i].len();
      }
      acc_l *= 1.0 / 8.0; acc_r *= 1.0 / 8.0;

      // 4 allpasses with tiny modulation
      let s = (tau * self.lfo_ph).sin();
      self.lfo_ph = (self.lfo_ph + self.lfo_rate / self.sr).fract();
      let mut vl = acc_l; let mut vr = acc_r;
      for j in 0..4 {
        let jl = self.idx_al[j]; let jr = self.idx_ar[j];
        let dl_mod = (s * self.lfo_amt_samp) as i32;
        let xl = self.ap_l[j][wrap(self.ap_l[j].len(), jl as i32 - dl_mod)];
        let xr = self.ap_r[j][wrap(self.ap_r[j].len(), jr as i32 + dl_mod)];
        let yl = vl - self.ap_coef * xl; self.ap_l[j][jl] = vl + self.ap_coef * yl; vl = yl;
        let yr = vr - self.ap_coef * xr; self.ap_r[j][jr] = vr + self.ap_coef * yr; vr = yr;
        self.idx_al[j] = (jl + 1) % self.ap_l[j].len();
        self.idx_ar[j] = (jr + 1) % self.ap_r[j].len();
      }

      // wet/dry
      let wl = vl; let wr = vr;
      l[n] = dl * dry + wl * wet;
      r[n] = dr * dry + wr * wet;
    }
  }
}

#[inline]
fn wrap(len: usize, i: i32) -> usize {
  let m = len as i32; let mut k = i % m; if k < 0 { k += m; } k as usize
}
