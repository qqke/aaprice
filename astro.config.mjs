// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

const [githubOwner, githubRepository] = (process.env.GITHUB_REPOSITORY || '/').split('/');
const githubBase = githubRepository && githubRepository !== `${githubOwner}.github.io` ? `/${githubRepository}` : undefined;
const configuredBase = process.env.ASTRO_BASE_PATH?.trim();

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL?.trim() || (githubOwner ? `https://${githubOwner}.github.io` : undefined),
  base: configuredBase === '/' ? undefined : configuredBase || githubBase,
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
