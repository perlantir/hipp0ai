import { useEffect } from 'react';

interface ShortcutActions {
  onCommandPalette: () => void;
  onEscape: () => void;
  onNavigate: (index: number) => void;
  onHelp?: () => void;
}

export function useKeyboardShortcuts({ onCommandPalette, onEscape, onNavigate, onHelp }: ShortcutActions) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Cmd/Ctrl+K → command palette
      if (meta && e.key === 'k') {
        e.preventDefault();
        onCommandPalette();
        return;
      }

      // Cmd/Ctrl+Enter → submit closest form
      if (meta && e.key === 'Enter') {
        const form = target.closest('form');
        if (form) {
          e.preventDefault();
          form.requestSubmit();
        }
        return;
      }

      // Escape → close modals
      if (e.key === 'Escape') {
        onEscape();
        return;
      }

      // ? → show keyboard shortcuts help (only when not in input)
      if (!isInput && e.key === '?' && !meta && !e.altKey) {
        e.preventDefault();
        onHelp?.();
        return;
      }

      // Number keys 1-9 → navigate (only when not focused on an input)
      if (!isInput && e.key >= '1' && e.key <= '9' && !meta && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        onNavigate(parseInt(e.key, 10) - 1);
        return;
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCommandPalette, onEscape, onNavigate, onHelp]);
}
