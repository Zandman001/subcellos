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
import { KarplusStrong } from "./synth/KarplusStrong";
import ResonatorBank from "./synth/ResonatorBank";
import Sampler from "./synth/Sampler";
import SamplerLoop from "./synth/SamplerLoop";
import SamplerEnvelope from "./synth/SamplerEnvelope";
import WaterDroplets from "./effects/WaterDroplets";

export default function RightPane({ view }: { view: ViewName }) {
  const s = useBrowser();
  const { focus, level, items, selected, selectedSoundId } = s as any;
  const focused = focus === 'right';
  const [dropletTriggerCount, setDropletTriggerCount] = React.useState(0);

  // Check if we're in the Acid303 tab
  const isAcid303Tab = view === 'Sounds' && 
                      level === 'synth' && 
                      s.synthPages[s.synthPageIndex] === 'ACID303';

  // Listen for note events to trigger droplets
  React.useEffect(() => {
    if (!isAcid303Tab) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger for preview keys when in synth level
      if (s.level === 'synth' && (e.key === 'q' || e.key === 'a')) {
        // Ignore repeated keydown events when holding the key
        if (e.repeat) return;
        
        const count = 2 + Math.floor(Math.random() * 3);
        setDropletTriggerCount(prev => prev + count);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isAcid303Tab, s.level]);

  return (
    <div style={{
      flex: 1,
      border: '1px solid',
      borderColor: focused ? 'var(--accent)' : 'var(--line)',
      boxSizing: 'border-box',
      color: 'var(--text)',
      background: 'var(--bg)',
      fontFamily: 'monospace',
      height: '100%',
      padding: 0,
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Water droplets effect - only visible in Acid303 tab */}
      <WaterDroplets 
        isActive={isAcid303Tab} 
        triggerCount={dropletTriggerCount}
      />
      
      {view === 'Sounds' && (
        level === 'synth'
          ? (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 12, paddingBottom: 8 }}>
                editing {s.selectedSoundName ? extractName(s.selectedSoundName) : ''} 
                · {s.synthPages[s.synthPageIndex]}
              </div>
              <div style={{ flex: 1 }}>
                {renderSynthPage(s.synthPages[s.synthPageIndex])}
              </div>
            </div>
          )
          : (level === 'pattern' && selectedSoundId && (s.selectedSoundName || items[selected]))
            ? (
              <div style={{ fontSize: 12 }}>
                editing {extractName(s.selectedSoundName || items[selected])}
              </div>
            )
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
    case 'KARPLUS': return <KarplusStrong />;
    case 'RESONATOR': return <ResonatorBank />;
    case 'SAMPLER': return <Sampler />;
    case 'LOOP': return <SamplerLoop />;
    case 'ENVELOPE': return <SamplerEnvelope />;
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
