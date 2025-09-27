import React from 'react';

export interface ArkGlyphProps { kind: 'A' | 'R' | 'K'; className?: string; }
export const ArkGlyph: React.FC<ArkGlyphProps> = ({ kind, className='' }) => <span className={`ark-glyph ${className}`} data-kind={kind} />;
export default ArkGlyph;
