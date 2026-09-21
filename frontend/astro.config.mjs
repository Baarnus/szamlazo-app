// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../shared'),
        '@scripts': path.resolve(__dirname, './src/scripts'),
        '@components': path.resolve(__dirname, './src/components'),
        'zod': path.resolve(__dirname, './node_modules/zod'),
      },
    },
    preview: {
      allowedHosts: true,
    },
  },
});