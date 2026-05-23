// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// Static-first output (SPEC §5): the browser talks directly to Supabase.
// No Vercel server compute on the authenticated hot path.
// Tailwind v4 runs via PostCSS (postcss.config.mjs), not the Vite plugin,
// for compatibility with Astro 6's rolldown-based Vite.
export default defineConfig({
  integrations: [react()],
});
