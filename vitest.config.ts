import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['server/**/*.test.ts', 'src/**/*.test.ts'],
    // No network in tests: the weather falls back to "unavailable".
    env: { TZ: 'Europe/Warsaw', WEATHER: 'off', AUDIO_DIR: join(tmpdir(), 'ai-care-test-audio') },
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
