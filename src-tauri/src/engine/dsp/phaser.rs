pub struct AP {
    a1: f32,
    zm1: f32,
}
impl AP {
    pub fn new() -> Self {
        Self { a1: 0.0, zm1: 0.0 }
    }
    #[inline]
    pub fn set_fc(&mut self, fc: f32, sr: f32) {
        let w = (2.0 * core::f32::consts::PI * (fc / sr)).tan();
        self.a1 = (1.0 - w) / (1.0 + w);
    }
    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        let y = -self.a1 * x + self.zm1;
        self.zm1 = x + self.a1 * y;
        y
    }
}

pub struct Phaser {
    ap: [AP; 4],
    phase: f32,
}
impl Phaser {
    pub fn new() -> Self {
        Self {
            ap: [AP::new(), AP::new(), AP::new(), AP::new()],
            phase: 0.0,
        }
    }
    #[inline]
    pub fn process_one(
        &mut self,
        l: f32,
        r: f32,
        sr: f32,
        rate_hz: f32,
        depth: f32,
        mix: f32,
    ) -> (f32, f32) {
        let mix = mix.clamp(0.0, 1.0);
        let depth = depth.clamp(0.0, 1.0);
        // Advance phase in cycles
        let dp = rate_hz / sr;
        // center fc sweep
        let modh = (core::f32::consts::TAU * self.phase).sin() * 0.5 + 0.5; // 0..1
        let fc = 200.0 + (2000.0 - 200.0) * (0.1 + 0.9 * depth * modh);
        for ap in self.ap.iter_mut() {
            ap.set_fc(fc, sr);
        }
        let yl = self.ap.iter_mut().fold(l, |x, ap| ap.tick(x));
        let yr = self.ap.iter_mut().fold(r, |x, ap| ap.tick(x));
        self.phase = (self.phase + dp).fract();
        let l_out = l * (1.0 - mix) + yl * mix;
        let r_out = r * (1.0 - mix) + yr * mix;
        (l_out, r_out)
    }
}
