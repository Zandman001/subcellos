import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type KnobProps = {
  label: string;
  value: number; // 0..1
  onChange: (v: number) => void;
  step?: number; // e.g., 4 for shapes
  format?: (v: number) => string;
  disabled?: boolean;
};

export default function Knob({ label, value, onChange, step, format, disabled }: KnobProps) {
  // Render as a vertical slider or stepped grid (no circular knob)
  const [v, setV] = useState<number>(clamp01(value));
  useEffect(() => setV(clamp01(value)), [value]);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startV = useRef(0);

  const quantize = useCallback((x: number) => {
    if (!step || step <= 1) return x;
    const idx = Math.round(x * (step - 1));
    return idx / (step - 1);
  }, [step]);

  const commit = useCallback((nv: number) => {
    const q = quantize(clamp01(nv));
    setV(q);
    onChange(q);
  }, [onChange, quantize]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (disabled) return;
    dragging.current = true;
    startY.current = e.clientY;
    startV.current = v;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current) return;
    const dy = startY.current - e.clientY; // up increases
    const nv = startV.current + dy * 0.003; // sensitivity
    commit(nv);
  };
  const onMouseUp = () => {
    dragging.current = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === '+' || e.key === '=' || e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      commit(v + (step ? 1 / (step - 1) : 0.02));
    } else if (e.key === '-' || e.key === '_' || e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      commit(v - (step ? 1 / (step - 1) : 0.02));
    }
  };

  const [flashTick, setFlashTick] = useState(0);
  useEffect(() => { setFlashTick((t)=>t+1); }, [value]);
  const valueText = format ? format(v) : `${Math.round(v * 100)}%`;
  const barH = 64, barW = 16;
  const filled = Math.round(v * barH);
  const blockH = 4; // blocky steps for retro feel
  const totalSteps = Math.max(1, Math.floor(barH / blockH));
  const litBlocks = Math.round((v) * totalSteps);

  return (
    <div className="ctrl" style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 76, opacity: disabled ? 0.5 : 1 }}>
      <div
        tabIndex={disabled ? -1 : 0}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        style={{ userSelect: 'none', outline: 'none', cursor: disabled ? 'default' : 'ns-resize' }}
      >
        {/* Slider track */}
        <div style={{ display:'flex', alignItems:'stretch', gap: 6 }}>
          <div style={{
            width: barW,
            height: barH,
            background: 'var(--neutral-1)',
            border: '1px solid var(--line)',
            boxSizing: 'border-box',
            position: 'relative'
          }}>
            <div style={{ position: 'absolute', inset: 2, display: 'flex', flexDirection: 'column-reverse' }}>
              {Array.from({ length: totalSteps }).map((_, i) => {
                const on = i < litBlocks;
                const intensity = on ? Math.min(1, (i + 1) / litBlocks) : 0;
                // Create a pattern for visual interest in monochrome
                const isPattern = (i % 3 === 0) && on;
                return (
                  <div key={i} style={{ 
                    height: blockH, 
                    marginBottom: i > 0 ? '1px' : '0',
                    background: on ? `rgba(var(--accent-rgb), ${0.3 + intensity * 0.7})` : 'transparent',
                    border: isPattern ? '1px solid var(--accent)' : 'none',
                    boxSizing: 'border-box'
                  }} />
                );
              })}
            </div>
            {/* Clean position indicator */}
            <div style={{ 
              position: 'absolute', 
              left: 2, 
              right: 2, 
              bottom: Math.max(2, filled - 1), 
              height: 2, 
              background: 'var(--accent)'
            }} />
          </div>
          {/* Clean meter strip with pattern */}
          <div style={{ 
            width: 3, 
            height: barH, 
            background: 'var(--neutral-1)', 
            border: '1px solid var(--line)', 
            boxSizing: 'border-box', 
            position: 'relative'
          }}>
            {/* Add dots pattern for visual interest */}
            {Array.from({ length: Math.floor(barH / 4) }).map((_, i) => (
              <div key={i} style={{
                position: 'absolute',
                left: 0,
                top: i * 4,
                width: 1,
                height: 1,
                background: 'var(--line)',
                opacity: 0.5
              }} />
            ))}
            <div style={{ 
              position: 'absolute', 
              left: 1, 
              bottom: 1, 
              width: 1, 
              height: Math.max(1, Math.round(v * (barH - 2))), 
              background: 'var(--accent-2)'
            }} />
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11, textAlign: 'center', whiteSpace: 'nowrap', color: 'var(--text-soft)', fontVariant: 'small-caps' }}>{label}</div>
      <div style={{ fontSize: 10, color: 'var(--accent)', animation: flashTick ? 'flash-value 250ms ease-out' : undefined as any }}>{valueText}</div>
    </div>
  );
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
