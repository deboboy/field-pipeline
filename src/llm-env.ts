/**
 * Pi LLM environment passthrough for the sandbox container.
 *
 * Pi supports many providers via env vars, models.json, and cloud credentials.
 * @see https://pi.dev/docs/latest/providers
 * @see https://pi.dev/docs/latest/models
 */

/** Env vars Pi reads for API keys, cloud auth, and provider configuration. */
export const PI_LLM_ENV_VARS = [
  // API-key providers (see pi packages/coding-agent/docs/providers.md)
  "ANTHROPIC_API_KEY",
  "ANT_LING_API_KEY",
  "AZURE_OPENAI_API_KEY",
  "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "NVIDIA_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_GATEWAY_ID",
  "XAI_API_KEY",
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "ZAI_API_KEY",
  "ZAI_CODING_CN_API_KEY",
  "OPENCODE_API_KEY",
  "HF_TOKEN",
  "FIREWORKS_API_KEY",
  "TOGETHER_API_KEY",
  "KIMI_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CN_API_KEY",
  "XIAOMI_API_KEY",
  "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
  // Azure OpenAI
  "AZURE_OPENAI_BASE_URL",
  "AZURE_OPENAI_RESOURCE_NAME",
  "AZURE_OPENAI_API_VERSION",
  "AZURE_OPENAI_DEPLOYMENT_NAME_MAP",
  // Amazon Bedrock
  "AWS_PROFILE",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_BEARER_TOKEN_BEDROCK",
  "AWS_REGION",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_BEDROCK_FORCE_CACHE",
  "AWS_ENDPOINT_URL_BEDROCK_RUNTIME",
  "AWS_BEDROCK_SKIP_AUTH",
  "AWS_BEDROCK_FORCE_HTTP1",
  // Google Vertex
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_APPLICATION_CREDENTIALS",
  // Pi / proxy
  "PI_CACHE_RETENTION",
  "HTTP_PROXY",
  "HTTPS_PROXY",
] as const

export interface LlmRunConfig {
  provider?: string
  model?: string
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function parseExtraEnvNames(): string[] {
  const raw = process.env.FIELD_PIPELINE_LLM_ENV
  if (!raw) return []
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
}

/** Collect env var names to forward into the Pi Docker container. */
export function collectLlmEnvVarNames(): string[] {
  const names = new Set<string>(PI_LLM_ENV_VARS)
  for (const name of parseExtraEnvNames()) {
    names.add(name)
  }
  return [...names]
}

/** Build `-e KEY='value'` flags for every set LLM-related env var. */
export function buildLlmDockerEnvFlags(extra?: Record<string, string>): string[] {
  const flags: string[] = []
  const seen = new Set<string>()

  const add = (name: string, value: string) => {
    if (seen.has(name)) return
    seen.add(name)
    flags.push(`-e ${name}=${shellQuote(value)}`)
  }

  for (const name of collectLlmEnvVarNames()) {
    const value = process.env[name]
    if (value) add(name, value)
  }

  if (extra) {
    for (const [name, value] of Object.entries(extra)) {
      add(name, value)
    }
  }

  return flags
}

/** True when at least one known LLM credential or proxy env var is set. */
export function hasLlmCredentials(): boolean {
  return collectLlmEnvVarNames().some((name) => Boolean(process.env[name]))
}

/** Resolve Pi CLI model flags from env and optional workflow llm config. */
export function resolveLlmRunConfig(llm?: LlmRunConfig): { args: string[]; model?: string; provider?: string } {
  const provider = llm?.provider ?? process.env.FIELD_PIPELINE_PI_PROVIDER ?? process.env.PI_PROVIDER
  const model = llm?.model ?? process.env.FIELD_PIPELINE_PI_MODEL ?? process.env.PI_MODEL

  const args: string[] = []
  if (provider) args.push("--provider", provider)
  if (model) args.push("--model", model)

  return { args, model, provider }
}

export function llmCredentialHint(): string {
  return [
    "set a Pi provider env var (see README — OPENROUTER_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, etc.)",
    "configure cloud credentials (AWS/GCP/Azure)",
    "define open-source providers in workflow llm.modelsJson or FIELD_PIPELINE_PI_MODELS_JSON",
    "or list extra vars in FIELD_PIPELINE_LLM_ENV",
  ].join("; ")
}
