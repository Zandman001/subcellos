import React from "react";
import { useBrowser } from "../store/browser";

export default function ProjectBrowser() {
  const state = useBrowser() as any;
  const focused = state.focus === "browser";
  // Build breadcrumb: Project › Pattern › Sound (omit missing). If no project yet, show 'Projects'.
  const crumbs: string[] = [];
  if (state.projectName) {
    crumbs.push(state.projectName);
    if (state.patternName) crumbs.push(state.patternName);
    if (state.patternName && state.selectedSoundName) crumbs.push(state.selectedSoundName);
  } else {
    crumbs.push('Projects');
  }

  return (
    <div
      style={{
        width: '25%',
        border: '1px solid',
        borderColor: focused ? 'var(--accent)' : 'var(--line)',
        boxSizing: 'border-box',
        color: 'var(--text)',
        background: 'var(--bg)',
        fontFamily: "'Press Start 2P', monospace",
        height: '100%',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div
        style={{
          padding: '8px 10px',
          borderBottom: '1px solid var(--line)',
          background: 'transparent',
          fontSize: 10,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        {crumbs.map((c, i) => (
          <React.Fragment key={c + i}>
            <span
              style={{
                color:
                  i === crumbs.length - 1 && state.selectedSoundName && c === state.selectedSoundName
                    ? 'var(--accent)'
                    : 'var(--text-soft)'
              }}
            >
              {c}
            </span>
            {i < crumbs.length - 1 && (
              <span style={{ margin: '0 6px', opacity: 0.6 }}>›</span>
            )}
          </React.Fragment>
        ))}
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {state.items.map((label: string, i: number) => (
          <div
            key={label + i}
            style={{
              padding: '6px 8px',
              borderBottom: '1px solid var(--line)',
              background: i === state.selected ? 'var(--accent)' : 'transparent',
              color: i === state.selected ? 'var(--bg)' : 'var(--text)',
              fontWeight: i === state.selected ? 'bold' : 'normal'
            }}
          >
            <span className={i === state.selected ? 'blink-cursor' : (undefined as any)}>{label}</span>
          </div>
        ))}
        {state.items.length === 0 && (
          <div style={{ padding: 8, color: 'var(--text-soft)' }}>(empty)</div>
        )}
      </div>
      <div
        style={{
          borderTop: '1px solid var(--line)',
          padding: '8px 10px',
          color: 'var(--text-soft)',
          background: 'transparent',
          fontSize: '10px'
        }}
      >
        <span>E↑ D↓ S← F→</span>
        <span style={{ margin: '0 8px' }}>·</span>
        <span>W◀ R▶</span>
        <span style={{ margin: '0 8px' }}>·</span>
        <span style={{ color: state.level === 'synth' ? 'var(--line)' : 'var(--text)' }}>Q add · A delete</span>
      </div>
      {state.level === 'pattern' && state.modulePickerOpen && (
        <div
          style={{
            position: 'absolute',
            top: 48,
            left: '10%',
            width: '80%',
            border: '1px solid var(--line)',
            background: 'var(--bg)',
            color: 'var(--text)',
            boxShadow: '0 0 0 2px var(--bg)'
          }}
        >
          {['Electricity', 'Acid 303', 'String Theory', 'Mushrooms', 'Sampler', 'Drubbles'].map(
            (name, i) => {
              const sel = i === state.modulePickerIndex;
              return (
                <div
                  key={name}
                  style={{
                    padding: '6px 8px',
                    borderBottom: '1px solid var(--line)',
                    background: sel ? '#ffffff' : 'transparent',
                    color: sel ? '#000000' : 'var(--text)',
                    fontWeight: sel ? 'bold' : 'normal',
                    transition: 'background 80ms linear, color 80ms linear'
                  }}
                >
                  {name}
                </div>
              );
            }
          )}
          <div
            style={{
              padding: 6,
              color: 'var(--text-soft)',
              borderTop: '1px solid var(--line)',
              textAlign: 'center'
            }}
          >
            Q to add · A to cancel
          </div>
        </div>
      )}

      {state.confirmOpen && (
        <div
          style={{
            position: 'absolute',
            top: 72,
            left: '10%',
            width: '80%',
            border: '1px solid var(--accent-2)',
            background: 'var(--bg)',
            color: 'var(--text)',
            boxShadow: '0 0 0 2px var(--bg)'
          }}
        >
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
            Confirm delete {state.confirmKind}: {state.confirmLabel}
          </div>
          <div
            style={{
              padding: '6px 10px',
              color: 'var(--text-soft)',
              textAlign: 'center',
              borderTop: '1px solid var(--line)'
            }}
          >
            Q confirm · A cancel
          </div>
        </div>
      )}
    </div>
  );
}
