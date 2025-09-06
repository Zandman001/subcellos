import { useEffect, useSyncExternalStore } from "react";
import { fsClient, Pattern, Project, Sound } from "../fsClient";
import { rpc } from "../rpc";

export type Level = "projects" | "project" | "patterns" | "pattern" | "synth";

export interface BrowserState {
  focus: "browser" | "right";
  level: Level;
  projectName?: string;
  patternName?: string;
  items: string[];
  selected: number;
  soundIdsAtLevel?: string[];
  soundTypesAtLevel?: ("synth"|"sampler"|"drum")[];
  soundPartsAtLevel?: number[];
  selectedSoundId?: string;
  selectedSoundName?: string;
  currentSoundType?: "synth" | "sampler" | "drum";
  selectedSoundPart?: number;
  // Synth editor state
  synthPages: readonly string[];
  synthPageIndex: number; // 0..7
  // per-page sub-selection (W/R)
  oscSelect: 0 | 1; // 0=A, 1=B
  envSelect: 0 | 1; // 0=AMP, 1=MOD
  filterSelect: 0 | 1; // 0=1, 1=2
  fxSelect: 0 | 1 | 2 | 3; // 0..3 for fx1..fx4
  eqGroup: 0 | 1; // 0=bands 1..4, 1=bands 5..8
  modulePickerOpen: boolean;
  modulePickerIndex: number; // 0: Synth, 1: Acid, 2: KarplusStrong, 3: Sampler, 4: Drum
  confirmOpen?: boolean;
  confirmKind?: 'project'|'pattern'|'module';
  confirmLabel?: string;
  confirmProjectName?: string;
  confirmSoundId?: string;
  openConfirm?: (kind:'project'|'pattern'|'module', label:string, extra?: { project?: string; soundId?: string }) => void;
  confirmYes?: () => Promise<void>;
  confirmNo?: () => void;
  // actions
  loadLevel: () => Promise<void>;
  goLeft: () => Promise<void>;
  goRight: () => Promise<void>;
  moveUp: () => void;
  moveDown: () => void;
  moveLeft: () => void;
  moveRight: () => void;
  add: () => Promise<void>;
  remove: () => Promise<void>;
  toggleFocus: () => void; // Tab
  // preview notes (synth level)
  currentPreview?: number;
  startPreview: (midi: number) => Promise<void>;
  stopPreview: (midi: number) => Promise<void>;
  setCurrentPreview: (midi?: number) => void;
  _previewLock?: boolean;
  _pressedQA?: { q: boolean; a: boolean };
  setPressedQA: (q: boolean | null, a: boolean | null) => void;
  updatePreviewFromPressed: () => Promise<void>;
  forceStopPreview: () => Promise<void>;
  // synth UI state (per current selected sound, transient)
  synthUIById?: Record<string, SynthUI>;
  synthUIVersion?: number; // bump to trigger rerenders when nested changes
  getSynthUI: () => SynthUI;
  setSynthParam: (path: string, v: number, kind?: 'F32'|'I32'|'Bool'|'Str') => void;
  updateSynthUI: (fn: (ui: SynthUI) => SynthUI) => void;
  // mod-key (R) state
  isRDown: boolean;
  setIsRDown: (b: boolean) => void;
  // Mod matrix helpers
  setLfoRow: (i: number) => void;
  setEnvRow: (i: number) => void;
  setLfoDest: (row: number, dest: number) => void;
  setEnvDest: (row: number, dest: number) => void;
  updateLfoAmount: (row: number, amt: number) => void;
  updateEnvAmount: (row: number, amt: number) => void;
  // preset persistence
  pendingSaves?: Record<string, any>;
  scheduleSavePreset?: (preset: any) => void;
  // per-sound module kind hint (UI-only). 'acid' constrains pages to 4.
  moduleKindById?: Record<string, 'acid' | 'analog' | 'karplus'>;
}

// Simple no-deps store with subscribe/get/set
type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());

type InternalState = BrowserState & {
  // internal cache for convenience
  _projectData?: Project;
  _patternData?: Pattern;
  _presetApplied?: Record<string, boolean>;
};

const state: InternalState = {
  focus: "browser",
  level: "projects",
  items: [],
  selected: 0,
  soundIdsAtLevel: undefined,
  soundTypesAtLevel: undefined,
  soundPartsAtLevel: undefined,
  selectedSoundId: undefined,
  selectedSoundName: undefined,
  currentSoundType: undefined,
  selectedSoundPart: undefined,
  synthPages: ["OSC","ENV","FILTER","LFO","MOD","FX","MIXER","EQ"],
  synthPageIndex: 0, 
  oscSelect: 0,
  envSelect: 0,
  filterSelect: 0,
  fxSelect: 0,
  eqGroup: 0,
  modulePickerOpen: false,
  modulePickerIndex: 0,
  confirmOpen: false,
  // placeholders, replaced below
  loadLevel: async () => {},
  goLeft: async () => {},
  goRight: async () => {},
  moveUp: () => {},
  moveDown: () => {},
  moveLeft: () => {},
  moveRight: () => {},
  add: async () => {},
  remove: async () => {},
  toggleFocus: () => {},
  currentPreview: undefined,
  startPreview: async () => {},
  stopPreview: async () => {},
  setCurrentPreview: () => {},
  _previewLock: false,
  _pressedQA: { q: false, a: false },
  setPressedQA: () => {},
  updatePreviewFromPressed: async () => {},
  forceStopPreview: async () => {},
  synthUIById: {},
  synthUIVersion: 0,
  getSynthUI: () => defaultSynthUI(),
  setSynthParam: () => {},
  updateSynthUI: () => {},
  isRDown: false,
  setIsRDown: () => {},
  setLfoRow: () => {},
  setEnvRow: () => {},
  setLfoDest: () => {},
  setEnvDest: () => {},
  updateLfoAmount: () => {},
  updateEnvAmount: () => {},
  pendingSaves: {},
  scheduleSavePreset: () => {},
  _presetApplied: {},
  moduleKindById: {},
};

function set(partial: Partial<InternalState>) {
  Object.assign(state, partial);
  bumpVersion();
}

function clampSelection() {
  if (state.selected >= state.items.length) state.selected = Math.max(0, state.items.length - 1);
  if (state.selected < 0) state.selected = 0;
}

// Confirm helpers (initialized after state to access set())
state.openConfirm = (kind, label, extra) => {
  set({ confirmOpen: true, confirmKind: kind, confirmLabel: label, confirmProjectName: extra?.project, confirmSoundId: extra?.soundId });
};
state.confirmNo = () => { set({ confirmOpen: false, confirmKind: undefined, confirmLabel: undefined, confirmProjectName: undefined, confirmSoundId: undefined }); };
state.confirmYes = async () => {
  if (!state.confirmOpen) return;
  try {
    if (state.confirmKind === 'project' && state.confirmLabel) {
      await fsClient.deleteProject(state.confirmLabel);
      await state.loadLevel();
      set({ selected: Math.min(state.selected, Math.max(0, state.items.length - 1)) });
    } else if (state.confirmKind === 'pattern' && state.confirmProjectName && state.confirmLabel) {
      await fsClient.deletePattern(state.confirmProjectName, state.confirmLabel);
      await state.loadLevel();
      set({ selected: Math.min(state.selected, Math.max(0, state.items.length - 1)) });
    } else if (state.confirmKind === 'module' && state.confirmProjectName && state.confirmSoundId) {
      await fsClient.deleteSound(state.confirmProjectName, state.confirmSoundId);
      await state.loadLevel();
      set({ selected: Math.max(0, Math.min(state.selected, Math.max(0, state.items.length - 1))) });
    }
  } catch (e) {
    console.error('delete failed', e);
  } finally {
    state.confirmNo?.();
  }
};

async function loadProject(project: string) {
  const pj = await fsClient.readProject(project);
  state._projectData = pj;
}

async function loadPattern(project: string, pattern: string) {
  const pat = await fsClient.readPattern(project, pattern);
  state._patternData = pat;
}

async function refreshPatternItems() {
  const project = state.projectName!;
  const sounds = await fsClient.listSounds(project);
  state.items = sounds.map((s) => `${s.name}`);
  state.soundIdsAtLevel = sounds.map((s) => s.id);
  state.soundTypesAtLevel = sounds.map((s) => normalizeSoundType(s.type)!) as any;
  state.soundPartsAtLevel = sounds.map((s) => (s as any).part_index ?? 0);
  clampSelection();
  const selectedSound = sounds[state.selected];
  state.selectedSoundId = selectedSound?.id;
  state.selectedSoundName = selectedSound?.name;
  state.currentSoundType = selectedSound ? normalizeSoundType(selectedSound.type) : undefined;
  state.selectedSoundPart = (selectedSound as any)?.part_index ?? 0;
}

// Actions implementation
state.loadLevel = async () => {
  switch (state.level) {
    case "projects": {
      const items = await fsClient.listProjects();
      set({ items, selected: Math.min(state.selected, Math.max(0, items.length - 1)) });
      break;
    }
    case "project": {
      set({ items: ["patterns", "recordings"], selected: 0 });
      break;
    }
    case "patterns": {
      if (!state.projectName) return;
      const items = await fsClient.listPatterns(state.projectName);
      set({ items, selected: Math.min(state.selected, Math.max(0, items.length - 1)) });
      break;
    }
    case "pattern": {
      if (!state.projectName) return;
      await refreshPatternItems();
      set({ items: state.items.slice() });
      break;
    }
    case "synth": {
      // Compute pages based on module kind (acid -> 4 pages)
      const pages = computeSynthPagesForCurrent();
      const maxIdx = pages.length - 1;
      const idx = Math.max(0, Math.min(maxIdx, state.synthPageIndex));
      set({ synthPages: pages, items: pages.slice(), selected: idx, synthPageIndex: idx });
      // Ensure engine module_kind matches pages (prevents Analog sounding like Acid and vice versa)
      try {
        const part = state.selectedSoundPart ?? 0;
        const kind = getCurrentModuleKind();
        await rpc.startAudio();
        await rpc.setParam(`part/${part}/module_kind`, { I32: kind } as any);
      } catch {}
      break;
    }
  }
};

state.goLeft = async () => {
  switch (state.level) {
    case "synth":
      await state.forceStopPreview();
      set({ level: "pattern" });
      await state.loadLevel();
      break;
    case "projects":
      break;
    case "project":
      set({ level: "projects", projectName: undefined, selected: 0 });
      await state.loadLevel();
      break;
    case "patterns":
      set({ level: "project", patternName: undefined, selected: 0 });
      await state.loadLevel();
      break;
    case "pattern":
      if (state.modulePickerOpen) { set({ modulePickerOpen: false }); break; }
      set({ level: "patterns", selected: 0, selectedSoundId: undefined, selectedSoundName: undefined, soundIdsAtLevel: undefined, currentSoundType: undefined });
      await state.loadLevel();
      break;
  }
};

state.goRight = async () => {
  switch (state.level) {
    case "projects": {
      const name = state.items[state.selected];
      if (!name) return;
      set({ level: "project", projectName: name, selected: 0, _projectData: undefined, _patternData: undefined });
      await state.loadLevel();
      // On project open, preload presets and replay to engine so state matches saved
      try { await preloadAndReplayProjectPresets(name); } catch (e) { console.error('preload project presets failed', e); }
      break;
    }
    case "project": {
      const item = state.items[state.selected];
      if (item === "patterns") {
        set({ level: "patterns", selected: 0 });
        await state.loadLevel();
      }
      break;
    }
    case "patterns": {
      const name = state.items[state.selected];
      if (!name) return;
      set({ level: "pattern", patternName: name, selected: 0, _patternData: undefined });
      await state.loadLevel();
      break;
    }
    case "pattern": {
      if (state.selectedSoundId && state.currentSoundType === "synth") {
        set({ level: "synth", synthPageIndex: 0, selected: 0 });
        await state.loadLevel();
        // Only (re)apply preset the first time we open this synth to avoid floods/underruns
        const id = state.selectedSoundId!;
        if (!state._presetApplied || !state._presetApplied[id]) {
          try { await loadAndApplyCurrentPreset(); } catch (e) { console.error('autoload preset failed', e); }
        }
        break;
      }
      // no deeper level
      break;
    }
  }
};

state.moveUp = () => {
  if (state.level === "synth") {
    const maxIdx = (state.synthPages.length - 1);
    const next = Math.max(0, Math.min(maxIdx, state.synthPageIndex - 1));
    set({ synthPageIndex: next, selected: next });
    return;
  }
  if (state.level === "pattern" && state.modulePickerOpen) {
    const next = Math.max(0, Math.min(4, state.modulePickerIndex - 1));
    set({ modulePickerIndex: next });
    return;
  }
  if (state.items.length === 0) return;
  const nextSel = state.selected > 0 ? state.selected - 1 : 0;
  if (state.level === "pattern") {
    const ids = state.soundIdsAtLevel ?? [];
    const types = state.soundTypesAtLevel ?? [];
    const parts = state.soundPartsAtLevel ?? [];
    const names = state.items;
    if (state.selected !== nextSel) { (async ()=>{ try { await state.forceStopPreview(); } catch(_){} })(); }
    set({ selected: nextSel, selectedSoundId: ids[nextSel], selectedSoundName: names[nextSel], currentSoundType: types[nextSel], selectedSoundPart: parts[nextSel] });
  } else {
    set({ selected: nextSel });
  }
};

state.moveDown = () => {
  if (state.level === "synth") {
    const maxIdx = (state.synthPages.length - 1);
    const next = Math.max(0, Math.min(maxIdx, state.synthPageIndex + 1));
    set({ synthPageIndex: next, selected: next });
    return;
  }
  if (state.level === "pattern" && state.modulePickerOpen) {
    const next = Math.max(0, Math.min(4, state.modulePickerIndex + 1));
    set({ modulePickerIndex: next });
    return;
  }
  if (state.items.length === 0) return;
  const nextSel = state.selected < state.items.length - 1 ? state.selected + 1 : state.selected;
  if (state.level === "pattern") {
    const ids = state.soundIdsAtLevel ?? [];
    const types = state.soundTypesAtLevel ?? [];
    const parts = state.soundPartsAtLevel ?? [];
    const names = state.items;
    if (state.selected !== nextSel) { (async ()=>{ try { await state.forceStopPreview(); } catch(_){} })(); }
    set({ selected: nextSel, selectedSoundId: ids[nextSel], selectedSoundName: names[nextSel], currentSoundType: types[nextSel], selectedSoundPart: parts[nextSel] });
  } else {
    set({ selected: nextSel });
  }
};

state.add = async () => {
  if (state.level === "synth") {
    return;
  }
  if (state.level === "projects") {
    const name = await fsClient.createProject();
    await state.loadLevel();
    const idx = state.items.findIndex((i) => i === name);
    set({ selected: idx >= 0 ? idx : state.selected });
    return;
  }
  if (state.level === "patterns" && state.projectName) {
    const name = await fsClient.createPattern(state.projectName);
    await state.loadLevel();
    const idx = state.items.findIndex((i) => i === name);
    set({ selected: idx >= 0 ? idx : state.selected });
    return;
  }
  if (state.level === "pattern") {
    if (!state.modulePickerOpen) {
      set({ modulePickerOpen: true, modulePickerIndex: 0 });
      return;
    }
    // Confirm create
    const types = ["synth", "acid", "karplus", "sampler", "drum"] as const;
    const t = types[Math.max(0, Math.min(4, state.modulePickerIndex))];
    const pn = state.projectName!;
    try {
      const created = await fsClient.createSound(pn, t);
      // Record UI-only module kind hint
      if (t === 'acid') {
        const map = state.moduleKindById || {};
        map[created.id] = 'acid';
        set({ moduleKindById: { ...map } });
      } else if (t === 'karplus') {
        const map = state.moduleKindById || {};
        map[created.id] = 'karplus';
        set({ moduleKindById: { ...map } });
      }
      set({ modulePickerOpen: false });
      await state.loadLevel();
      // Select the newly added sound by id
      const ids = state.soundIdsAtLevel ?? [];
      const idx = ids.findIndex((id) => id === created.id);
      if (idx >= 0) {
        set({ selected: idx, selectedSoundId: created.id, selectedSoundPart: (created as any).part_index ?? 0 });
        // Default preset for synth: Osc B level = 0; if Acid, also set module_kind
        if (t === "synth" || t === "acid" || t === "karplus") {
          const part = (created as any).part_index ?? 0;
          // Build and save default preset immediately, then replay
          const ui = defaultSynthUI();
          ui.oscB.level = 0.0; // default tweak
          const preset = uiToSchema(ui);
          try { await fsClient.saveSoundPreset(pn, created.id, preset); } catch (e) { console.error('save default preset failed', e); }
          try { await rpc.startAudio(); } catch(_){}
          try { await applyPreset(preset); } catch(e){ console.error('apply default preset failed', e); }
          if (t === 'acid') {
            try { await rpc.setParam(`part/${part}/module_kind`, { I32: 1 } as any); } catch(e) { console.error('set module_kind failed', e); }
          } else if (t === 'karplus') {
            try { await rpc.setParam(`part/${part}/module_kind`, { I32: 2 } as any); } catch(e) { console.error('set module_kind failed', e); }
          }
        }
      }
    } catch (e) {
      console.error('createSound failed', e);
      // keep picker open; optionally show small toast elsewhere
    }
    return;
  }
};

state.remove = async () => {
  if (state.level === "synth") {
    return;
  }
  if (state.items.length === 0) return;
  switch (state.level) {
    case "projects": {
      const name = state.items[state.selected];
      if (!name) return;
      state.openConfirm?.('project', name, {});
      break;
    }
    case "patterns": {
      if (!state.projectName) return;
      const name = state.items[state.selected];
      if (!name) return;
      state.openConfirm?.('pattern', name, { project: state.projectName });
      break;
    }
    case "pattern": {
      if (!state.projectName) return;
      const id = state.soundIdsAtLevel?.[state.selected];
      if (!id) return;
      const label = state.items[state.selected] || 'module';
      state.openConfirm?.('module', label, { project: state.projectName, soundId: id });
      break;
    }
  }
};

state.toggleFocus = () => {
  set({ focus: state.focus === "browser" ? "right" : "browser" });
};

// Hook to use the store
export function useBrowser<T = InternalState>(selector?: (s: InternalState) => T): T {
  useEffect(() => { state.loadLevel(); }, []);
  const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };
  // Provide a cached snapshot that only changes identity when state changes.
  return useSyncExternalStore(subscribe, getSnapshot) as unknown as T;
}

// Provide latest state accessor for key handlers
export const useBrowserStore = {
  getState: (): InternalState => state,
};

// --- EQ helpers and hooks ---
export function useSynthEqState(_partIndex?: number): { eqGains: number[]; eqPage: 0|1 } {
  const s = useBrowser() as unknown as InternalState;
  const ui = (s as any).getSynthUI();
  // Map normalized [0..1] -> dB in [-8..+8]
  const gainsDb = (ui.eq.gains || Array.from({length:8}).map(()=>0.5)).map((v: number) => -8 + v * 16);
  const eqPage = (s as any).eqGroup as 0|1;
  return { eqGains: gainsDb, eqPage };
}

export function setEqPage(page: 0 | 1) {
  set({ eqGroup: page });
}

export function updateEqGain(index: number, db: number) {
  const idx = Math.max(0, Math.min(7, Math.round(index)));
  const clampedDb = Math.max(-8, Math.min(8, db));
  const norm = (clampedDb + 8) / 16;
  // Short-circuit if value is effectively unchanged to avoid echo loops
  const cur = (state.getSynthUI().eq?.gains || [])[idx];
  if (typeof cur === 'number' && Math.abs(cur - norm) < 1e-6) return;
  state.updateSynthUI((ui: any) => {
    const next = (ui.eq?.gains || Array.from({ length: 8 }).map(() => 0.5)).slice();
    next[idx] = norm;
    return { ...ui, eq: { gains: next } };
  });
  const part = state.selectedSoundPart ?? 0;
  state.setSynthParam(`part/${part}/eq/gain_db/b${idx + 1}`, clampedDb, 'F32');
  try { state.scheduleSavePreset?.(serializeCurrentPreset()); } catch {}
}

state.moveLeft = () => {
  if (state.level !== "synth") return;
  const page = state.synthPages[state.synthPageIndex];
  switch (page) {
    case "OSC": set({ oscSelect: 0 }); break;
    case "ENV": set({ envSelect: 0 }); break;
    case "FILTER": set({ filterSelect: 0 }); break;
    case "FX": set({ fxSelect: Math.max(0, Math.min(3, (state.fxSelect ?? 0) - 1)) as 0|1|2|3 }); break;
    case "EQ": set({ eqGroup: 0 }); break;
    default: break;
  }
};

state.moveRight = () => {
  if (state.level !== "synth") return;
  const page = state.synthPages[state.synthPageIndex];
  switch (page) {
    case "OSC": set({ oscSelect: 1 }); break;
    case "ENV": set({ envSelect: 1 }); break;
    case "FILTER": set({ filterSelect: 1 }); break;
    case "FX": set({ fxSelect: Math.max(0, Math.min(3, (state.fxSelect ?? 0) + 1)) as 0|1|2|3 }); break;
    case "EQ": set({ eqGroup: 1 }); break;
    default: break;
  }
};
// Snapshot caching for useSyncExternalStore
let version = 0;
let cachedSnapshot: InternalState | null = null;
function bumpVersion() { version++; cachedSnapshot = null; notify(); }
function getSnapshot(): InternalState {
  if (!cachedSnapshot) {
    // Shallow copy so identity changes when any field changes
    cachedSnapshot = { ...(state as any) } as InternalState;
  }
  return cachedSnapshot;
}

function normalizeSoundType(t: Sound["type"] | undefined): "synth" | "sampler" | "drum" | undefined {
  if (!t) return undefined;
  const l = (typeof t === 'string' ? t : '').toLowerCase();
  if (l === 'synth') return 'synth';
  if (l === 'sampler') return 'sampler';
  if (l === 'drum') return 'drum';
  return undefined;
}

function getCurrentModuleKind(): number {
  const id = state.selectedSoundId;
  if (!id) return 0;
  const map = state.moduleKindById || {};
  if (map[id] === 'acid') return 1;
  if (map[id] === 'karplus') return 2;
  const label = state.selectedSoundName || '';
  const l = label.toLowerCase();
  if (l.startsWith('acid 303')) return 1;
  if (l.startsWith('karplus string')) return 2;
  return 0;
}

function isAcidCurrent(): boolean {
  return getCurrentModuleKind() === 1;
}

function computeSynthPagesForCurrent(): readonly string[] {
  const moduleKind = getCurrentModuleKind();
  if (moduleKind === 1) { // Acid
    return ["ACID303", "FX", "MIXER", "EQ"] as const;
  } else if (moduleKind === 2) { // KarplusStrong
    return ["KARPLUS", "FX", "MIXER", "EQ"] as const;
  }
  // Analog synth (default)
  return ["OSC","ENV","FILTER","LFO","MOD","FX","MIXER","EQ"] as const;
}
// Preview note actions
state.setCurrentPreview = (midi?: number) => {
  set({ currentPreview: midi });
};

state.startPreview = async (midi: number) => {
  try {
    await rpc.startAudio();
  } catch (e) {
    console.error('startAudio failed', e);
  }
  const cur = state.currentPreview;
  if (cur === midi) return; // already playing
  try {
    if (cur !== undefined) {
      await rpc.noteOff(0, cur);
    }
    await rpc.noteOn(0, midi, 0.9);
    set({ currentPreview: midi });
  } catch (e) {
    console.error('preview switch failed', e);
  }
};

state.stopPreview = async (midi: number) => {
  const cur = state.currentPreview;
  if (cur === undefined) return;
  if (cur !== midi) return; // only stop if matches current
  try {
    await rpc.noteOff(0, cur);
  } catch (e) {
    console.error('noteOff failed', e);
  }
  set({ currentPreview: undefined });
};

state.setPressedQA = (q: boolean | null, a: boolean | null) => {
  const prev = state._pressedQA || { q: false, a: false };
  const next = { q: q === null ? prev.q : q, a: a === null ? prev.a : a };
  set({ _pressedQA: next });
};

state.updatePreviewFromPressed = async () => {
  if (state._previewLock) { setTimeout(() => { state.updatePreviewFromPressed(); }, 0); return; }
  set({ _previewLock: true });
  try {
    const pressed = state._pressedQA || { q: false, a: false };
    const desired = pressed.q && pressed.a ? 72 : pressed.q ? 60 : pressed.a ? 48 : undefined;
    const cur = state.currentPreview;
    if (desired === cur) return;
    try { await rpc.startAudio(); } catch (e) { console.error('startAudio failed', e); }
    if (cur !== undefined) {
      const part = state.selectedSoundPart ?? 0;
      try { await rpc.noteOff(part, cur); } catch (e) { console.error('noteOff failed', e); }
    }
    if (desired !== undefined) {
      const part = state.selectedSoundPart ?? 0;
      try { await rpc.noteOn(part, desired, 0.9); } catch (e) { console.error('noteOn failed', e); }
    }
    set({ currentPreview: desired });
  } finally {
    set({ _previewLock: false });
  }
};

state.forceStopPreview = async () => {
  const cur = state.currentPreview;
  if (cur !== undefined) {
    const part = state.selectedSoundPart ?? 0;
    try { await rpc.noteOff(part, cur); } catch (e) { console.error('noteOff failed', e); }
  }
  set({ currentPreview: undefined, _pressedQA: { q: false, a: false } });
};

// --- Synth UI helpers ---
type OscUI = { shape: number; detune: number; fm: number; level: number };
type EnvUI = { a: number; d: number; s: number; r: number };
type FilterUI = { type: number; cutoff: number; res: number; assign: number };
type LfoUI = { shape: number; rate: number; amount: number; drive: number };
type FxUI = { type: number; p1: number; p2: number; p3: number };
type MixerUI = { volume: number; pan: number; haas: number; comp: number };
type ModRow = { dest: number; amount: number };
type ModUI = { lfo: ModRow[]; env: ModRow[]; lfoRow: number; envRow: number };
type EqUI = { gains: number[] };
export type SynthUI = {
  oscA: OscUI;
  oscB: OscUI;
  ampEnv: EnvUI;
  modEnv: EnvUI;
  filter1: FilterUI;
  filter2: FilterUI;
  lfo: LfoUI;
  fx1: FxUI;
  fx2: FxUI;
  fx3: FxUI;
  fx4: FxUI;
  mixer: MixerUI;
  mod: ModUI;
  eq: EqUI;
  acid?: {
    wave: number;
    cutoff: number;
    reso: number;
    envmod: number;
    decay: number;
    accent: number;
    slide: number;
    drive: number;
  };
  karplus: {
    decay: number;
    damp: number;
    excite: number;
    tune: number;
  };
};

function defaultSynthUI(): SynthUI {
  return {
    oscA: { shape: 0, detune: 0.5, fm: 0, level: 0.7 },
    oscB: { shape: 1, detune: 0.5, fm: 0, level: 0.7 },
    ampEnv: { a: 0.02, d: 0.2, s: 0.7, r: 0.25 },
    modEnv: { a: 0.01, d: 0.15, s: 0.6, r: 0.2 },
    filter1: { type: 0, cutoff: 0.7, res: 0.2, assign: 0 },
    filter2: { type: 0, cutoff: 0.7, res: 0.2, assign: 0 },
    lfo: { shape: 0, rate: 0.2, amount: 1, drive: 0 },
    fx1: { type: 0, p1: 0.5, p2: 0.4, p3: 0.3 },
    fx2: { type: 0, p1: 0.5, p2: 0.4, p3: 0.3 },
    fx3: { type: 0, p1: 0.5, p2: 0.4, p3: 0.3 },
    fx4: { type: 0, p1: 0.5, p2: 0.4, p3: 0.3 },
    mixer: { volume: 0.8, pan: 0.5, haas: 0.0, comp: 0.0 },
    mod: {
      lfo: Array.from({ length: 5 }).map(() => ({ dest: 0, amount: 1 })),
      env: Array.from({ length: 5 }).map(() => ({ dest: 0, amount: 1 })),
      lfoRow: 0,
      envRow: 0,
    },
    eq: { gains: Array.from({ length: 8 }).map(() => 0.5) },
    // Add default acid parameters to ensure they persist
    acid: {
      wave: 0.0,
      cutoff: 0.55,
      reso: 0.5,
      envmod: 0.6,
      decay: 0.7,
      accent: 0.7,
      slide: 0.4,
      drive: 0.3,
    },
    // Add default KarplusStrong parameters
    karplus: {
      decay: 0.8,
      damp: 0.5,
      excite: 0.1,
      tune: 0.0,
    },
  };
}

const debounceTimers: Record<string, number> = {};
function debounceInvokeSet(path: string, value: any) {
  if (debounceTimers[path]) window.clearTimeout(debounceTimers[path]);
  debounceTimers[path] = window.setTimeout(async () => {
    try {
      // Ensure audio engine is running before sending params
      try { await rpc.startAudio(); } catch (e) { /* idempotent; ignore */ }
      await rpc.setParam(path, value);
    } catch (e) {
      console.error('set_param failed', path, value, e);
    }
  }, 12);
}

state.getSynthUI = () => {
  const id = state.selectedSoundId || '_default_';
  const map = state.synthUIById || {};
  if (!map[id]) map[id] = defaultSynthUI();
  return map[id];
};

state.setSynthParam = (path: string, v: number, kind: 'F32'|'I32'|'Bool'|'Str' = 'F32') => {
  const id = state.selectedSoundId || '_default_';
  const map = state.synthUIById || {};
  if (!map[id]) map[id] = defaultSynthUI();
  // Shallow clone to trigger update
  const ui = { ...map[id] } as SynthUI;
  map[id] = ui;
  set({ synthUIById: { ...map }, synthUIVersion: (state.synthUIVersion || 0) + 1 });
  // sanitize numeric to avoid NaN -> null in JSON to Rust
  const num = (typeof v === 'number' && isFinite(v)) ? v : 0;
  const pi = state.selectedSoundPart ?? 0;
  const rewritten = path.replace(/^part\/[0-9]+\//, `part/${pi}/`);
  debounceInvokeSet(rewritten, { [kind]: num } as any);
  // Schedule preset save after updating UI
  try {
    const preset = serializeCurrentPreset();
    state.scheduleSavePreset?.(preset);
  } catch (e) { /* ignore serialization errors */ }
};

state.updateSynthUI = (fn: (ui: SynthUI) => SynthUI) => {
  const id = state.selectedSoundId || '_default_';
  const map = state.synthUIById || {};
  const ui = map[id] || defaultSynthUI();
  const next = fn(ui);
  map[id] = next;
  set({ synthUIById: { ...map }, synthUIVersion: (state.synthUIVersion || 0) + 1 });
};

// --- Preset serialization/persistence helpers ---
function currentSoundKey(): string {
  const proj = state.projectName || 'default';
  const id = state.selectedSoundId || '_default_';
  return `${proj}/${id}`;
}

function uiToSchema(ui: SynthUI) {
  // Map UI (mostly 0..1) to engine-friendly values per schema
  const part = state.selectedSoundPart ?? 0;
  const name = state.selectedSoundName || 'Analog Synth';
  // helper mappers mirrored from components
  const mapCutoff = (v: number) => 20 * Math.pow(10, v * Math.log10(18000/20));
  const mapQ = (v: number) => 0.5 + v * (12 - 0.5);
  const mapRate = (v: number) => 0.05 + v * (20 - 0.05);
  const detuneCents = (v: number) => (v - 0.5) * 200; // +/-100 cents
  return {
    schema: 1,
    name,
    part_index: part,
    params: {
      module_kind: getCurrentModuleKind(),
      oscA: { shape: Math.round(ui.oscA.shape*7), detune_cents: detuneCents(ui.oscA.detune), fm_to_B: ui.oscA.fm, level: ui.oscA.level },
      oscB: { shape: Math.round(ui.oscB.shape*7), detune_cents: detuneCents(ui.oscB.detune), fm_to_A: ui.oscB.fm, level: ui.oscB.level },
      amp_env: { attack: mapTime(ui.ampEnv.a), decay: mapTime(ui.ampEnv.d), sustain: ui.ampEnv.s, release: mapTime(ui.ampEnv.r) },
      mod_env: { attack: mapTime(ui.modEnv.a), decay: mapTime(ui.modEnv.d), sustain: ui.modEnv.s, release: mapTime(ui.modEnv.r) },
      filter1: { type: Math.round(ui.filter1.type*3), cutoff_hz: mapCutoff(ui.filter1.cutoff), q: mapQ(ui.filter1.res), assign: ui.filter1.assign },
      filter2: { type: Math.round(ui.filter2.type*3), cutoff_hz: mapCutoff(ui.filter2.cutoff), q: mapQ(ui.filter2.res), assign: ui.filter2.assign },
      lfo: { shape: Math.round(ui.lfo.shape*3), rate_hz: mapRate(ui.lfo.rate), amount: ui.lfo.amount, drive: ui.lfo.drive },
      mod: { lfo: ui.mod.lfo.map(r=>({ dest: r.dest, amount: r.amount })), env: ui.mod.env.map(r=>({ dest: r.dest, amount: r.amount })) },
      fx1: { type: Math.round(ui.fx1.type), p1: ui.fx1.p1, p2: ui.fx1.p2, p3: ui.fx1.p3 },
      fx2: { type: Math.round(ui.fx2.type), p1: ui.fx2.p1, p2: ui.fx2.p2, p3: ui.fx2.p3 },
      fx3: { type: Math.round(ui.fx3.type), p1: ui.fx3.p1, p2: ui.fx3.p2, p3: ui.fx3.p3 },
      fx4: { type: Math.round(ui.fx4.type), p1: ui.fx4.p1, p2: ui.fx4.p2, p3: ui.fx4.p3 },
      mixer: { volume: ui.mixer.volume, pan: (ui.mixer.pan-0.5)*2, haas: ui.mixer.haas ?? 0.0, comp: ui.mixer.comp },
      // Persist EQ in dB (UI normalized [0..1] maps to [-8..+8] dB)
      eq: {
        b1: ((ui.eq.gains[0] ?? 0.5) * 16) - 8,
        b2: ((ui.eq.gains[1] ?? 0.5) * 16) - 8,
        b3: ((ui.eq.gains[2] ?? 0.5) * 16) - 8,
        b4: ((ui.eq.gains[3] ?? 0.5) * 16) - 8,
        b5: ((ui.eq.gains[4] ?? 0.5) * 16) - 8,
        b6: ((ui.eq.gains[5] ?? 0.5) * 16) - 8,
        b7: ((ui.eq.gains[6] ?? 0.5) * 16) - 8,
        b8: ((ui.eq.gains[7] ?? 0.5) * 16) - 8,
      },
      // Persist Acid macros (normalized 0..1)
      acid: (ui as any).acid ? {
        wave: (ui as any).acid.wave ?? 0.0,
        cutoff: (ui as any).acid.cutoff ?? 0.55,
        reso: (ui as any).acid.reso ?? 0.5,
        envmod: (ui as any).acid.envmod ?? 0.6,
        decay: (ui as any).acid.decay ?? 0.7,
        accent: (ui as any).acid.accent ?? 0.7,
        slide: (ui as any).acid.slide ?? 0.4,
        drive: (ui as any).acid.drive ?? 0.3,
      } : undefined,
      // Persist KarplusStrong macros (normalized 0..1)
      karplus: (ui as any).karplus ? {
        decay: (ui as any).karplus.decay ?? 0.8,
        damp: (ui as any).karplus.damp ?? 0.5,
        excite: (ui as any).karplus.excite ?? 0.7,
        tune: (ui as any).karplus.tune ?? 0.0,
      } : undefined,
    }
  };
}

function mapTime(v: number): number {
  // Same mapping used for ENV knobs formatting
  // 1ms..4s approximately
  const min = 0.001;
  const max = 4.0;
  return min * Math.pow(max/min, v);
}

function serializeCurrentPreset(): any {
  const ui = state.getSynthUI();
  return uiToSchema(ui);
}

let flushTimer: number | undefined;
state.scheduleSavePreset = (preset: any) => {
  const key = currentSoundKey();
  const pending = state.pendingSaves || {};
  pending[key] = preset;
  set({ pendingSaves: pending });
  if (flushTimer) window.clearTimeout(flushTimer);
  flushTimer = window.setTimeout(async () => {
    const toFlush = { ...(state.pendingSaves || {}) };
    set({ pendingSaves: {} });
    for (const k of Object.keys(toFlush)) {
      const [project, soundId] = k.split('/');
      try {
        await fsClient.saveSoundPreset(project, soundId, toFlush[k]);
      } catch (e) {
        console.error('saveSoundPreset failed', k, e);
      }
    }
  }, 350);
};

// Apply preset to UI and engine
async function applyPreset(preset: any) {
  if (!preset || !preset.params) return;
  const p = preset.params;
  // Update UI state from preset
  state.updateSynthUI((ui: any) => ({
    ...ui,
    oscA: { shape: (p.oscA?.shape ?? 0)/7, detune: ((p.oscA?.detune_cents ?? 0)/200)+0.5, fm: p.oscA?.fm_to_B ?? 0, level: p.oscA?.level ?? 0.7 },
    oscB: { shape: (p.oscB?.shape ?? 0)/7, detune: ((p.oscB?.detune_cents ?? 0)/200)+0.5, fm: p.oscB?.fm_to_A ?? 0, level: p.oscB?.level ?? 0.0 },
    ampEnv: { a: invMapTime(p.amp_env?.attack ?? 0.01), d: invMapTime(p.amp_env?.decay ?? 0.2), s: p.amp_env?.sustain ?? 0.8, r: invMapTime(p.amp_env?.release ?? 0.2) },
    modEnv: { a: invMapTime(p.mod_env?.attack ?? 0.01), d: invMapTime(p.mod_env?.decay ?? 0.2), s: p.mod_env?.sustain ?? 0.8, r: invMapTime(p.mod_env?.release ?? 0.2) },
    filter1: { type: (p.filter1?.type ?? 0)/3, cutoff: invMapCutoff(p.filter1?.cutoff_hz ?? 8000), res: invMapQ(p.filter1?.q ?? 0.7), assign: p.filter1?.assign ?? 3 },
    filter2: { type: (p.filter2?.type ?? 0)/3, cutoff: invMapCutoff(p.filter2?.cutoff_hz ?? 8000), res: invMapQ(p.filter2?.q ?? 0.7), assign: p.filter2?.assign ?? 0 },
    lfo: { shape: (p.lfo?.shape ?? 0)/3, rate: invMapRate(p.lfo?.rate_hz ?? 1.0), amount: p.lfo?.amount ?? 1.0, drive: p.lfo?.drive ?? 0 },
    mod: {
      ...ui.mod,
      lfo: (p.mod?.lfo ?? Array.from({ length: 5 }).map(()=>({dest:0,amount:1}))),
      env: (p.mod?.env ?? Array.from({ length: 5 }).map(()=>({dest:0,amount:1}))),
    },
    fx1: { type: p.fx1?.type ?? 0, p1: p.fx1?.p1 ?? 0, p2: p.fx1?.p2 ?? 0, p3: p.fx1?.p3 ?? 0 },
    fx2: { type: p.fx2?.type ?? 1, p1: p.fx2?.p1 ?? 0, p2: p.fx2?.p2 ?? 0, p3: p.fx2?.p3 ?? 0 },
    fx3: { type: p.fx3?.type ?? 0, p1: p.fx3?.p1 ?? 0, p2: p.fx3?.p2 ?? 0, p3: p.fx3?.p3 ?? 0 },
    fx4: { type: p.fx4?.type ?? 0, p1: p.fx4?.p1 ?? 0, p2: p.fx4?.p2 ?? 0, p3: p.fx4?.p3 ?? 0 },
    mixer: { volume: p.mixer?.volume ?? 0.7, pan: ((p.mixer?.pan ?? 0)+2)/4, haas: p.mixer?.haas ?? 0.0, comp: p.mixer?.comp ?? 0 },
    // Accept both normalized [0..1] (legacy) and dB [-12..12] in presets; default to 0 dB
    eq: { gains: [p.eq?.b1,p.eq?.b2,p.eq?.b3,p.eq?.b4,p.eq?.b5,p.eq?.b6,p.eq?.b7,p.eq?.b8].map((v:any)=>{
      const toNorm = (x:any) => {
        if (typeof x !== 'number' || Number.isNaN(x)) return 0.5; // 0 dB
        if (x >= -12 && x <= 12) { // dB in legacy or current
          const clamped = Math.max(-8, Math.min(8, x));
          return (clamped + 8) / 16;
        }
        if (x >= 0 && x <= 1) return x; // normalized legacy
        return 0.5; // fallback
      };
      const norm = toNorm(v);
      return Math.max(0, Math.min(1, norm));
    }) },
    // Acid UI mirror (normalized)
    acid: {
      wave: p.acid?.wave ?? 0.0,
      cutoff: p.acid?.cutoff ?? 0.55,
      reso: p.acid?.reso ?? 0.5,
      envmod: p.acid?.envmod ?? 0.6,
      decay: p.acid?.decay ?? 0.7,
      accent: p.acid?.accent ?? 0.7,
      slide: p.acid?.slide ?? 0.4,
      drive: p.acid?.drive ?? 0.3,
    },
    // KarplusStrong UI mirror (normalized)
    karplus: {
      decay: p.karplus?.decay ?? 0.8,
      damp: p.karplus?.damp ?? 0.5,
      excite: p.karplus?.excite ?? 0.7,
      tune: p.karplus?.tune ?? 0.0,
    },
  }));
  // Replay to engine
  const part = state.selectedSoundPart ?? 0;
  const pf = `part/${part}/`;
  try { await rpc.startAudio(); } catch {}
  const calls: Array<Promise<any>> = [];
  const send = (path: string, v: any) => calls.push(rpc.setParam(pf + path, v));
  // Module kind
  if (typeof p.module_kind === 'number') {
    send(`module_kind`, { I32: p.module_kind });
  }
  send(`oscA/shape`, { I32: p.oscA?.shape ?? 0 });
  send(`oscB/shape`, { I32: p.oscB?.shape ?? 0 });
  send(`oscA/detune_cents`, { F32: p.oscA?.detune_cents ?? 0 });
  send(`oscB/detune_cents`, { F32: p.oscB?.detune_cents ?? 0 });
  send(`oscA/fm_to_B`, { F32: p.oscA?.fm_to_B ?? 0 });
  send(`oscB/fm_to_A`, { F32: p.oscB?.fm_to_A ?? 0 });
  send(`oscA/level`, { F32: p.oscA?.level ?? 0.7 });
  send(`oscB/level`, { F32: p.oscB?.level ?? 0.0 });
  send(`filter1/type`, { I32: p.filter1?.type ?? 0 });
  send(`filter1/cutoff_hz`, { F32: p.filter1?.cutoff_hz ?? 20000 });
  send(`filter1/q`, { F32: p.filter1?.q ?? 0.707 });
  send(`filter1/assign`, { I32: p.filter1?.assign ?? 3 });
  send(`filter2/type`, { I32: p.filter2?.type ?? 0 });
  send(`filter2/cutoff_hz`, { F32: p.filter2?.cutoff_hz ?? 20000 });
  send(`filter2/q`, { F32: p.filter2?.q ?? 0.707 });
  send(`filter2/assign`, { I32: p.filter2?.assign ?? 0 });
  // Envelopes
  send(`amp_env/attack`, { F32: p.amp_env?.attack ?? 0.01 });
  send(`amp_env/decay`, { F32: p.amp_env?.decay ?? 0.1 });
  send(`amp_env/sustain`, { F32: p.amp_env?.sustain ?? 0.8 });
  send(`amp_env/release`, { F32: p.amp_env?.release ?? 0.2 });
  send(`mod_env/attack`, { F32: p.mod_env?.attack ?? 0.01 });
  send(`mod_env/decay`, { F32: p.mod_env?.decay ?? 0.1 });
  send(`mod_env/sustain`, { F32: p.mod_env?.sustain ?? 0.8 });
  send(`mod_env/release`, { F32: p.mod_env?.release ?? 0.2 });
  send(`lfo/shape`, { I32: p.lfo?.shape ?? 0 });
  send(`lfo/rate_hz`, { F32: p.lfo?.rate_hz ?? 1.0 });
  send(`lfo/amount`, { F32: p.lfo?.amount ?? 1.0 });
  send(`lfo/drive`, { F32: p.lfo?.drive ?? 0 });
  // Mod matrix LFO rows
  for (let i=0;i<5;i++) {
    const lrow = p.mod?.lfo?.[i] || { dest:0, amount:1 };
    send(`mod/lfo/row${i}/dest`, { I32: lrow.dest ?? 0 });
    send(`mod/lfo/row${i}/amount`, { F32: (lrow.amount ?? 1.0) as number });
  }
  // Mod matrix ENV rows
  for (let i=0;i<5;i++) {
    const erow = p.mod?.env?.[i] || { dest:0, amount:1 };
    send(`mod/env/row${i}/dest`, { I32: erow.dest ?? 0 });
    send(`mod/env/row${i}/amount`, { F32: (erow.amount ?? 1.0) as number });
  }
  send(`fx1/type`, { I32: p.fx1?.type ?? 0 });
  send(`fx1/p1`, { F32: p.fx1?.p1 ?? 0 });
  send(`fx1/p2`, { F32: p.fx1?.p2 ?? 0 });
  send(`fx1/p3`, { F32: p.fx1?.p3 ?? 0 });
  send(`fx2/type`, { I32: p.fx2?.type ?? 1 });
  send(`fx2/p1`, { F32: p.fx2?.p1 ?? 0 });
  send(`fx2/p2`, { F32: p.fx2?.p2 ?? 0 });
  send(`fx2/p3`, { F32: p.fx2?.p3 ?? 0 });
  send(`fx3/type`, { I32: p.fx3?.type ?? 0 });
  send(`fx3/p1`, { F32: p.fx3?.p1 ?? 0 });
  send(`fx3/p2`, { F32: p.fx3?.p2 ?? 0 });
  send(`fx3/p3`, { F32: p.fx3?.p3 ?? 0 });
  send(`fx4/type`, { I32: p.fx4?.type ?? 0 });
  send(`fx4/p1`, { F32: p.fx4?.p1 ?? 0 });
  send(`fx4/p2`, { F32: p.fx4?.p2 ?? 0 });
  send(`fx4/p3`, { F32: p.fx4?.p3 ?? 0 });
  send(`mixer/volume`, { F32: p.mixer?.volume ?? 0.7 });
  send(`mixer/pan`, { F32: p.mixer?.pan ?? 0 });
  send(`mixer/width`, { F32: p.mixer?.width ?? 1.0 });
  send(`mixer/comp`, { F32: p.mixer?.comp ?? 0 });
  send(`mixer/haas`, { F32: p.mixer?.haas ?? 0.0 });
  for (let i=0; i<8; i++) {
    const raw = (p.eq?.[`b${i+1}`] ?? 0) as number;
    const db0 = (raw >= 0 && raw <= 1) ? (-12 + raw * 24) : raw; // support older saves
    const db = Math.max(-8, Math.min(8, db0));
    send(`eq/gain_db/b${i+1}`, { F32: db });
  }
  // Acid macros
  if (p.acid) {
    send(`acid/wave`, { F32: p.acid.wave ?? 0.0 });
    send(`acid/cutoff`, { F32: p.acid.cutoff ?? 0.55 });
    send(`acid/reso`, { F32: p.acid.reso ?? 0.5 });
    send(`acid/envmod`, { F32: p.acid.envmod ?? 0.6 });
    send(`acid/decay`, { F32: p.acid.decay ?? 0.7 });
    send(`acid/accent`, { F32: p.acid.accent ?? 0.7 });
    send(`acid/slide`, { F32: p.acid.slide ?? 0.4 });
    send(`acid/drive`, { F32: p.acid.drive ?? 0.3 });
  }
  // KarplusStrong macros
  if (p.karplus) {
    send(`ks/decay`, { F32: p.karplus.decay ?? 0.8 });
    send(`ks/damp`, { F32: p.karplus.damp ?? 0.5 });
    send(`ks/excite`, { F32: p.karplus.excite ?? 0.7 });
    send(`ks/tune`, { F32: p.karplus.tune ?? 0.0 });
  }
  // Throttle slightly to avoid spamming
  for (const c of calls) { try { await c; } catch(e) { console.error('apply preset set_param failed', e); } }
  // Mark this synth as applied so we don't re-send everything on next entry
  try {
    const id = state.selectedSoundId;
    if (id) { const m = state._presetApplied || {}; m[id] = true; set({ _presetApplied: m }); }
  } catch {}
}

function invMapCutoff(hz: number): number { const min=20, max=18000; return Math.log10((hz/min)) / Math.log10(max/min); }
function invMapQ(q: number): number { return (q - 0.5) / (12 - 0.5); }
function invMapRate(hz: number): number { return (hz - 0.05) / (20 - 0.05); }
function invMapTime(sec: number): number { const min=0.001, max=4.0; return Math.log(sec/min)/Math.log(max/min); }

async function loadAndApplyCurrentPreset() {
  const proj = state.projectName; const id = state.selectedSoundId; if (!proj || !id) return;
  const preset = await fsClient.loadSoundPreset(proj, id);
  if (!preset || preset.schema !== 1) {
    // Create default and save immediately
    const def = uiToSchema(defaultSynthUI());
    try { await fsClient.saveSoundPreset(proj, id, def); } catch(e) { console.error('save default preset failed', e); }
    await applyPreset(def);
  } else {
    await applyPreset(preset);
  }
}

async function preloadAndReplayProjectPresets(project: string) {
  const pj = await fsClient.readProject(project);
  const sounds = pj.sounds || [];
  for (const s of sounds) {
    if ((s as any).type !== 'Synth' && (s as any).kind !== 'Synth') continue;
    const id = s.id; const part = (s as any).part_index ?? 0;
    const preset = await fsClient.loadSoundPreset(project, id);
    if (!preset || preset.schema !== 1) continue;
    // Apply to engine only (do not touch current UI selection here)
    try { await rpc.startAudio(); } catch {}
    const pf = `part/${part}/`;
    const p = preset.params || {};
    const set = (path: string, v: any) => rpc.setParam(pf + path, v);
    try {
      if (typeof p.module_kind === 'number') { await set(`module_kind`, { I32: p.module_kind }); }
      await set(`oscA/shape`, { I32: p.oscA?.shape ?? 0 });
      await set(`oscB/shape`, { I32: p.oscB?.shape ?? 0 });
      await set(`oscA/detune_cents`, { F32: p.oscA?.detune_cents ?? 0 });
      await set(`oscB/detune_cents`, { F32: p.oscB?.detune_cents ?? 0 });
      await set(`oscA/fm_to_B`, { F32: p.oscA?.fm_to_B ?? 0 });
      await set(`oscB/fm_to_A`, { F32: p.oscB?.fm_to_A ?? 0 });
      await set(`oscA/level`, { F32: p.oscA?.level ?? 0.7 });
      await set(`oscB/level`, { F32: p.oscB?.level ?? 0.0 });
      await set(`amp_env/attack`, { F32: p.amp_env?.attack ?? 0.01 });
      await set(`amp_env/decay`, { F32: p.amp_env?.decay ?? 0.1 });
      await set(`amp_env/sustain`, { F32: p.amp_env?.sustain ?? 0.8 });
      await set(`amp_env/release`, { F32: p.amp_env?.release ?? 0.2 });
      await set(`mod_env/attack`, { F32: p.mod_env?.attack ?? 0.01 });
      await set(`mod_env/decay`, { F32: p.mod_env?.decay ?? 0.1 });
      await set(`mod_env/sustain`, { F32: p.mod_env?.sustain ?? 0.8 });
      await set(`mod_env/release`, { F32: p.mod_env?.release ?? 0.2 });
      await set(`filter1/type`, { I32: p.filter1?.type ?? 0 });
      await set(`filter1/cutoff_hz`, { F32: p.filter1?.cutoff_hz ?? 20000 });
      await set(`filter1/q`, { F32: p.filter1?.q ?? 0.707 });
      await set(`filter1/assign`, { I32: p.filter1?.assign ?? 3 });
      await set(`filter2/type`, { I32: p.filter2?.type ?? 0 });
      await set(`filter2/cutoff_hz`, { F32: p.filter2?.cutoff_hz ?? 20000 });
      await set(`filter2/q`, { F32: p.filter2?.q ?? 0.707 });
      await set(`filter2/assign`, { I32: p.filter2?.assign ?? 0 });
      await set(`lfo/shape`, { I32: p.lfo?.shape ?? 0 });
      await set(`lfo/rate_hz`, { F32: p.lfo?.rate_hz ?? 1.0 });
      await set(`lfo/amount`, { F32: p.lfo?.amount ?? 1.0 });
      await set(`lfo/drive`, { F32: p.lfo?.drive ?? 0 });
      // Mod matrix LFO rows
      for (let i=0;i<5;i++) {
        const lrow = p.mod?.lfo?.[i] || { dest:0, amount:1 };
        await set(`mod/lfo/row${i}/dest`, { I32: lrow.dest ?? 0 });
        await set(`mod/lfo/row${i}/amount`, { F32: (lrow.amount ?? 1.0) as number });
      }
      // Mod matrix ENV rows
      for (let i=0;i<5;i++) {
        const erow = p.mod?.env?.[i] || { dest:0, amount:1 };
        await set(`mod/env/row${i}/dest`, { I32: erow.dest ?? 0 });
        await set(`mod/env/row${i}/amount`, { F32: (erow.amount ?? 1.0) as number });
      }
      await set(`fx1/type`, { I32: p.fx1?.type ?? 0 });
      await set(`fx1/p1`, { F32: p.fx1?.p1 ?? 0 });
      await set(`fx1/p2`, { F32: p.fx1?.p2 ?? 0 });
      await set(`fx1/p3`, { F32: p.fx1?.p3 ?? 0 });
      await set(`fx2/type`, { I32: p.fx2?.type ?? 1 });
      await set(`fx2/p1`, { F32: p.fx2?.p1 ?? 0 });
      await set(`fx2/p2`, { F32: p.fx2?.p2 ?? 0 });
      await set(`fx2/p3`, { F32: p.fx2?.p3 ?? 0 });
      await set(`fx3/type`, { I32: p.fx3?.type ?? 0 });
      await set(`fx3/p1`, { F32: p.fx3?.p1 ?? 0 });
      await set(`fx3/p2`, { F32: p.fx3?.p2 ?? 0 });
      await set(`fx3/p3`, { F32: p.fx3?.p3 ?? 0 });
      await set(`fx4/type`, { I32: p.fx4?.type ?? 0 });
      await set(`fx4/p1`, { F32: p.fx4?.p1 ?? 0 });
      await set(`fx4/p2`, { F32: p.fx4?.p2 ?? 0 });
      await set(`fx4/p3`, { F32: p.fx4?.p3 ?? 0 });
      await set(`mixer/volume`, { F32: p.mixer?.volume ?? 0.7 });
      await set(`mixer/pan`, { F32: p.mixer?.pan ?? 0 });
      await set(`mixer/width`, { F32: p.mixer?.width ?? 1.0 });
      await set(`mixer/comp`, { F32: p.mixer?.comp ?? 0 });
      await set(`mixer/haas`, { F32: p.mixer?.haas ?? 0.0 });
      for (let i=0; i<8; i++) {
        const raw = (p.eq?.[`b${i+1}`] ?? 0) as number;
        const db0 = (raw >= 0 && raw <= 1) ? (-12 + raw * 24) : raw;
        const db = Math.max(-8, Math.min(8, db0));
        await set(`eq/gain_db/b${i+1}`, { F32: db });
      }
      if (p.acid) {
        await set(`acid/wave`, { F32: p.acid.wave ?? 0.0 });
        await set(`acid/cutoff`, { F32: p.acid.cutoff ?? 0.55 });
        await set(`acid/reso`, { F32: p.acid.reso ?? 0.5 });
        await set(`acid/envmod`, { F32: p.acid.envmod ?? 0.6 });
        await set(`acid/decay`, { F32: p.acid.decay ?? 0.7 });
        await set(`acid/accent`, { F32: p.acid.accent ?? 0.7 });
        await set(`acid/slide`, { F32: p.acid.slide ?? 0.4 });
        await set(`acid/drive`, { F32: p.acid.drive ?? 0.3 });
      }
    } catch (e) { console.error('replay preset failed', e); }
  }
}


state.setIsRDown = (b: boolean) => { set({ isRDown: !!b }); };

// --- Mod Matrix helpers (rows, dests, amounts) ---
state.setLfoRow = (i: number) => {
  const idx = Math.max(0, Math.min(4, Math.round(i)));
  state.updateSynthUI((ui: any) => ({ ...ui, mod: { ...ui.mod, lfoRow: idx } }));
};
state.setEnvRow = (i: number) => {
  const idx = Math.max(0, Math.min(4, Math.round(i)));
  state.updateSynthUI((ui: any) => ({ ...ui, mod: { ...ui.mod, envRow: idx } }));
};
state.setLfoDest = (row: number, dest: number) => {
  const r = Math.max(0, Math.min(4, Math.round(row)));
  const d = Math.max(0, Math.min(10, Math.round(dest)));
  state.updateSynthUI((ui: any) => {
    const rows = ui.mod.lfo.slice(); rows[r] = { ...rows[r], dest: d };
    return { ...ui, mod: { ...ui.mod, lfo: rows } };
  });
  const part = state.selectedSoundPart ?? 0;
  state.setSynthParam(`part/${part}/mod/lfo/row${r}/dest`, d, 'I32');
  try { state.scheduleSavePreset!(serializeCurrentPreset()); } catch {}
};
state.setEnvDest = (row: number, dest: number) => {
  const r = Math.max(0, Math.min(4, Math.round(row)));
  const d = Math.max(0, Math.min(10, Math.round(dest)));
  state.updateSynthUI((ui: any) => {
    const rows = ui.mod.env.slice(); rows[r] = { ...rows[r], dest: d };
    return { ...ui, mod: { ...ui.mod, env: rows } };
  });
  const part = state.selectedSoundPart ?? 0;
  state.setSynthParam(`part/${part}/mod/env/row${r}/dest`, d, 'I32');
  try { state.scheduleSavePreset!(serializeCurrentPreset()); } catch {}
};
state.updateLfoAmount = (row: number, amt: number) => {
  const r = Math.max(0, Math.min(4, Math.round(row)));
  const next = Math.max(-1, Math.min(1, amt));
  state.updateSynthUI((ui: any) => {
    const rows = ui.mod.lfo.slice(); rows[r] = { ...rows[r], amount: next };
    return { ...ui, mod: { ...ui.mod, lfo: rows } };
  });
  const part = state.selectedSoundPart ?? 0;
  state.setSynthParam(`part/${part}/mod/lfo/row${r}/amount`, next, 'F32');
  try { state.scheduleSavePreset!(serializeCurrentPreset()); } catch {}
};
state.updateEnvAmount = (row: number, amt: number) => {
  const r = Math.max(0, Math.min(4, Math.round(row)));
  const next = Math.max(-1, Math.min(1, amt));
  state.updateSynthUI((ui: any) => {
    const rows = ui.mod.env.slice(); rows[r] = { ...rows[r], amount: next };
    return { ...ui, mod: { ...ui.mod, env: rows } };
  });
  const part = state.selectedSoundPart ?? 0;
  state.setSynthParam(`part/${part}/mod/env/row${r}/amount`, next, 'F32');
  try { state.scheduleSavePreset!(serializeCurrentPreset()); } catch {}
};
