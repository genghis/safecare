import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['lib/**/*.test.ts'],
    server: {
      deps: {
        inline: [/expo-secure-store/, /expo-network/],
      },
    },
  },
});
