import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Sayt ypodaz.github.io/app/ altında işləyir.
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { client: 'index.html', admin: 'admin/index.html' },
    },
  },
  server: { port: 5173 },
});
