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

      // Preview notes inside synth level: 'a' (base), 'q' (+1 oct), and 'a'+'q' (+2 oct) for Electricity.
      // Suppress BOTH when current module is drum (Drubbles) – only Drubbles component handles 'a' for slot preview.
      if (st.level === 'synth' && (k === 'a' || k === 'q')) {
        if (st.currentSoundType === 'drum') {
          // Allow Q to fall through for pack browser open in Drubbles (handled in Drubbles component); prevent generic preview.
          if (k === 'a') e.preventDefault(); // prevent accidental remove action binding below
          return;
        }
        e.preventDefault();
        const pressed = st._pressedQA || { q: false, a: false };
        if (k === 'a') {
          if (!pressed.a) { st.setPressedQA(null, true); st.updatePreviewFromPressed(); }
        } else { // 'q'
          if (!pressed.q) { st.setPressedQA(true, null); st.updatePreviewFromPressed(); }
        }
        return;
      }
      if (k === 'e') { st.moveUp(); e.preventDefault(); return; }
      if (k === 'd') { st.moveDown(); e.preventDefault(); return; }
      if (k === 's') { st.goLeft(); e.preventDefault(); return; }
      if (k === 'f') { st.goRight(); e.preventDefault(); return; }
      // Avoid interpreting 'a' as remove when in drum synth page (reserved for slot preview there)
      if (k === 'q') { st.add(); e.preventDefault(); return; }
      if (k === 'a') {
        if (st.currentSoundType === 'drum' && st.level === 'synth') { e.preventDefault(); return; }
        st.remove(); e.preventDefault(); return; }
      if (k === 'w') { st.moveLeft(); e.preventDefault(); return; }
      if (k === 'r') { st.moveRight(); e.preventDefault(); return; }
      };
    const onKeyUp = (e: KeyboardEvent) => {
      const st = useBrowserStore.getState() as any;
      const k = e.key;
      if (st.focus !== 'browser') return;
    if (k === 'a' || k === 'q') {
        if (st.level === 'synth') {
          // Skip synth note preview for drum module
          if (st.currentSoundType === 'drum') { e.preventDefault(); return; }
          e.preventDefault();
          if (k === 'a') {
            st.setPressedQA(null, false);
          }
          if (k === 'q') {
            st.setPressedQA(false, null);
          }
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
