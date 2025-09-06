import React from "react";
import { useBrowser } from "../store/browser";

export default function ProjectBrowser() {
  const state = useBrowser() as any;
  const focused = state.focus === "browser";
  return (
    <div
      style={{
        width: "25%",
        border: "2px solid",
        borderColor: focused ? "var(--accent)" : "var(--line)",
        boxSizing: "border-box",
        color: "var(--text)",
        background: "rgba(var(--neutral-1), 0.6)",
        backdropFilter: "blur(15px)",
        fontFamily: "monospace",
        height: "100%",
        position: "relative",
        boxShadow: focused ? "0 0 20px rgba(var(--accent-rgb), 0.4)" : "0 0 10px rgba(0,0,0,0.3)",
      }}
   >
      <div style={{ 
        padding: 8, 
        borderBottom: "2px solid var(--accent)",
        background: "rgba(var(--accent-rgb), 0.1)",
        textShadow: "0 0 5px rgba(var(--accent-rgb), 0.5)"
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
              background: i === state.selected ? "rgba(var(--accent-rgb), 0.14)" : "transparent",
              color: i === state.selected ? "var(--text)" : "var(--text)",
            }}
          >
            <span className={i === state.selected ? 'blink-cursor' : undefined as any}>{label}</span>
          </div>
        ))}
        {state.items.length === 0 && (
          <div style={{ padding: 8, color: "#aaa" }}>(empty)</div>
        )}
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: '1px solid var(--line)', padding: '6px 8px', color: 'var(--text)', background: 'var(--bg)' }}>
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
          boxShadow: '0 0 0 2px #000',
        }}>
          {["Analog Synth", "Acid 303", "KarplusStrong", "Sampler", "Drum"].map((name, i) => (
            <div key={name} style={{
              padding: '6px 8px',
              borderBottom: '1px solid var(--line)',
              background: i === state.modulePickerIndex ? 'rgba(var(--accent-rgb), 0.14)' : 'transparent',
              color: i === state.modulePickerIndex ? 'var(--text)' : 'var(--text)',
            }}>
              {name}
            </div>
          ))}
          <div style={{ padding: 6, color: '#aaa', borderTop: '1px solid #333', textAlign: 'center' }}>
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
          boxShadow: '0 0 0 2px #000',
        }}>
          <div style={{ padding: '8px 10px', borderBottom: '1px solid #333' }}>
            Confirm delete {state.confirmKind}: {state.confirmLabel}
          </div>
          <div style={{ padding: '6px 10px', color: '#aaa', textAlign: 'center', borderTop: '1px solid #333' }}>
            Q confirm · A cancel
          </div>
        </div>
      )}
    </div>
  );
}
