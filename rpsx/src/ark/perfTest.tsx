import React from 'react';
import { ArkBitmapText } from './primitives/ArkBitmapText';

// Simple performance probe for ArkBitmapText creation cost.
export function measureBitmapBatch(count = 100): { nodes: React.ReactElement[]; ms: number } {
  const start = performance.now();
  const nodes: React.ReactElement[] = [];
  for (let i = 0; i < count; i++) {
    nodes.push(<ArkBitmapText key={i} text={`LBL${i}`} />);
  }
  const end = performance.now();
  return { nodes, ms: +(end - start).toFixed(3) };
}
