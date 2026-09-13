import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { resolve } from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dice: resolve(__dirname, 'dice.html'), // Vite handles resolving src/pages/dice.tsx from dice.html
      },
    },
  },
});