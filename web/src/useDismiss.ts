import { useEffect, type RefObject } from "react";

// Shared "close this dropdown/popover" behavior: Escape key, or a click
// anywhere outside the given element. Every topbar popover (admin menu,
// notifications, accent picker, profile menu) wants exactly this and
// nothing more — a hook keeps that consistent instead of each one
// reimplementing its own partial version (previously only outside-click
// existed, and only on one of them).
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open, ref, onClose]);
}
