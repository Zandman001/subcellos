import { useEffect, useSyncExternalStore } from "react";
import { fsClient, Pattern, Project, Sound } from "../fsClient";
import { rpc } from "../rpc";
import { sequencerSetCurrentPattern, sequencerStopAll, sequencerDeleteForSound, sequencerDeleteForPattern, sequencerSetPart, sequencerSetAllowedSounds } from '../store/sequencer';
import { envTimeFromNorm, envTimeMsFromNorm, envTimeNormFromMilliseconds, envTimeNormFromSeconds } from "../utils/envTime";
import type { ViewName } from "../types/ui";

export type Level = "projects" | "project" | "patterns" | "pattern" | "synth";

export interface BrowserState {
  focus: "browser" | "right";
  level: Level;
  currentView: ViewName;
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
  modulePickerIndex: number; // 0: Synth, 1: Acid, 2: KarplusStrong, 3: ResonatorBank, 4: Sampler, 5: Drum
  // Sample browser state
  sampleBrowserOpen: boolean;
  sampleBrowserItems: string[];
  sampleBrowserSelected: number;
  drumPackBrowserOpen?: boolean;
  drumPackItems?: string[];
  drumPackSelected?: number;
  drumSampleItems?: string[];
  drumSampleSelected?: number;
  drumPreviewing?: boolean;
  isRecording: boolean;
  // Project settings menu
  projectSettingsOpen?: boolean;
  projectSettingsIndex?: number; // which setting is selected (start with 0)
  globalBpm?: number; // mirror of global tempo for UI
  uiTheme?: string; // name of current UI theme
  openProjectSettings?: () => void;
  closeProjectSettings?: () => void;
  projectSettingsMoveUp?: () => void;
  projectSettingsMoveDown?: () => void;
  projectSettingsInc?: (delta?: number) => void; // R increments
  projectSettingsDec?: (delta?: number) => void; // W decrements
  closeSampleBrowser: () => void;
  openDrumPackBrowser?: () => Promise<void>;
  closeDrumPackBrowser?: () => void;
  drumPackMoveUp?: () => void;
  drumPackMoveDown?: () => void;
  drumPackLoadSelected?: () => Promise<void>;
  drumSampleMoveUp?: () => void;
  drumSampleMoveDown?: () => void;
  drumTogglePreview?: () => Promise<void>;
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
  serializeCurrentPreset?: () => any;
  // per-sound module kind hint (UI-only). 'acid' constrains pages to 4.
  moduleKindById?: Record<string, 'acid' | 'analog' | 'karplus' | 'resonator' | 'sampler' | 'drum'>;
  // recompute pages when conditions change (e.g., sampler playback type toggles LOOP availability)
  refreshSynthPages?: () => void;
  setActiveView?: (view: ViewName) => void;
  // Ark design language now always on (previous arkMode flag removed)
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
  // Track last applied module kind per part to avoid skipping sends across parts
  _lastAppliedModuleKindByPart?: Record<number, number>;
};

const state: InternalState = {
  focus: "browser",
  level: "projects",
  currentView: 'Sounds',
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
  _lastAppliedModuleKindByPart: {},
  modulePickerIndex: 0,
  sampleBrowserOpen: false,
  sampleBrowserItems: [],
  sampleBrowserSelected: 0,
  drumPackBrowserOpen: false,
  drumPackItems: [],
  drumPackSelected: 0,
  drumSampleItems: [],
  drumSampleSelected: 0,
  drumPreviewing: false,
  isRecording: false,
  projectSettingsOpen: false,
  projectSettingsIndex: 0,
  globalBpm: 120,
  uiTheme: 'Off',
  closeSampleBrowser: () => {},
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
  setActiveView: () => {},
  // arkMode removed
};

function set(partial: Partial<InternalState>) {
  Object.assign(state, partial);
  bumpVersion();
}

// UI Theme support
export const UI_THEMES = [
  'Off',
  'RGB Shift', // animated gradient
  'Nebula Drift', // animated radial blend
  'Cyberwave', // animated gradient
  'Aurora Flow', // new animated gradient
  'Solar Flare', // new animated gradient
  'Deep Ocean', // new animated gradient
];

export function applyUiTheme(name: string) {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('ui-theme-overlay');
  if (!el) return;
  const root = document.documentElement;
  const setVar = (k: string, v: string|number) => { root.style.setProperty(k, String(v)); };
  const cls = el.classList;
  // Reset
  cls.remove('solid', 'gradient', 'grad-nebula', 'grad-cyberwave', 'grad-aurora', 'grad-solar', 'grad-ocean', 'grad-sunset');
  setVar('--ui-intensity', '0');
  setVar('--ui-hue', '0deg'); setVar('--ui-sat', '0%');
  el.style.opacity = '0';
  // Apply
  let intensity = '0';
  switch ((name||'').toLowerCase()) {
    case 'rgb shift':
      intensity = '0.35'; setVar('--ui-intensity', intensity);
      cls.remove('solid'); cls.add('gradient');
      break;
    case 'nebula drift':
      intensity = '0.35'; setVar('--ui-intensity', intensity);
      cls.remove('solid'); cls.add('grad-nebula');
      break;
    case 'cyberwave':
      intensity = '0.28'; setVar('--ui-intensity', intensity);
      cls.remove('solid'); cls.add('grad-cyberwave');
      break;
    case 'aurora flow':
      intensity = '0.30'; setVar('--ui-intensity', intensity);
      cls.add('grad-aurora');
      break;
    case 'solar flare':
      intensity = '0.55'; setVar('--ui-intensity', intensity);
      cls.add('grad-solar');
      break;
    case 'deep ocean':
      intensity = '0.30'; setVar('--ui-intensity', intensity);
      cls.add('grad-ocean');
      break;
    default:
      // Off or unknown
      intensity = '0'; setVar('--ui-intensity', intensity);
      break;
  }
  // Fallback inline opacity to ensure visibility even if CSS var scoping fails
  el.style.opacity = intensity;
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
      // Purge any stored sequences for this pattern name so reusing the number starts clean
      try { sequencerDeleteForPattern(state.confirmLabel); } catch {}
      await fsClient.deletePattern(state.confirmProjectName, state.confirmLabel);
      await state.loadLevel();
      set({ selected: Math.min(state.selected, Math.max(0, state.items.length - 1)) });
    } else if (state.confirmKind === 'module' && state.confirmProjectName && state.confirmSoundId) {
      await fsClient.deleteSound(state.confirmProjectName, state.confirmSoundId);
  try { sequencerDeleteForSound(state.confirmSoundId, state.patternName); } catch {}
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
  // Restore global tempo if present in project
  const bpm = Math.max(20, Math.min(240, Number((pj as any)?.globalBpm || (pj as any)?.global_bpm || state.globalBpm || 120)));
  if (Number.isFinite(bpm)) {
    set({ globalBpm: bpm });
    try { window.dispatchEvent(new CustomEvent('tempo-change', { detail: { bpm } })); } catch {}
    try { rpc.setTempo(bpm); } catch {}
  }
  // Restore ui theme
  const theme = String((pj as any)?.uiTheme || (pj as any)?.ui_theme || state.uiTheme || 'Off');
  set({ uiTheme: theme });
  applyUiTheme(theme);
}

async function loadPattern(project: string, pattern: string) {
  // Stop any running playback before switching patterns
  try { sequencerStopAll(); } catch {}
  try { sequencerSetCurrentPattern(pattern); } catch {}
  const pat = await fsClient.readPattern(project, pattern);
  state._patternData = pat;
  // Restrict sequencer to only sounds referenced by this pattern
  try { sequencerSetAllowedSounds(pat?.soundRefs || []); } catch {}
  // Ensure sequencer entries exist for this pattern and have proper routing
  try {
    const sounds = await fsClient.listSounds(project);
    const byId = new Map(sounds.map(s => [s.id, s] as const));
    for (const id of (pat?.soundRefs || [])) {
      const s = byId.get(id);
      if (!s) continue;
      const part = (s as any).part_index ?? 0;
      let kind: 'synth'|'sampler'|'drum' = 'synth';
      const t = String(s.type || '').toLowerCase();
      if (t.includes('drum')) kind = 'drum'; else if (t.includes('sampler')) kind = 'sampler'; else kind = 'synth';
      try { sequencerSetPart(id, part, kind); } catch {}
    }
  } catch {}
}

async function refreshPatternItems() {
  const project = state.projectName!;
  const sounds = await fsClient.listSounds(project);
  state.items = sounds.map((s) => `${s.name}`);
  state.soundIdsAtLevel = sounds.map((s) => s.id);
  state.soundTypesAtLevel = sounds.map((s) => normalizeSoundType(s.type)!) as any;
  state.soundPartsAtLevel = sounds.map((s) => (s as any).part_index ?? 0);
  
  // Infer module kinds from sound names and update moduleKindById
  const moduleKindById = state.moduleKindById || {};
  sounds.forEach((s) => {
    const name = s.name.toLowerCase();
    if (name.startsWith('acid 303')) {
      moduleKindById[s.id] = 'acid';
    } else if (name.startsWith('karplus string') || name.startsWith('string theory')) {
      moduleKindById[s.id] = 'karplus';
    } else if (name.startsWith('resonator bank') || name.startsWith('mushrooms')) {
      moduleKindById[s.id] = 'resonator';
    } else if (name.startsWith('sampler')) {
      moduleKindById[s.id] = 'sampler';
    } else if (name.startsWith('drum') || name.startsWith('drubbles') || name.startsWith('drum sampler')) {
      moduleKindById[s.id] = 'drum';
    }
  });
  set({ moduleKindById: { ...moduleKindById } });
  
  clampSelection();
  const selectedSound = sounds[state.selected];
  state.selectedSoundId = selectedSound?.id;
  state.selectedSoundName = selectedSound?.name;
  state.currentSoundType = selectedSound ? normalizeSoundType(selectedSound.type) : undefined;
  state.selectedSoundPart = (selectedSound as any)?.part_index ?? 0;
  // Proactively sync engine module kind for the newly selected item
  try { syncModuleKindToEngineForSelected(); } catch {}
}

// Ensure the engine's part/{selected}/module_kind matches current selection's inferred module
function syncModuleKindToEngineForSelected() {
  const part = state.selectedSoundPart ?? 0;
  const mk = getCurrentModuleKind();
  const lastMap = state._lastAppliedModuleKindByPart || {};
  const last = lastMap[part];
  if (last !== mk) {
    lastMap[part] = mk as any;
    set({ _lastAppliedModuleKindByPart: { ...lastMap } });
    // Send immediately with debounce to avoid IPC flood
    debounceInvokeSet(`part/${part}/module_kind`, { I32: mk });
  }
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
      // Keep sequencer scoped to this pattern id proactively
      const patName = state.patternName || state.items[state.selected];
      if (typeof patName === 'string' && patName) {
        try { sequencerSetCurrentPattern(patName); } catch {}
      }
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
  // Ensure engine module_kind matches current selection
  try { syncModuleKindToEngineForSelected(); } catch {}
      // Ensure sequencer knows the current part and kind so local play works inside synth UI
      try {
        const id = state.selectedSoundId; const part = state.selectedSoundPart ?? 0;
        const mk = getCurrentModuleKind();
        const kind = mk === 4 ? 'sampler' : mk === 5 ? 'drum' : 'synth';
        if (id) sequencerSetPart(id, part, kind as any);
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
      if (state.currentView !== 'Sounds') {
        break;
      }
  if (state.selectedSoundId && (state.currentSoundType === "synth" || state.currentSoundType === "sampler" || state.currentSoundType === "drum")) {
        set({ level: "synth", synthPageIndex: 0, selected: 0 });
        await state.loadLevel();
  try { syncModuleKindToEngineForSelected(); } catch {}
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
    const next = Math.max(0, Math.min(5, state.modulePickerIndex - 1));
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
  try { syncModuleKindToEngineForSelected(); } catch {}
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
    const next = Math.max(0, Math.min(5, state.modulePickerIndex + 1));
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
  try { syncModuleKindToEngineForSelected(); } catch {}
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
  // Ensure no stale sequencer data is carried over if this pattern name existed before
  try { sequencerDeleteForPattern(name); } catch {}
    await state.loadLevel();
    const idx = state.items.findIndex((i) => i === name);
    set({ selected: idx >= 0 ? idx : state.selected });
    return;
  }
  if (state.level === "pattern") {
    // Only allow adding sounds from the Sounds view
    if (state.currentView !== 'Sounds') {
      return;
    }
    if (!state.modulePickerOpen) {
      set({ modulePickerOpen: true, modulePickerIndex: 0 });
      return;
    }
    // Confirm create
  const types = ["synth", "acid", "karplus", "resonator", "sampler", "drum"] as const; // last is drum sampler
    const t = types[Math.max(0, Math.min(5, state.modulePickerIndex))];
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
      } else if (t === 'resonator') {
        const map = state.moduleKindById || {};
        map[created.id] = 'resonator';
        set({ moduleKindById: { ...map } });
      } else if (t === 'sampler') {
        const map = state.moduleKindById || {};
        map[created.id] = 'sampler';
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
        if (t === "synth" || t === "acid" || t === "karplus" || t === "resonator" || t === "sampler") {
          const part = (created as any).part_index ?? 0;
          // Build and save default preset immediately, then replay
          const ui = defaultSynthUI();
          ui.oscB.level = 0.0; // default tweak
          // If sampler: ensure no stale sample buffer by explicitly clearing engine state
          if (t === 'sampler') {
            try { await rpc.clearSample(part); } catch(e) { console.warn('clearSample on creation failed', e); }
            // Ensure sampler section exists with current_sample undefined
            (ui as any).sampler = { ...(ui as any).sampler, current_sample: undefined };
          }
          
          // Update UI state for this new sound so knobs match audio
          const map = state.synthUIById || {};
          map[created.id] = ui;
          set({ synthUIById: { ...map } });
          
          const preset = uiToSchema(ui);
          try { await fsClient.saveSoundPreset(pn, created.id, preset); } catch (e) { console.error('save default preset failed', e); }
          try { await rpc.startAudio(); } catch(_){}
          try { await applyPreset(preset); } catch(e){ console.error('apply default preset failed', e); }
          
          // Mark preset as applied so it doesn't get reloaded when entering synth level
          const appliedMap = state._presetApplied || {};
          appliedMap[created.id] = true;
          set({ _presetApplied: { ...appliedMap } });
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
  // Only allow removing sounds from the Sounds view
  if (state.currentView !== 'Sounds') return;
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

state.setActiveView = (view: ViewName) => {
  if (state.currentView === view) return;
  const wasSynth = state.level === 'synth';
  set({ currentView: view });
  if (wasSynth && view !== 'Sounds') {
    try { state.forceStopPreview?.(); } catch {}
    set({ level: 'pattern', synthPageIndex: 0, selected: 0 });
    (async () => {
      try { await state.loadLevel(); }
      catch (e) { console.error('sync view change level load failed', e); }
    })();
  }
};

// Ark mode persistence removed; always active via App

// --- Project Settings (Global) ---
state.openProjectSettings = () => { set({ projectSettingsOpen: true, projectSettingsIndex: 0 }); };
state.closeProjectSettings = () => { set({ projectSettingsOpen: false }); };
state.projectSettingsMoveUp = () => {
  if (!state.projectSettingsOpen) return;
  const next = Math.max(0, (state.projectSettingsIndex || 0) - 1);
  set({ projectSettingsIndex: next });
};
state.projectSettingsMoveDown = () => {
  if (!state.projectSettingsOpen) return;
  const maxIdx = 1; // 0=BPM, 1=UI Theme
  const next = Math.min(maxIdx, (state.projectSettingsIndex || 0) + 1);
  set({ projectSettingsIndex: next });
};
state.projectSettingsInc = (delta = 1) => {
  if (!state.projectSettingsOpen) return;
  const idx = state.projectSettingsIndex || 0;
  if (idx === 0) {
    const cur = typeof state.globalBpm === 'number' ? state.globalBpm : 120;
    const next = Math.max(20, Math.min(240, Math.round(cur + delta)));
    set({ globalBpm: next });
    try { window.dispatchEvent(new CustomEvent('tempo-change', { detail: { bpm: next } })); } catch {}
    try { rpc.setTempo(next); } catch {}
    try {
      const pj = state._projectData || { sounds: [] };
      const data = { ...(pj as any), globalBpm: next, uiTheme: state.uiTheme };
      if (state.projectName) fsClient.writeProject(state.projectName, data as any);
    } catch {}
  } else if (idx === 1) {
    // Cycle UI theme list
    const themes = UI_THEMES;
    const cur = state.uiTheme || 'Off';
    const at = Math.max(0, themes.indexOf(cur));
    const nextIdx = (at + (delta >= 0 ? 1 : -1) + themes.length) % themes.length;
    const next = themes[nextIdx];
    set({ uiTheme: next });
    applyUiTheme(next);
    try {
      const pj = state._projectData || { sounds: [] };
      const data = { ...(pj as any), globalBpm: state.globalBpm, uiTheme: next };
      if (state.projectName) fsClient.writeProject(state.projectName, data as any);
    } catch {}
  }
};
state.projectSettingsDec = (delta = 1) => {
  state.projectSettingsInc?.(-delta);
};

// Public helper to recompute pages and keep selection in bounds
state.refreshSynthPages = () => {
  if (state.level !== 'synth') return;
  const pages = computeSynthPagesForCurrent();
  const maxIdx = pages.length - 1;
  const curLabel = state.synthPages[state.synthPageIndex];
  // try to keep same label if still present, else clamp index
  const idxSame = pages.indexOf(curLabel);
  const nextIdx = idxSame >= 0 ? idxSame : Math.max(0, Math.min(maxIdx, state.synthPageIndex));
  set({ synthPages: pages, items: pages.slice(), synthPageIndex: nextIdx, selected: nextIdx });
};

// Hook to use the store
export function useBrowser<T = InternalState>(selector?: (s: InternalState) => T): T {
  useEffect(() => { state.loadLevel(); }, []);
  const subscribe = (cb: () => void) => { listeners.add(cb); return () => listeners.delete(cb); };
  // Provide a cached snapshot that only changes identity when state changes.
  return useSyncExternalStore(subscribe, getSnapshot) as unknown as T;
}

// Drum pack browser helpers
state.openDrumPackBrowser = async () => {
  try { await rpc.startAudio(); } catch {}
  try {
    const packs = await rpc.listDrumPacks();
    set({ drumPackBrowserOpen: true, drumPackItems: packs, drumPackSelected: 0 });
  } catch(e){ console.error('listDrumPacks failed', e); set({ drumPackBrowserOpen: true, drumPackItems: [], drumPackSelected: 0 }); }
};
state.closeDrumPackBrowser = () => { set({ drumPackBrowserOpen: false, drumPreviewing: false }); };
state.drumPackMoveUp = () => {
  if (!state.drumPackBrowserOpen) return;
  const n = (state.drumPackItems||[]).length; if (!n) return;
  const sel = Math.max(0, Math.min(n-1, (state.drumPackSelected||0)-1));
  set({ drumPackSelected: sel });
};
state.drumPackMoveDown = () => {
  if (!state.drumPackBrowserOpen) return;
  const n = (state.drumPackItems||[]).length; if (!n) return;
  const sel = Math.max(0, Math.min(n-1, (state.drumPackSelected||0)+1));
  set({ drumPackSelected: sel });
};
state.drumPackLoadSelected = async () => {
  const packs = state.drumPackItems||[]; const sel = state.drumPackSelected||0;
  const pack = packs[sel]; if (!pack) return;
  const part = state.selectedSoundPart ?? 0;
  try { await rpc.loadDrumPack(part, pack); } catch(e){ console.error('loadDrumPack failed', e); }
  // fetch samples for display
  let samples: string[] = [];
  try { samples = await rpc.listDrumSamples(pack); } catch(e){ console.error('listDrumSamples failed', e); }
  // Persist selected pack into per-sound UI and save preset
  try {
    const id = state.selectedSoundId;
    if (id) {
      const map = state.synthUIById || {} as any;
      const ui = map[id] ? { ...map[id] } : defaultSynthUI();
      ui.drum = { ...(ui.drum||{}), current_pack: pack };
      map[id] = ui;
      set({ synthUIById: { ...map }, synthUIVersion: (state.synthUIVersion||0)+1 });
      const preset = uiToSchema(ui as any);
      const proj = state.projectName; if (proj) { await fsClient.saveSoundPreset(proj, id, preset); }
    }
  } catch (e) { console.error('persist drum pack failed', e); }
  set({ drumPackBrowserOpen: false, drumSampleItems: samples, drumSampleSelected: 0 });
};
state.drumSampleMoveUp = () => {
  const items = state.drumSampleItems||[]; if (!items.length) return;
  const cur = state.drumSampleSelected||0;
  const sel = (cur + items.length - 1) % items.length; // wrap left
  set({ drumSampleSelected: sel });
};
state.drumSampleMoveDown = () => {
  const items = state.drumSampleItems||[]; if (!items.length) return;
  const cur = state.drumSampleSelected||0;
  const sel = (cur + 1) % items.length; // wrap right
  set({ drumSampleSelected: sel });
};
state.drumTogglePreview = async () => {
  // In drum sampler, preview should trigger the selected drum slot via the part's drum engine (not global sampler preview)
  if (state.drumPackBrowserOpen) return; // no preview while browsing packs
  const samples = state.drumSampleItems||[]; const sidx = state.drumSampleSelected||0;
  if (!samples.length) return;
  const part = state.selectedSoundPart ?? 0;
  const note = 36 + sidx; // slot mapping logic matches drum slot_for_note
  try { await rpc.startAudio(); } catch {}
  try { await rpc.noteOn(part, note, 0.9); } catch(e){ console.error('drum preview noteOn failed', e); }
  // mark previewing momentarily for UI feedback
  set({ drumPreviewing: true });
  setTimeout(()=>{ set({ drumPreviewing: false }); }, 400);
};

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

export function setFxPage(page: 0 | 1 | 2 | 3) {
  set({ fxSelect: page });
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
  if (l === 'drum' || l === 'drumsampler') return 'drum';
  return undefined;
}

function getCurrentModuleKind(): number {
  const id = state.selectedSoundId;
  if (!id) return 0;
  const map = state.moduleKindById || {};
  if (map[id] === 'acid') return 1;
  if (map[id] === 'karplus') return 2;
  if (map[id] === 'resonator') return 3;
  if (map[id] === 'sampler') return 4;
  if (map[id] === 'drum') return 5;
  const label = state.selectedSoundName || '';
  const l = label.toLowerCase();
  if (l.startsWith('acid 303')) return 1;
  if (l.startsWith('karplus string') || l.startsWith('string theory')) return 2;
  if (l.startsWith('resonator bank') || l.startsWith('mushrooms')) return 3;
  if (l.startsWith('sampler')) return 4;
  if (l.startsWith('drum') || l.startsWith('drum sampler') || l.startsWith('drubbles')) return 5;
  return 0;
}

function isAcidCurrent(): boolean {
  return getCurrentModuleKind() === 1;
}

function isSamplerCurrent(): boolean {
  return getCurrentModuleKind() === 4;
}

function computeSynthPagesForCurrent(): readonly string[] {
  const moduleKind = getCurrentModuleKind();
  // Ensure engine module_kind matches inferred moduleKind (including analog=0)
  try {
    const part = state.selectedSoundPart ?? 0;
    // Track per-part last-applied value to avoid cross-part desyncs
    const lastMap = state._lastAppliedModuleKindByPart || {};
    const last = lastMap[part];
    if (last !== moduleKind) {
      lastMap[part] = moduleKind as any;
      set({ _lastAppliedModuleKindByPart: { ...lastMap } });
      state.setSynthParam?.(`part/${part}/module_kind`, moduleKind, 'I32');
    }
  } catch {}
  if (moduleKind === 1) { // Acid
    return ["ACID303", "FX", "MIXER", "EQ"] as const;
  } else if (moduleKind === 2) { // String Theory (formerly KarplusStrong)
    return ["STRING THEORY", "FX", "MIXER", "EQ"] as const;
  } else if (moduleKind === 3) { // Mushrooms (formerly ResonatorBank)
    return ["MUSHROOMS", "FX", "MIXER", "EQ"] as const;
  } else if (moduleKind === 4) { // Sampler
    // Pages depend on playback mode: show ENVELOPE only in Loop/Keytrack; LOOP tab only in Loop
    const ui = state.getSynthUI() as any;
    const pmode = Math.round(ui?.sampler?.playback_mode ?? 0);
    if (pmode === 0) {
      // One-Shot: hide ENVELOPE and LOOP
      return ["SAMPLER", "MIXER", "FX", "EQ"] as const;
    } else if (pmode === 1) {
      // Loop: show LOOP and ENVELOPE
      return ["SAMPLER", "LOOP", "ENVELOPE", "MIXER", "FX", "EQ"] as const;
    } else {
      // Keytrack: show ENVELOPE, no LOOP
      return ["SAMPLER", "ENVELOPE", "MIXER", "FX", "EQ"] as const;
    }
  } else if (moduleKind === 5) { // Drubbles (formerly Drum Sampler)
    return ["DRUBBLES","MIXER","FX","EQ"] as const;
  }
  // Electricity (formerly Analog synth) – default
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
      await rpc.noteOff(state.selectedSoundPart ?? 0, cur);
    }
    await rpc.noteOn(state.selectedSoundPart ?? 0, midi, 0.9);
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
  await rpc.noteOff(state.selectedSoundPart ?? 0, cur);
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
  // If current module is drum, suppress synth preview entirely.
  if (state.currentSoundType === 'drum') {
    // Ensure any existing synth preview note is stopped
    if (state.currentPreview !== undefined) {
      try { await rpc.noteOff(state.selectedSoundPart ?? 0, state.currentPreview); } catch {}
      set({ currentPreview: undefined, _pressedQA: { q: false, a: false } });
    }
    return;
  }
  const pressed = state._pressedQA || { q: false, a: false };
  // Electricity preview: 'a' = base C3 (48), 'q' adds +12, 'a'+'q' = +24.
  let desired: number | undefined = undefined;
  if (pressed.a) {
    const base = 48; // C3
    const add = pressed.q ? 24 : 0; // if Q held with A, +24
    desired = base + add;
  } else if (pressed.q) {
    // If only Q is held, play +12
    desired = 48 + 12;
  }
  const cur = state.currentPreview;

  if (desired === cur) return;

  try {
  // Warm engine before toggling preview notes to avoid first-note being dropped
  try { await rpc.startAudio(); } catch {}
    if (cur !== undefined) {
      await rpc.noteOff(state.selectedSoundPart ?? 0, cur);
    }
    if (desired !== undefined) {
      await rpc.noteOn(state.selectedSoundPart ?? 0, desired, 0.9);
    }
    set({ currentPreview: desired });
  } catch (e) {
    console.error("Preview note error", e);
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
  resonator?: {
    pitch: number;
    decay: number;
    brightness: number;
    bank_size: number;
    mode: number;
    inharmonicity: number;
    feedback: number;
    drive: number;
    exciter_type: number;
    exciter_amount: number;
    noise_color: number;
    strike_rate: number;
    stereo_width: number;
    randomize: number;
    body_blend: number;
    output_gain: number;
  };
  sampler?: {
    sample_start: number;
    sample_end: number;
  pitch_semitones: number; // coarse semitones -48..+48
  pitch_cents: number;     // fine cents -100..+100
    playback_mode: number;
    loop_start: number;
    loop_end: number;
    loop_mode: number;
  retrig_mode?: number; // 0=Immediate; 1..7 = tempo divisions 1/1..1/64
  // persisted filename from Documents/subsamples, if any
  current_sample?: string;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
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
    // Add default ResonatorBank parameters
    resonator: {
      pitch: 0.5,
      decay: 0.5,
      brightness: 0.5,
      bank_size: 8,
      mode: 0,
      inharmonicity: 0.1,
      feedback: 0.0,
      drive: 0.0,
      exciter_type: 0,
      exciter_amount: 0.5,
      noise_color: 0.5,
      strike_rate: 0.0,
      stereo_width: 0.5,
      randomize: 0.0,
      body_blend: 0.4,
      output_gain: 0.7,
    },
    // Add default Sampler parameters
    sampler: {
      sample_start: 0.0,
  sample_end: 1.0,
  pitch_semitones: 0.0,
  pitch_cents: 0.0,
      playback_mode: 0, // OneShot
      loop_start: 0.0,
      loop_end: 1.0,
      loop_mode: 0, // Forward
  retrig_mode: 0,
  current_sample: undefined,
  // Normalized ADSR values (same scale as AMP env)
  attack: 0.0,
  decay: 0.0,
      sustain: 1.0,
  release: 0.0,
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
  let ui = map[id];
  if (!ui) {
    // Instead of forcing a full default (which contains all module sections and can overwrite
    // intent when switching from sampler -> analog), create a minimal structure and selectively
    // add sections lazily when accessed or when module kind requires them.
    const base = defaultSynthUI();
    // Prune sampler section if current module isn't sampler to avoid pages logic mis-detecting
    const kind = getCurrentModuleKind();
    if (kind !== 4) {
      delete (base as any).sampler;
    }
    if (kind !== 1) delete (base as any).acid;
    if (kind !== 2) delete (base as any).karplus;
    if (kind !== 3) delete (base as any).resonator;
    ui = base as any;
    map[id] = ui;
    set({ synthUIById: { ...map } });
  } else {
    // If switching to a module that needs a section that was previously pruned, inject defaults now.
    const kind = getCurrentModuleKind();
    if (kind === 4 && !(ui as any).sampler) {
      (ui as any).sampler = { ...defaultSynthUI().sampler };
    } else if (kind === 1 && !(ui as any).acid) {
      (ui as any).acid = { ...(defaultSynthUI() as any).acid };
    } else if (kind === 2 && !(ui as any).karplus) {
      (ui as any).karplus = { ...(defaultSynthUI() as any).karplus };
    } else if (kind === 3 && !(ui as any).resonator) {
      (ui as any).resonator = { ...(defaultSynthUI() as any).resonator };
    }
  }
  return ui;
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
  const name = state.selectedSoundName || 'Electricity';
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
      // Persist selected Drubbles pack name if available (stored in per-sound UI)
      drum: (ui as any).drum && (ui as any).drum.current_pack ? { current_pack: (ui as any).drum.current_pack } : undefined,
      oscA: { shape: Math.round(ui.oscA.shape*7), detune_cents: detuneCents(ui.oscA.detune), fm_to_B: ui.oscA.fm, level: ui.oscA.level },
      oscB: { shape: Math.round(ui.oscB.shape*7), detune_cents: detuneCents(ui.oscB.detune), fm_to_A: ui.oscB.fm, level: ui.oscB.level },
      amp_env: { attack: envTimeFromNorm(ui.ampEnv.a), decay: envTimeFromNorm(ui.ampEnv.d), sustain: ui.ampEnv.s, release: envTimeFromNorm(ui.ampEnv.r) },
      mod_env: { attack: envTimeFromNorm(ui.modEnv.a), decay: envTimeFromNorm(ui.modEnv.d), sustain: ui.modEnv.s, release: envTimeFromNorm(ui.modEnv.r) },
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
      resonator: (ui as any).resonator ? {
        pitch: (ui as any).resonator.pitch ?? 0.5,
        decay: (ui as any).resonator.decay ?? 0.5,
        brightness: (ui as any).resonator.brightness ?? 0.5,
        bank_size: Math.round((ui as any).resonator.bank_size ?? 8),
        mode: Math.round((ui as any).resonator.mode ?? 0),
        inharmonicity: (ui as any).resonator.inharmonicity ?? 0.1,
        feedback: (ui as any).resonator.feedback ?? 0.0,
        drive: (ui as any).resonator.drive ?? 0.0,
        exciter_type: Math.round((ui as any).resonator.exciter_type ?? 0),
        exciter_amount: (ui as any).resonator.exciter_amount ?? 0.5,
        noise_color: (ui as any).resonator.noise_color ?? 0.5,
        strike_rate: (ui as any).resonator.strike_rate ?? 0.0,
        stereo_width: (ui as any).resonator.stereo_width ?? 0.5,
        randomize: (ui as any).resonator.randomize ?? 0.0,
        body_blend: (ui as any).resonator.body_blend ?? 0.4,
        output_gain: (ui as any).resonator.output_gain ?? 0.7,
      } : undefined,
      sampler: (ui as any).sampler ? {
        sample_start: (ui as any).sampler.sample_start ?? 0.0,
        sample_end: (ui as any).sampler.sample_end ?? 1.0,
        pitch_semitones: Math.round((ui as any).sampler.pitch_semitones ?? 0),
        pitch_cents: (ui as any).sampler.pitch_cents ?? 0.0,
        playback_mode: Math.round((ui as any).sampler.playback_mode ?? 0),
        loop_mode: Math.round((ui as any).sampler.loop_mode ?? 0),
        loop_start: (ui as any).sampler.loop_start ?? 0.2,
        loop_end: (ui as any).sampler.loop_end ?? 0.8,
        retrig_mode: Math.round((ui as any).sampler.retrig_mode ?? 0),
  current_sample: (ui as any).sampler.current_sample,
        // Convert normalized UI times (seconds mapper) to milliseconds for engine preset
  attack: envTimeMsFromNorm((ui as any).sampler.attack ?? 0.0),
  decay: envTimeMsFromNorm((ui as any).sampler.decay ?? 0.0),
  sustain: (ui as any).sampler.sustain ?? 1.0,
  release: envTimeMsFromNorm((ui as any).sampler.release ?? 0.0),
        gain: (ui as any).sampler.gain ?? 0.8,
      } : undefined,
    }
  };
}

// Convert milliseconds (preferred) or seconds (legacy) to normalized [0..1]
function invMapTimeMs(msOrSec: number): number {
  return envTimeNormFromMilliseconds(msOrSec);
}

function serializeCurrentPreset(): any {
  const ui = state.getSynthUI();
  return uiToSchema(ui);
}

let flushTimer: number | undefined;
state.serializeCurrentPreset = () => {
  try { return serializeCurrentPreset(); } catch { return undefined; }
};
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
  drum: { current_pack: preset.params?.drum?.current_pack },
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
    resonator: {
      pitch: p.resonator?.pitch ?? 0.5,
      decay: p.resonator?.decay ?? 0.5,
      brightness: p.resonator?.brightness ?? 0.5,
      bank_size: p.resonator?.bank_size ?? 8,
      mode: p.resonator?.mode ?? 0,
      inharmonicity: p.resonator?.inharmonicity ?? 0.1,
      feedback: p.resonator?.feedback ?? 0.0,
      drive: p.resonator?.drive ?? 0.0,
      exciter_type: p.resonator?.exciter_type ?? 0,
      exciter_amount: p.resonator?.exciter_amount ?? 0.5,
      noise_color: p.resonator?.noise_color ?? 0.5,
      strike_rate: p.resonator?.strike_rate ?? 0.0,
      stereo_width: p.resonator?.stereo_width ?? 0.5,
      randomize: p.resonator?.randomize ?? 0.0,
      body_blend: p.resonator?.body_blend ?? 0.4,
      output_gain: p.resonator?.output_gain ?? 0.7,
    },
    sampler: {
      sample_start: p.sampler?.sample_start ?? 0.0,
      sample_end: p.sampler?.sample_end ?? 1.0,
  pitch_semitones: p.sampler?.pitch_semitones ?? 0,
  pitch_cents: p.sampler?.pitch_cents ?? 0.0,
      playback_mode: p.sampler?.playback_mode ?? 0,
      loop_mode: p.sampler?.loop_mode ?? 0,
      loop_start: p.sampler?.loop_start ?? 0.2,
      loop_end: p.sampler?.loop_end ?? 0.8,
  retrig_mode: p.sampler?.retrig_mode ?? 0,
  current_sample: p.sampler?.current_sample,
      // Convert ms back to normalized knob value via shared envTime mapping
  attack: invMapTimeMs(p.sampler?.attack ?? 1.0),
  decay: invMapTimeMs(p.sampler?.decay ?? 1.0),
  sustain: p.sampler?.sustain ?? 1.0,
  release: invMapTimeMs(p.sampler?.release ?? 1.0),
      gain: p.sampler?.gain ?? 0.8,
    },
  }));
  // Pages may depend on sampler playback_mode (hide/show LOOP)
  try { state.refreshSynthPages?.(); } catch {}
  // Replay to engine
  const part = state.selectedSoundPart ?? 0;
  const pf = `part/${part}/`;
  try { await rpc.startAudio(); } catch {}
  const calls: Array<Promise<any>> = [];
  const send = (path: string, v: any) => calls.push(rpc.setParam(pf + path, v));
  // Drubbles: load saved drum pack first, if present
  try {
    const pack = p?.drum?.current_pack;
    if (typeof pack === 'string' && pack.length > 0) {
      await rpc.loadDrumPack(part, pack);
      // Also update UI drum sample list for display if available
      try { const samples = await rpc.listDrumSamples(pack); set({ drumSampleItems: samples, drumSampleSelected: 0 }); } catch {}
    }
  } catch (e) { console.error('applyPreset drum pack load failed', e); }
  // Module kind - also update UI state module hint
  if (typeof p.module_kind === 'number') {
    send(`module_kind`, { I32: p.module_kind });
    // Update moduleKindById for UI state consistency
    const soundId = state.selectedSoundId;
    if (soundId) {
      const map = state.moduleKindById || {};
      if (p.module_kind === 1) {
        map[soundId] = 'acid';
      } else if (p.module_kind === 2) {
        map[soundId] = 'karplus';
      } else if (p.module_kind === 3) {
        map[soundId] = 'resonator';
      } else if (p.module_kind === 4) {
        map[soundId] = 'sampler';
      } else {
        delete map[soundId]; // Remove hint for analog (default)
      }
      set({ moduleKindById: { ...map } });
    }
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
  // ResonatorBank macros
  if (p.resonator) {
    send(`resonator/pitch`, { F32: (p.resonator.pitch ?? 0.5) * 2 - 1 }); // Transform to ±1 range
    send(`resonator/decay`, { F32: p.resonator.decay ?? 0.5 });
    send(`resonator/brightness`, { F32: p.resonator.brightness ?? 0.5 });
    send(`resonator/bank_size`, { I32: Math.round(p.resonator.bank_size ?? 8) });
    send(`resonator/mode`, { I32: Math.round(p.resonator.mode ?? 0) });
    send(`resonator/inharmonicity`, { F32: p.resonator.inharmonicity ?? 0.1 });
    send(`resonator/feedback`, { F32: p.resonator.feedback ?? 0.0 });
    send(`resonator/drive`, { F32: p.resonator.drive ?? 0.0 });
    send(`resonator/exciter_type`, { I32: Math.round(p.resonator.exciter_type ?? 0) });
    send(`resonator/exciter_amount`, { F32: p.resonator.exciter_amount ?? 0.5 });
  // noise_color is stored UI 0..1; engine expects -1..+1
  send(`resonator/noise_color`, { F32: ((p.resonator.noise_color ?? 0.5) as number) * 2 - 1 });
  // strike_rate UI 0..1; engine maps to 0.5..10 Hz internally
  send(`resonator/strike_rate`, { F32: p.resonator.strike_rate ?? 0.0 });
    send(`resonator/stereo_width`, { F32: p.resonator.stereo_width ?? 0.5 });
    send(`resonator/randomize`, { F32: p.resonator.randomize ?? 0.0 });
    send(`resonator/body_blend`, { F32: p.resonator.body_blend ?? 0.4 });
    send(`resonator/output_gain`, { F32: p.resonator.output_gain ?? 0.7 });
  }
  // Sampler parameters
  if (p.sampler) {
    // Ensure the sample file is loaded first so params apply to correct buffer
    if (typeof p.sampler.current_sample === 'string' && p.sampler.current_sample.length > 0) {
      try { await rpc.loadSample(part, p.sampler.current_sample); } catch (e) { console.error('loadSample from preset failed', e); }
    }
    send(`sampler/sample_start`, { F32: p.sampler.sample_start ?? 0.0 });
    send(`sampler/sample_end`, { F32: p.sampler.sample_end ?? 1.0 });
    send(`sampler/pitch_semitones`, { F32: (p.sampler.pitch_semitones ?? 0) as number });
    send(`sampler/pitch_cents`, { F32: p.sampler.pitch_cents ?? 0.0 });
    send(`sampler/playback_mode`, { I32: Math.round(p.sampler.playback_mode ?? 0) });
    send(`sampler/loop_mode`, { I32: Math.round(p.sampler.loop_mode ?? 0) });
    send(`sampler/loop_start`, { F32: p.sampler.loop_start ?? 0.2 });
    send(`sampler/loop_end`, { F32: p.sampler.loop_end ?? 0.8 });
  if (typeof p.sampler.retrig_mode === 'number') {
      send(`sampler/retrig_mode`, { I32: Math.round(p.sampler.retrig_mode) });
    }
  send(`sampler/attack`, { F32: p.sampler.attack ?? 1.0 });
  send(`sampler/decay`, { F32: p.sampler.decay ?? 1.0 });
    send(`sampler/sustain`, { F32: p.sampler.sustain ?? 1.0 });
  send(`sampler/release`, { F32: p.sampler.release ?? 1.0 });
    send(`sampler/gain`, { F32: p.sampler.gain ?? 0.8 });
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
function invMapTime(sec: number): number { return envTimeNormFromSeconds(sec); }

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
  // Apply for Synth, Sampler, and Drubbles (Drum) kinds
    const kind = (s as any).type || (s as any).kind;
  if (kind !== 'Synth' && kind !== 'Sampler' && kind !== 'Drum' && kind !== 'DrumSampler') continue;
  const id = s.id; const part = (s as any).part_index ?? 0;
  // Ensure sequencer has correct part & kind before any UI mounts
  try { sequencerSetPart(id, part, (kind === 'Sampler') ? 'sampler' : (kind === 'Drum' || kind === 'DrumSampler') ? 'drum' : 'synth'); } catch {}
    const preset = await fsClient.loadSoundPreset(project, id);
    if (!preset || preset.schema !== 1) continue;
    
    // Apply to engine only (do not touch current UI selection here)
    try { await rpc.startAudio(); } catch {}
    const pf = `part/${part}/`;
    const p = preset.params || {};
  const set = (path: string, v: any) => rpc.setParam(pf + path, v);
    
    try {
      if (typeof p.module_kind === 'number') { await set(`module_kind`, { I32: p.module_kind }); }
      // If drum with a saved pack, load it first
      if (p.drum && typeof p.drum.current_pack === 'string' && p.drum.current_pack.length > 0) {
        try { await rpc.loadDrumPack(part, p.drum.current_pack); } catch (e) { console.error('preload drum pack failed', e); }
      }
      // If sampler with a saved file, load it first
      if (p.sampler && typeof p.sampler.current_sample === 'string' && p.sampler.current_sample.length > 0) {
        try { await rpc.loadSample(part, p.sampler.current_sample); } catch (e) { console.error('preload sampler file failed', e); }
      }
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
      for (let i=0;i<5;i++) {
        const lrow = p.mod?.lfo?.[i] || { dest:0, amount:1 };
        await set(`mod/lfo/row${i}/dest`, { I32: lrow.dest ?? 0 });
        await set(`mod/lfo/row${i}/amount`, { F32: (lrow.amount ?? 1.0) as number });
      }
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
      if (p.karplus) {
        await set(`ks/decay`, { F32: p.karplus.decay ?? 0.8 });
        await set(`ks/damp`, { F32: p.karplus.damp ?? 0.5 });
        await set(`ks/excite`, { F32: p.karplus.excite ?? 0.7 });
        await set(`ks/tune`, { F32: p.karplus.tune ?? 0.0 });
      }
      if (p.resonator) {
        await set(`resonator/pitch`, { F32: (p.resonator.pitch ?? 0.5) * 2 - 1 }); // Transform to ±1 range
        await set(`resonator/decay`, { F32: p.resonator.decay ?? 0.5 });
        await set(`resonator/brightness`, { F32: p.resonator.brightness ?? 0.5 });
        await set(`resonator/bank_size`, { I32: Math.round(p.resonator.bank_size ?? 8) });
        await set(`resonator/mode`, { I32: Math.round(p.resonator.mode ?? 0) });
        await set(`resonator/inharmonicity`, { F32: p.resonator.inharmonicity ?? 0.1 });
        await set(`resonator/feedback`, { F32: p.resonator.feedback ?? 0.0 });
        await set(`resonator/drive`, { F32: p.resonator.drive ?? 0.0 });
        await set(`resonator/exciter_type`, { I32: Math.round(p.resonator.exciter_type ?? 0) });
        await set(`resonator/exciter_amount`, { F32: p.resonator.exciter_amount ?? 0.5 });
  await set(`resonator/noise_color`, { F32: ((p.resonator.noise_color ?? 0.5) as number) * 2 - 1 });
  await set(`resonator/strike_rate`, { F32: p.resonator.strike_rate ?? 0.0 });
        await set(`resonator/stereo_width`, { F32: p.resonator.stereo_width ?? 0.5 });
        await set(`resonator/randomize`, { F32: p.resonator.randomize ?? 0.0 });
        await set(`resonator/body_blend`, { F32: p.resonator.body_blend ?? 0.4 });
        await set(`resonator/output_gain`, { F32: p.resonator.output_gain ?? 0.7 });
      }
      if (p.sampler) {
        await set(`sampler/sample_start`, { F32: p.sampler.sample_start ?? 0.0 });
        await set(`sampler/sample_end`, { F32: p.sampler.sample_end ?? 1.0 });
        await set(`sampler/pitch_semitones`, { F32: (p.sampler.pitch_semitones ?? 0) as number });
        await set(`sampler/pitch_cents`, { F32: p.sampler.pitch_cents ?? 0.0 });
        await set(`sampler/playback_mode`, { I32: Math.round(p.sampler.playback_mode ?? 0) });
        await set(`sampler/loop_mode`, { I32: Math.round(p.sampler.loop_mode ?? 0) });
        await set(`sampler/loop_start`, { F32: p.sampler.loop_start ?? 0.2 });
        await set(`sampler/loop_end`, { F32: p.sampler.loop_end ?? 0.8 });
        if (typeof p.sampler.retrig_mode === 'number') {
          await set(`sampler/retrig_mode`, { I32: Math.round(p.sampler.retrig_mode) });
        }
  await set(`sampler/attack`, { F32: p.sampler.attack ?? 1.0 });
  await set(`sampler/decay`, { F32: p.sampler.decay ?? 1.0 });
    await set(`sampler/sustain`, { F32: p.sampler.sustain ?? 1.0 });
  await set(`sampler/release`, { F32: p.sampler.release ?? 1.0 });
        await set(`sampler/gain`, { F32: p.sampler.gain ?? 0.8 });
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

// Sample browser functions
const openSampleBrowser = async () => {
  // Require selected sound to be sampler module
  const selectedSoundId = state.selectedSoundId;
  const moduleKindById = state.moduleKindById || {};
  const mk = selectedSoundId ? moduleKindById[selectedSoundId] : undefined;
  if (mk !== 'sampler') return; // silently ignore if not sampler
  try {
    const samples = await rpc.listSubsamples();
    set({ sampleBrowserOpen: true, sampleBrowserItems: samples, sampleBrowserSelected: 0 });
  } catch (e) {
    console.error('Failed to load samples:', e);
    set({ sampleBrowserOpen: true, sampleBrowserItems: [], sampleBrowserSelected: 0 });
  }
};

const closeSampleBrowser = () => {
  set({ sampleBrowserOpen: false });
};

// Assign to state
state.closeSampleBrowser = closeSampleBrowser;

const sampleBrowserMoveUp = () => {
  if (state.sampleBrowserItems.length === 0) return;
  const next = state.sampleBrowserSelected > 0 ? state.sampleBrowserSelected - 1 : 0;
  set({ sampleBrowserSelected: next });
};

const sampleBrowserMoveDown = () => {
  if (state.sampleBrowserItems.length === 0) return;
  const next = state.sampleBrowserSelected < state.sampleBrowserItems.length - 1 
    ? state.sampleBrowserSelected + 1 
    : state.sampleBrowserSelected;
  set({ sampleBrowserSelected: next });
};

const loadSelectedSample = async () => {
  if (state.sampleBrowserItems.length === 0) return;
  const selectedSample = state.sampleBrowserItems[state.sampleBrowserSelected];
  const part = state.selectedSoundPart ?? 0;
  
  try {
    // Load the sample into the current sampler part
    await rpc.loadSample(part, selectedSample);
    // Stash current sample path into synth UI state for waveform components
    if (state.selectedSoundId) {
      const uiMap = state.synthUIById || {};
      const ui = uiMap[state.selectedSoundId] ? { ...uiMap[state.selectedSoundId] } : defaultSynthUI();
      (ui as any).sampler = { ...(ui as any).sampler, current_sample: selectedSample };
      uiMap[state.selectedSoundId] = ui;
      set({ synthUIById: { ...uiMap }, synthUIVersion: (state.synthUIVersion||0)+1 });
      // Save preset immediately so the sample persists between sessions
      try {
        const preset = uiToSchema(ui as any);
        const proj = state.projectName; const id = state.selectedSoundId;
        if (proj && id) { await fsClient.saveSoundPreset(proj, id, preset); }
      } catch (e) { console.error('save preset with current_sample failed', e); }
    }
    closeSampleBrowser();
  } catch (e) {
    console.error('Failed to load sample:', e);
  }
};

const startRecording = async () => {
  // Only allow recording when selected module is sampler
  const selectedSoundId = state.selectedSoundId;
  const mk = selectedSoundId ? (state.moduleKindById || {})[selectedSoundId] : undefined;
  if (mk !== 'sampler') return;
  try {
    await rpc.startRecording();
    set({ isRecording: true });
  } catch (e) {
    console.error('Failed to start recording:', e);
  }
};

const stopRecording = async () => {
  // Gate stop as well (harmless if not sampler but consistent)
  const selectedSoundId = state.selectedSoundId;
  const mk = selectedSoundId ? (state.moduleKindById || {})[selectedSoundId] : undefined;
  if (mk !== 'sampler') return;
  try {
    await rpc.stopRecording();
    set({ isRecording: false });
  } catch (e) {
    console.error('Failed to stop recording:', e);
  }
};

// Export sample browser functions for external use
export const sampleBrowser = {
  openSampleBrowser,
  closeSampleBrowser,
  sampleBrowserMoveUp,
  sampleBrowserMoveDown,
  loadSelectedSample,
  startRecording,
  stopRecording,
};
