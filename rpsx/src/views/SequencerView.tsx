import React from 'react';
import { useBrowser } from "../store/browser";
import SequencerRow from "../components/SequencerRow";
import { useSequencer } from "../store/sequencer";

export default function SequencerView() {
  const s = useBrowser() as any;
  const soundId = s.selectedSoundId as string | undefined;
  const part = s.selectedSoundPart as number | undefined;
  const seq = useSequencer(soundId || '__none__');
  return (
    <div className="view-container" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="view-title pixel-text" style={{ textAlign: 'center' }}>SEQUENCER</div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {soundId ? (
          <>
            {/* Transport controls */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, paddingBottom: 6 }}>
              <button className="tab" onClick={() => seq?.toggleLocalPlay()}>
                {seq?.playingLocal ? 'Pause Local' : 'Play Local'}
              </button>
              <button className="tab" onClick={() => seq?.toggleGlobalPlay()}>
                {seq?.playingGlobal ? 'Pause Global' : 'Play Global'}
              </button>
            </div>
            <SequencerRow soundId={soundId} part={typeof part === 'number' ? part : 0} />
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-soft)' }}>
            Select a sound in the left list (E/D) to sequence
          </div>
        )}
      </div>
    </div>
  )
}

