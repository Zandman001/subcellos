import React, { useEffect, useRef, useState } from "react";
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

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const selRef = useRef<HTMLDivElement | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Keep selected item in view on selection change
  useEffect(() => {
    const c = scrollRef.current;
    const sel = selRef.current;
    if (!c || !sel) return;
    const cb = c.getBoundingClientRect();
    const sb = sel.getBoundingClientRect();
    if (sb.top < cb.top) {
      c.scrollTop += (sb.top - cb.top) - 8; // scroll up with small padding
    } else if (sb.bottom > cb.bottom) {
      c.scrollTop += (sb.bottom - cb.bottom) + 8; // scroll down with small padding
    }
  }, [state.selected, state.items.length]);

  // Detect if there is more content below the visible area
  useEffect(() => {
    const c = scrollRef.current;
    if (!c) return;
    const update = () => {
      const hasMore = c.scrollTop + c.clientHeight < c.scrollHeight - 1; // allow 1px tolerance
      setShowScrollDown(hasMore);
    };
    update();
    const onScroll = () => update();
    window.addEventListener('resize', update);
    c.addEventListener('scroll', onScroll);
    return () => { c.removeEventListener('scroll', onScroll); window.removeEventListener('resize', update); };
  }, [state.items.length]);

  return (
  <div className={`panel ${focused ? 'focused' : ''}`} style={{ width: '25%', height: '100%', display:'flex', flexDirection:'column', fontFamily: "'Press Start 2P', monospace", minHeight: 0 }}>
  <div ref={scrollRef} className="panel-scroll no-scrollbars" style={{ flex: 1, minHeight: 0, overflow: 'auto', position:'relative' }}>
        {state.items.map((label: string, i: number) => {
          const active = i === state.selected;
          return (
            <div ref={active ? selRef : undefined} key={label + i} className={`list-item ${active ? 'active' : ''}`}>
              <span className={active ? 'blink-cursor' : undefined as any}>{label}</span>
            </div>
          );
        })}
        {state.items.length === 0 && (
          <div className="list-item muted" style={{ borderBottom: 'none' }}>(empty)</div>
        )}
      </div>
      {/* Overlay scroll indicator (outside scroller, pinned to bottom of visible area) */}
      {showScrollDown && (
        <div className="scroll-indicator" aria-hidden="true">
          <div className="scroll-indicator__arrow" />
        </div>
      )}
      {/* Footer legend removed per request */}
      {state.level === 'pattern' && state.modulePickerOpen && (
        <div className="overlay-box fade-in" style={{ top: 48, maxHeight: '60%', overflow: 'auto' }}>
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
        <div className="overlay-box danger fade-in" style={{ top: 72, maxHeight: '60%', overflow: 'auto' }}>
          <div className="overlay-header">Confirm delete {state.confirmKind}: {state.confirmLabel}</div>
          <div className="overlay-footer">Q confirm · A cancel</div>
        </div>
      )}
    </div>
  );
}
