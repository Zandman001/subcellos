import React, { useRef } from 'react';
import { useGlitchFlash } from '../hooks/useGlitchFlash';

export interface ArkButtonProps {
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent)=>void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export const ArkButton: React.FC<ArkButtonProps> = ({ children, onClick, active=false, disabled=false, title, className='' }) => {
  const { ref, trigger } = useGlitchFlash();
  const onClickWrap = (e: React.MouseEvent) => {
    trigger();
    onClick?.(e);
  };
  return (
    <button
      className={`ark-btn ark-font ${active ? 'is-active': ''} ${disabled? 'is-disabled': ''} ${className}`}
      onClick={onClickWrap}
      disabled={disabled}
      title={title}
      onFocus={(e)=> e.currentTarget.classList.add('is-focus')}
      onBlur={(e)=> e.currentTarget.classList.remove('is-focus')}
      style={{ position:'relative' }}
    >
      {children}
      <div className="ark-glitch-layer" ref={ref as any} aria-hidden />
    </button>
  );
};
export default ArkButton;
