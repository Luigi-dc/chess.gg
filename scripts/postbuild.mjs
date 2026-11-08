// Strips files the Sites uploader refuses (hidden files and source maps)
// from the build output, so `deploy.json` can point straight at dist/.
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

const dist = new URL('../dist', import.meta.url).pathname

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

clean(dist)

// Make the built configuration self-report, and never deploy the example id.
const config = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
const databaseId = /"database_id"\s*:\s*"([^"]+)"/.exec(config)?.[1]
console.log(`D1 binding: ${databaseId ?? 'missing'}`)
if (!databaseId || /^0{8}-0{4}-/.test(databaseId))
  throw new Error(
    'wrangler.jsonc still has the example D1 database_id; replace it before deploying.',
  )

// freebuff-realtime/ is a local-only helper: its Durable Object class lives in
// a script registered on the dev machine, not in the hosting account. Keep that
// binding out of the deployed config so the upload is accepted; clients fall
// back to the snapshot poll. Local `vite dev` still uses wrangler.jsonc as-is.
for (const name of readdirSync(dist)) {
  const dir = join(dist, name)
  const built = join(dir, 'wrangler.json')
  if (!statSync(dir).isDirectory() || !existsSync(built)) continue
  const generated = JSON.parse(readFileSync(built, 'utf8'))
  if (!generated.durable_objects) continue
  delete generated.durable_objects
  delete generated.migrations
  writeFileSync(built, JSON.stringify(generated))
  console.log('Realtime binding omitted from the deployment; clients poll.')
}
