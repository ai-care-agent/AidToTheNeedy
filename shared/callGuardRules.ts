import type { CallGuardLevel, CallGuardVerdict } from './types';

// Instant screening of a phone call transcript, run in the browser on every recognised
// phrase (no network round trip) and again on the server before the model's verdict.
// Speech recognition drops diacritics and punctuation inconsistently, so text is folded.

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ł/g, 'l');

const RULES: { reason: string; weight: number; re: RegExp }[] = [
  { reason: 'prośba o kod BLIK', weight: 4, re: /\bblik/ },
  { reason: 'prośba o PIN, hasło lub kod z SMS-a', weight: 4, re: /\bpin\b|\bhasl|kod z sms|kod weryfikac|dane do logowania|numer karty/ },
  { reason: 'przelew na „bezpieczne konto”', weight: 4, re: /bezpieczne konto|konto techniczne|przelac|przelew|wyplac/ },
  { reason: 'przekazanie gotówki lub kosztowności', weight: 4, re: /gotowk|oszczednosci|kosztownosc|bizuteri|kurier (odbierze|przyjedzie)|przyjedzie po pieniadze|odbierze pieniadze/ },
  { reason: 'podszywanie się pod policję lub prokuraturę', weight: 3, re: /policj|komisarz|aspirant|prokurat|\bcbs\b|centralne biuro|funkcjonariusz/ },
  { reason: 'podszywanie się pod pracownika banku', weight: 3, re: /pracownik banku|dzial bezpieczenstwa|konsultant banku|dzwonie z banku|z pani banku|pani konto/ },
  { reason: 'wypadek lub kłopoty bliskiej osoby', weight: 3, re: /wypadek|potracil|zatrzyman|areszt|kaucj/ },
  { reason: 'żądanie tajemnicy', weight: 4, re: /nikomu (nie|o tym)|nie mowic nikomu|tajn[aey]|tajemnic|nie rozlaczaj|nie odkladaj sluchawki/ },
  { reason: 'prośba o instalację aplikacji', weight: 4, re: /zainstaluj|pobierz aplikac|anydesk|teamviewer|quick ?support|zdalny dostep/ },
  { reason: 'presja czasu', weight: 1, re: /pilnie|natychmiast|od razu|w ciagu godziny|nie ma czasu/ },
  { reason: 'rozmowa o pieniądzach', weight: 1, re: /pieniadz|zlotych|tysiec|tysiecy|\d+ ?zl/ },
];

export interface CallScreen {
  level: CallGuardLevel;
  /** Strongest signals first; only the ones worth telling her about. */
  reasons: string[];
  score: number;
}

export function screenCall(transcript: string): CallScreen {
  const t = fold(transcript);
  const hits = RULES.filter((r) => r.re.test(t)).sort((a, b) => b.weight - a.weight);
  const score = hits.reduce((sum, r) => sum + r.weight, 0);
  const level: CallGuardLevel = score >= 6 ? 'scam' : score >= 3 ? 'suspicious' : 'safe';
  return { level, reasons: hits.filter((r) => r.weight > 1).map((r) => r.reason), score };
}

const RANK: Record<CallGuardLevel, number> = { safe: 0, suspicious: 1, scam: 2 };

/** A call never becomes "safer" once a warning was given. */
export function maxLevel(a: CallGuardLevel, b: CallGuardLevel): CallGuardLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The spoken warning for a rules verdict — the browser uses it instantly, the server as a fallback. */
export function verdictFromRules(transcript: string, addressAs: string): CallGuardVerdict {
  const screen = screenCall(transcript);
  const reason = screen.reasons[0] ?? null;
  if (screen.level === 'scam') {
    return {
      level: 'scam',
      reason,
      warning: `${addressAs}, to wygląda na oszustwo${reason ? `: ${reason}` : ''}. Proszę się rozłączyć. Policja ani bank nigdy nie proszą przez telefon o pieniądze ani kody.`,
      source: 'rules',
    };
  }
  if (screen.level === 'suspicious') {
    return { level: 'suspicious', reason, warning: `Uwaga${reason ? `, ${reason}` : ''}. Proszę nie podawać żadnych danych i nie przekazywać pieniędzy.`, source: 'rules' };
  }
  return { level: 'safe', reason: null, warning: null, source: 'rules' };
}
