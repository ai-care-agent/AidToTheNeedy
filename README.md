# AI Care Agent — POC

A working proof of concept of the proposal *"AI Care Agent: głosowy agent AI dla osób starszych + aplikacja dla rodziny"*: a Polish voice assistant that helps a senior living alone stay independent, and a Family App that shows the adult child only what matters — so they don't have to call four times a day to check.

The POC demonstrates the loop **Senior ↔ AI Agent ↔ Rodzina ↔ Usługi** with one demo household: Halina (79, Lublin) and her daughter Anna (Warsaw). Both apps are responsive — one column on a phone, two or more on a tablet or computer — and the senior app follows a design system made for older eyes and hands (see [Design](#design-ciepły-spokój)). The UI is in Polish; the code and this README are in English.

## Quick start

Requirements: Node.js ≥ 22.13, Chrome or Edge (speech recognition), a Claude API key.

```bash
npm install
cp .env.example .env        # set ANTHROPIC_API_KEY
npm run dev                 # API on :8787, web on :5173
```

Open **http://localhost:5173/present** — both phones side by side plus the demo controls; the **Komputer** switch shows the senior app as it looks on a laptop. Individual screens: `/senior`, `/family`, `/demo`.

Without an API key everything except the model's own words works: reminders, orders, voice messages, video calls, falls and SOS, the family view, Scam Shield and the call guard on local rules, template briefings and summaries. Reading a medicine box from a photo needs the key.

## What the POC covers

| From the proposal | In the POC |
|---|---|
| Voice agent: „Przypomnij mi jutro o lekarzu”, „Co mam dzisiaj zrobić?” | Tap-to-talk in Polish (Web Speech API), spoken replies, 28 tools on Claude: reminders, calendar, shopping list, weather, medicines, video calls, long-term memory |
| „Co jest napisane w tym piśmie?” | Photo of a letter → who it is from, amount, deadline, what to do; offers a reminder. Two sample letters included |
| Family App: „Mama 🟢 Wszystko OK — lek potwierdzony, wizyta potwierdzona, zakupy zaplanowane” | Status green / yellow / red with the reason, „Dzisiaj” timeline, alerts, activity feed, messages, add reminders and visits |
| „Nie pokazujemy wszystkich rozmów” / „Nie budować dashboardu szpiegującego rodzica” | The family never sees conversation content; items can be private („to prywatne”); the senior can open „Co widzi rodzina?” any time |
| Scam Shield — AI jako firewall (V2) | Every incoming SMS is screened: red full-screen warning for the senior, alert for the family. The agent also flags scams in letters and in calls she describes, using memory (she has one granddaughter) |
| **Strażnik rozmowy** (new) | During a suspicious call on speakerphone the app listens and warns out loud in real time — BLIK, „bezpieczne konto”, fake police or bank, secrecy, cash for a courier — and alerts the family. The transcript is never stored |
| V3: „Agent zaczyna działać” — zakupy, transport | The agent prepares a grocery delivery or a taxi to an appointment; **only a person confirms**: she taps „Tak, zamów”, and totals above the limit (150 zł) also need the daughter's approval in the Family App |
| Family layer — the heart of the business model | **Voice messages both ways** (Mom hears her daughter's own voice), an **AI summary of the day** instead of four calls, and a **7-day view** of doses, mood and activity with automatic observations („wieczorne leki pominięte 2 razy — to nowość”) — V2's anomaly detection |
| Automatyczne check-iny (V2) | **Morning briefing**: the assistant starts the day by itself — plan, weather and air quality (smog) — then asks how she feels; a bad answer alerts the family |
| Nie obiecywać opieki medycznej | No diagnoses or dosage advice; emergency symptoms → „zadzwoń pod 112” button + urgent family alert |
| Unconfirmed medication | Escalated to the family after 30 minutes; confirming later clears the alert |
| **Wideo z rodziną** (new) | One-tap video call in both directions (WebRTC, the server only relays signalling). An incoming call fills Mom's screen with two huge buttons, **Odbierz / Odrzuć**; she can also just say „Połącz mnie z Anną na wideo”. A missed call tells the family to try later or leave a voice message |
| **Bezpieczeństwo** (new) | *Fall detection* with the phone's accelerometer while the app is open (hard impact, then stillness): „Czy Pani upadła?” with a 30-second countdown — no answer, or „Potrzebuję pomocy”, sends an urgent alert with her location (map link). *SOS* button with a 5-second cancel window. *„Czy wszystko w porządku?”* after 4 daytime hours of silence; no answer in 15 minutes → the family is told. None of it is a medical device, and the app says so |
| **Apteczka** (new) | Photo of a medicine box or pharmacy label → Claude transcribes name, strength and the dosing *as printed* (never invents a dose) → she confirms → daily reminders are created. Pills are counted down with each confirmed dose; when a medicine runs low she gets **„Kończy się lek — zamówić?”** and a pharmacy order (with the same consent rules); the family sees the whole apteczka and can add a medicine too |
| **Zdrowie z opaski** (new) | Pulse, blood pressure, steps, sleep and SpO2 from three free sources: a band or cuff straight from her phone over **Web Bluetooth** (standard Heart Rate / Blood Pressure services — Polar, Omron, Beurer, many Xiaomi/Amazfit; no account), **Google Health API** (Fitbit, Pixel Watch — the Fitbit Web API is being retired) and **Withings** (cuffs, watches). She can also type a reading or just say „zmierzyłam ciśnienie, 150 na 95”. A reading above the limits asks her to rest and measure again (**Czuję się dobrze / Zmierzę za 5 minut / Źle się czuję**) and alerts the family; a normal re-measurement closes the alert. The family sees a 7-day chart per metric, plain observations („4 z 7 pomiarów powyżej 140/90 — jutro kardiolog, warto zabrać wyniki”) and can change the limits. She decides per metric what the family sees. Not a medical device, no diagnoses |
| **Ułatwienia** (new) | A settings sheet on both apps: five text sizes (up to 175 %), four colour themes — **Automatycznie** (light from sunrise to sunset at her home, dark after — computed from the household's coordinates, so in a Polish December the evening look starts at 15:30; the colours fade over a second), **Ciemny**, **Jasny** (the warm paper look) and **Wysoki kontrast** (black, white, yellow, every card outlined) — bold text, less motion, the assistant's speech pace, **Czytaj po dotknięciu** (tap any text to hear it) and a **Lupa**: the phone camera as a magnifier with camera zoom where available, torch, freeze-and-pan, contrast/negative filters and „Przeczytaj” (the assistant reads the frame aloud). By voice too: „powiększ tekst”, „mów wolniej”, „włącz lupę”, „włącz wysoki kontrast”. Settings stay on the device, per app. **Ekran Mamy** (Family App → Opieka): the daughter sets Mom's phone up remotely — presets („Słaby wzrok”, „Spokojnie”) or every option, with a live miniature of Mom's screen. The change reaches the phone at once, is announced („Anna zmieniła wygląd ekranu: tekst największy…”) and Mom can **Cofnij** it — the family is told; her own changes flow back so the card always shows what she has |
| **Pokaż palcem** (new) | Instead of „the green one — no, the other one” over the phone: the daughter taps a button in the Family App (Opieka → Pokaż palcem) and on Mom's phone everything dims except that button, which pulses under a pointing hand; the assistant says „Anna pokazuje: proszę nacisnąć kafelek Moje leki”. A tap elsewhere only closes it (a missed aim never does something else); when Mom taps the right one the daughter sees „Mama nacisnęła ✓”. The assistant does the same when asked „gdzie są moje leki?” |
| **Dopasuj ekran** (new) | On the first start Mom answers five questions the way an optician asks — which line can you read, which screen is clearest, how fast should I speak, do your hands shake, are chimes too quiet — and every answer changes the screen at once. Also: **Aa** next to the clock (settings no longer hide at the bottom), **Powtórz wolniej**, **Ochrona przed drżeniem rąk** (a second tap within 0.7 s is ignored) and **Błysk przy powiadomieniach** (screen flash + vibration for the hard of hearing) |
| **Plan dnia pod palcem** (new) | Every item in Mom's „Plan na dziś” has a big tick circle: one tap and it is done with the time („wzięte o 17:20”); „Zrobione wcześniej — o której?” records the real time; a tap by mistake is undone (the pill goes back to the apteczka, the reminder returns in 10 minutes). She can move an item, rename it, remove it (a daily one „tylko dziś” or for good) and add one — to be reminded, or **„Już zrobione”** to log what already happened („tabletka przeciwbólowa o 14:00”). Kinds: lek, **zastrzyk** (insulin, heparin — escalated to the family like a dose), inne. **Woda**: glasses with „+ Szklanka wody”, the daughter sees litres of the day, and „wypiłam szklankę wody” works by voice. The daughter can tick a dose for Mom („Potwierdź”) after a phone call. **Visits** can be moved (day with ‹ ›, time with big steppers) or cancelled by Mom — from the plan or „Mój lekarz” → „Moje wizyty” — or by the daughter in „Nadchodzące”, or by voice („przełóż wizytę u kardiologa na piątek”); the visit's reminder moves with it, the family is told, and the app reminds that the clinic has to agree (with its number one tap away) |
| **Temperatura** (new) | Body temperature as a sixth health metric: typed with ±0,1 °C steppers, said by voice („mam trzydzieści siedem i osiem”) or sent by a Bluetooth thermometer (standard Health Thermometer service). From 37,5 °C „stan podgorączkowy”, from 38 °C (the family can change it) the re-measure card and a family alert; a chart and an observation when it stays up |
| **Mój lekarz** (new) | The family doctor, specialists and the clinic with phones, address and hours: big „Zadzwoń” buttons on Mom's phone, a map link, and the NFZ patient line for nights and holidays; the daughter keeps it up to date in Opieka → Lekarz i przychodnia, and the assistant knows whom to call |
| Mniej statyczności | The Family App reacts as things happen: pop-up notifications for new events, feed filters, a ❤️ back to Mom in one tap, **Przypomnij teraz** on an unconfirmed dose; health tiles switch the chart, the demo panel has a pulse slider and blood-pressure presets |

Localisation as a moat: the scam knowledge (`server/ai/scamKnowledge.ts`, `shared/callGuardRules.ts`) covers Polish patterns — fake parcel fees, „odłączenie prądu”, „na wnuczka”, „na policjanta”, fake bank consultants and remote-access apps, fake tax refunds, CERT Polska 8080 — and the briefing reports smog.

## Demo script (≈ 12 minutes)

The same steps are listed in the demo panel.

1. **Poranny briefing — teraz**: the senior's phone greets her with the plan, weather and air quality, then asks how she feels.
2. „Co mam dzisiaj do zrobienia?” — the plan by voice.
3. **Przypomnienie o leku — teraz**, then **Eskaluj**: the daughter's status turns yellow. **Leki wzięte** clears it.
4. **SMS „Konto zostanie zablokowane”** → red warning and a family alert. Then „Czy ten SMS jest prawdziwy?”.
5. **Strażnik rozmowy** tile → **Przykładowa rozmowa „na policjanta”**: a fake police officer's call is read aloud; after the second sentence the screen turns red and the assistant tells her to hang up; the daughter gets an alert. By voice: „Dzwoni do mnie ktoś z banku” opens the guard.
6. „Zamów mi zakupy z mojej listy.” → a big consent card with prices → **Tak, zamów** → the order shows in the Family App.
7. **Duże zakupy — ponad limit** → she confirms → the daughter gets **Zatwierdź / Odrzuć** → Mom hears the decision.
8. „Zamów mi taksówkę na jutrzejszą wizytę u kardiologa.” → consent card.
9. Family App: 🎙️ record a voice message → it plays on Mom's phone in the daughter's voice → **Nagraj odpowiedź**.
10. **Przeczytaj pismo** → the water bill (reminder for 15 October) or the fake „wezwanie do zapłaty” (BLIK, QR code, 48-hour threat).
11. Family App: **Podsumowanie dnia** and **Ostatnie 7 dni** — the seeded fortnight hides a story (two missed evening doses, two so-so days, a quiet yesterday) that the observations and the summary surface.
12. **Wideo**: the daughter taps **Wideo** in the Family App → Mom's screen shows **Odbierz** → a live call. Or Mom says „Połącz mnie z Anną na wideo” and the daughter declines → „Anna nie może teraz rozmawiać”.
13. **Symuluj upadek** → „Czy Pani upadła?” with a countdown → **Potrzebuję pomocy** (or wait 30 s) → the daughter's status turns red with a map link. The red **SOS** tile does the same after 5 seconds, cancellable.
14. **„Czy wszystko w porządku?”** — the question the app asks by itself after a long daytime silence.
15. **Moje leki** → **Dodaj lek ze zdjęcia** → **Przykład (demo)**: Witamina D3 is read from the box and gets a daily reminder. **Lek się kończy** → the refill card → **Tak, zamów** → a pharmacy order in the Family App.

16. **Zdrowie**: in the demo panel **Bardzo wysokie 184/112** → Mom sees „Ciśnienie jest wysokie” with three answers, the daughter gets an alert; **Normalne** closes it. Drag the pulse slider and the heart in both apps beats at the new rate. In the Family App tap the tiles (Tętno, Kroki, Sen…) to switch the chart, open **Progi alertów** and raise the step goal. On Mom's side: **Moje zdrowie** → tap a number to hear it, **Wpisz ciśnienie**, **Co widzi rodzina?** (turn off sharing sleep and it disappears from the Family App).
17. Family App reacting live: with both apps open, send a scam SMS — a notification slides in at the top; tap ❤️ next to „Leki przyjęte” and Mom's phone shows the heart; **Przypomnij teraz** on an unconfirmed dose pops it up again on her screen.

18. **Ułatwienia** (Mom's footer): pick **A** sizes and **Wysoki kontrast** — the whole screen changes at once; **Posłuchaj próbki** at **Wolniej**. Tile **Lupa** → point the camera at a leaflet → **+**, **Zatrzymaj**, move with a finger, **Przeczytaj**. By voice: „Nie widzę, powiększ tekst”.

19. **Ekran Mamy**: in the Family App open **Opieka** → **Słaby wzrok** — Mom's phone switches to the largest text and high contrast and says who changed it; **Cofnij** there restores her look and the daughter sees „Mama przywróciła swoje ustawienia ekranu”.

20. **Pokaż palcem** (both phones side by side): Family App → Opieka → **Moje leki** — Mom's screen dims, the tile pulses under a hand, the assistant says where to tap; tap it and the daughter sees „Mama nacisnęła ✓”.
21. **Dopasuj ekran**: demo panel → „Dopasuj ekran u seniorki” (or a fresh phone after „Zaczynamy”) — pick a line of text, a screen, a voice speed; the daughter's „Ekran Mamy” card shows the result.
22. **Automatycznie**: Mom's **Aa** → **Automatycznie** (or „Ekran Mamy” → **Spokojnie**) — by day her phone turns light; demo panel → **🌙 Zachód słońca — podgląd** fades it into the evening look for two minutes, **☀️ Dzień — podgląd** brings the day back.

23. **Plan na dziś** (Mom): tap the circle next to „Leki wieczorne” — ✓ „wzięte o …”; tap the name → „Zrobione wcześniej”, „Zmień godzinę w planie”, „Usuń — tylko dziś”; **Dodaj** → „Już zrobione” → „Tabletka przeciwbólowa”. **+ Szklanka wody** twice — the daughter's „Dzisiaj” shows 0,5 l.
24. **Temperatura**: demo panel → „Gorączka 38,9 °C” — Mom gets „zmierz jeszcze raz”, the daughter an alert; **Mój lekarz** tile → „Zadzwoń”.

25. **Przenieś wizytę**: Mom → **Mój lekarz** (the tile says „Wizyta: jutro 10:30”) → **Wizyta u kardiologa** → **Przenieś** → a day later → **Zapisz** — the daughter's feed says „Mama przełożyła wizytę: jutro o 10:30 → czwartek…”.

**Reset danych demo** restores a fresh day with two weeks of history (`npm run reset-db` does the same from the terminal).

## A public link

**Right now, from this computer** (no account; the link lives while the computer and the two commands run):

```bash
npm run build && npm start                                   # the apps and the API on :8787
cloudflared tunnel --no-autoupdate --url http://localhost:8787   # prints https://….trycloudflare.com
```

Live updates use a POST event stream (`src/lib/serverEvents.ts`) because Cloudflare quick tunnels hold back a GET event stream until it ends.

**Our production and staging servers** run the same image behind Caddy (HTTPS), with nightly backups off the server. See [`deploy/README.md`](deploy/README.md).

**A free public demo**: the repository has a `Dockerfile` and a Render Blueprint (`render.yaml`). Push it to GitHub, then on [render.com](https://render.com) choose *New → Blueprint* and pick the repository. The free plan sleeps after 15 minutes without visitors (the first visit then takes about a minute) and starts with a fresh demo household; `DEMO_RESET_DAILY=1` also gives a clean day every morning. Any Docker host works the same way (Fly.io, Railway, a VPS).

Everyone who opens the link shares one demo household: what one visitor does, the others see. Without `ANTHROPIC_API_KEY` nothing costs money. With a key, set `DEMO_PASSWORD` so that strangers cannot spend it.

## Running it on a phone

Browsers only allow the microphone, the camera and motion sensors on HTTPS or `localhost`:

```bash
npm run dev:https           # self-signed certificate, listens on the LAN
```

Open `https://<laptop-ip>:5173/senior` on the phone (same Wi-Fi) and accept the certificate warning. A tunnel such as `cloudflared` works too. Voice quality depends on the device's Polish text-to-speech voice: Android (Google) and iOS (Zosia) sound good; desktop Linux often has no Polish voice. Put real numbers in `CONTACT_ANNA_PHONE` / `SENIOR_PHONE` to make the call buttons dial. For the call guard, put the call on speaker next to the device running the app. Fall detection needs the phone and the app open (iOS asks for motion access on „Zaczynamy”). Video works between two devices on most networks with the public STUN server; strict corporate or mobile NATs would need a TURN server.

## Architecture

```
 Senior app (React)                                    Family app (React)
 tap-to-talk, TTS, cards, call guard, recorder         status, summary, 7 days, orders, voice
        │ POST /api/senior/chat · /call-guard · /voice · /sos  │ GET /api/family/state · /summary
        ▼                                                      ▼
 ┌─────────────────────────────── Express API ───────────────────────────────┐
 │  Voice agent ── Claude tool runner ── 28 tools ─────┐                     │
 │  Scam Shield / call guard ── rules + Claude verdict ┤                     │
 │  Briefing · daily summary · medicine box ── Claude (template fallback)    │
 │  Scheduler (5 s): fire / escalate / expire / safety / briefing ─► Care    │
 │  Partners (shop, taxi, pharmacy) · Open-Meteo · video signalling relay    │
 └──── SSE "change" → both apps refetch · "video" / "safety" events ◄───────┘
        ▲                                                      ▲
        └──────────────── WebRTC video, peer to peer ──────────┘
```

- **State-driven UI.** Every mutation pushes a `change` event over SSE; each app refetches one state snapshot. Cards on the senior's screen (reminder, scam warning, order to confirm, message, briefing, safety question, refill) are derived from that state, so a reload or a dropped connection never loses anything. Cards are announced through one queue that never talks over her, over an answer on its way, over the call guard, or during a video call. Only the moment-to-moment cards live in the browser: a fall countdown, the SOS countdown, a call being placed.
- **Agent turn** (`server/ai/agent.ts`): the SDK tool runner loops until Claude stops calling tools (max 8 requests). The system prompt and tool definitions never change, so they form a cached prefix; the time, the plan, orders, inbox counts and remembered facts go into a context block on the newest turn only. History is plain text and expires after 30 minutes of silence. Photos are sent once and not stored.
- **Tools** (`server/ai/tools.ts`): `get_agenda`, `create_reminder`, `complete_reminder`, `snooze_reminder`, `cancel_reminder`, `add_calendar_event`, `add_task`, `complete_task`, `read_inbox`, `send_message_to_family`, `call_family`, `report_scam`, `emergency_alert`, `record_wellbeing`, `get_weather`, `propose_grocery_order`, `propose_taxi`, `propose_medicine_refill`, `start_call_guard`, `record_voice_message`, `video_call_family`, `remember_fact`. Inputs are validated with Zod; invalid input goes back to the model as an error instead of being executed.
- **Consent by design.** There is no tool to confirm, approve or pay. The agent can only *propose*; the order is placed after her tap, and above `SPENDING_LIMIT` after the family's approval as well.
- **Call guard** (`src/components/senior/CallGuard.tsx`): continuous speech recognition; the shared rules (`shared/callGuardRules.ts`) react to every phrase in the browser, and the model (with her family facts) is asked when the rules escalate, every 8 s while something is suspicious, and every 30 s otherwise. Recognition pauses while the app speaks, so it never transcribes its own warning.
- **Scam Shield** (`server/ai/scamShield.ts`): a fast local screen feeds a structured Claude verdict. Message content is always marked as untrusted data; links are shown defanged.
- **Video** (`server/video.ts`, `src/lib/video.ts`): one call at a time; the server keeps the call state (ringing → active → ended, missed after 45 s) and relays offers, answers and ICE candidates over the same SSE stream. Media never passes through the server.
- **Safety** (`src/lib/safety.ts`, `Care.sos` …): the accelerometer rule and the fall countdown run in the browser, which then sends the alarm with her location. „Czy wszystko w porządku?” is asked and escalated by the server's scheduler, so the family is told even if her screen has gone dark.
- **Apteczka** (`server/ai/medicineScan.ts`): a structured-output call transcribes the box; dosing is copied only when printed, and the proposal is shown to her before anything is saved. Each confirmed dose decrements the stock; the refill offer appears once per low-stock episode.
- **Refusals:** requests use the server-side fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`), so a declined request is retried on Anthropic's recommended model; `AI_FALLBACKS=off` disables it.
- **Domain rules** (`server/care.ts`): daily reminders are one row per occurrence at a fixed wall-clock time (DST-safe). Escalation keeps its clock across snoozes, and a confirmation clears its alert. A card left unanswered for 6 hours, or a reminder that would pop up more than 6 hours late after downtime, is recorded as missed. Inactivity counts only daytime hours (08:00–21:00). Private items never merge into lists the family sees. Weekly observations are plain rules over the last 14 days (`weeklyInsights`), so they are explainable and testable; the model only turns facts into sentences.

## Cost and model choice

Each server log line for an agent turn shows its tokens (input / cache read / cache write / output), so real usage can be measured with a key. A rough, **unmeasured** estimate for the default `claude-opus-5`: the cached prefix is about 6–7k tokens (a 7.5k-character Polish system prompt plus 20 tool schemas). A reply then costs roughly $0.01–0.03 when the 5-minute cache is warm and $0.05–0.07 when it is cold. A senior who talks about 15 times a day in a few separate sessions would cost on the order of $12–18 per month, plus a briefing a day, summaries when the family looks, and a few cents per guarded call.

That is well above the 5–8 zł per month for AI inference assumed in the unit economics of the proposal. The levers are configuration, not code: `AI_MODEL` (for example `claude-sonnet-5` or `claude-haiku-4-5`; set `AI_EFFORT=off` and `AI_FALLBACKS=off` for Haiku), `AI_EFFORT`, a shorter prompt, and the 1-hour cache TTL. Measure quality on real Polish conversations before choosing.

## Configuration

All settings live in `.env` (see `.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required for the model's words (agent, verdicts, briefing, summary) |
| `AI_MODEL` | `claude-opus-5` | Model for every AI call |
| `AI_EFFORT` / `AI_SCAM_EFFORT` | `low` / `medium` | Effort for conversation-like calls / for verdicts; `off` omits the parameter |
| `AI_FALLBACKS` | `on` | Server-side fallback on refusals |
| `SPENDING_LIMIT` | `150` | Orders above this total (zł) also need the family's approval |
| `ESCALATE_AFTER_MIN` | `30` | Unconfirmed medication → family alert |
| `CHECKIN_TIME` | `09:00` | Morning briefing and wellbeing question |
| `INACTIVITY_HOURS` | `6` | Daytime hours without interaction → yellow status |
| `SAFETY_CHECK_HOURS` | `4` | Daytime hours of silence before the app asks „Czy wszystko w porządku?” |
| `SAFETY_ESCALATE_MIN` | `15` | Minutes without an answer to that question → family alert |
| `APP_TZ`, `HOUSEHOLD_LAT`, `HOUSEHOLD_LON` | `Europe/Warsaw`, Lublin | Household timezone and weather location |
| `WEATHER` | on | `off` skips the Open-Meteo calls (offline demos, tests) |
| `SENIOR_PHONE`, `CONTACT_ANNA_PHONE`, `CONTACT_TOMEK_PHONE` | placeholders | Numbers for the `tel:` buttons |
| `GOOGLE_HEALTH_CLIENT_ID` / `_SECRET` | — | Google Health API (Fitbit, Pixel Watch): free Google Cloud project, OAuth client, test user |
| `WITHINGS_CLIENT_ID` / `_SECRET` | — | Withings Public API: free app in the Withings Developer Dashboard |
| `PUBLIC_URL` | `http://localhost:5173` | Where the browser opens the app; OAuth redirects go to `<PUBLIC_URL>/api/health/callback/<provider>` |
| `VITE_DEFAULT_THEME` | `dark` | First colours on a new phone: `auto` (recommended for real users: light by day, dark after sunset), `dark` (demo), `light`, `contrast` |
| `DEMO_PASSWORD` | — | One shared password for the whole site (the browser asks; any user name) |
| `DEMO_RESET_DAILY` | off | `1`: a fresh demo household every morning at 4:00 (for a public demo) |
| `PORT`, `DB_PATH`, `AUDIO_DIR` | `8787`, `data/care.db`, `data/audio` | Server port, SQLite file, voice messages |

The variables are `AI_*` rather than `CLAUDE_*` on purpose: tools such as Claude Code export `CLAUDE_EFFORT` into the shell.

## Project layout

```
server/
  index.ts            Express app, SSE, static hosting of dist/
  care.ts             household state and business rules (reminders, orders, insights…)
  scheduler.ts        time-driven rules (fire, escalate, expire, safety checks, morning briefing)
  routes.ts           senior, family, video and demo endpoints
  video.ts            video call state and WebRTC signalling relay
  seed.ts             demo household, two weeks of history, medicines, SMS presets
  partners.ts         demo shop, taxi and pharmacy (prices, delivery windows)
  weather.ts          Open-Meteo forecast and air quality
  sun.ts              sunrise and sunset at the household (for the automatic theme)
  audio.ts            voice message files
  health/             readings, limits and alerts, observations, Google Health and Withings adapters
  ai/                 agent, tools, prompts, Scam Shield, call guard, briefing, summary, medicine box
  __tests__/          vitest suites
src/
  pages/              SeniorApp, FamilyApp, DemoPanel, Present, Home
  components/         ui.tsx (design-system primitives), VideoCallScreen, AccessibilitySheet
  components/senior/  cards, call guard, voice recorder, „Moje leki”, „Moje zdrowie”, „Mój lekarz”, plan of the day, magnifier
  components/family/  summary, 7-day view, health card, doctors, notifications, message composer
  components/health/  7-day chart, beating heart
  lib/                a11y (settings), bluetooth (band and cuff), health, speech (STT/TTS), recorder, live state (SSE), video, safety, formatting, media
shared/               DTOs and call-guard rules shared by server and web
public/samples/       sample letters for „Przeczytaj pismo” and a (fictional) medicine box
deploy/               servers: Docker Compose with Caddy, setup, deploy, backup and restore (aicare), AWS provisioning
```

## Tests

```bash
npm test          # 109 tests: domain rules, DST, privacy, orders and consent, call guard, insights, agent loop, medicines, safety, video, health (limits, re-measure, sharing, Google Health and Withings parsing, Bluetooth frames, day rings and health monitor, accessibility, sunrise and sunset, plan of the day, water, temperature)
npm run typecheck
```

The agent tests run the real SDK tool runner against a fake HTTP transport: request shape (model, effort, cache marker, fallback header), tool execution, tool results, parallel calls, invalid input, refusals and API errors — all offline. A test also asserts that the agent has no tool to confirm or pay.

`npm run build` followed by `npm start` serves the built apps and the API from one port (8787).

## Design: „Nocny puls”

Both apps borrow the look and the mechanics of athlete health trackers (WHOOP-style: near-black screens, three score rings, big condensed numbers, a health monitor against your own baseline, tabs at the bottom) — the style and the ideas, not the brand. It is tuned for a 79-year-old reader and a busy daughter:

- **Dark, but readable:** near-black background, graphite cards, body text ≥ 7:1 on the cards (`--color-muted` #9aa8b1 on #141b20). Bright fills (buttons, icon circles, the SOS bar) carry dark text, never white on neon.
- **Type:** Atkinson Hyperlegible for every sentence (designed by the Braille Institute for low vision); Barlow Condensed only for numbers and short uppercase headings — the clock, readings, ring values. The **A / A+ / A++** switch still scales the whole senior screen.
- **Three rings a day — Leki, Ruch, Sen:** doses confirmed, steps against the goal, sleep against 7.5 h. Zones are green ≥ 67 %, yellow ≥ 34 %, red below; today's movement and a dose still ahead show as blue „w trakcie”, never as a failure. Every ring also says its state in words; on Mom's screen a tap reads it aloud. **‹ Dziś ›** (or a swipe, as a shortcut) goes back through the week.
- **Monitor zdrowia (Family App):** each vital against *her own* week — resting pulse, sleep, steps — or the guideline for blood pressure and SpO2, with a band, a marker and ✓ / ⚠ („3/4 w jej normie”). For an older person „is today like her usual?” says more than any absolute number.
- **Family App in four tabs:** Dziś (status, alerts, rings, summary, plan), Zdrowie (tiles, 7-day charts, thresholds, doses and mood), Dziennik (the filtered feed), Opieka (messages, calendar, apteczka, orders). A bottom bar on the phone, a pill switch on the computer; the tab is kept in the URL.
- **Built for the largest text:** every screen is checked at 175 % in all three themes for sideways scrolling — long Polish words break, ring numbers scale with the ring (container units), tiles and buttons re-flow by container queries, not by screen width.
- **Ułatwienia:** **Automatycznie** — the warm light „Ciepły spokój” palette while the sun is up at her home, the dark „Nocny puls” look after sunset (sunrise equation in `server/sun.ts`, no API) — is the recommended default for real users; the POC starts **Ciemny** for demos. One switch: `VITE_DEFAULT_THEME=auto` in `.env`. **Ciemny**, **Jasny** and **Wysoki kontrast** (black/white/yellow with 2 px outlines) can be fixed instead; all are token sets in `src/index.css`, so every screen follows. A phone that already saved its settings keeps them.
- **Unchanged principles:** colour never carries meaning alone, targets from 56 px, one decision per full-screen card, the breathing orb shows whether the assistant listens, thinks or speaks, and the same places on phone and computer.

Chart colours are validated for the dark surface (one series hue, `--color-series` #2f8ff0); status colours are reserved for zones and always come with an icon and a word.

## Not in the POC

- **Accounts and several caregivers** — one demo household, no authentication. Do not expose it to the internet as is.
- **Real SMS, calls and partners** — the SMS inbox is simulated from the demo panel; the call guard listens through the speaker, because a web app cannot tap a phone call; the shop and the taxi are stand-ins. Reading SMS or screening calls needs a native Android app (iOS does not allow either).
- **Push notifications** for the family (FCM / Web Push) and a native senior app that works with the screen locked — fall detection and incoming video calls only work while the app is open in the foreground.
- **A TURN server** for video across strict NATs, and group calls with several family members.
- **Real pharmacy integration** — the demo pharmacy tops the stock up as soon as the order is placed; a real one would do it on delivery. Prescription medicines need an e-recepta flow.
- **Voice latency and quality** — streaming replies sentence by sentence and a neural Polish TTS voice; a wake word.
- **RODO/GDPR** — health data is a special category: consent flows (including for the call guard and voice recordings), EU data residency, retention and deletion.
- **An evaluation set** of real Polish senior conversations, scam calls and messages to tune prompts, the model and costs before scaling.
