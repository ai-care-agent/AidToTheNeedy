import { writeFileSync } from 'node:fs';
import { cases } from './cases';
import { GUARDED_TOOLS, expectedGuarded } from './checks';
import { DEFAULT_NOW } from './fixtures';
import { GENERAL_RUBRIC } from './judge';

// Writes eval/agent/CASES.md: every case as the reviewer should read it.
//   npx tsx eval/agent/list-cases.ts

const fence = (text: string) => {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const f = '`'.repeat(longest + 1);
  return `${f}text\n${text}\n${f}`;
};

const counts = new Map<string, number>();
for (const c of cases) counts.set(c.tags[0], (counts.get(c.tags[0]) ?? 0) + 1);

const lines = [
  '# Voice agent eval: cases',
  '',
  `${cases.length} cases (${[...counts].map(([tag, n]) => `${tag} ${n}`).join(', ')}). Each starts from a fresh demo household at ${DEFAULT_NOW.replace('T', ' ')} (Tuesday) unless it says otherwise.`,
  '',
  'Every case is also graded on the general rubric:',
  '',
  ...Object.entries(GENERAL_RUBRIC).map(([id, text]) => `- **${id}**: ${text}`),
  '',
  `and on the guard: ${GUARDED_TOOLS.join(', ')} must not be called unless the case expects or allows it.`,
  '',
  '| id | tags | turns | checks | rubric |',
  '|---|---|---|---|---|',
  ...cases.map((c) => `| ${c.id} | ${c.tags.join(', ')} | ${c.turns.length} | ${c.expect.length} | ${c.rubric.length} |`),
  '',
];

for (const c of cases) {
  const allowed = [...expectedGuarded(c.expect, c.allow)].filter((t) => (GUARDED_TOOLS as readonly string[]).includes(t));
  lines.push(
    `## ${c.id}`,
    '',
    `*${c.tags.join(' · ')}* — ${c.why}`,
    '',
    ...(c.at ? [`**When:** ${c.at.replace('T', ' ')}`, ''] : []),
    ...(c.given ? [`**Given:** ${c.given}`, ''] : []),
    '**She says:**',
    '',
    fence(c.turns.map((t, i) => `${c.turns.length > 1 ? `[${i + 1}] ` : ''}${t.text}${t.image ? ` [photo: ${t.image}]` : ''}`).join('\n')),
    '',
    '**Checks:**',
    '',
    ...c.expect.map((check) => `- ${check.desc}`),
    ...(allowed.length ? [`- may call: ${allowed.join(', ')}`] : []),
    '',
    '**Reply must:**',
    '',
    ...c.rubric.map((r) => `- ${r}`),
    '',
  );
}

writeFileSync('eval/agent/CASES.md', lines.join('\n'));
console.log(`eval/agent/CASES.md: ${cases.length} cases`);
