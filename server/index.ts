import './env';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';
import { aiStatus } from './ai/client';
import { Care } from './care';
import { openDb } from './db';
import { config } from './env';
import { publishChange, sseHandler } from './events';
import { apiRouter } from './routes';
import { startScheduler } from './scheduler';
import { seedDemo } from './seed';
import { dateKey } from './time';

const care = new Care(openDb(config.dbPath), publishChange);

/** Seeds the demo household, and remembers the day so a public demo can start fresh each morning. */
function seed(reason: string) {
  seedDemo(care);
  care.setKv('seeded_on', dateKey(new Date()));
  console.log(`Seeded demo household (Halina, 79, and her daughter Anna) — ${reason}.`);
}

if (!care.lastActivity()) seed('empty database');

// A public demo is shared by everyone who opens the link, and its "last 7 days" are relative to
// the day it was seeded: DEMO_RESET_DAILY=1 starts a clean day at 4:00 household time.
if (process.env.DEMO_RESET_DAILY === '1') {
  setInterval(() => {
    const now = new Date();
    if (now.getHours() >= 4 && care.getKv<string>('seeded_on') !== dateKey(now)) seed('daily reset');
  }, 10 * 60_000).unref();
}

const app = express();

// DEMO_PASSWORD: one shared password for everything (browser login prompt, any user name).
const password = process.env.DEMO_PASSWORD;
if (password) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    const given = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':') : null;
    if (given === password) return next();
    res.set('WWW-Authenticate', 'Basic realm="AI Care Agent demo", charset="UTF-8"').status(401).send('Demo: podaj hasło.');
  });
}

app.use(express.json({ limit: '12mb' }));
// POST as well as GET: the web apps read it with fetch (see src/lib/serverEvents.ts).
app.get('/api/stream', sseHandler);
app.post('/api/stream', sseHandler);
app.use('/api', apiRouter(care));

// Production: serve the built web apps from the same origin.
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(dist, 'index.html')));
}

startScheduler(care);

app.listen(config.port, () => {
  const ai = aiStatus();
  console.log(`AI Care Agent API on http://localhost:${config.port} · TZ ${config.tz} · model ${config.model} (effort ${config.chatEffort ?? 'off'})`);
  if (!ai.configured) console.warn('ANTHROPIC_API_KEY is not set: the voice agent is disabled and Scam Shield uses local heuristics only.');
});
