#!/usr/bin/env tsx
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { parse as parseYaml } from "yaml"
import {
  buildExportManifest,
  parseWorkflowYaml,
  runPipeline,
  toHuggingFaceDatasetCard,
} from "../src/index.js"

const [, , command, workflowPath, ...rest] = process.argv

async function main() {
  if (!command || command === "--help" || command === "-h") {
    printHelp()
    process.exit(0)
  }

  if (command === "validate") {
    if (!workflowPath) die("Usage: field-pipeline validate <workflow.yaml>")
    const workflow = await loadWorkflow(workflowPath)
    console.log(`✓ Valid workflow: ${workflow.name}`)
    if (workflow.domain) console.log(`  domain: ${workflow.domain}`)
    return
  }

  if (command === "run") {
    if (!workflowPath) die("Usage: field-pipeline run <workflow.yaml> [--out dir]")
    const outDir = parseOutDir(rest)
    const workflow = await loadWorkflow(workflowPath)

    console.log(`Running: ${workflow.name}`)
    if (workflow.domain) console.log(`Domain: ${workflow.domain}`)
    console.log("")

    const result = await runPipeline(workflow, {
      onLog: (line) => console.log(line),
    })

    console.log("")
    console.log(`Status: ${result.status}`)
    if (result.error) console.error(`Error: ${result.error}`)
    if (result.summary) {
      console.log("")
      console.log("--- SUMMARY ---")
      console.log(result.summary)
    }

    if (outDir) {
      await mkdir(outDir, { recursive: true })
      const manifest = buildExportManifest(workflow, result)
      const stem = basename(workflowPath, ".yaml").replace(/\.yml$/, "")
      const manifestPath = join(outDir, `${stem}.manifest.json`)
      const cardPath = join(outDir, `${stem}.dataset-card.md`)
      const logsPath = join(outDir, `${stem}.logs.txt`)

      await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
      await writeFile(cardPath, toHuggingFaceDatasetCard(manifest))
      await writeFile(logsPath, result.logs.join("\n"))

      console.log("")
      console.log(`Wrote ${manifestPath}`)
      console.log(`Wrote ${cardPath}`)
      console.log(`Wrote ${logsPath}`)
    }

    process.exit(result.status === "completed" ? 0 : 1)
  }

  die(`Unknown command: ${command}`)
}

async function loadWorkflow(path: string) {
  const raw = parseYaml(await readFile(resolve(path), "utf8"))
  return parseWorkflowYaml(raw)
}

function parseOutDir(args: string[]): string | undefined {
  const idx = args.indexOf("--out")
  if (idx === -1) return undefined
  return resolve(args[idx + 1] ?? ".runs")
}

function die(msg: string): never {
  console.error(msg)
  process.exit(1)
}

function printHelp() {
  console.log(`field-pipeline — field-sourced training data via Vercel Sandbox + Pi

Usage:
  field-pipeline validate <workflow.yaml>
  field-pipeline run <workflow.yaml> [--out .runs]

Environment:
  VERCEL_OIDC_TOKEN   Vercel Sandbox auth (vercel link && vercel env pull)
  ANTHROPIC_API_KEY   Pi LLM provider (or OPENAI_API_KEY)

Examples:
  field-pipeline validate examples/smoke-test.yaml
  field-pipeline run examples/smoke-test.yaml --out .runs
`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
