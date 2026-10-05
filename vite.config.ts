import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { proposalsParquetPlugin } from './scripts/proposals-parquet-plugin.mjs';

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/mapa_primer_nivel/' : '/',
  plugins: [react(), proposalsParquetPlugin()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
}));
