// Strips files the Sites uploader refuses (hidden files and source maps)
// from the build output, so `deploy.json` can point straight at dist/.
import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

function clean(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (name.startsWith('.') || name.endsWith('.map')) {
      rmSync(path, { recursive: true, force: true })
      continue
    }
    if (statSync(path).isDirectory()) {
      clean(path)
      continue
    }
    // A removed map must not leave a comment pointing at it behind, or
    // `wrangler deploy` rejects the bundle with "Invalid source map path".
    if (/\.(?:m?js|cjs)$/.test(name)) {
      const source = readFileSync(path, 'utf8')
      const stripped = source.replace(
        /\n?\/\/# sourceMappingURL=\S+[ \t]*$/,
        '\n',
      )
      if (stripped !== source) writeFileSync(path, stripped)
    }
  }
}

clean(new URL('../dist', import.meta.url).pathname)

// Make the built configuration self-report, and never deploy the example id.
const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
const databaseId = /"database_id"\s*:\s*"([^"]+)"/.exec(config)?.[1]
console.log(`D1 binding: ${databaseId ?? 'missing'}`)
if (!databaseId || /^0{8}-0{4}-/.test(databaseId))
  throw new Error(
    'wrangler.jsonc still has the example D1 database_id; replace it before deploying.',
  )
