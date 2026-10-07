import '../env';
import { Care } from '../care';
import { openDb } from '../db';
import { config } from '../env';
import { seedDemo } from '../seed';

seedDemo(new Care(openDb(config.dbPath)));
console.log(`Demo data re-seeded in ${config.dbPath}. Open apps pick it up on their next refresh.`);
