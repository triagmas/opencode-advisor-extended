import { build } from 'esbuild'

// Two bundles: the panel page (classic IIFE, runs in a sandboxed iframe) and the
// OpenCode plugin (one ESM file with no imports from node_modules).
const builds = [
  {
    entryPoints: ['src/panel/main.js'],
    outfile: 'panel/main.js',
    format: 'iife',
    platform: 'browser',
  },
  {
    entryPoints: ['src/plugin/index.js'],
    outfile: 'plugin/index.js',
    format: 'esm',
    platform: 'node',
  },
]

for (const options of builds) {
  await build({
    ...options,
    bundle: true,
    target: 'es2022',
    legalComments: 'none',
    logLevel: 'info',
  })
}
