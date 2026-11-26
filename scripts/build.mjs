import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../', import.meta.url))
const options = {
  absWorkingDir: project,
  bundle: true,
  loader: { '.webp': 'dataurl', '.png': 'dataurl', '.svg': 'text' },
  target: 'es2022',
  legalComments: 'none',
}

const css = await build({
  ...options,
  entryPoints: ['src/style.css'],
  write: false,
})

await build({
  ...options,
  entryPoints: ['src/client.js'],
  format: 'iife',
  outfile: 'lib/client.js',
  define: {
    __HELLO84_CSS__: JSON.stringify(css.outputFiles[0].text),
  },
})

console.log('lib/client.js built')
