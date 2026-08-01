// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

const [githubOwner, githubRepository] = (process.env.GITHUB_REPOSITORY || '/').split('/');
const githubBase = githubRepository && githubRepository !== `${githubOwner}.github.io` ? `/${githubRepository}` : undefined;

export default defineConfig({
  site: githubOwner ? `https://${githubOwner}.github.io` : undefined,
  base: githubBase,
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
  },
});
