import React from 'react';
import ArkBitmapText from './ArkBitmapText';

export interface ArkLabelProps { 
  text: string; 
  glyph?: React.ReactNode; 
  className?: string; 
  bitmap?: boolean; 
  invert?: boolean; 
  scale?: number; 
}

export const ArkLabel: React.FC<ArkLabelProps> = ({ 
  text, 
  glyph, 
  className='', 
  bitmap=false, 
  invert=false, 
  scale=2 
}) => {
  return (
    <div className={`ark-label ark-font ${className}`} style={{ display:'inline-flex', alignItems:'center', gap:2 }}>
      {glyph}
      {bitmap ? <ArkBitmapText text={text} invert={invert} scale={scale} /> : <span>{text}</span>}
    </div>
  );
};

export default ArkLabel;
