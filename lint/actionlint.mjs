#!/usr/bin/env node
// Lints every workflow under .github/workflows with actionlint, the same checker as the Go
// binary, loaded from the `actionlint` npm package (a WebAssembly build). The npm package ships
// no executable, so this is the command `pnpm lint:actions` runs — on any machine with the
// dependencies installed, without a binary on PATH. The WebAssembly build reads no
// .github/actionlint.yml and runs no shellcheck: it checks workflow syntax, expressions, action
// inputs and job dependencies.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createLinter } from 'actionlint'

const WORKFLOWS = '.github/workflows'

const lint = await createLinter()

const findings = readdirSync(WORKFLOWS)
  .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
  .toSorted()
  .flatMap((name) => {
    const file = join(WORKFLOWS, name)
    return lint(readFileSync(file, 'utf8'), file)
  })

for (const finding of findings) {
  console.error(`${finding.file}:${finding.line}:${finding.column}: ${finding.message} [${finding.kind}]`)
}

if (findings.length > 0) {
  console.error(`\nactionlint: ${findings.length} problem(s) in ${WORKFLOWS}`)
  process.exit(1)
}
