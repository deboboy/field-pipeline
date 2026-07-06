import { z } from "zod"

export const llmSpecSchema = z.object({
  provider: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(200).optional(),
  modelsJson: z.union([z.string().min(1).max(50000), z.record(z.unknown())]).optional(),
})

export const outputSpecSchema = z.object({
  format: z.enum(["jsonl", "csv", "markdown", "custom"]).optional(),
  schema: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
})

export const pipelineWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  domain: z.string().max(100).optional(),
  fieldInputs: z.string().min(1).max(50000),
  engineerPrompt: z.string().min(1).max(50000),
  dockerImage: z.string().min(1).max(200).optional().default("node:22-bookworm"),
  llm: llmSpecSchema.optional(),
  output: outputSpecSchema.optional(),
})

export type PipelineWorkflowInput = z.infer<typeof pipelineWorkflowSchema>

export function parseWorkflowYaml(raw: unknown): PipelineWorkflowInput {
  return pipelineWorkflowSchema.parse(raw)
}
