import React, { useCallback } from 'react';

export type ArkToggleState = 'off' | 'on' | 'alt';
export interface ArkToggleProps { state: ArkToggleState; onChange?: (s: ArkToggleState)=>void; disabled?: boolean; }

export const ArkToggle: React.FC<ArkToggleProps> = ({ state, onChange, disabled=false }) => {
  const cycle = useCallback(() => {
    if (disabled) return;
    const next = state === 'off' ? 'on' : state === 'on' ? 'alt' : 'off';
    onChange?.(next);
  }, [disabled, state, onChange]);
  const onKey = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      cycle();
    }
  }, [cycle, disabled]);
  return (
    <div
      className={`ark-toggle ${disabled? 'is-disabled': ''}`}
      data-state={state === 'off' ? 'off' : state === 'on' ? 'on' : 'alt'}
      onClick={cycle}
      role="switch"
      aria-checked={state !== 'off'}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={onKey}
      style={{ opacity: disabled? 0.4: 1 }}
      onFocus={(e)=> e.currentTarget.classList.add('is-focus')}
      onBlur={(e)=> e.currentTarget.classList.remove('is-focus')}
    />
  );
};
export default ArkToggle;
