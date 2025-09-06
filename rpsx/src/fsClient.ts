import { invoke } from "@tauri-apps/api/core";

export type Sound = { id: string; type: "Synth" | "Sampler" | "Drum"; name: string; part_index: number };
export type Project = { sounds: Sound[] };
export type Pattern = { soundRefs: string[] };

function isTauri(): boolean {
  const g: any = globalThis as any;
  return !!(g.__TAURI__ || g.__TAURI_INTERNALS__);
}

async function safeInvoke<T>(cmd: string, payload?: any, fallback?: T): Promise<T> {
  if (!isTauri()) {
    // Running in plain browser or Vite preview – return fallback to avoid crashing.
    // eslint-disable-next-line no-console
    console.warn(`[fsClient] Not in Tauri; ${cmd} returning fallback`);
    return fallback as T;
  }
  try {
    return await invoke<T>(cmd, payload);
  } catch (e) {
    console.error(`[fsClient] invoke ${cmd} failed`, e);
    if (fallback !== undefined) return fallback as T;
    throw e;
  }
}

export const fsClient = {
  listProjects: () => safeInvoke<string[]>("fs_list_projects", undefined, []),
  createProject: () => safeInvoke<string>("fs_create_project", undefined, "project 1"),
  deleteProject: (name: string) => safeInvoke<void>("fs_delete_project", { name }),

  listPatterns: (project: string) => safeInvoke<string[]>("fs_list_patterns", { project }, []),
  createPattern: (project: string) => safeInvoke<string>("fs_create_pattern", { project }, "pattern 1"),
  deletePattern: (project: string, pattern: string) => safeInvoke<void>("fs_delete_pattern", { project, pattern }),

  readProject: (project: string) => safeInvoke<Project>("fs_read_project", { project }, { sounds: [] }),
  writeProject: (project: string, data: Project) => safeInvoke<void>("fs_write_project", { project, data }),

  readPattern: (project: string, pattern: string) => safeInvoke<Pattern>("fs_read_pattern", { project, pattern }, { soundRefs: [] }),
  writePattern: (project: string, pattern: string, data: Pattern) => safeInvoke<void>("fs_write_pattern", { project, pattern, data }),

  listSounds: (project: string) => safeInvoke<Sound[]>("fs_list_sounds", { project }, []),
  createSound: (projectName: string, soundType: string) => safeInvoke<Sound>(
    "create_sound",
    { projectName, soundType },
  ),
  deleteSound: (projectName: string, soundId: string) => safeInvoke<void>(
    "delete_sound",
    { projectName, soundId },
  ),
  // Sound presets
  loadSoundPreset: async (project: string, soundId: string): Promise<any|undefined> => {
    try {
      const s = await safeInvoke<string>("load_sound_preset", { project, soundId }, "");
      if (!s) return undefined;
      return JSON.parse(s);
    } catch (e: any) {
      const msg = String(e);
      if (msg.includes("not_found")) return undefined;
      console.error("loadSoundPreset failed", e);
      return undefined;
    }
  },
  saveSoundPreset: async (project: string, soundId: string, data: any): Promise<void> => {
    const json = JSON.stringify(data);
    await safeInvoke<void>("save_sound_preset", { project, soundId, json });
  },
};
