import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../env';

// Used by deploy/aicare. VACUUM INTO writes a consistent copy while the app keeps running and writing.
//   backup.ts <target.db>      copy the live database (DB_PATH) to <target.db> and check the copy
//   backup.ts --check <file>   only check <file>, before a restore puts it live

function check(path: string): void {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    const result = rows.map((r) => r.integrity_check).join('; ');
    if (result !== 'ok') throw new Error(`integrity check failed for ${path}: ${result}`);
  } finally {
    db.close();
  }
}

function backup(target: string): void {
  if (existsSync(target)) throw new Error(`${target} already exists`);
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
  } finally {
    db.close();
  }
  check(target);
}

const [first, second] = process.argv.slice(2);
if (first === '--check' && second) {
  check(second);
  console.log(`${second}: ok`);
} else if (first && !first.startsWith('-')) {
  backup(first);
  console.log(`${config.dbPath} → ${first}: ok`);
} else {
  console.error('usage: backup.ts <target.db> | backup.ts --check <file>');
  process.exit(2);
}
