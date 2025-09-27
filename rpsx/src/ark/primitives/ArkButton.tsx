import React from 'react';

export interface ArkButtonProps {
  children?: React.ReactNode;
  onClick?: (e: React.MouseEvent)=>void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}

export const ArkButton: React.FC<ArkButtonProps> = ({ children, onClick, active=false, disabled=false, title, className='' }) => {
  return (
    <button
      className={`ark-btn ark-font ${active ? 'is-active': ''} ${disabled? 'is-disabled': ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >{children}</button>
  );
};
export default ArkButton;
