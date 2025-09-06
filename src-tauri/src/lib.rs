mod engine {
  pub mod messages;
  pub mod params;
  pub mod graph;
  pub mod audio;
  pub mod dsp;
  pub mod modules;
}
mod commands;
use commands::*;
mod fs_api;
use fs_api::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // No engine stored in State; a global singleton holds the sender.
    .invoke_handler(tauri::generate_handler![
      start_audio,
      stop_audio,
      set_param,
      note_on,
      note_off,
      set_tempo,
      set_transport,
      get_audio_levels,
      debug_ping,
      // FS API
      fs_list_projects,
      fs_create_project,
      fs_delete_project,
      fs_list_patterns,
      fs_create_pattern,
      fs_delete_pattern,
      fs_read_project,
      fs_write_project,
      fs_read_pattern,
      fs_write_pattern,
      fs_list_sounds,
      create_sound,
      delete_sound,
      load_sound_preset,
      save_sound_preset,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
