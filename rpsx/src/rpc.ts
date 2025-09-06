import { invoke } from "@tauri-apps/api/core";

function isTauri(): boolean {
  const g: any = globalThis as any;
  return !!(g.__TAURI__ || g.__TAURI_INTERNALS__);
}

async function safeInvoke<T>(cmd: string, payload?: any, fallback?: T): Promise<T> {
  if (!isTauri()) {
    // eslint-disable-next-line no-console
    console.warn(`[rpc] Not in Tauri; ${cmd} noop/fallback`);
    return fallback as T;
  }
  try {
    return await invoke<T>(cmd, payload);
  } catch (e) {
    console.error(`[rpc] invoke ${cmd} failed`, e);
    if (fallback !== undefined) return fallback as T;
    throw e;
  }
}

export const rpc = {
  startAudio: () => safeInvoke<void>("start_audio", undefined),
  noteOn: (part: number, note: number, vel: number) => safeInvoke<void>("note_on", { part, note, vel }),
  noteOff: (part: number, note: number) => safeInvoke<void>("note_off", { part, note }),
  setParam: (path: string, value: any) => safeInvoke<void>("set_param", { path, value }),
  getAudioLevels: (part: number) => safeInvoke<{ left: number; right: number }>("get_audio_levels", { part }, { left: 0, right: 0 }),
};
