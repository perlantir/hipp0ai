import { X } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{ keys: string[]; description: string }>;
}

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['1', '-', '9'], description: 'Navigate to sidebar items' },
      { keys: ['Ctrl', 'K'], description: 'Open command palette' },
      { keys: ['Esc'], description: 'Close modal / menu' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['Ctrl', 'Enter'], description: 'Submit form' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function KeyboardShortcuts({ onClose }: { onClose: () => void }) {
  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 z-[90] bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-[91] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="card p-6 w-full max-w-md animate-slide-up"
          style={{ background: 'var(--bg-card)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold">Keyboard Shortcuts</h2>
            <button onClick={onClose} className="btn-ghost p-1.5">
              <X size={16} />
            </button>
          </div>

          {/* Groups */}
          <div className="space-y-5">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)] mb-2.5">
                  {group.title}
                </h3>
                <div className="space-y-2">
                  {group.shortcuts.map((shortcut) => (
                    <div key={shortcut.description} className="flex items-center justify-between">
                      <span className="text-sm text-[var(--text-secondary)]">{shortcut.description}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, i) => (
                          <span key={i}>
                            {key === '-' || key === '+' ? (
                              <span className="text-xs text-[var(--text-tertiary)] mx-0.5">{key}</span>
                            ) : (
                              <kbd
                                className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded text-xs font-mono"
                                style={{
                                  background: 'var(--bg-secondary)',
                                  border: '1px solid var(--border-light)',
                                  color: 'var(--text-primary)',
                                }}
                              >
                                {key}
                              </kbd>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-5 pt-4 border-t border-[var(--border-light)]">
            <p className="text-xs text-[var(--text-tertiary)] text-center">
              Press <kbd className="text-xs font-mono px-1 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-light)' }}>?</kbd> to toggle this help
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
