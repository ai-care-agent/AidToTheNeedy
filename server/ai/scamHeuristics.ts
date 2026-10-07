import type { ScamCategory } from './scamKnowledge';

// Fast local screening. It grounds the model's judgement and keeps Scam Shield working
// when the API is unavailable. Polish SMS often lack diacritics, so text is folded first.

export interface HeuristicResult {
  verdict: 'safe' | 'suspicious' | 'scam';
  category: ScamCategory | null;
  signals: string[];
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ł/g, 'l');

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:pl|com|info|top|online|xyz|site|shop|click|icu|live|net|org|cc|me|link)(?:\/\S*)?/i;
const SHORTENERS = /\b(?:bit\.ly|tinyurl\.com|t\.co|cutt\.ly|is\.gd|rb\.gy|shorturl\.at|t\.ly)\b/i;
const RISKY_TLD = /\.(?:top|online|info|xyz|site|shop|click|icu|live|cc|link)\b/i;
const LOOKALIKE = /(?:weryfikac|doplat|rozliczen|zaleglos|platnosc|bezpieczn|odblokuj|aktualizac)[a-z0-9-]*\./;

const rules: { signal: string; category: ScamCategory | null; weight: number; re: RegExp }[] = [
  { signal: 'groźba blokady lub odłączenia', category: null, weight: 2, re: /zablokow|zawieszon|wstrzyman|odlaczen|odlaczy|dezaktywac|utrat[ay] dostepu/ },
  { signal: 'presja czasu', category: null, weight: 1, re: /\bdzis\b|w ciagu \d+ ?(h|godz)|natychmiast|pilnie|ostatnie wezwanie|termin mija|do godz/ },
  { signal: 'prośba o dane, kod lub weryfikację', category: 'bank_impersonation', weight: 2, re: /\bpin\b|\bblik\b|haslo|login|dane do logowania|potwierdz dane|zweryfikuj|weryfikacj|kod z sms/ },
  { signal: 'żądanie dopłaty lub płatności', category: null, weight: 2, re: /doplat|oplac|zaplac|zaleglosc|platnosc|uregu?luj/ },
  { signal: 'wzmianka o przesyłce', category: 'parcel_fee', weight: 2, re: /paczk|przesylk|kurier|punkt odbioru|paczkomat/ },
  { signal: 'podszywanie się pod dostawcę energii', category: 'utility_disconnection', weight: 1, re: /energi|pradu|gazu|licznik/ },
  { signal: 'nowy numer „członka rodziny”', category: 'family_emergency', weight: 3, re: /nowy numer|zmienil(em|am) numer|zgubil(em|am) telefon|zbil(em|am) telefon|to ja,? (twoj|twoja)|babciu|dziadku|mamo,? to ja/ },
  { signal: 'pilna prośba o pieniądze', category: 'family_emergency', weight: 2, re: /potrzebuje \d+|pozycz|przelej|wyslij pieniadze|potrzebuje pieniedzy|\d+ ?zl.*oddam/ },
  { signal: 'przeniesienie rozmowy na komunikator', category: 'family_emergency', weight: 2, re: /whatsapp|telegram|signal|nie dzwon/ },
  { signal: 'podszywanie się pod policję', category: 'police_impersonation', weight: 3, re: /policj|cbs|prokurat|bezpieczne konto|akcj[ai] policji/ },
  { signal: 'prośba o instalację aplikacji', category: 'remote_access', weight: 3, re: /anydesk|teamviewer|quicksupport|zainstaluj aplikacj|pobierz aplikacj/ },
  { signal: 'obietnica zwrotu lub nagrody', category: 'tax_or_benefit_refund', weight: 2, re: /zwrot podatku|nadplat|odbierz zwrot|wygral|nagrod|odbierz srodki|kupujacy zaplacil/ },
];

export function screenMessage(text: string, sender = ''): HeuristicResult {
  const t = fold(text);
  const signals: string[] = [];
  const categoryScore = new Map<ScamCategory, number>();
  let score = 0;

  const hasUrl = URL_RE.test(text);
  if (hasUrl) {
    signals.push('link w wiadomości');
    score += 2;
    if (SHORTENERS.test(text)) {
      signals.push('skrócony link');
      score += 1;
    }
    if (RISKY_TLD.test(text) || LOOKALIKE.test(t)) {
      signals.push('podejrzana domena');
      score += 2;
    }
  }

  for (const rule of rules) {
    if (!rule.re.test(t)) continue;
    signals.push(rule.signal);
    score += rule.weight;
    if (rule.category) categoryScore.set(rule.category, (categoryScore.get(rule.category) ?? 0) + rule.weight);
  }

  if (/^\+(?!48)\d/.test(sender.replace(/\s/g, ''))) {
    signals.push('zagraniczny numer nadawcy');
    score += 1;
  }

  const category = [...categoryScore.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const asksForMoneyOrData = signals.some((s) => /płatności|dopłaty|pieniądze|dane, kod|instalację/.test(s));

  let verdict: HeuristicResult['verdict'] = 'safe';
  if (score >= 5 && (hasUrl || asksForMoneyOrData)) verdict = 'scam';
  else if (score >= 3) verdict = 'suspicious';

  return { verdict, category: verdict === 'safe' ? null : (category ?? 'other'), signals };
}
