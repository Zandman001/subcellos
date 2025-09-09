import { useEffect } from "react";
import { useBrowserStore } from "../store/browser";

export default function BrowserKeys() {
  useEffect(() => {
    const onBlur = () => {
      const st = useBrowserStore.getState() as any;
      st.forceStopPreview?.();
    };

    const onKey = (e: KeyboardEvent) => {
      const st = useBrowserStore.getState() as any;
      if (e.key === 'Tab') { e.preventDefault(); st.toggleFocus(); return; }
      if (st.focus !== 'browser') return;
      // prevent interfering with inputs
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (target as any).isContentEditable) return;
      }
      const k = e.key;
      
      // While sample browser is open, pause E/D navigation and let sample browser handle it
      if (st.sampleBrowserOpen) {
        // Allow only Escape to close the sample browser from here
        if (k === 'Escape') {
          st.closeSampleBrowser?.();
          e.preventDefault();
        }
        return;
      }
      
      // While picker is open, only E/D/Q/S should act
      if (st.level === 'pattern' && st.modulePickerOpen) {
        if (k === 'e') { st.moveUp(); e.preventDefault(); return; }
        if (k === 'd') { st.moveDown(); e.preventDefault(); return; }
        if (k === 'a') { st.goLeft(); e.preventDefault(); return; }
        if (k === 'q') { st.add(); e.preventDefault(); return; }
        return;
      }

      // Confirm dialog: Q confirm, A cancel
      if (st.confirmOpen) {
        if (k === 'q') { st.confirmYes?.(); e.preventDefault(); return; }
        if (k === 'a') { st.confirmNo?.(); e.preventDefault(); return; }
        // swallow other keys while open
        e.preventDefault();
        return;
      }

      // Preview notes inside synth level: intercept q/a and use store-managed pressed QA
      if (st.level === 'synth' && (k === 'q' || k === 'a')) {
        e.preventDefault();
        // Ignore duplicate keydown for the same key to avoid repeated noteOn
        const pressed = st._pressedQA || { q: false, a: false };
        if ((k === 'q' && pressed.q) || (k === 'a' && pressed.a)) return;
        if (k === 'q') st.setPressedQA(true, null);
        if (k === 'a') st.setPressedQA(null, true);
        st.updatePreviewFromPressed();
        return;
      }
      if (k === 'e') { st.moveUp(); e.preventDefault(); return; }
      if (k === 'd') { st.moveDown(); e.preventDefault(); return; }
      if (k === 's') { st.goLeft(); e.preventDefault(); return; }
      if (k === 'f') { st.goRight(); e.preventDefault(); return; }
      if (k === 'q') { st.add(); e.preventDefault(); return; }
      if (k === 'a') { st.remove(); e.preventDefault(); return; }
      if (k === 'w') { st.moveLeft(); e.preventDefault(); return; }
      if (k === 'r') { st.moveRight(); e.preventDefault(); return; }
      };
    const onKeyUp = (e: KeyboardEvent) => {
      const st = useBrowserStore.getState() as any;
      const k = e.key;
      if (st.focus !== 'browser') return;
      if (k === 'q' || k === 'a') {
        if (st.level === 'synth') {
          e.preventDefault();
          if (k === 'q') st.setPressedQA(false, null);
          if (k === 'a') st.setPressedQA(null, false);
          st.updatePreviewFromPressed();
          return;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('blur', onBlur); };
  }, []);
  return null;
}
