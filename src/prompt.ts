import type { PipelineWorkflow } from "./types.js"

export function buildPiPrompt(workflow: PipelineWorkflow): string {
  const outputLines: string[] = [
    "Produce training data artifacts under /work/output.",
    "Write a short summary of what you produced to /work/output/SUMMARY.md.",
    "When finished, list the files you created.",
  ]

  if (workflow.output?.format) {
    outputLines.unshift(`Primary output format: ${workflow.output.format}`)
  }
  if (workflow.output?.schema) {
    outputLines.unshift(`Target schema:\n${workflow.output.schema}`)
  }
  if (workflow.output?.artifacts?.length) {
    outputLines.unshift(`Required artifact paths:\n${workflow.output.artifacts.map((a) => `- ${a}`).join("\n")}`)
  }

  return [
    "You are running a field-sourced training-data workload.",
    "Transform domain expert (frontline) inputs into clean, export-ready training artifacts.",
    "",
    `Workflow: ${workflow.name}`,
    workflow.description ? `Description: ${workflow.description}` : "",
    workflow.domain ? `Domain: ${workflow.domain}` : "",
    "",
    "## Field inputs (from domain experts — not engineers)",
    workflow.fieldInputs,
    "",
    "## Engineer instructions",
    workflow.engineerPrompt,
    "",
    "## Output requirements",
    ...outputLines,
  ]
    .filter(Boolean)
    .join("\n")
}

export function buildAgentsMd(workflow: PipelineWorkflow): string {
  return [
    "# Field Pipeline workload",
    "",
    "You generate and organize AI training data from frontline / domain expert inputs.",
    "Write all artifacts under /work/output.",
    workflow.output?.format
      ? `Prefer ${workflow.output.format} where appropriate.`
      : "Prefer structured JSONL, CSV, or Markdown datasets.",
    "",
    "Be concise, schema-consistent, and ready for downstream model training export.",
  ].join("\n")
}
