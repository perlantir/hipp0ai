import { useState, useEffect, useRef, useCallback } from 'react';
import { Search } from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  group?: string;
  shortcut?: string;
}

interface CommandPaletteProps {
  items: CommandItem[];
  open: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette({ items, open, onClose, onSelect }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? items.filter((item) => fuzzyMatch(query, item.label))
    : items;

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keep selected index in bounds
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onSelect(filtered[selectedIndex].id);
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, onSelect, onClose],
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="command-palette-backdrop" onClick={onClose} />

      {/* Palette */}
      <div className="command-palette" onKeyDown={handleKeyDown}>
        <div className="command-palette-input-row">
          <Search size={18} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search..."
            className="command-palette-input"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="command-palette-kbd">esc</kbd>
        </div>

        <div className="command-palette-list" ref={listRef}>
          {filtered.length === 0 && (
            <div className="command-palette-empty">No results found</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={item.id}
              className={`command-palette-item ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => {
                onSelect(item.id);
                onClose();
              }}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="command-palette-item-label">{item.label}</span>
              {item.group && (
                <span className="command-palette-item-group">{item.group}</span>
              )}
              {item.shortcut && (
                <kbd className="command-palette-item-shortcut">{item.shortcut}</kbd>
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
