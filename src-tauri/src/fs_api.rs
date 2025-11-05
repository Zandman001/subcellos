use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    thread,
    time::Duration,
};

use crossbeam_channel::{select, unbounded, Receiver, Sender};
use once_cell::sync::OnceCell;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sound {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String, // "Synth" | "Sampler" | "Drum"
    pub name: String,
    #[serde(default)]
    pub part_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub sounds: Vec<Sound>,
    #[serde(default, alias = "global_bpm", rename = "globalBpm")]
    pub global_bpm: Option<u32>,
    #[serde(default, alias = "ui_theme", rename = "uiTheme")]
    pub ui_theme: Option<String>,
}

impl Default for Project {
    fn default() -> Self {
        Self {
            sounds: Vec::new(),
            global_bpm: Some(120),
            ui_theme: Some("Off".to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pattern {
    #[serde(default, alias = "sound_refs", rename = "soundRefs")]
    pub sound_refs: Vec<String>,
}

impl Default for Pattern {
    fn default() -> Self {
        Self {
            sound_refs: Vec::new(),
        }
    }
}

fn documents_root() -> Result<PathBuf, String> {
    let base = dirs::document_dir().ok_or_else(|| "Could not resolve documents dir".to_string())?;
    let root = base.join("projects");
    if !root.exists() {
        fs::create_dir_all(&root).map_err(|e| format!("create root: {e}"))?;
    }
    Ok(root)
}

fn project_dir(name: &str) -> Result<PathBuf, String> {
    Ok(documents_root()?.join(name))
}

fn project_file(name: &str) -> Result<PathBuf, String> {
    Ok(project_dir(name)?.join("project.json"))
}
fn arrangement_file(project: &str) -> Result<PathBuf, String> {
    Ok(project_dir(project)?.join("arrangement.json"))
}
fn patterns_dir(project: &str) -> Result<PathBuf, String> {
    Ok(project_dir(project)?.join("patterns"))
}
fn pattern_dir(project: &str, pattern: &str) -> Result<PathBuf, String> {
    Ok(patterns_dir(project)?.join(pattern))
}
fn pattern_file(project: &str, pattern: &str) -> Result<PathBuf, String> {
    Ok(pattern_dir(project, pattern)?.join("pattern.json"))
}
fn sounds_dir(project: &str) -> Result<PathBuf, String> {
    Ok(project_dir(project)?.join("sounds"))
}
fn sound_preset_file(project: &str, sound_id: &str) -> Result<PathBuf, String> {
    Ok(sounds_dir(project)?.join(format!("{}.json", sound_id)))
}

// Debounced atomic writer per-path
static WRITE_WORKERS: OnceCell<std::sync::Mutex<HashMap<PathBuf, Sender<Vec<u8>>>>> =
    OnceCell::new();

fn schedule_write(path: PathBuf, data: Vec<u8>) -> Result<(), String> {
    let map = WRITE_WORKERS.get_or_init(|| std::sync::Mutex::new(HashMap::new()));
    let mut map = map
        .lock()
        .map_err(|_| "write workers poisoned".to_string())?;
    let tx = if let Some(tx) = map.get(&path) {
        tx.clone()
    } else {
        let (tx, rx) = unbounded::<Vec<u8>>();
        spawn_writer(path.clone(), rx);
        map.insert(path.clone(), tx.clone());
        tx
    };
    tx.send(data).map_err(|e| format!("send write: {e}"))
}

#[allow(unused_assignments)]
fn spawn_writer(path: PathBuf, rx: Receiver<Vec<u8>>) {
    thread::spawn(move || {
        let mut pending: Option<Vec<u8>> = None;
        loop {
            match rx.recv() {
                Ok(bytes) => {
                    pending = Some(bytes);
                    // debounce window
                    loop {
                        let timeout = crossbeam_channel::after(Duration::from_millis(150));
                        let mut got_more = false;
                        select! {
                          recv(rx) -> msg => {
                            if let Ok(b) = msg { pending = Some(b); got_more = true; } else { break; }
                          },
                          recv(timeout) -> _ => { /* timed out */ }
                        }
                        if !got_more {
                            break;
                        }
                    }
                    if let Some(bytes) = pending.take() {
                        if let Err(e) = atomic_write(&path, &bytes) {
                            eprintln!("write error for {:?}: {}", path, e);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });
}

fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("create dir: {e}"))?;
    }
    let mut tmp = PathBuf::from(path);
    tmp.set_extension("tmp");
    let mut f = fs::File::create(&tmp).map_err(|e| format!("create tmp: {e}"))?;
    f.write_all(data).map_err(|e| format!("write tmp: {e}"))?;
    f.flush().map_err(|e| format!("flush tmp: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o644));
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename: {e}"))
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    atomic_write(path, &bytes)
}

fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn now_ms() -> i64 {
    let dur = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    dur.as_millis() as i64
}

static ID_COUNTER: AtomicU64 = AtomicU64::new(1);

fn new_id() -> String {
    let ts = now_ms();
    let c = ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("s{}-{}", ts, c)
}

#[tauri::command]
pub fn fs_list_projects() -> Result<Vec<String>, String> {
    let root = documents_root()?;
    let mut names: Vec<String> = fs::read_dir(&root)
        .map_err(|e| format!("read_dir: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
pub fn fs_create_project() -> Result<String, String> {
    let root = documents_root()?;
    // find next project N
    let mut n = 1;
    let name = loop {
        let candidate = format!("project {}", n);
        if !root.join(&candidate).exists() {
            break candidate;
        }
        n += 1;
    };
    let dir = root.join(&name);
    fs::create_dir_all(dir.join("patterns")).map_err(|e| format!("create project: {e}"))?;
    let pj = Project::default();
    let json = serde_json::to_vec_pretty(&pj).map_err(|e| e.to_string())?;
    schedule_write(project_file(&name)?, json)?;
    Ok(name)
}

#[tauri::command]
pub fn fs_delete_project(name: String) -> Result<(), String> {
    let dir = project_dir(&name)?;
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| format!("rm project: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn fs_list_patterns(project: String) -> Result<Vec<String>, String> {
    let pdir = patterns_dir(&project)?;
    fs::create_dir_all(&pdir).map_err(|e| format!("mk patterns: {e}"))?;
    let mut names: Vec<String> = fs::read_dir(&pdir)
        .map_err(|e| format!("read patterns: {e}"))?
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    names.sort();
    Ok(names)
}

#[tauri::command]
pub fn fs_create_pattern(project: String) -> Result<String, String> {
    let pdir = patterns_dir(&project)?;
    fs::create_dir_all(&pdir).map_err(|e| format!("mk patterns: {e}"))?;
    // Choose the next highest number (max+1) so new patterns always append at the end
    let mut max_n: u32 = 0;
    for entry in std::fs::read_dir(&pdir).map_err(|e| format!("read patterns: {e}"))? {
        if let Ok(ent) = entry {
            let path = ent.path();
            if path.is_dir() {
                if let Some(os_name) = path.file_name() {
                    if let Some(name) = os_name.to_str() {
                        if let Some(suffix) = name.strip_prefix("pattern ") {
                            if let Ok(n) = suffix.trim().parse::<u32>() {
                                if n > max_n {
                                    max_n = n;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let name = format!("pattern {}", max_n.saturating_add(1));
    let dir = pdir.join(&name);
    fs::create_dir_all(&dir).map_err(|e| format!("mk pattern: {e}"))?;
    let pat = Pattern::default();
    let json = serde_json::to_vec_pretty(&pat).map_err(|e| e.to_string())?;
    schedule_write(pattern_file(&project, &name)?, json)?;
    Ok(name)
}

#[tauri::command]
pub fn fs_delete_pattern(project: String, pattern: String) -> Result<(), String> {
    let dir = pattern_dir(&project, &pattern)?;
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| format!("rm pattern: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub fn fs_read_project(project: String) -> Result<Project, String> {
    let file = project_file(&project)?;
    if !file.exists() {
        return Ok(Project::default());
    }
    let bytes = fs::read(file).map_err(|e| format!("read project: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("parse project: {e}"))
}

#[tauri::command]
pub fn fs_write_project(project: String, data: Project) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?;
    let file = project_file(&project)?;
    schedule_write(file, json)
}

#[tauri::command]
pub fn fs_read_pattern(project: String, pattern: String) -> Result<Pattern, String> {
    let file = pattern_file(&project, &pattern)?;
    if !file.exists() {
        return Ok(Pattern::default());
    }
    let bytes = fs::read(file).map_err(|e| format!("read pattern: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("parse pattern: {e}"))
}

#[tauri::command]
pub fn fs_write_pattern(project: String, pattern: String, data: Pattern) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(&data).map_err(|e| e.to_string())?;
    let file = pattern_file(&project, &pattern)?;
    schedule_write(file, json)
}

#[tauri::command]
pub fn fs_list_sounds(project: String) -> Result<Vec<Sound>, String> {
    let pj = fs_read_project(project)?;
    Ok(pj.sounds)
}

#[tauri::command]
pub fn delete_sound(project_name: String, sound_id: String) -> Result<(), String> {
    // Update project.json: remove sound by id
    let pfile = project_file(&project_name)?;
    let mut pj: Project = if pfile.exists() {
        read_json(&pfile)?
    } else {
        Project::default()
    };
    let before = pj.sounds.len();
    pj.sounds.retain(|s| s.id != sound_id);
    if pj.sounds.len() != before {
        write_json_atomic(&pfile, &pj)?;
    }
    // For each pattern, remove id from soundRefs if present
    let pdir = patterns_dir(&project_name)?;
    if pdir.exists() {
        for entry in fs::read_dir(&pdir).map_err(|e| format!("read_dir: {e}"))? {
            if let Ok(ent) = entry {
                let path = ent.path();
                if path.is_dir() {
                    let f = path.join("pattern.json");
                    if f.exists() {
                        if let Ok(mut pat) = read_json::<Pattern>(&f) {
                            let len0 = pat.sound_refs.len();
                            pat.sound_refs.retain(|id| id != &sound_id);
                            if pat.sound_refs.len() != len0 {
                                let _ = write_json_atomic(&f, &pat);
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn create_sound(project_name: String, sound_type: String) -> Result<Sound, String> {
    // Load project.json
    let pfile = project_file(&project_name)?;
    let mut pj: Project = if pfile.exists() {
        read_json(&pfile)?
    } else {
        Project::default()
    };

    // Enforce max 16 sounds
    if pj.sounds.len() >= 16 {
        return Err("max sounds reached".to_string());
    }

    // Normalize type to Title Case kind and lowercase prefix for display name
    let t_lower = sound_type.to_ascii_lowercase();
    let (kind, prefix) = match t_lower.as_str() {
        "synth" => ("Synth".to_string(), "electricity".to_string()),
        "acid" | "acid303" => ("Synth".to_string(), "acid 303".to_string()),
        "karplus" => ("Synth".to_string(), "string theory".to_string()),
        "resonator" => ("Synth".to_string(), "mushrooms".to_string()),
        "sampler" => ("Sampler".to_string(), "sampler".to_string()),
        "drum" => ("Drum".to_string(), "drubbles".to_string()),
        other => {
            // accept Title Case too
            let l = other.to_string();
            if l == "synth" || l == "Synth".to_string() {
                ("Synth".to_string(), "electricity".to_string())
            } else if l == "Acid" || l == "Acid303" || l == "acid303" {
                ("Synth".to_string(), "acid 303".to_string())
            } else if l == "karplus" || l == "Karplus" {
                ("Synth".to_string(), "string theory".to_string())
            } else if l == "resonator" || l == "Resonator" {
                ("Synth".to_string(), "mushrooms".to_string())
            } else if l == "sampler" || l == "Sampler".to_string() {
                ("Sampler".to_string(), "sampler".to_string())
            } else if l == "drum"
                || l == "Drum".to_string()
                || l == "drumsampler"
                || l == "DrumSampler".to_string()
            {
                ("Drum".to_string(), "drubbles".to_string())
            } else {
                return Err("invalid sound type".to_string());
            }
        }
    };

    // Determine lowest free N for this prefix (e.g., "synth N")
    let mut taken: Vec<u32> = pj
        .sounds
        .iter()
        .filter_map(|s| {
            if s.name.starts_with(&format!("{} ", prefix)) {
                let rest = s.name[prefix.len() + 1..].trim();
                rest.parse::<u32>().ok()
            } else {
                None
            }
        })
        .collect();
    taken.sort_unstable();
    let mut n: u32 = 1;
    for v in taken {
        if v == n {
            n += 1;
        } else if v > n {
            break;
        }
    }
    let display_name = format!("{} {}", prefix, n);

    // Compute lowest free part index in 0..15
    let mut used: Vec<usize> = pj.sounds.iter().map(|s| s.part_index).collect();
    used.sort_unstable();
    let mut pi: usize = 0;
    for u in used {
        if u == pi {
            pi += 1;
        }
    }
    if pi >= 16 {
        return Err("no free part index".to_string());
    }

    let sound = Sound {
        id: new_id(),
        kind,
        name: display_name,
        part_index: pi,
    };
    pj.sounds.push(sound.clone());
    write_json_atomic(&pfile, &pj)?;
    Ok(sound)
}

// --- Sound preset I/O ---
#[tauri::command]
pub fn load_sound_preset(project: String, sound_id: String) -> Result<String, String> {
    let file = sound_preset_file(&project, &sound_id)?;
    if !file.exists() {
        return Err("not_found".to_string());
    }
    let s = std::fs::read_to_string(&file).map_err(|e| format!("read preset: {e}"))?;
    Ok(s)
}

#[tauri::command]
pub fn save_sound_preset(project: String, sound_id: String, json: String) -> Result<(), String> {
    let file = sound_preset_file(&project, &sound_id)?;
    schedule_write(file, json.into_bytes())
}

// --- Arrangement persistence ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArrangementItem {
    pub id: String,
    pub len: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Arrangement {
    pub items: Vec<ArrangementItem>,
}

#[tauri::command]
pub fn read_arrangement(project: String) -> Result<Arrangement, String> {
    let file = arrangement_file(&project)?;
    if !file.exists() {
        return Ok(Arrangement::default());
    }
    let data: Arrangement = read_json(&file)?;
    Ok(data)
}

#[tauri::command]
pub fn write_arrangement(project: String, json: Arrangement) -> Result<(), String> {
    let file = arrangement_file(&project)?;
    write_json_atomic(&file, &json)
}
