import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';

export interface ComboboxOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Typeable/searchable dropdown — a drop-in replacement for a plain <select>
 * when the option list is long enough that scanning it visually is slower
 * than typing a few letters (spells, items, monsters, ...). Built from
 * scratch (no combobox library anywhere in this app yet) to match the
 * existing "no drag/canvas/select libraries, plain Tailwind" style. Filters
 * client-side by substring match on `label`, case-insensitive.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  className = '',
}: {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { t } = useLocale();
  const effectivePlaceholder = placeholder ?? t('common.search');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIndex, setHighlightIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  function openDropdown() {
    setOpen(true);
    setHighlightIndex(0);
  }

  function selectOption(option: ComboboxOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
    setQuery('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const option = filtered[highlightIndex];
      if (option) selectOption(option);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={open ? query : (selected?.label ?? '')}
        placeholder={effectivePlaceholder}
        onFocus={openDropdown}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className="w-full rounded-md bg-stone-800 border border-stone-700 px-2 py-1.5 text-sm text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
      />
      {open && (
        <ul role="listbox" className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-stone-700 bg-stone-800 shadow-xl">
          {filtered.length === 0 && <li className="px-2 py-1.5 text-sm text-stone-500 italic">{t('common.noMatches')}</li>}
          {filtered.map((option, i) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus on the input so onClickOutside doesn't fire first
                selectOption(option);
              }}
              onMouseEnter={() => setHighlightIndex(i)}
              className={`px-2 py-1.5 text-sm cursor-pointer ${
                option.disabled
                  ? 'text-stone-600 cursor-not-allowed'
                  : i === highlightIndex
                    ? 'bg-amber-950 text-amber-400'
                    : 'text-stone-100 hover:bg-stone-700'
              }`}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
