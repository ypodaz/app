import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Sayt ypodaz.github.io/app/ altında işləyir.
export default defineConfig(({ command }) => ({
  base: '/app/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        client: 'index.html',
        admin: 'admin/index.html',
        // Dev önbaxış səhifəsi yalnız `vite` (serve) zamanı; prod build dəyişmir.
        ...(command === 'serve' ? { dev: 'src/dev/index.html' } : {}),
      },
    },
  },
  server: { port: 5173 },
}));
