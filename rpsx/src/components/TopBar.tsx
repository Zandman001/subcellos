import React, { useEffect, useState } from 'react'
import { rpc } from '../rpc'
import type { ViewName } from '../types/ui'
import { useBrowser } from '../store/browser'
import { useSequencer } from '../store/sequencer'

type Props = {
  active: ViewName
  onSelect: (v: ViewName) => void
}

const NAV_HINT = '3=Prev / 4=Next';
const TABS: Array<{ key: ViewName; label: string; hotkey: string }> = [
  { key: 'Sounds',     label: 'SOUNDS',      hotkey: NAV_HINT },
  { key: 'Sequencer',  label: 'SEQUENCER',   hotkey: NAV_HINT },
  { key: 'Arrangement',label: 'ARRANGEMENT', hotkey: NAV_HINT },
  { key: 'Perform',    label: 'PERFORM',     hotkey: NAV_HINT },
]

export default function TopBar({ active, onSelect }: Props) {
  const s: any = useBrowser();
  const selectedSoundId = s?.selectedSoundId || '__none__';
  const seq = useSequencer(selectedSoundId);
  // Mirror transport globally to control icon independently of selectedSound
  const [transport, setTransport] = useState<{ globalPlaying: boolean; localPlayingId?: string }>({ globalPlaying: false });
  useEffect(() => {
    const h = (e: any) => {
      const d = e?.detail || {};
      setTransport({ globalPlaying: !!d.globalPlaying, localPlayingId: d.localPlayingId });
    };
    window.addEventListener('seq-transport', h as any);
    return () => window.removeEventListener('seq-transport', h as any);
  }, []);
  const isGlobal = transport.globalPlaying || !!seq.playingGlobal;
  const localActive = !!transport.localPlayingId || (!!seq.playingLocal && !isGlobal);
  // Hide pause animation for local when not on Sounds view
  const showLocalAsPlaying = active === 'Sounds' && localActive && !isGlobal;
  const isLocal = showLocalAsPlaying;
  const fill = isLocal ? '#666' : '#000';
  const handleClick = () => {
    try {
      // If global is running, pause it
      if (isGlobal) { seq.toggleGlobalPlay?.(); return; }
      // If local is running (for selected), stop it
      if (isLocal) { seq.toggleLocalPlay?.(); return; }
      // Otherwise: in Sounds view, start local for selected sound; elsewhere, start global
      if (active === 'Sounds') {
        const st = s as any;
        const sid = st.selectedSoundId;
        if (sid) {
          const part = st.selectedSoundPart;
          if (typeof part === 'number') seq.setPart?.(part);
          const mk = st.moduleKindById?.[sid];
          if (mk === 'drum') seq.setModuleKind?.('drum');
          else if (mk === 'sampler') seq.setModuleKind?.('sampler');
          else seq.setModuleKind?.('synth');
          seq.toggleLocalPlay?.();
          return;
        }
      }
      // In other views, toggle global
      seq.toggleGlobalPlay?.();
    } catch {}
  };
  // Removed legacy low-contrast & ark toggles; UI now always Ark-styled.
  return (
    <div className="topbar pixel-text" role="tablist" aria-label="Views">
      <div className="topbar-tabs" style={{ display:'flex', alignItems:'stretch' }}>
        {TABS.map(t => {
          const isActive = t.key === active
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={isActive}
              className={`tab ${isActive ? 'active' : ''}`}
              onClick={() => onSelect(t.key)}
              tabIndex={0}
              title={`${t.label} [${t.hotkey}]`}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div style={{ flex:1 }} />
      {/* Global Play/Pause */}
      <button
        onClick={handleClick}
        aria-label={isGlobal ? 'Pause' : (isLocal ? 'Stop Local' : (active === 'Sounds' ? 'Play Local' : 'Play'))}
        title={isGlobal ? 'Pause [U]' : (isLocal ? 'Stop Local [I]' : (active === 'Sounds' ? 'Play Local [I]' : 'Play [U]'))}
        style={{
          marginRight: 8,
          alignSelf: 'center',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 28, height: 28,
          background: 'transparent', border: 'none', color: '#000',
          cursor: 'pointer', padding: 0,
        }}
      >
  {isGlobal || isLocal ? (
          <svg width="18" height="18" viewBox="0 0 14 14" aria-hidden="true" style={{ display:'block' }}>
            <rect x="2" y="2" width="3" height="10" fill={fill} />
            <rect x="9" y="2" width="3" height="10" fill={fill} />
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 14 14" aria-hidden="true" style={{ display:'block' }}>
            <polygon points="3,2 12,7 3,12" fill="#000" />
          </svg>
        )}
      </button>
    </div>
  )
}
