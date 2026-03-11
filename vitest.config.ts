import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    // Frontend tests only - backend tests run separately via backend/vitest.config.ts
    include: [
      './src/**/*.test.ts',
      './src/**/*.test.tsx',
      './components/**/*.test.tsx',
      './contexts/**/*.test.tsx',
      './utils/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/backend/**',
      './backend/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '*.config.ts',
        'dist/',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  // Prevent vite from accessing backend directory
  server: {
    fs: {
      deny: ['backend/**', '**/backend/**'],
    },
  },
});
