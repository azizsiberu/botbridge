import { defineConfig } from 'vitest/config';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://botbridge:botbridge@127.0.0.1:5432/botbridge_test';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      DATABASE_URL: databaseUrl,
      BOTBRIDGE_SECRET: process.env.BOTBRIDGE_SECRET ?? 'test-secret-not-for-production',
      LOG_LEVEL: 'silent',
      ALLOWED_HOSTS: 'localhost,127.0.0.1,[::1]',
      HOST: '127.0.0.1',
    },
  },
});
