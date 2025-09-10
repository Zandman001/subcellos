pub struct OnePoleLP { a: f32, y: f32 }
impl OnePoleLP {
  pub fn new() -> Self { Self { a: 0.5, y: 0.0 } }
  #[inline] pub fn set_hf_damp(&mut self, amt: f32) { self.a = 0.3 + 0.6 * amt.clamp(0.0, 1.0); }
  #[inline] pub fn tick(&mut self, x: f32) -> f32 { self.y += self.a * (x - self.y); self.y }
}
