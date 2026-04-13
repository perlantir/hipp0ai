import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    // Build version injected at compile time.
    // In Docker: set via VITE_BUILD_VERSION env var.
    // Locally: falls back to ISO timestamp.
    '__BUILD_VERSION__': JSON.stringify(
      process.env.VITE_BUILD_VERSION ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
    ),
  },
  server: {
    port: 5173,
  },
});
