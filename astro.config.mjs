import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://assyst.bg',
  trailingSlash: 'always',
  build: { format: 'directory' },
});
