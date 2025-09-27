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
    <div className={`panel ${focused ? 'focused' : ''}`} style={{ width: '25%', height: '100%', display:'flex', flexDirection:'column', fontFamily: "'Press Start 2P', monospace" }}>
      <div className="panel-header breadcrumb" title={crumbs.join(' / ')}>
        {crumbs.map((c, i) => (
          <React.Fragment key={c + i}>
            <span className={`breadcrumb-item ${i === crumbs.length - 1 ? 'final' : ''}`}>{c}</span>
            {i < crumbs.length - 1 && <span className="breadcrumb-sep">›</span>}
          </React.Fragment>
        ))}
      </div>
      <div className="panel-scroll" style={{ flex: 1 }}>
        {state.items.map((label: string, i: number) => {
          const active = i === state.selected;
          return (
            <div key={label + i} className={`list-item ${active ? 'active' : ''}`}>
              <span className={active ? 'blink-cursor' : undefined as any}>{label}</span>
            </div>
          );
        })}
        {state.items.length === 0 && (
          <div className="list-item muted" style={{ borderBottom: 'none' }}>(empty)</div>
        )}
      </div>
      <div className="panel-footer">
        <span>E↑ D↓ S← F→</span><span>·</span><span>W◀ R▶</span><span>·</span>
        <span style={{ color: state.level === 'synth' ? 'var(--line)' : 'var(--text)' }}>Q add · A delete</span>
      </div>
      {state.level === 'pattern' && state.modulePickerOpen && (
        <div className="overlay-box fade-in" style={{ top: 48 }}>
          {['Electricity', 'Acid 303', 'String Theory', 'Mushrooms', 'Sampler', 'Drubbles'].map((name, i) => {
            const sel = i === state.modulePickerIndex;
            return (
              <div key={name} className={`picker-item ${sel ? 'selected' : ''}`}>{name}</div>
            );
          })}
          <div className="overlay-footer">Q to add · A to cancel</div>
        </div>
      )}

      {state.confirmOpen && (
        <div className="overlay-box danger fade-in" style={{ top: 72 }}>
          <div className="overlay-header">Confirm delete {state.confirmKind}: {state.confirmLabel}</div>
          <div className="overlay-footer">Q confirm · A cancel</div>
        </div>
      )}
    </div>
  );
}
