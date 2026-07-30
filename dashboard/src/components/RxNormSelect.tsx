/**
 * RxNormSelect — a debounced RxNorm search input with a dropdown of matches.
 *
 * Resolves drug concepts against NIH's public RxNav API (no auth, CORS-enabled):
 *   • approximateTerm — ranks partial / as-you-type input (ingredient + dose-form level)
 *   • drugs.json      — returns strength-level prescribable products for complete words
 * The two are merged (prescribable products first) and deduped by RxCUI. If the
 * network call fails or returns nothing, the raw text is still accepted as a
 * free-text entry, so the control degrades gracefully offline.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon } from './icons';

const RXNAV = 'https://rxnav.nlm.nih.gov/REST';

/** Term types worth prescribing against (strength-level clinical/branded drugs + packs). */
const PRESCRIBE_TTYS = new Set(['SCD', 'SBD', 'SCDF', 'SBDF', 'SCDC', 'SBDC', 'GPCK', 'BPCK']);

export type RxNormConcept = { rxcui: string; display: string };

type Match = { code: string; display: string; tty?: string };

/** Query RxNav and return a merged, deduped, prescribable-first match list. */
async function searchRxNorm(term: string, signal: AbortSignal): Promise<Match[]> {
  const q = term.trim();
  if (q.length < 2) return [];

  const [drugs, approx] = await Promise.allSettled([
    fetch(`${RXNAV}/drugs.json?name=${encodeURIComponent(q)}`, { signal }).then((r) => r.json()),
    fetch(`${RXNAV}/approximateTerm.json?term=${encodeURIComponent(q)}&maxEntries=20`, { signal }).then((r) => r.json()),
  ]);

  const byCode = new Map<string, Match>();

  // Strength-level products first (only present when the term is a complete word).
  if (drugs.status === 'fulfilled') {
    const groups = drugs.value?.drugGroup?.conceptGroup ?? [];
    for (const g of groups) {
      if (!PRESCRIBE_TTYS.has(g.tty)) continue;
      for (const c of g.conceptProperties ?? []) {
        if (c.rxcui && c.name && !byCode.has(c.rxcui)) {
          byCode.set(c.rxcui, { code: c.rxcui, display: c.name, tty: g.tty });
        }
      }
    }
  }

  // Then ranked approximate matches (bridges partial input), skipping dupes.
  if (approx.status === 'fulfilled') {
    const cand = approx.value?.approximateGroup?.candidate ?? [];
    for (const c of cand) {
      if (c.rxcui && c.name && !byCode.has(c.rxcui)) {
        byCode.set(c.rxcui, { code: c.rxcui, display: c.name });
      }
    }
  }

  return [...byCode.values()].slice(0, 15);
}

export function RxNormSelect({
  value,
  onChange,
  placeholder = 'Search RxNorm…',
  disabled = false,
}: {
  /** the currently-selected concept (display drives the input text). */
  value: RxNormConcept;
  onChange: (next: RxNormConcept) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(value.display ?? '');
  const [open, setOpen] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  // Keep the input text in sync when the selected value changes externally.
  useEffect(() => {
    setText(value.display ?? '');
  }, [value.display]);

  // Close the dropdown on outside clicks.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Debounced RxNav lookup.
  useEffect(() => {
    const q = text.trim();
    if (!open || q.length < 2 || q === value.display) {
      setMatches([]);
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    const controller = new AbortController();
    setLoading(true);
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const next = await searchRxNorm(q, controller.signal);
          if (id === seq.current) setMatches(next);
        } catch {
          // Network/RxNav unavailable — degrade to free-text (no matches).
          if (id === seq.current) setMatches([]);
        } finally {
          if (id === seq.current) setLoading(false);
        }
      })();
    }, 260);
    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [text, open, value.display]);

  const select = useMemo(
    () => (m: Match) => {
      onChange({ rxcui: m.code, display: m.display });
      setText(m.display);
      setOpen(false);
      setMatches([]);
      setActive(-1);
    },
    [onChange],
  );

  function commitFreeText(next: string) {
    // Free-text entry keeps whatever rxcui was already picked (or clears it if the
    // text no longer matches the selected concept's display).
    onChange({ rxcui: next === value.display ? value.rxcui : '', display: next });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? matches.length - 1 : a - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      select(matches[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const showDropdown = open && (loading || matches.length > 0);

  return (
    <div className="rxnorm-select" ref={wrapRef}>
      <span className="rxnorm-search-icon">
        <SearchIcon size={15} />
      </span>
      <input
        className="field-input rxnorm-input"
        value={text}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(-1);
          commitFreeText(e.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      {showDropdown && (
        <div className="rxnorm-menu" role="listbox">
          {loading && matches.length === 0 && (
            <div className="rxnorm-menu-status">Searching RxNorm…</div>
          )}
          {matches.map((m, i) => (
            <button
              key={`${m.code}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              className={`rxnorm-option ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                select(m);
              }}
            >
              <span className="rxnorm-option-name">{m.display}</span>
              {m.tty && <span className="rxnorm-option-tty">{m.tty}</span>}
              <code className="rxnorm-option-code">{m.code}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
