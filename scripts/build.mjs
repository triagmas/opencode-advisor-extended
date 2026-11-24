import { build } from 'esbuild'

// One bundle: the OpenCode plugin. It is loaded by the server, so it stays a
// single ESM file with no imports from node_modules.
const builds = [
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
