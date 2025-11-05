use crate::engine::modules::sampler::PlayheadState;
use once_cell::sync::OnceCell;
use std::sync::{Arc, Mutex};

pub static PLAYHEAD_STATES: OnceCell<Arc<Mutex<Vec<Option<PlayheadState>>>>> = OnceCell::new();

pub fn init_playhead_states(parts: usize) {
    PLAYHEAD_STATES.get_or_init(|| Arc::new(Mutex::new(vec![None; parts])));
}

pub fn set_playhead_state(part: usize, state: Option<PlayheadState>) {
    if let Some(arc) = PLAYHEAD_STATES.get() {
        if let Ok(mut v) = arc.lock() {
            if part < v.len() {
                v[part] = state;
            }
        }
    }
}

pub fn get_playhead_state(part: usize) -> Option<PlayheadState> {
    PLAYHEAD_STATES
        .get()?
        .lock()
        .ok()?
        .get(part)
        .cloned()
        .flatten()
}
