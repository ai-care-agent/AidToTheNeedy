// Local knowledge about fraud targeting seniors in Poland — part of the product's moat
// ("polskie oszustwa"), shared by the voice agent and the SMS classifier.

export const scamCategories = [
  'bank_impersonation',
  'parcel_fee',
  'utility_disconnection',
  'family_emergency',
  'police_impersonation',
  'remote_access',
  'tax_or_benefit_refund',
  'marketplace_payment',
  'prize_or_lottery',
  'investment',
  'other',
] as const;

export type ScamCategory = (typeof scamCategories)[number];

export const scamCategoryLabels: Record<ScamCategory, string> = {
  bank_impersonation: 'podszywanie się pod bank',
  parcel_fee: 'fałszywa dopłata do przesyłki',
  utility_disconnection: 'fałszywe odłączenie prądu lub gazu',
  family_emergency: 'metoda „na wnuczka” / „na członka rodziny”',
  police_impersonation: 'metoda „na policjanta”',
  remote_access: 'prośba o instalację aplikacji zdalnego dostępu',
  tax_or_benefit_refund: 'fałszywy zwrot podatku lub świadczenia',
  marketplace_payment: 'fałszywa płatność z serwisu ogłoszeniowego',
  prize_or_lottery: 'fałszywa wygrana lub nagroda',
  investment: 'fałszywa inwestycja',
  other: 'inne oszustwo',
};

export const polishScamPatterns = `Najczęstsze oszustwa wobec seniorów w Polsce:
- Podszywanie się pod bank: „konto zostanie zablokowane”, „wykryto nietypowe logowanie”, link do fałszywej strony logowania, prośba o kod BLIK, PIN lub dane karty.
- Fałszywa dopłata do paczki (podszywanie się pod firmy kurierskie lub pocztę): mała kwota (np. 1,99 zł) i link do płatności.
- Fałszywe odłączenie prądu lub gazu (podszywanie się pod dostawcę energii): groźba odłączenia „dziś”, link do zapłaty zaległości.
- Metoda „na wnuczka” lub „na członka rodziny”: „Babciu/Mamo, to mój nowy numer”, pilna prośba o pieniądze, przeniesienie rozmowy na WhatsApp, „nie mogę rozmawiać”.
- Metoda „na policjanta” lub „na agenta CBŚ”: telefon, że pieniądze są zagrożone albo że ktoś bliski spowodował wypadek; polecenie przekazania gotówki kurierowi lub przelewu na „bezpieczne konto”; prośba o zachowanie tajemnicy.
- „Pracownik banku” lub „konsultant” przez telefon: prośba o zainstalowanie aplikacji (np. AnyDesk, TeamViewer, QuickSupport), podanie kodu z SMS-a albo przeniesienie środków.
- Fałszywy zwrot podatku, nadpłaty lub świadczenia (podszywanie się pod urząd skarbowy, ZUS, NFZ, gov.pl, mObywatel): link do „odebrania zwrotu” lub „aktualizacji danych”.
- Fałszywa płatność z serwisu ogłoszeniowego: „kupujący zapłacił, odbierz środki pod linkiem”.
- Fałszywa wygrana, nagroda lub loteria, za której „odbiór” trzeba zapłacić.
- Fałszywe inwestycje (kryptowaluty, „akcje znanej spółki”, wizerunek znanych osób), obietnica szybkiego zysku.

Sygnały ostrzegawcze: presja czasu i groźba („dziś”, „w ciągu 24 godzin”, „ostatnie wezwanie”), link w nieoczekiwanej wiadomości (zwłaszcza domeny z dopiskami typu „weryfikacja”, „doplata”, „rozliczenie” albo nietypowe końcówki .top, .online, .info, .xyz), prośba o pieniądze, dane logowania, PIN, kod BLIK lub kod z SMS-a, nieznany numer (także zagraniczny), błędy językowe, prośba o tajemnicę lub przejście na WhatsApp.

Zasady bezpieczeństwa: bank, policja, prokuratura ani urząd nigdy nie proszą przez telefon lub SMS o PIN, hasło, kod BLIK, instalację aplikacji, przekazanie gotówki ani przelew na „bezpieczne konto”. Nie klikać linków z nieoczekiwanych SMS-ów. W razie wątpliwości rozłączyć się i samodzielnie zadzwonić na numer z karty płatniczej, z oficjalnej strony albo do kogoś z rodziny. Podejrzany SMS można bezpłatnie przesłać do CERT Polska na numer 8080. Jeśli ktoś podał już dane lub pieniądze — natychmiast zadzwonić do banku, żeby zablokować konto, i zgłosić sprawę na policję (112).`;
