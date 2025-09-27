import React from 'react';

export interface ArkGridCell { id: string; active: boolean; pulse?: boolean; accent?: boolean; }
export interface ArkGridProps { cells: ArkGridCell[]; cols: number; cellSize?: number; onToggle?: (id:string)=>void; }

export const ArkGrid: React.FC<ArkGridProps> = ({ cells, cols, cellSize=12, onToggle }) => {
  return (
    <div className="ark-grid" style={{ ['--cols' as any]: cols, ['--cell-size' as any]: cellSize + 'px' }}>
      {cells.map(c => (
        <div
          key={c.id}
          className={`ark-grid-cell ${c.active? 'is-on': ''} ${c.pulse? 'is-pulse': ''}`}
          onClick={()=> onToggle?.(c.id)}
        >
          {c.accent && <div className="corner-accent" />}
        </div>
      ))}
    </div>
  );
};
export default ArkGrid;
