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
import SequencerRow from "./SequencerRow";
import { useSequencer } from "../store/sequencer";

export default function RightPane({ view }: { view: ViewName }) {
  const s = useBrowser();
  const { focus, level, items, selected, selectedSoundId, selectedSoundPart } = s as any;
  // Always call hooks; use a dummy id when none is selected to respect Rules of Hooks
  const seq = useSequencer(selectedSoundId || '__none__');
  const focused = focus === 'right';
  // Droplets removed

  // Droplets removed: no special Acid303 overlay

  // Droplets removed: no overlay triggers

  return (
  <div className={`panel right-pane ${focused ? 'focused' : ''}`} style={{ flex:1, height:'100%', minHeight:0, display:'flex', flexDirection:'column', fontFamily: "'Press Start 2P', monospace", overflow:'hidden' }}>
  {/* Droplets removed */}
      
      {view === 'Sounds' && (
        level === 'synth'
          ? (
            <div style={{ height:'100%', display:'flex', flexDirection:'column' }}>
              <div className="no-scrollbars" style={{ flex:1, minHeight:0, overflow:'auto' }}>
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
          ? (
            <div style={{ height:'100%', display:'flex', flexDirection:'column' }}>
              <div className="no-scrollbars" style={{ flex:1, minHeight:0, overflow:'auto' }}>
                <SequencerRow soundId={selectedSoundId} part={typeof selectedSoundPart === 'number' ? selectedSoundPart : 0} />
              </div>
            </div>
          )
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
  return <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', padding:'var(--space-4)' }}><div style={{ fontSize:16, textAlign:'center' }}>{children}</div></div>;
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
