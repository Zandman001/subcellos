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
  startRecording: () => safeInvoke<void>("start_recording", undefined),
  stopRecording: () => safeInvoke<void>("stop_recording", undefined),
  listSubsamples: () => safeInvoke<string[]>("list_subsamples", undefined, []),
  loadSample: (part: number, path: string) => safeInvoke<void>("load_sample", { part, path }),
  clearSample: (part: number) => safeInvoke<void>("clear_sample", { part }),
  previewSample: (path: string) => safeInvoke<void>("preview_sample", { path }),
  stopPreview: () => safeInvoke<void>("stop_preview"),
  getSampleWaveform: (path: string) => safeInvoke<number[]>("get_sample_waveform", { path }, []),
  getSampleInfo: (path: string) => safeInvoke<{ length_samples: number; sample_rate: number; channels: number }>("get_sample_info", { path }, { length_samples: 0, sample_rate: 44100, channels: 1 }),
  getSamplerPlayhead: (part: number) => safeInvoke<any>("get_sampler_playhead", { part }, null),
  deleteSubsample: (path: string) => safeInvoke<void>("delete_subsample", { path }),
  setTempo: (bpm: number) => safeInvoke<void>("set_tempo", { bpm }),
  listDrumPacks: () => safeInvoke<string[]>("list_drum_packs", undefined, []),
  listDrumSamples: (pack: string) => safeInvoke<string[]>("list_drum_samples", { pack }, []),
  loadDrumPack: (part: number, pack: string) => safeInvoke<void>("load_drum_pack", { part, pack }),
};
