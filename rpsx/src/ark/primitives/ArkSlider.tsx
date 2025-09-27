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
  return (
    <div className={`ark-slider ${disabled? 'is-disabled': ''}`} style={{ width }} onPointerDown={onPointer} onPointerMove={(e)=> e.buttons===1 && onPointer(e)}>
      <div className="ark-slider-rail" />
      <div className="ark-slider-handle" style={{ left: `calc(${(value*100).toFixed(2)}% - 3px)` }} />
    </div>
  );
};
export default ArkSlider;
