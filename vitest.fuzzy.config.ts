import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/fuzzy/**/*.test.ts'],
    // Fuzzy cases hit the live DeepSeek API. Run them sequentially so token
    // pacing is predictable and console reports stay readable.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
