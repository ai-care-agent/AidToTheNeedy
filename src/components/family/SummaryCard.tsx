import { useCallback, useEffect, useRef, useState } from 'react';
import type { DailySummary } from '../../../shared/types';
import { getJson } from '../../lib/api';
import { fmtTime } from '../../lib/format';

/** A few sentences instead of four phone calls; refreshed when something new happens. */
export function SummaryCard({ version, tz }: { version: number; tz: string }) {
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [loading, setLoading] = useState(false);
  const scheduled = useRef<number | undefined>(undefined);
  const firstVersion = useRef(version);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await getJson<DailySummary>('/api/family/summary'));
    } catch {
      // Keep the previous text; the next change retries.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // New events come in bursts: refresh at most every few seconds, and never postpone
  // indefinitely (a debounce would starve while a demo keeps generating events).
  useEffect(() => {
    if (version === firstVersion.current || scheduled.current) return;
    scheduled.current = window.setTimeout(() => {
      scheduled.current = undefined;
      void load();
    }, 3_000);
  }, [version, load]);

  useEffect(() => () => window.clearTimeout(scheduled.current), []);

  return (
    <div>
      {summary ? (
        <p className={`text-lg leading-relaxed transition-opacity ${loading ? 'opacity-60' : ''}`}>{summary.text}</p>
      ) : (
        <p className="text-muted">Przygotowuję podsumowanie…</p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-sm text-muted">
        <span>{summary ? `${summary.source === 'model' ? 'Napisane przez AI' : 'Podsumowanie automatyczne'} · ${fmtTime(summary.generatedAt, tz)} · bez treści rozmów` : ''}</span>
        <button type="button" onClick={() => void load()} disabled={loading} className="min-h-10 rounded-xl px-2 font-semibold text-brand hover:bg-brand-soft disabled:opacity-50">
          {loading ? 'Odświeżam…' : 'Odśwież'}
        </button>
      </div>
    </div>
  );
}
