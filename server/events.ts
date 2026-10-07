import type { Request, Response } from 'express';

// Server-sent events: the apps refetch their state whenever a "change" arrives.
// State-driven (not event-driven) UI means a missed event or a page reload never loses anything.

const clients = new Set<Response>();

export function sseHandler(req: Request, res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

let pending: NodeJS.Timeout | null = null;

/** Coalesces bursts (e.g. several tool calls in one agent turn) into one push. */
export function publishChange(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    for (const res of clients) res.write(`event: change\ndata: ${Date.now()}\n\n`);
  }, 60);
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 20_000).unref();

/** A named event with a payload, delivered at once (video signalling, a simulated fall). */
export function publishEvent(name: string, data: unknown): void {
  const payload = `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(payload);
}
