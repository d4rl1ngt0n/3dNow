import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'client/index.html'),
        admin: path.resolve(import.meta.dirname, 'client/admin.html'),
        fileservice: path.resolve(import.meta.dirname, 'client/fileservice.html')
      }
    }
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000', '/brand-logo': 'http://localhost:3000' }
  }
});
