import { build } from 'esbuild'

// Three bundles: the panel page and the Work Status section (classic IIFEs that
// run in sandboxed iframes), and the OpenCode plugin (one ESM file with no
// imports from node_modules).
const builds = [
  {
    entryPoints: ['src/panel/main.js'],
    outfile: 'panel/main.js',
    format: 'iife',
    platform: 'browser',
  },
  {
    entryPoints: ['src/panel/status.js'],
    outfile: 'status/main.js',
    format: 'iife',
    platform: 'browser',
  },
  {
    entryPoints: ['src/block/main.js'],
    outfile: 'block/main.js',
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
