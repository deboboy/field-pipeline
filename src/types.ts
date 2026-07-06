/** Output format hints for Pi and downstream export. */
export type OutputFormat = "jsonl" | "csv" | "markdown" | "custom"

/**
 * Optional Pi LLM configuration for a workflow run.
 * Use modelsJson for Ollama, vLLM, LM Studio, or any OpenAI-compatible endpoint.
 * @see https://pi.dev/docs/latest/models
 */
export interface LlmSpec {
  /** Pi provider id (e.g. openrouter, groq, ollama). */
  provider?: string
  /** Model id or pattern (e.g. openrouter/qwen/qwen-2.5-coder-32b-instruct). */
  model?: string
  /**
   * Inline Pi models.json content. Provide the full file object or just `{ providers: { ... } }`.
   * Custom provider apiKey fields can reference env vars passed via FIELD_PIPELINE_LLM_ENV.
   */
  modelsJson?: string | Record<string, unknown>
}

export interface OutputSpec {
  /** Preferred artifact format Pi should produce. */
  format?: OutputFormat
  /** Human-readable schema notes passed into the Pi prompt. */
  schema?: string
  /** Relative paths under /work/output Pi should create. */
  artifacts?: string[]
}

/**
 * A training-data workflow.
 *
 * `fieldInputs` — raw brief from domain experts (GCs, nurses, technicians, etc.).
 * `engineerPrompt` — how Pi should transform those inputs into training artifacts.
 */
export interface PipelineWorkflow {
  name: string
  description?: string
  /** Industry or domain tag for organization (e.g. construction, healthcare). */
  domain?: string
  fieldInputs: string
  engineerPrompt: string
  dockerImage?: string
  llm?: LlmSpec
  output?: OutputSpec
}

export type PipelineRunStatus = "provisioning" | "running" | "completed" | "failed"

export interface ArtifactEntry {
  /** Path relative to the sandbox work directory (e.g. `output/dataset.jsonl`). */
  path: string
  /** Local filesystem path after `--out` download, when available. */
  localPath?: string
  format?: OutputFormat
}

export interface PipelineRunResult {
  status: PipelineRunStatus
  sandboxName: string
  logs: string[]
  summary?: string
  error?: string
  exitCode?: number
  artifacts: ArtifactEntry[]
  startedAt: string
  completedAt?: string
}

export interface RunPipelineOptions {
  /** Sandbox name prefix. Default: field-pipeline */
  sandboxPrefix?: string
  /** Sandbox timeout in ms. Default: 5 minutes */
  timeoutMs?: number
  /** Vercel Sandbox runtime. Default: node24 */
  runtime?: "node24" | "node22" | "node26" | "python3.13"
  /** Called as log lines are produced. */
  onLog?: (line: string) => void
  /** Local directory to download sandbox output artifacts into. */
  outDir?: string
  /** Stop sandbox after run. Default: true */
  stopSandbox?: boolean
}

export interface ExportManifest {
  workflow: Pick<PipelineWorkflow, "name" | "description" | "domain">
  run: {
    sandboxName: string
    startedAt: string
    completedAt?: string
    status: PipelineRunStatus
  }
  artifacts: ArtifactEntry[]
  summary?: string
  /** Hints for importers (Hugging Face, OpenAI fine-tune, etc.). */
  exportHints: {
    primaryFormat?: OutputFormat
    suggestedImporter?: "huggingface" | "openai-finetune" | "generic-jsonl" | "custom"
  }
}
