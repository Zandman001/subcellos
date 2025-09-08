import React from "react";
import { useBrowser } from "../store/browser";

export default function ProjectBrowser() {
  const state = useBrowser() as any;
  const focused = state.focus === "browser";
  return (
    <div
      style={{
        width: "25%",
        border: "1px solid",
        borderColor: focused ? "var(--accent)" : "var(--line)",
        boxSizing: "border-box",
        color: "var(--text)",
        background: "var(--neutral-1)",
        fontFamily: "monospace",
        height: "100%",
        position: "relative",
      }}
   >
      <div style={{ 
        padding: 10, 
        borderBottom: "1px solid var(--line)",
        background: "var(--neutral-2)"
      }}>
        <div>Level: {state.level}</div>
        {state.projectName && <div>Project: {state.projectName}</div>}
        {state.patternName && <div>Pattern: {state.patternName}</div>}
      </div>
      <div style={{ overflowY: "auto", height: "calc(100% - 84px)" }}>
        {state.items.map((label: string, i: number) => (
          <div
            key={label + i}
            style={{
              padding: "6px 8px",
              borderBottom: "1px solid var(--line)",
              background: i === state.selected ? "var(--accent)" : "transparent",
              color: i === state.selected ? "var(--bg)" : "var(--text)",
              fontWeight: i === state.selected ? "bold" : "normal",
            }}
          >
            <span className={i === state.selected ? 'blink-cursor' : undefined as any}>{label}</span>
          </div>
        ))}
        {state.items.length === 0 && (
          <div style={{ padding: 8, color: "var(--text-soft)" }}>(empty)</div>
        )}
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: '1px solid var(--line)', padding: '8px 10px', color: 'var(--text-soft)', background: 'var(--neutral-2)', fontSize: '10px' }}>
        <span>E↑ D↓ S← F→</span>
        <span style={{ margin: '0 8px' }}>·</span>
        <span>W◀ R▶</span>
        <span style={{ margin: '0 8px' }}>·</span>
        <span style={{ color: state.level === 'synth' ? 'var(--line)' : 'var(--text)' }}>Q add · A delete</span>
      </div>
      {state.level === 'pattern' && state.modulePickerOpen && (
        <div style={{
          position: 'absolute',
          top: 60,
          left: '10%',
          width: '80%',
          border: '1px solid var(--line)',
          background: 'var(--bg)',
          color: 'var(--text)',
          boxShadow: '0 0 0 2px var(--bg)',
        }}>
          {["Analog Synth", "Acid 303", "KarplusStrong", "ResonatorBank", "Sampler", "Drum"].map((name, i) => (
            <div key={name} style={{
              padding: '6px 8px',
              borderBottom: '1px solid var(--line)',
              background: i === state.modulePickerIndex ? 'rgba(var(--accent-rgb), 0.14)' : 'transparent',
              color: i === state.modulePickerIndex ? 'var(--text)' : 'var(--text)',
            }}>
              {name}
            </div>
          ))}
          <div style={{ padding: 6, color: 'var(--text-soft)', borderTop: '1px solid var(--line)', textAlign: 'center' }}>
            Q to add · A to cancel
          </div>
        </div>
      )}

      {state.confirmOpen && (
        <div style={{
          position: 'absolute',
          top: 80,
          left: '10%',
          width: '80%',
          border: '1px solid var(--accent-2)',
          background: 'var(--bg)',
          color: 'var(--text)',
          boxShadow: '0 0 0 2px var(--bg)',
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
            Confirm delete {state.confirmKind}: {state.confirmLabel}
          </div>
          <div style={{ padding: '6px 10px', color: 'var(--text-soft)', textAlign: 'center', borderTop: '1px solid var(--line)' }}>
            Q confirm · A cancel
          </div>
        </div>
      )}
    </div>
  );
}
