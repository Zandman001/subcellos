import React, { useCallback, useEffect, useRef, useState } from 'react'

type KnobProps = {
  label: string;
  value: number; // 0..1
  onChange: (v: number) => void;
  step?: number; // e.g., 4 for shapes
  format?: (v: number) => string;
  disabled?: boolean;
  dragScale?: number; // optional scaling of drag sensitivity (multiplies baseline)
  inactive?: boolean; // visually dim, still interactive
  infinite?: boolean; // if true, don't capture; accumulate deltas endlessly
  onStepClick?: (dir: -1 | 1) => void; // click steppy: left/right click
};

export default function Knob({ label, value, onChange, step, format, disabled, dragScale, inactive, infinite, onStepClick }: KnobProps) {
  // Round knob with radial ticks & pointer
  const [v, setV] = useState<number>(clamp01(value));
  useEffect(() => setV(clamp01(value)), [value]);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startV = useRef(0);
  const ANG_MIN = -135;
  const ANG_MAX = 135;

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
    if (e.button === 0) {
      dragging.current = true;
      startY.current = e.clientY;
      startV.current = v;
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    } else if (onStepClick && (e.button === 2 || e.button === 1)) {
      // middle/right click steps down/up
      e.preventDefault();
      onStepClick(e.button === 2 ? -1 : 1);
    }
  };
  const onContextMenu = (e: React.MouseEvent) => { if (onStepClick) e.preventDefault(); };
  const onMouseMove = (e: MouseEvent) => {
    if (!dragging.current) return;
    const dy = startY.current - e.clientY;
    const base = e.shiftKey ? 0.001 : 0.003;
    const scale = (dragScale === undefined ? 1 : dragScale);
    const sensitivity = base * scale;
    const nv = (infinite ? v : startV.current) + dy * sensitivity;
    commit(nv);
  };
  const onMouseUp = () => {
    dragging.current = false;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (disabled) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.0006; // fine tuning
    commit(v + delta);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const stepSize = step ? 1 / (step - 1) : 0.02;
    if (['+', '=', 'ArrowUp', 'ArrowRight'].includes(e.key)) { e.preventDefault(); commit(v + stepSize); }
    else if (['-', '_', 'ArrowDown', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); commit(v - stepSize); }
    else if (e.key === 'Home') { e.preventDefault(); commit(0); }
    else if (e.key === 'End') { e.preventDefault(); commit(1); }
  };

  const [flashTick, setFlashTick] = useState(0);
  useEffect(() => { setFlashTick(t => t + 1); }, [value]);
  const valueText = format ? format(v) : `${Math.round(v * 100)}%`;
  const angle = ANG_MIN + v * (ANG_MAX - ANG_MIN);
  const ticks = 24; // fixed total ticks
  const activeTicks = Math.round(v * (ticks - 1));
  const showSteps = !!step && step > 1;
  const stepTicks = step ? Array.from({ length: step }, (_, i) => i / (step - 1)) : [];

  return (
  <div className={`ctrl${inactive ? ' inactive' : ''}`} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 72, opacity: disabled ? 0.5 : 1 }}>
      <div
        className="knob-shell"
        tabIndex={disabled ? -1 : 0}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(v.toFixed(3))}
        aria-label={label}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onWheel={onWheel}
        style={{ cursor: disabled ? 'default' : 'grab' }}
        onContextMenu={onContextMenu}
      >
        <div className="knob-face">
          {/* tick ring */}
          <div className="knob-ticks">
            {Array.from({ length: ticks }).map((_, i) => {
              const tNorm = i / (ticks - 1);
              const a = ANG_MIN + tNorm * (ANG_MAX - ANG_MIN);
              const on = i <= activeTicks;
              return (
                <div
                  key={i}
                  className="knob-tick"
                  style={{
                    // Single translation outward from center – no extra negative margins in CSS now
                    transform: `rotate(${a}deg) translateY(-22px)`,
                    opacity: on ? 1 : 0.15,
                  }}
                />
              );
            })}
            {showSteps && stepTicks.map((sv, i) => {
              const a = ANG_MIN + sv * (ANG_MAX - ANG_MIN);
              return <div key={"s"+i} className="knob-step" style={{ transform: `rotate(${a}deg) translateY(-20px)` }} />
            })}
          </div>
          {/* pointer */}
          <div className="knob-pointer" style={{ transform: `rotate(${angle}deg)` }} />
          <div className="knob-center" />
        </div>
      </div>
      <div style={{ fontSize: 11, textAlign: 'center', whiteSpace: 'nowrap', color: 'var(--text-soft)', fontVariant: 'small-caps' }}>{label}</div>
      <div style={{ fontSize: 10, color: 'var(--accent)', animation: flashTick ? 'flash-value 250ms ease-out' : undefined as any }}>{valueText}</div>
    </div>
  );
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, n)); }
