import React from 'react';
import '../../ark/ark1bit.css';
import '../../ark/font.css';

export interface ArkSurfaceProps {
  children?: React.ReactNode;
  padded?: boolean;
  focus?: boolean;
  className?: string;
  style?: React.CSSProperties;
  role?: string;
}

export const ArkSurface: React.FC<ArkSurfaceProps> = ({ children, padded = true, focus = false, className = '', style, role }) => {
  return (
    <div
      className={`ark-surface ark-font ${focus ? 'is-focus' : ''} ${className}`}
      style={{ border: '1px solid #fff', padding: padded ? '4px' : 0, position: 'relative', ...style }}
      role={role}
    >
      {children}
    </div>
  );
};
export default ArkSurface;
