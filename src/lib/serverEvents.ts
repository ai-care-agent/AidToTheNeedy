// One event stream per page, shared by every subscriber: the live state ("change"), video
// signalling ("video") and demo triggers ("safety"). Browsers allow only a few connections
// per host over HTTP/1.1, and the presentation page already holds two apps.
//
// The stream is read with fetch (POST) rather than EventSource: some tunnels and proxies —
// Cloudflare quick tunnels among them — hold a GET event stream back until it ends, but pass a
// POST response through as it arrives. The wire format is the same text/event-stream.

type Handler = (data: unknown) => void;

const handlers = new Map<string, Set<Handler>>();
const statusListeners = new Set<(online: boolean) => void>();
let running = false;
let controller: AbortController | null = null;

const RETRY_MS = 3_000;
/** The server pings every 20 s; silence for longer means the connection is dead. */
const SILENCE_MS = 45_000;

function dispatch(name: string, raw: string) {
  let data: unknown = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    // "change" carries a bare timestamp.
  }
  for (const h of handlers.get(name) ?? []) h(data);
}

function setOnline(online: boolean) {
  for (const l of statusListeners) l(online);
}

/** Parses one text/event-stream block ("event: x\ndata: y"); comments and retry lines are ignored. */
function handleBlock(block: string) {
  let name = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length) dispatch(name, data.join('\n'));
}

async function readStream(): Promise<void> {
  controller = new AbortController();
  let watchdog: number | undefined;
  const alive = () => {
    window.clearTimeout(watchdog);
    watchdog = window.setTimeout(() => controller?.abort(), SILENCE_MS);
  };
  try {
    const res = await fetch('/api/stream', { method: 'POST', headers: { accept: 'text/event-stream' }, signal: controller.signal, cache: 'no-store' });
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
    setOnline(true);
    for (const h of handlers.get('open') ?? []) h(null);
    alive();
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      alive();
      buffer += value.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        handleBlock(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
      }
    }
  } catch {
    // Dropped, refused (the API restarting behind a proxy) or silent too long: retry below.
  } finally {
    window.clearTimeout(watchdog);
  }
}

async function connect() {
  running = true;
  for (;;) {
    await readStream();
    setOnline(false);
    await new Promise((r) => window.setTimeout(r, RETRY_MS));
  }
}

/** Subscribes to a named server event ("open" fires on every (re)connect). */
export function onServerEvent(name: string, handler: Handler): () => void {
  let set = handlers.get(name);
  if (!set) {
    set = new Set();
    handlers.set(name, set);
  }
  set.add(handler);
  if (!running) void connect();
  return () => set!.delete(handler);
}

export function onConnectionChange(listener: (online: boolean) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}
