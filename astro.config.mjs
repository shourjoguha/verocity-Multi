// @ts-check
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

/**
 * Stamp public/sw.js with a hash of the built site.
 *
 * The service worker keys its cache on this name and deletes every other cache
 * on activate, so a name that changes with the output is what bounds staleness
 * to a single navigation after a deploy. It hashes the whole of dist, not just
 * the content-hashed /_astro/* filenames: layout and page changes compile into
 * the HTML, which is not itself hashed, and those are exactly the changes that
 * went missing before.
 *
 * @returns {import('astro').AstroIntegration}
 */
function swVersion() {
  return {
    name: 'verocity-sw-version',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const root = fileURLToPath(dir);
        const swPath = join(root, 'sw.js');

        /** @param {string} d @returns {Promise<string[]>} */
        async function walk(d) {
          const entries = await readdir(d, { withFileTypes: true });
          const out = await Promise.all(
            entries.map((e) => {
              const p = join(d, e.name);
              return e.isDirectory() ? walk(p) : Promise.resolve([p]);
            }),
          );
          return out.flat();
        }

        const files = (await walk(root)).filter((f) => f !== swPath).sort();
        const hash = createHash('sha256');
        for (const f of files) {
          hash.update(f.slice(root.length));
          hash.update(await readFile(f));
        }
        const id = hash.digest('hex').slice(0, 12);

        const src = await readFile(swPath, 'utf8');
        if (!src.includes('__BUILD_ID__')) {
          logger.warn('sw.js has no __BUILD_ID__ token — the cache name will not change per deploy.');
          return;
        }
        await writeFile(swPath, src.replaceAll('__BUILD_ID__', id));
        logger.info(`service worker cache: verocity-${id}`);
      },
    },
  };
}

// Static-first output (SPEC §5): the browser talks directly to Supabase.
// No Vercel server compute on the authenticated hot path.
// Tailwind v4 runs via PostCSS (postcss.config.mjs), not the Vite plugin,
// for compatibility with Astro 6's rolldown-based Vite.
export default defineConfig({
  integrations: [react(), swVersion()],
  // Warm the next tab before the tap: prefetch linked pages (HTML + the island's
  // modulepreload) on hover / touchstart. Pairs with ClientRouter so the swap is
  // near-instant. The service worker then caches those assets for repeat visits.
  prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
});
