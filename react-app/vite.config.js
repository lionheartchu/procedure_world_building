import react from '@vitejs/plugin-react'
import { defineConfig, searchForWorkspaceRoot } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // The Atlas shows the project's own documentation images, in ../docs,
      // where the studies keep them (the build bundles them as assets).
      allow: [searchForWorkspaceRoot(process.cwd()), '../docs'],
    },
  },
})
