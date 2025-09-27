import React, { useEffect, useRef } from 'react';
import { GLYPH_W, GLYPH_H, getGlyph } from '../glyphs';

export interface ArkBitmapTextProps {
  text: string;
  scale?: number; // integer scale factor
  invert?: boolean;
  className?: string;
}

export const ArkBitmapText: React.FC<ArkBitmapTextProps> = ({ text, scale=2, invert=false, className='' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(()=> {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const chars = text.toUpperCase().split('');
    const w = chars.length * GLYPH_W;
    const h = GLYPH_H;
    canvas.width = w; canvas.height = h;
    ctx.fillStyle = invert? '#fff':'#000';
    ctx.fillRect(0,0,w,h);
    ctx.fillStyle = invert? '#000':'#fff';
    chars.forEach((ch, ci) => {
      const glyph = getGlyph(ch) || [];
      glyph.forEach((rowBits, ry) => {
        for (let bx=0; bx<GLYPH_W; bx++) {
          if (rowBits & (1 << (7-bx))) { // leftmost bit check (using padded row)
            ctx.fillRect(ci*GLYPH_W + bx, ry, 1, 1);
          }
        }
      });
    });
  }, [text, invert]);
  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: text.length*GLYPH_W*scale, height: GLYPH_H*scale, imageRendering:'pixelated', display:'inline-block', background: invert? '#fff':'#000' }}
    />
  );
};
export default ArkBitmapText;
