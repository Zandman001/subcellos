import React from 'react';
import ArkDemo from './ArkDemo';
import { ArkBitmapText } from './primitives/ArkBitmapText';
import ArkLabel from './primitives/ArkLabel';

export const ArkPreviewView: React.FC = () => {
  return (
    <div style={{ padding:16 }}>
      <ArkLabel text="ARK PREVIEW" bitmap scale={3} />
      <div style={{ height:12 }} />
      <ArkBitmapText text="PARAM A: 123" />
      <div style={{ height:12 }} />
      <ArkDemo />
    </div>
  );
};
export default ArkPreviewView;
