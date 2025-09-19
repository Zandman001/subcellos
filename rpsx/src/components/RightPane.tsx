import React from "react";
import { useBrowser } from "../store/browser";
import type { ViewName } from "../types/ui";
import SynthOSC from "./synth/SynthOSC";
import SynthENV from "./synth/SynthENV";
import SynthFILTER from "./synth/SynthFILTER";
import SynthLFO from "./synth/SynthLFO";
import SynthModMatrix from "./synth/SynthModMatrix";
import SynthFX from "./synth/SynthFX";
import SynthMIXER from "./synth/SynthMIXER";
import SynthEQView from "./synth/SynthEQView";
import Acid303 from "./synth/Acid303";
import StringTheory from "./synth/StringTheory";
import Mushrooms from "./synth/Mushrooms";
import Sampler from "./synth/Sampler";
import SamplerLoop from "./synth/SamplerLoop";
import SamplerEnvelope from "./synth/SamplerEnvelope";
import Drubbles from "./synth/Drubbles";
// WaterDroplets removed

export default function RightPane({ view }: { view: ViewName }) {
  const s = useBrowser();
  const { focus, level, items, selected, selectedSoundId } = s as any;
  const focused = focus === 'right';
  // Droplets removed

  // Droplets removed: no special Acid303 overlay

  // Droplets removed: no overlay triggers

  return (
    <div style={{
      flex: 1,
      border: '1px solid',
      borderColor: focused ? 'var(--accent)' : 'var(--line)',
      boxSizing: 'border-box',
      color: 'var(--text)',
  background: 'var(--bg)',
  fontFamily: "'Press Start 2P', monospace",
      height: '100%',
      padding: 0,
      position: 'relative',
      overflow: 'hidden',
    }}>
  {/* Droplets removed */}
      
      {view === 'Sounds' && (
        level === 'synth'
          ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ flex: 1 }}>
                {renderSynthPage(s.synthPages[s.synthPageIndex])}
              </div>
            </div>
          )
          : (level === 'pattern' && selectedSoundId && (s.selectedSoundName || items[selected]))
            ? null
            : <Center>Select a sound to start editing</Center>
      )}
      {view === 'Sequencer' && (
        level === 'pattern' && selectedSoundId && items[selected]
          ? <Center>Sequencer for {extractName(items[selected])}</Center>
          : <Center>Nothing to sequence, please select a sound</Center>
      )}
      {view === 'Arrangement' && (
        <div>Arrangement</div>
      )}
      {view === 'Perform' && (
        <div>Perform</div>
      )}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 16, textAlign: 'center' }}>{children}</div>
    </div>
  );
}

function extractName(label: string): string {
  const idx = label.indexOf(' (');
  return idx >= 0 ? label.slice(0, idx) : label;
}

function renderSynthPage(label: string): React.ReactNode {
  switch (label) {
    case 'ACID303': return <Acid303 />;
  case 'STRING THEORY': return <StringTheory />;
  case 'MUSHROOMS': return <Mushrooms />;
    case 'SAMPLER': return <Sampler />;
    case 'LOOP': return <SamplerLoop />;
    case 'ENVELOPE': return <SamplerEnvelope />;
  case 'DRUBBLES': return <Drubbles />;
    case 'OSC': return <SynthOSC />;
    case 'ENV': return <SynthENV />;
    case 'FILTER': return <SynthFILTER />;
    case 'LFO': return <SynthLFO />;
    case 'MOD': return <SynthModMatrix />;
    case 'FX': return <SynthFX />;
    case 'MIXER': return <SynthMIXER />;
    case 'EQ': return <SynthEQView />;
    default: return null;
  }
}
