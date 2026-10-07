import {
  Accessibility,
  Activity,
  Bell,
  ChevronRight,
  HeartHandshake,
  House,
  BellRing,
  BellOff,
  CalendarDays,
  CarTaxiFront,
  CircleCheck,
  Clock,
  Frown,
  GlassWater,
  Headphones,
  Heart,
  HeartPulse,
  Lock,
  MapPin,
  Meh,
  MessageCircle,
  NotebookPen,
  PackageCheck,
  PackageX,
  Phone,
  PhoneCall,
  Pill,
  Plus,
  Pointer,
  Receipt,
  ShieldAlert,
  ShieldCheck,
  ShoppingBasket,
  Syringe,
  Siren,
  Smile,
  Sparkles,
  Stethoscope,
  TriangleAlert,
  UserRound,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { CalendarEvent, FamilyState, FeedItem, FeedKind, Medicine, Order, StatusLevel, TimelineItem } from '../../shared/types';
import { AccessibilitySheet } from '../components/AccessibilitySheet';
import { CareTeamCard } from '../components/family/CareTeamCard';
import { GuideCard } from '../components/family/GuideCard';
import { HealthCard } from '../components/family/HealthCard';
import { DayRings } from '../components/health/DayRings';
import { MessageComposer } from '../components/family/MessageComposer';
import { SummaryCard } from '../components/family/SummaryCard';
import { SeniorScreenCard } from '../components/family/SeniorScreenCard';
import { Toasts } from '../components/family/Toasts';
import { WeekCard } from '../components/family/WeekCard';
import { Avatar, IconBadge, type Tone } from '../components/ui';
import { VideoCallScreen } from '../components/VideoCallScreen';
import { previewAutoTheme, setSunTimes } from '../lib/a11y';
import { postJson } from '../lib/api';
import { dayKey, fmtMoney, fmtTime, fmtWhen, hourIn, timeAgo } from '../lib/format';
import { chime, unlockAudio } from '../lib/media';
import { fmtSeconds } from '../lib/recorder';
import { mapLink } from '../lib/safety';
import { onServerEvent } from '../lib/serverEvents';
import { useLiveState, useNow } from '../lib/useLiveState';
import { useVideoCall, videoSupported } from '../lib/video';

const STATUS: Record<StatusLevel, { icon: LucideIcon; pill: string; ring: string }> = {
  ok: { icon: CircleCheck, pill: 'bg-ok-soft text-ok', ring: 'ring-white/5' },
  attention: { icon: TriangleAlert, pill: 'bg-warn-soft text-warn', ring: 'ring-2 ring-warn/40' },
  urgent: { icon: Siren, pill: 'bg-danger text-on-accent', ring: 'ring-4 ring-danger/70' },
};

/** Icon and resting colour per kind; warnings and urgent items override the colour. */
const FEED: Record<FeedKind, { icon: LucideIcon; tone: Tone }> = {
  medication_taken: { icon: Pill, tone: 'ok' },
  medication_missed: { icon: Pill, tone: 'warn' },
  reminder_done: { icon: CircleCheck, tone: 'ok' },
  reminder_missed: { icon: Clock, tone: 'warn' },
  reminder_created: { icon: Bell, tone: 'sky' },
  reminder_cancelled: { icon: BellOff, tone: 'sand' },
  event_created: { icon: CalendarDays, tone: 'sky' },
  task_created: { icon: ShoppingBasket, tone: 'sun' },
  task_done: { icon: CircleCheck, tone: 'ok' },
  scam_detected: { icon: ShieldAlert, tone: 'teal' },
  message_from_senior: { icon: MessageCircle, tone: 'lilac' },
  call_request: { icon: PhoneCall, tone: 'teal' },
  wellbeing: { icon: Smile, tone: 'sun' },
  emergency: { icon: Siren, tone: 'danger' },
  family_action: { icon: UserRound, tone: 'sand' },
  order_placed: { icon: PackageCheck, tone: 'ok' },
  order_needs_approval: { icon: Receipt, tone: 'warn' },
  order_declined: { icon: PackageX, tone: 'sand' },
  call_guard: { icon: ShieldCheck, tone: 'teal' },
  sos: { icon: Siren, tone: 'danger' },
  fall: { icon: HeartPulse, tone: 'sand' },
  safety_check: { icon: HeartPulse, tone: 'sand' },
  medicine_added: { icon: Pill, tone: 'teal' },
  medicine_low: { icon: Pill, tone: 'warn' },
  video_call: { icon: Video, tone: 'brand' },
  health: { icon: Activity, tone: 'rose' },
};

function feedLook(item: FeedItem): { icon: LucideIcon; tone: Tone } {
  if (item.kind === 'wellbeing') {
    return item.severity === 'warning' ? { icon: Frown, tone: 'warn' } : item.severity === 'info' ? { icon: Meh, tone: 'sun' } : { icon: Smile, tone: 'ok' };
  }
  const base = FEED[item.kind];
  if (item.severity === 'urgent') return { ...base, tone: 'danger' };
  if (item.severity === 'warning') return { ...base, tone: 'warn' };
  return base;
}

/** The server marks timeline rows with an emoji; the dashboard draws them as icons. */
const TIMELINE_ICON: Record<string, { icon: LucideIcon; tone: Tone }> = {
  '💊': { icon: Pill, tone: 'teal' },
  '💉': { icon: Syringe, tone: 'rose' },
  '🩺': { icon: Stethoscope, tone: 'sky' },
  '🛒': { icon: ShoppingBasket, tone: 'sun' },
  '📝': { icon: NotebookPen, tone: 'sand' },
};

const TIMELINE_STATUS: Record<TimelineItem['tone'], { text: string; icon: LucideIcon | null }> = {
  done: { text: 'text-ok', icon: CircleCheck },
  pending: { text: 'text-warn', icon: Clock },
  warning: { text: 'text-danger font-bold', icon: TriangleAlert },
  neutral: { text: 'text-muted', icon: null },
};

const ORDER_ICON: Record<Order['kind'], LucideIcon> = { groceries: ShoppingBasket, taxi: CarTaxiFront, pharmacy: Pill };

const ORDER_STATUS: Record<Order['status'], { label: (o: Order) => string; tone: string }> = {
  awaiting_senior: { label: () => 'czeka na decyzję', tone: 'text-muted' },
  awaiting_family: { label: () => 'czeka na Twoją zgodę', tone: 'text-warn font-semibold' },
  placed: { label: (o) => `złożone · ${o.kind === 'taxi' ? 'odbiór' : 'dostawa'} ${o.eta ?? ''}`, tone: 'text-ok' },
  declined: { label: (o) => (o.declinedBy === 'family' ? 'odrzucone przez Ciebie' : o.declinedBy === 'system' ? 'wygasło bez potwierdzenia' : 'anulowane'), tone: 'text-muted' },
};

const FEED_PREVIEW = 12;

type FeedFilter = 'all' | 'meds' | 'health' | 'safety' | 'contact' | 'orders';

const FEED_FILTERS: { key: FeedFilter; label: string; kinds?: FeedKind[] }[] = [
  { key: 'all', label: 'Wszystko' },
  { key: 'meds', label: 'Leki', kinds: ['medication_taken', 'medication_missed', 'reminder_done', 'reminder_missed', 'reminder_created', 'reminder_cancelled', 'medicine_added', 'medicine_low'] },
  { key: 'health', label: 'Zdrowie', kinds: ['health', 'wellbeing'] },
  { key: 'safety', label: 'Bezpieczeństwo', kinds: ['scam_detected', 'call_guard', 'sos', 'fall', 'safety_check', 'emergency'] },
  { key: 'contact', label: 'Kontakt', kinds: ['message_from_senior', 'call_request', 'video_call', 'family_action'] },
  { key: 'orders', label: 'Zamówienia', kinds: ['order_placed', 'order_needs_approval', 'order_declined', 'task_created', 'task_done'] },
];

/** News from her side worth a quick "I saw it, love you" without typing. */
const HEARTABLE: FeedKind[] = ['message_from_senior', 'wellbeing', 'medication_taken', 'reminder_done', 'task_done', 'health'];

const HEART_TEXT = '❤️ Ściskam mocno!';

export function FamilyApp() {
  const { data: state, offline, refresh } = useLiveState<FamilyState>('/api/family/state');
  const now = useNow(30_000);
  const [form, setForm] = useState<'reminder' | 'event' | 'medicine' | null>(null);
  const [allFeed, setAllFeed] = useState(false);
  const [feedFilter, setFeedFilter] = useState<FeedFilter>('all');
  const [hearted, setHearted] = useState<Set<number>>(() => new Set());
  const [flash, setFlash] = useState<number | null>(null);
  const [nudged, setNudged] = useState<Set<string>>(() => new Set());
  const knownAlerts = useRef<Set<number> | null>(null);
  const video = useVideoCall('family');
  const [healthNotice, setHealthNotice] = useState(readHealthRedirect);
  const [tab, setTab] = useTab();
  const [settings, setSettings] = useState(false);

  // "Automatycznie" follows the sun at her home; the demo can preview the evening at noon.
  useEffect(() => {
    if (state?.sun) setSunTimes(state.sun);
  }, [state?.sun.sunrise, state?.sun.sunset]);
  useEffect(() => onServerEvent('theme_preview', (data) => previewAutoTheme((data as { theme: 'light' | 'dark' | null }).theme)), []);

  // Browsers keep audio locked until the first tap.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    if (state?.video) video.adopt(state.video);
  }, [state?.video?.id]);

  // Sound and vibration for alerts that arrive while the app is open.
  useEffect(() => {
    if (!state) return;
    const ids = new Set(state.alerts.map((a) => a.id));
    if (knownAlerts.current && [...ids].some((id) => !knownAlerts.current!.has(id))) {
      chime('alert');
      navigator.vibrate?.(state.alerts.some((a) => a.severity === 'urgent') ? [300, 150, 300] : 250);
    }
    knownAlerts.current = ids;
    document.title = `${state.alerts.length ? `(${state.alerts.length}) ` : ''}Rodzina · AI Care`;
  }, [state]);

  if (!state) {
    return (
      <FamilyShell>
        <p className="mt-24 text-center text-lg text-muted">{offline ? 'Brak połączenia z serwerem…' : 'Wczytywanie…'}</p>
      </FamilyShell>
    );
  }

  const { profile, status } = state;
  const senior = profile.familyCallsHer;
  const tel = `tel:${profile.phone.replace(/\s/g, '')}`;
  const look = STATUS[status.level];
  const doses = state.today.filter((i) => i.icon === '💊' || i.icon === '💉');
  const localNow = fmtTime(now, state.tz);
  const next = state.today.find((i) => i.time && i.time >= localNow && i.tone !== 'done');
  const filterKinds = FEED_FILTERS.find((f) => f.key === feedFilter)?.kinds;
  const filtered = filterKinds ? state.feed.filter((f) => filterKinds.includes(f.kind)) : state.feed;
  const feed = allFeed ? filtered : filtered.slice(0, FEED_PREVIEW);
  const sendHeart = (item: FeedItem) => {
    setHearted((h) => new Set(h).add(item.id));
    void postJson('/api/family/messages', { text: HEART_TEXT }).then(refresh);
  };
  const nudge = (key: string) => {
    setNudged((n) => new Set(n).add(key));
    postJson(`/api/family/reminders/${key.slice(1)}/nudge`)
      .catch(() =>
        // Confirmed in the meantime: the row updates on refresh, the button comes back if still pending.
        setNudged((n) => {
          const next = new Set(n);
          next.delete(key);
          return next;
        }),
      )
      .finally(refresh);
  };
  const openFeedItem = (item: FeedItem) => {
    setTab('feed');
    setFeedFilter('all');
    setAllFeed(true);
    setFlash(item.id);
    window.setTimeout(() => document.getElementById(`feed-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    window.setTimeout(() => setFlash(null), 2_500);
  };
  const done = () => {
    setForm(null);
    void refresh();
  };

  return (
    <FamilyShell viewer={state.viewer.name} tab={tab} onTab={setTab} alerts={state.alerts.length} onSettings={() => setSettings(true)}>
      {offline && <p className="mb-4 rounded-2xl bg-danger-soft px-4 py-2 text-danger">Brak połączenia z serwerem — ponawiam…</p>}

      {tab === 'today' && (
        <>
          <section className={`overflow-hidden rounded-[2rem] bg-surface shadow-soft ring-1 ${look.ring}`}>
            <div className="flex flex-wrap items-center gap-5 p-5 sm:p-6">
              <Avatar name={senior} size={80} />
              <div className="min-w-0 flex-1">
                <h1 className="kicker text-4xl leading-none">{senior}</h1>
                <p className="text-base text-muted">
                  {profile.fullName}, {profile.age} lat · {profile.city}
                </p>
                <p className={`mt-3 inline-flex max-w-full items-center gap-2 rounded-full px-4 py-1.5 text-lg font-bold ${look.pill}`}>
                  <look.icon size={22} /> {status.label}
                </p>
                {status.reason && <p className="mt-2 text-base leading-snug">{status.reason}</p>}
              </div>
              <div className="grid w-full grid-cols-2 gap-3 sm:w-auto sm:min-w-72">
                <a href={tel} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-ok px-5 text-lg font-bold text-on-accent shadow-sm hover:brightness-110">
                  <Phone size={22} /> Zadzwoń
                </a>
                <button
                  type="button"
                  onClick={() => void video.start()}
                  disabled={!videoSupported}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-brand px-5 text-lg font-bold text-on-accent shadow-sm hover:bg-brand-strong disabled:opacity-50"
                >
                  <Video size={24} /> Wideo
                </button>
              </div>
            </div>
            <dl className="grid grid-cols-1 divide-y divide-line border-t border-line bg-paper/60 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <Stat icon={Clock} label="Ostatnia aktywność" value={state.lastActivityAt ? timeAgo(state.lastActivityAt, now) : 'brak danych'} />
              <Stat icon={Pill} label="Leki dziś" value={doses.length ? `${doses.filter((d) => d.tone === 'done').length} z ${doses.length} potwierdzone` : 'brak dawek'} />
              <Stat icon={CalendarDays} label="Następne" value={next ? `${next.time} · ${next.title}` : 'nic więcej na dziś'} />
            </dl>
          </section>

          {state.alerts.length > 0 && (
            <section className="mt-5" aria-label="Wymaga uwagi">
              <h2 className="mb-3 flex items-center gap-2 text-xl font-bold">
                Wymaga uwagi <span className="rounded-full bg-danger px-2.5 py-0.5 text-base text-on-accent">{state.alerts.length}</span>
              </h2>
              <ul className="grid gap-3 lg:grid-cols-2">
                {state.alerts.map((alert) => (
                  <AlertCard
                    key={alert.id}
                    alert={alert}
                    now={now}
                    tz={state.tz}
                    tel={tel}
                    onVideo={videoSupported ? () => void video.start() : null}
                    onAck={() => void postJson(`/api/family/alerts/${alert.id}/ack`).then(refresh)}
                    onOrder={(approve) => void postJson(`/api/family/orders/${alert.orderId}/${approve ? 'approve' : 'decline'}`).then(refresh)}
                  />
                ))}
              </ul>
            </section>
          )}

          <div className="mt-5 gap-5 space-y-5 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:space-y-0">
            <div className="space-y-5">
              <Card title="Dzień" icon={Activity} tone="teal" action={<TabLink onClick={() => setTab('health')}>Trendy</TabLink>}>
                <DayRings days={state.health.days} doses={state.insights.days} thresholds={state.health.thresholds} monitor />
              </Card>
              <Card title="Podsumowanie dnia" icon={Sparkles} tone="sun">
                <SummaryCard version={state.feed[0]?.id ?? 0} tz={state.tz} />
              </Card>
            </div>
            <div className="space-y-5">
              <Card title="Dzisiaj" icon={CalendarDays} tone="sky">
                <WaterLine water={state.water} senior={senior} />
                {state.today.length === 0 ? (
                  <p className="text-muted">Na dziś nic nie zaplanowano.</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {state.today.map((item) => {
                      const icon = TIMELINE_ICON[item.icon] ?? { icon: Bell, tone: 'sand' as Tone };
                      const st = TIMELINE_STATUS[item.tone];
                      return (
                        <li key={item.key} className="flex items-center gap-3 py-3">
                          <span className="w-12 shrink-0 font-bold tabular-nums">{item.time ?? '—'}</span>
                          <IconBadge icon={icon.icon} tone={icon.tone} size={36} />
                          <div className="min-w-0 flex-1">
                            <p className="leading-snug">{item.title}</p>
                            <p className={`flex items-center gap-1 text-sm ${st.text}`}>
                              {st.icon && <st.icon size={15} />}
                              {item.statusLabel}
                            </p>
                          </div>
                          {item.key.startsWith('r') && (item.tone === 'pending' || item.tone === 'warning') && (
                            <button
                              type="button"
                              onClick={() => void postJson(`/api/family/reminders/${item.key.slice(1)}/done`).then(refresh)}
                              title={profile.gender === 'f' ? `${senior} potwierdziła przez telefon? Zaznacz za nią.` : `${senior} potwierdził przez telefon? Zaznacz za niego.`}
                              className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-ok-soft px-3 text-sm font-semibold text-ok hover:bg-ok hover:text-on-accent"
                            >
                              <CircleCheck size={16} /> Potwierdź
                            </button>
                          )}
                          {item.key.startsWith('r') && (item.tone === 'pending' || item.tone === 'warning') && (
                            <button
                              type="button"
                              onClick={() => nudge(item.key)}
                              disabled={nudged.has(item.key)}
                              className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand-soft px-3 text-sm font-semibold text-brand-strong hover:bg-brand hover:text-on-accent disabled:bg-ok-soft disabled:text-ok"
                            >
                              {nudged.has(item.key) ? <CircleCheck size={16} /> : <BellRing size={16} />}
                              {nudged.has(item.key) ? 'Wysłane' : 'Przypomnij teraz'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
              {state.upcoming.length > 0 && (
                <Card title="Nadchodzące" icon={Stethoscope} tone="sky">
                  <ul className="space-y-3">
                    {state.upcoming.map((e) => (
                      <UpcomingVisit key={e.id} event={e} now={now} tz={state.tz} onChange={() => void refresh()} />
                    ))}
                  </ul>
                </Card>
              )}
            </div>
          </div>
        </>
      )}

      {tab === 'health' && (
        <div className="gap-5 space-y-5 lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-start lg:space-y-0">
          <Card title="Zdrowie" icon={Activity} tone="rose">
            {healthNotice && (
              <p className={`mb-3 flex items-start justify-between gap-2 rounded-2xl px-3 py-2 ${healthNotice.ok ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`} role="status">
                {healthNotice.text}
                <button type="button" onClick={() => setHealthNotice(null)} aria-label="Zamknij" className="shrink-0">
                  <X size={18} />
                </button>
              </p>
            )}
            <HealthCard health={state.health} senior={senior} now={now} onChange={() => void refresh()} />
          </Card>
          <Card title="Ostatnie 7 dni" icon={HeartPulse} tone="teal">
            <WeekCard insights={state.insights} />
          </Card>
        </div>
      )}

      {tab === 'feed' && (
        <div className="mx-auto max-w-3xl">
          <Card title="Aktywność" icon={Clock} tone="sand">
            <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Filtruj aktywność">
              {FEED_FILTERS.map((f) => {
                const count = f.kinds ? state.feed.filter((x) => f.kinds!.includes(x.kind)).length : state.feed.length;
                if (f.kinds && !count) return null;
                return (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={feedFilter === f.key}
                    onClick={() => setFeedFilter(f.key)}
                    className={`flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ring-1 transition ${feedFilter === f.key ? 'bg-ink text-on-accent ring-ink' : 'bg-surface ring-line hover:ring-brand'}`}
                  >
                    {f.label} <span className={`tabular-nums ${feedFilter === f.key ? 'text-on-accent/70' : 'text-muted'}`}>{count}</span>
                  </button>
                );
              })}
            </div>
            <ul className="space-y-4">
              {feed.map((item) => {
                const { icon, tone } = feedLook(item);
                const canHeart = HEARTABLE.includes(item.kind) && item.severity !== 'warning' && item.severity !== 'urgent';
                return (
                  <li key={item.id} id={`feed-${item.id}`} className={`-mx-2 flex gap-3 rounded-2xl px-2 py-1 transition-colors duration-700 ${flash === item.id ? 'bg-brand-soft' : ''}`}>
                    <IconBadge icon={icon} tone={tone} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold leading-snug">{item.title}</p>
                      {item.detail && <p className="leading-snug text-muted">{item.mediaUrl ? `„${item.detail}”` : item.detail}</p>}
                      {item.mediaUrl && <audio src={item.mediaUrl} controls preload="none" className="mt-1 h-9 w-full" />}
                      {item.geo && <MapLinkButton geo={item.geo} />}
                      <p className="text-sm text-muted">{fmtWhen(item.createdAt, now, state.tz)}</p>
                    </div>
                    {canHeart && (
                      <button
                        type="button"
                        onClick={() => sendHeart(item)}
                        disabled={hearted.has(item.id)}
                        aria-label={hearted.has(item.id) ? 'Serduszko wysłane' : `Wyślij serduszko do ${profile.familyCallsHerGenitive}`}
                        title={hearted.has(item.id) ? 'Wysłane' : 'Wyślij serduszko'}
                        className="grid size-10 shrink-0 place-items-center self-center rounded-full text-muted transition hover:bg-tint-rose hover:text-danger disabled:text-danger"
                      >
                        <Heart size={20} fill={hearted.has(item.id) ? 'currentColor' : 'none'} className={hearted.has(item.id) ? 'pop' : ''} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {filtered.length > FEED_PREVIEW && (
              <button type="button" onClick={() => setAllFeed(!allFeed)} className="mt-4 min-h-11 w-full rounded-2xl font-semibold text-brand ring-1 ring-line hover:bg-brand-soft">
                {allFeed ? 'Pokaż mniej' : `Pokaż wszystko (${filtered.length})`}
              </button>
            )}
          </Card>
        </div>
      )}

      {tab === 'care' && (
        <div className="gap-5 space-y-5 lg:grid lg:grid-cols-2 lg:items-start lg:space-y-0">
          <div className="space-y-5">
            <Card title="Pokaż palcem" icon={Pointer} tone="teal">
              <GuideCard senior={senior} seniorGenitive={profile.familyCallsHerGenitive} female={profile.gender === 'f'} />
            </Card>
            <Card title={`Ekran ${profile.familyCallsHerGenitive}`} icon={Accessibility} tone="sky">
              <SeniorScreenCard display={state.display} senior={senior} now={now} onChange={() => void refresh()} />
            </Card>
            <Card title={`Napisz do ${profile.familyCallsHerGenitive}`} icon={MessageCircle} tone="lilac">
              <MessageComposer onSent={refresh} senior={senior} />
              {state.sentMessages.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {state.sentMessages.slice(0, 3).map((m) => (
                    <li key={m.id} className="rounded-2xl bg-tint-lilac/70 px-3 py-2">
                      {m.audioUrl && (
                        <p className="mb-1 flex items-center gap-2 text-sm font-semibold">
                          <Headphones size={16} /> Wiadomość głosowa {m.audioSeconds ? fmtSeconds(m.audioSeconds) : ''}
                        </p>
                      )}
                      {m.audioUrl && <audio src={m.audioUrl} controls preload="none" className="mb-1 h-9 w-full" />}
                      {m.text && <p className="leading-snug">{m.audioUrl ? `„${m.text}”` : m.text}</p>}
                      <p className="mt-1 text-sm text-muted">
                        {fmtWhen(m.createdAt, now, state.tz)} · {m.readAt ? `✓✓ odsłuchana ${fmtTime(m.readAt, state.tz)}` : '✓ wysłana'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Dodaj do kalendarza" icon={Plus} tone="sand">
              <div className="grid grid-cols-2 gap-3">
                <SmallButton wide active={form === 'reminder'} onClick={() => setForm(form === 'reminder' ? null : 'reminder')}>
                  <Bell size={18} /> Przypomnienie
                </SmallButton>
                <SmallButton wide active={form === 'event'} onClick={() => setForm(form === 'event' ? null : 'event')}>
                  <Stethoscope size={18} /> Wizyta
                </SmallButton>
              </div>
              {form === 'reminder' && <ReminderForm tz={state.tz} now={now} onDone={done} />}
              {form === 'event' && <EventForm tz={state.tz} now={now} onDone={done} />}
            </Card>
          </div>
          <div className="space-y-5">
            <Card title="Lekarz i przychodnia" icon={Stethoscope} tone="sky">
              <CareTeamCard team={state.careTeam} senior={senior} onChange={() => void refresh()} />
            </Card>
            <Card
              title="Apteczka"
              icon={Pill}
              tone="teal"
              action={
                <SmallButton active={form === 'medicine'} onClick={() => setForm(form === 'medicine' ? null : 'medicine')}>
                  {form === 'medicine' ? <X size={18} /> : <Plus size={18} />} Lek
                </SmallButton>
              }
            >
              {form === 'medicine' && <MedicineForm onDone={done} />}
              {state.medicines.length === 0 ? (
                <p className="text-muted">Apteczka jest pusta.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {state.medicines.map((m) => (
                    <MedicineRow key={m.id} medicine={m} />
                  ))}
                </ul>
              )}
              <p className="mt-3 text-sm text-muted">
                {senior} może dodać lek sama — zdjęciem opakowania. Dawkowanie zawsze z opakowania lub od lekarza; gdy lek się kończy, asystentka zaproponuje zamówienie w aptece.
              </p>
            </Card>
            {state.orders.length > 0 && (
              <Card title="Zamówienia" icon={ShoppingBasket} tone="sun">
                <ul className="space-y-3">
                  {state.orders.map((o) => {
                    const Icon = ORDER_ICON[o.kind];
                    return (
                      <li key={o.id} className="flex gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-tint-sun text-deep-sun">
                          <Icon size={19} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex justify-between gap-2 font-semibold leading-snug">
                            <span>{o.title}</span>
                            <span className="shrink-0 tabular-nums">{fmtMoney(o.total)}</span>
                          </p>
                          <p className={`text-sm ${ORDER_STATUS[o.status].tone}`}>{ORDER_STATUS[o.status].label(o)}</p>
                          <p className="text-sm text-muted">
                            {fmtWhen(o.createdAt, now, state.tz)} · {o.partner}
                            {o.reference ? ` · nr ${o.reference}` : ''}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-3 text-sm text-muted">
                  Zamówienia powyżej {fmtMoney(state.spendingLimit)} wymagają Twojej zgody. Asystentka nigdy nie zamawia bez potwierdzenia {profile.familyCallsHerGenitive}.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}

      <p className="mt-6 flex items-start gap-2 px-1 text-muted">
        <Lock size={18} className="mt-1 shrink-0" />
        Nie pokazujemy treści rozmów {profile.familyCallsHerGenitive} z asystentką. Widzisz tylko istotne informacje: plan dnia, potwierdzenia, apteczkę i alerty bezpieczeństwa.
      </p>
      {!state.ai.configured && <p className="mt-2 px-1 text-sm text-warn">Tryb bez AI: Scam Shield działa na lokalnych regułach, asystentka głosowa jest wyłączona.</p>}


      {settings && <AccessibilitySheet senior={false} onClose={() => setSettings(false)} />}
      <Toasts feed={state.feed} look={feedLook} onOpen={openFeedItem} />
      <VideoCallScreen call={video} peer={senior} />
    </FamilyShell>
  );
}

const HEALTH_REDIRECT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'Konto połączone — pierwsze dane pojawią się w ciągu kilku minut.' },
  denied: { ok: false, text: 'Połączenie anulowane — nic nie zostało udostępnione.' },
  error: { ok: false, text: 'Nie udało się połączyć konta. Spróbuj jeszcze raz.' },
  not_configured: { ok: false, text: 'Ta usługa nie jest skonfigurowana na serwerze (brak kluczy w .env) — zobacz „Jak to działa?”.' },
};

/** After OAuth the server sends the family back with ?health=…; show it once, then clean the URL. */
function readHealthRedirect(): { ok: boolean; text: string } | null {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('health');
  if (!result) return null;
  params.delete('health');
  window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
  return HEALTH_REDIRECT[result] ?? null;
}

type Tab = 'today' | 'health' | 'feed' | 'care';

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'today', label: 'Dziś', icon: House },
  { key: 'health', label: 'Zdrowie', icon: Activity },
  { key: 'feed', label: 'Dziennik', icon: Clock },
  { key: 'care', label: 'Opieka', icon: HeartHandshake },
];

/** The tab lives in the URL hash, so a reload (or a shared link) opens the same view. */
function useTab(): [Tab, (t: Tab) => void] {
  const read = () => (TABS.find((t) => `#${t.key}` === window.location.hash)?.key ?? 'today') as Tab;
  const [tab, setTabState] = useState<Tab>(read);
  useEffect(() => {
    const onHash = () => setTabState(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setTab = (t: Tab) => {
    window.history.replaceState(null, '', t === 'today' ? window.location.pathname + window.location.search : `#${t}`);
    setTabState(t);
    window.scrollTo({ top: 0 });
  };
  return [tab, setTab];
}

function FamilyShell({
  children,
  viewer,
  tab,
  onTab,
  alerts = 0,
  onSettings,
}: {
  children: ReactNode;
  viewer?: string;
  tab?: Tab;
  onTab?: (t: Tab) => void;
  alerts?: number;
  onSettings?: () => void;
}) {
  const nav = (placement: 'top' | 'bottom') =>
    tab &&
    onTab && (
      <nav
        aria-label="Sekcje"
        className={
          placement === 'top'
            ? 'hidden gap-1 rounded-full bg-raised p-1 lg:flex'
            : 'fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-paper/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur lg:hidden'
        }
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          const badge = t.key === 'today' && alerts > 0;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onTab(t.key)}
              aria-current={active ? 'page' : undefined}
              className={
                placement === 'top'
                  ? `relative flex items-center gap-2 rounded-full px-4 py-2 font-semibold transition ${active ? 'bg-ink text-on-accent' : 'text-muted hover:text-ink'}`
                  : `relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-xs font-semibold transition ${active ? 'text-ink' : 'text-muted'}`
              }
            >
              <span className={placement === 'bottom' && active ? 'grid h-8 w-14 place-items-center rounded-full bg-raised' : 'grid place-items-center'}>
                <t.icon size={placement === 'top' ? 18 : 22} strokeWidth={active ? 2.5 : 2} />
              </span>
              {t.label}
              {badge && <span className="absolute right-3 top-1 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-on-accent lg:static">{alerts}</span>}
            </button>
          );
        })}
      </nav>
    );

  return (
    <main className="min-h-dvh bg-family-bg text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <p className="flex items-center gap-2.5">
            <span className="orb size-8" data-phase="idle" aria-hidden />
            <span className="kicker text-xl">
              <span className="text-brand">AI Care</span> <span className="text-muted">·</span> Rodzina
            </span>
          </p>
          {nav('top')}
          <span className="flex items-center gap-2">
            {onSettings && (
              <button type="button" onClick={onSettings} aria-label="Ułatwienia: tekst i kolory" title="Ułatwienia" className="grid size-11 place-items-center rounded-full bg-raised text-ink hover:bg-line">
                <Accessibility size={22} />
              </button>
            )}
            {viewer && (
              <span className="flex items-center gap-2 text-muted">
                <span className="hidden sm:inline">{viewer}</span>
                <Avatar name={viewer} size={36} />
              </span>
            )}
          </span>
        </div>
      </header>
      <div className={`mx-auto max-w-6xl px-4 pt-5 sm:px-6 ${tab ? 'pb-28 lg:pb-12' : 'pb-12'}`}>{children}</div>
      {nav('bottom')}
    </main>
  );
}

function TabLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-10 items-center gap-1 rounded-full px-3 text-sm font-semibold text-brand hover:bg-brand-soft">
      {children} <ChevronRight size={16} />
    </button>
  );
}

function Card({ title, icon, tone, action, children }: { title: string; icon: LucideIcon; tone: Tone; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-[1.75rem] bg-surface p-5 shadow-soft ring-1 ring-white/5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="kicker flex items-center gap-3 text-xl">
          <IconBadge icon={icon} tone={tone} size={36} />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function SmallButton({ active, onClick, children, wide = false }: { active: boolean; onClick: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex min-h-11 items-center justify-center gap-1.5 rounded-2xl px-4 font-semibold ring-1 transition ${wide ? 'w-full' : ''} ${active ? 'bg-brand text-on-accent ring-brand' : 'bg-surface ring-line hover:ring-brand'}`}
    >
      {children}
    </button>
  );
}

/** A visit in "Nadchodzące": moved or cancelled from here too; Mom's reminder follows. */
function UpcomingVisit({ event: e, now, tz, onChange }: { event: CalendarEvent; now: Date; tz: string; onChange: () => void }) {
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(dayKey(e.startsAt, tz));
  const [time, setTime] = useState(fmtTime(e.startsAt, tz));
  const [error, setError] = useState(false);

  async function move(ev: FormEvent) {
    ev.preventDefault();
    try {
      await postJson(`/api/family/events/${e.id}/move`, { date, time });
      setMoving(false);
      onChange();
    } catch {
      setError(true);
    }
  }

  return (
    <li>
      <div className="flex flex-wrap items-center gap-3">
        <IconBadge icon={CalendarDays} tone="sky" size={36} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">{e.title}</p>
          <p className="text-sm text-muted">
            {fmtWhen(e.startsAt, now, tz)}
            {e.location ? ` · ${e.location}` : ''}
          </p>
        </div>
        <span className="flex gap-1.5">
          <SmallButton active={moving} onClick={() => setMoving(!moving)}>
            Przenieś
          </SmallButton>
          <button
            type="button"
            onClick={() => window.confirm(`Odwołać: ${e.title}?`) && void postJson(`/api/family/events/${e.id}/cancel`).then(onChange)}
            aria-label={`Odwołaj: ${e.title}`}
            className="grid size-11 place-items-center rounded-2xl text-muted ring-1 ring-line hover:text-danger hover:ring-danger"
          >
            <X size={18} />
          </button>
        </span>
      </div>
      {moving && (
        <form onSubmit={move} className="mt-2 flex flex-wrap gap-2 rounded-2xl bg-raised p-2">
          <input type="date" required value={date} onChange={(ev) => setDate(ev.target.value)} className={`${inputClass} min-w-[9.5rem] flex-1`} aria-label="Nowy dzień" />
          <input type="time" required value={time} onChange={(ev) => setTime(ev.target.value)} className={`${inputClass} w-32 flex-none`} aria-label="Nowa godzina" />
          <button type="submit" className="min-h-12 flex-1 rounded-2xl bg-brand px-4 font-semibold text-on-accent">
            Zapisz
          </button>
          {error && <p className="w-full text-sm text-danger">Termin musi być w przyszłości.</p>}
        </form>
      )}
    </li>
  );
}

function WaterLine({ water, senior }: { water: FamilyState['water']; senior: string }) {
  const l = (ml: number) => (ml / 1000).toFixed(1).replace('.', ',');
  const share = Math.min(1, water.ml / water.goalMl);
  return (
    <div className="mb-3 rounded-2xl bg-tint-sky p-3">
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          <GlassWater size={18} className="text-deep-sky" /> Woda
        </span>
        <span>
          <span className="num text-xl">{l(water.ml)} l</span> <span className="text-sm text-muted">z {l(water.goalMl)} l{water.lastAt ? ` · ostatnio ${fmtTime(water.lastAt)}` : ''}</span>
        </span>
      </p>
      <span className="mt-2 block h-2 rounded-full bg-surface" role="meter" aria-valuemin={0} aria-valuemax={water.goalMl} aria-valuenow={water.ml} aria-label={`Woda wypita dziś przez: ${senior}`}>
        <span className="block h-2 rounded-full bg-deep-sky transition-[width] duration-700" style={{ width: `${share * 100}%` }} />
      </span>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3.5">
      <Icon size={22} className="shrink-0 text-muted" />
      <div className="min-w-0">
        <dt className="text-sm text-muted">{label}</dt>
        <dd className="truncate font-semibold">{value}</dd>
      </div>
    </div>
  );
}

function MapLinkButton({ geo }: { geo: NonNullable<FeedItem['geo']> }) {
  return (
    <a href={mapLink(geo)} target="_blank" rel="noreferrer" className="mt-1 inline-flex min-h-10 items-center gap-1.5 font-semibold text-brand underline-offset-2 hover:underline">
      <MapPin size={18} /> Pokaż na mapie{geo.accuracy ? ` (±${geo.accuracy} m)` : ''}
    </a>
  );
}

function AlertCard({
  alert,
  now,
  tz,
  tel,
  onAck,
  onOrder,
  onVideo,
}: {
  alert: FeedItem;
  now: Date;
  tz: string;
  tel: string;
  onAck: () => void;
  onOrder: (approve: boolean) => void;
  onVideo: (() => void) | null;
}) {
  const urgent = alert.severity === 'urgent';
  const { icon } = feedLook(alert);
  return (
    <li className={`rounded-[1.5rem] p-4 ring-1 ${urgent ? 'bg-danger-soft ring-danger/30' : 'bg-warn-soft ring-warn/25'}`} role={urgent ? 'alert' : undefined}>
      <div className="flex gap-3">
        <IconBadge icon={icon} tone={urgent ? 'danger' : 'warn'} size={44} />
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold leading-snug">{alert.title}</p>
          {alert.detail && <p className="mt-0.5 leading-snug">{alert.detail}</p>}
          {alert.geo && <MapLinkButton geo={alert.geo} />}
          <p className="mt-1 text-sm text-muted">{fmtWhen(alert.createdAt, now, tz)}</p>
        </div>
      </div>
      {alert.orderId ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onOrder(true)} className="min-h-12 rounded-2xl bg-ok font-semibold text-on-accent">
            Zatwierdź
          </button>
          <button type="button" onClick={() => onOrder(false)} className="min-h-12 rounded-2xl bg-surface font-semibold ring-1 ring-white/10">
            Odrzuć
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <a href={tel} className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl px-4 font-semibold ${urgent ? 'bg-ok text-on-accent' : 'bg-surface ring-1 ring-white/10'}`}>
            <Phone size={18} /> Zadzwoń
          </a>
          {urgent && onVideo && (
            <button type="button" onClick={onVideo} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-brand px-4 font-semibold text-on-accent">
              <Video size={18} /> Wideo
            </button>
          )}
          <button type="button" onClick={onAck} className="min-h-12 flex-1 rounded-2xl bg-ink px-4 font-semibold text-on-accent">
            OK, zajmę się tym
          </button>
        </div>
      )}
    </li>
  );
}

function MedicineRow({ medicine: m }: { medicine: Medicine }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-bold leading-snug">
          {m.name} {m.strength}
        </p>
        {m.instructions && <p className="text-sm leading-snug text-muted">{m.instructions}</p>}
        {m.times.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {m.times.map((t) => (
              <span key={t} className="inline-flex items-center gap-1 rounded-full bg-tint-teal px-2.5 py-0.5 text-sm font-semibold">
                <Clock size={14} /> {t}
              </span>
            ))}
          </div>
        )}
      </div>
      {m.stock !== null && (
        <span className={`shrink-0 rounded-2xl px-3 py-1.5 text-right text-sm leading-tight ${m.lowStock ? 'bg-warn-soft text-warn' : 'bg-ok-soft text-ok'}`}>
          <span className="flex items-center justify-end gap-1 font-bold">
            {m.lowStock && <TriangleAlert size={14} />}
            {m.daysLeft !== null ? `na ${m.daysLeft} dni` : `${m.stock} szt.`}
          </span>
          {m.daysLeft !== null && <span className="block">{m.stock} szt.</span>}
        </span>
      )}
    </li>
  );
}

/** The next full hour, with the date rolled over after 23:00. */
function nextFullHour(now: Date, tz: string): { date: string; time: string } {
  const inAnHour = new Date(now.getTime() + 3_600_000);
  return { date: dayKey(inAnHour, tz), time: `${String(hourIn(inAnHour, tz)).padStart(2, '0')}:00` };
}

const inputClass = 'min-h-12 w-full rounded-2xl bg-paper px-3 ring-1 ring-line focus:ring-2 focus:ring-brand';

function FormError({ children }: { children?: ReactNode }) {
  return <p className="rounded-2xl bg-danger-soft px-3 py-2 text-danger">{children ?? 'Nie udało się zapisać. Sprawdź dzień i godzinę — nie mogą być w przeszłości.'}</p>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block font-semibold text-muted">
      {label}
      <div className="mt-1 font-normal text-ink">{children}</div>
    </label>
  );
}

function SubmitButton({ children }: { children: ReactNode }) {
  return (
    <button type="submit" className="min-h-12 w-full rounded-2xl bg-brand font-semibold text-on-accent hover:bg-brand-strong">
      {children}
    </button>
  );
}

function MedicineForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [strength, setStrength] = useState('');
  const [instructions, setInstructions] = useState('');
  const [times, setTimes] = useState(['08:00']);
  const [stock, setStock] = useState('');
  const [error, setError] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const count = stock ? Number(stock) : null;
    try {
      await postJson('/api/family/medicines', {
        name: name.trim(),
        strength: strength.trim() || null,
        instructions: instructions.trim() || null,
        times: [...new Set(times.filter(Boolean))].sort(),
        doseUnits: 1,
        stock: count,
        packSize: count,
      });
      onDone();
    } catch {
      setError(true);
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 space-y-3 rounded-3xl bg-tint-teal/60 p-4">
      <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
        <Field label="Nazwa leku">
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Metformina" className={inputClass} />
        </Field>
        <Field label="Dawka">
          <input value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="500 mg" className={inputClass} />
        </Field>
      </div>
      <Field label="Dawkowanie (z opakowania lub od lekarza)">
        <input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="np. 1 tabletka 2 razy dziennie po posiłku" className={inputClass} />
      </Field>
      <div>
        <p className="font-semibold text-muted">Przypomnienia codziennie o</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {times.map((t, i) => (
            <span key={i} className="flex items-center gap-1">
              <input
                type="time"
                required
                value={t}
                onChange={(e) => setTimes(times.map((x, j) => (j === i ? e.target.value : x)))}
                className={`${inputClass} w-32`}
                aria-label={`Godzina ${i + 1}`}
              />
              {times.length > 1 && (
                <button type="button" onClick={() => setTimes(times.filter((_, j) => j !== i))} className="grid size-10 place-items-center rounded-full text-muted hover:bg-surface" aria-label="Usuń godzinę">
                  <X size={18} />
                </button>
              )}
            </span>
          ))}
          {times.length < 4 && (
            <button type="button" onClick={() => setTimes([...times, '20:00'])} className="flex min-h-12 items-center gap-1 rounded-2xl px-3 font-semibold text-brand ring-1 ring-line hover:bg-surface">
              <Plus size={18} /> godzina
            </button>
          )}
        </div>
      </div>
      <Field label="Ile sztuk w opakowaniu (opcjonalnie)">
        <input type="number" min={0} max={1000} value={stock} onChange={(e) => setStock(e.target.value)} placeholder="np. 30" className={`${inputClass} w-40`} />
      </Field>
      {error && <FormError>Nie udało się dodać leku. Sprawdź nazwę i godziny.</FormError>}
      <SubmitButton>Dodaj do apteczki</SubmitButton>
    </form>
  );
}

function ReminderForm({ tz, now, onDone }: { tz: string; now: Date; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<'medication' | 'injection' | 'other'>('medication');
  const [date, setDate] = useState(() => nextFullHour(now, tz).date);
  const [time, setTime] = useState(() => nextFullHour(now, tz).time);
  const [daily, setDaily] = useState(false);
  const [error, setError] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await postJson('/api/family/reminders', { title: title.trim(), category, date, time, repeat: daily ? 'daily' : 'none' });
      onDone();
    } catch {
      setError(true);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <Field label="Co przypomnieć?">
        <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="np. Krople do oczu" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dzień">
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Godzina">
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Field label="Rodzaj">
        <select value={category} onChange={(e) => setCategory(e.target.value as 'medication' | 'injection' | 'other')} className={inputClass}>
          <option value="medication">Lek (alert, gdy brak potwierdzenia)</option>
          <option value="injection">Zastrzyk (alert, gdy brak potwierdzenia)</option>
          <option value="other">Inne</option>
        </select>
      </Field>
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={daily} onChange={(e) => setDaily(e.target.checked)} className="size-5 accent-brand" /> Codziennie o tej porze
      </label>
      {error && <FormError />}
      <SubmitButton>Zapisz przypomnienie</SubmitButton>
    </form>
  );
}

function EventForm({ tz, now, onDone }: { tz: string; now: Date; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(dayKey(new Date(now.getTime() + 86_400_000), tz));
  const [time, setTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [remind, setRemind] = useState(60);
  const [error, setError] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await postJson('/api/family/events', { title: title.trim(), date, time, location: location.trim() || undefined, remindBeforeMin: remind });
      onDone();
    } catch {
      setError(true);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <Field label="Wizyta">
        <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="np. Wizyta u okulisty" className={inputClass} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Dzień">
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Godzina">
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
        </Field>
      </div>
      <Field label="Miejsce">
        <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="np. Przychodnia Lipowa" className={inputClass} />
      </Field>
      <Field label="Przypomnienie">
        <select value={remind} onChange={(e) => setRemind(Number(e.target.value))} className={inputClass}>
          <option value={0}>bez przypomnienia</option>
          <option value={30}>30 minut wcześniej</option>
          <option value={60}>godzinę wcześniej</option>
          <option value={120}>2 godziny wcześniej</option>
          <option value={1440}>dzień wcześniej</option>
        </select>
      </Field>
      {error && <FormError />}
      <SubmitButton>Dodaj do kalendarza</SubmitButton>
    </form>
  );
}
