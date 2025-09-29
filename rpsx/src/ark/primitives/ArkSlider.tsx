import React, { useCallback } from 'react';

export interface ArkSliderProps { value: number; onChange?: (v:number)=>void; disabled?: boolean; width?: number; }
export const ArkSlider: React.FC<ArkSliderProps> = ({ value, onChange, disabled=false, width=80 }) => {
  const clamp = (x:number)=> Math.max(0, Math.min(1, x));
  const onPointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const v = clamp((e.clientX - rect.left) / rect.width);
    onChange?.(v);
  }, [onChange, disabled]);
  const stepSmall = 1/32;
  const stepLarge = 1/8;
  const onKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next = value;
    switch (e.key) {
      case 'ArrowLeft': case 'ArrowDown': next = value - stepSmall; break;
      case 'ArrowRight': case 'ArrowUp': next = value + stepSmall; break;
      case 'PageDown': next = value - stepLarge; break;
      case 'PageUp': next = value + stepLarge; break;
      case 'Home': next = 0; break;
      case 'End': next = 1; break;
      default: return;
    }
    e.preventDefault();
    onChange?.(clamp(next));
  }, [disabled, value, onChange]);
  return (
    <div
      className={`ark-slider ${disabled? 'is-disabled': ''}`}
      style={{ width }}
      onPointerDown={onPointer}
      onPointerMove={(e)=> e.buttons===1 && onPointer(e)}
      tabIndex={0}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={Number.isFinite(value) ? Number(value.toFixed(3)) : 0}
      aria-disabled={disabled}
      onKeyDown={onKey}
      onFocus={(e)=> e.currentTarget.classList.add('is-focus')}
      onBlur={(e)=> e.currentTarget.classList.remove('is-focus')}
    >
      <div className="ark-slider-rail" />
      <div className="ark-slider-handle" style={{ left: `calc(${(value*100).toFixed(2)}% - 3px)` }} />
    </div>
  );
};
export default ArkSlider;
