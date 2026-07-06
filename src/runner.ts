import { buildAgentsMd, buildPiPrompt } from "./prompt.js"
import {
  buildLlmDockerEnvFlags,
  hasLlmCredentials,
  llmCredentialHint,
  resolveLlmRunConfig,
} from "./llm-env.js"
import type { ArtifactEntry, LlmSpec, PipelineRunResult, PipelineWorkflow, RunPipelineOptions } from "./types.js"
import { readFile } from "node:fs/promises"

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function normalizeModelsJson(modelsJson: LlmSpec["modelsJson"]): string {
  if (!modelsJson) throw new Error("modelsJson is required")
  if (typeof modelsJson === "string") return modelsJson
  const payload = "providers" in modelsJson ? modelsJson : { providers: modelsJson }
  return JSON.stringify(payload, null, 2)
}

async function resolveModelsJsonContent(workflow: PipelineWorkflow): Promise<string | undefined> {
  if (workflow.llm?.modelsJson) {
    return normalizeModelsJson(workflow.llm.modelsJson)
  }

  const path = process.env.FIELD_PIPELINE_PI_MODELS_JSON
  if (path) {
    return await readFile(path, "utf8")
  }

  return undefined
}

/**
 * Run a training-data workflow in a Vercel Sandbox with Docker + Pi.
 *
 * Auth: Vercel OIDC (`vercel link` + `vercel env pull` locally; automatic on Vercel).
 * LLM: any Pi-supported provider — pass API keys / cloud creds via env, or define
 * open-source endpoints in workflow `llm.modelsJson`. See README.
 */
export async function runPipeline(
  workflow: PipelineWorkflow,
  options: RunPipelineOptions = {}
): Promise<PipelineRunResult> {
  const logs: string[] = []
  const startedAt = new Date().toISOString()
  const sandboxPrefix = options.sandboxPrefix ?? "field-pipeline"
  const sandboxName = `${sandboxPrefix}-${Date.now().toString(36)}`
  const dockerImage = workflow.dockerImage ?? "node:22-bookworm"
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000
  const runtime = options.runtime ?? "node24"
  const stopSandbox = options.stopSandbox ?? true

  const log = (line: string) => {
    const entry = `[${new Date().toISOString()}] ${line}`
    logs.push(entry)
    options.onLog?.(entry)
  }

  try {
    log(`Provisioning Vercel sandbox: ${sandboxName}`)

    const { Sandbox } = await import("@vercel/sandbox")
    const sandbox = await Sandbox.create({ name: sandboxName, runtime, timeout: timeoutMs })

    log("Sandbox created. Installing Docker…")

    const installDocker = await sandbox.runCommand({
      sudo: true,
      cmd: "dnf",
      args: ["install", "-y", "docker"],
    })
    if (installDocker.exitCode !== 0) {
      throw new Error(`Docker install failed: ${await installDocker.stderr()}`)
    }

    await sandbox.runCommand({ sudo: true, cmd: "dockerd", detached: true })
    await sandbox.runCommand({
      cmd: "sh",
      args: ["-lc", "until sudo docker info >/dev/null 2>&1; do sleep 1; done"],
    })
    log("Docker daemon is ready.")

    const workDir = "/vercel/sandbox/training"
    const piAgentDir = `${workDir}/.pi/agent`
    await sandbox.runCommand({ cmd: "mkdir", args: ["-p", workDir, `${workDir}/output`, piAgentDir] })

    await sandbox.fs.writeFile(`${workDir}/PROMPT.md`, buildPiPrompt(workflow))
    await sandbox.fs.writeFile(`${workDir}/AGENTS.md`, buildAgentsMd(workflow))

    const modelsJsonContent = await resolveModelsJsonContent(workflow)
    const llmEnvExtra: Record<string, string> = {}
    if (modelsJsonContent) {
      await sandbox.fs.writeFile(`${piAgentDir}/models.json`, modelsJsonContent)
      llmEnvExtra.PI_CODING_AGENT_DIR = "/work/.pi/agent"
      log("Wrote Pi models.json for custom / open-source providers.")
    }

    log(`Pulling image ${dockerImage} and starting Pi…`)

    const llmEnvFlags = buildLlmDockerEnvFlags(llmEnvExtra)
    if (!hasLlmCredentials() && !modelsJsonContent) {
      log(`Warning: no LLM credentials detected; Pi may fail to authenticate. ${llmCredentialHint()}.`)
    }

    const { args: piModelArgs } = resolveLlmRunConfig(workflow.llm)
    const piArgs = [...piModelArgs, "-p", '"$(cat /work/PROMPT.md)"'].join(" ")

    const containerScript = [
      "set -euo pipefail",
      "npm install -g @mariozechner/pi-coding-agent",
      "mkdir -p /work/output",
      `pi ${piArgs}`,
      "echo '--- OUTPUT TREE ---'",
      "find /work/output -type f | sort",
    ].join(" && ")

    const shellDocker = [
      "sudo docker run --rm",
      `-v ${workDir}:/work`,
      "-w /work",
      ...llmEnvFlags,
      dockerImage,
      `bash -lc ${shellQuote(containerScript)}`,
    ].join(" ")

    const result = await sandbox.runCommand({ cmd: "sh", args: ["-lc", shellDocker] })

    const stdout = await result.stdout()
    const stderr = await result.stderr()
    log(`Pi container exit code: ${result.exitCode}`)
    if (stdout) log(stdout.slice(0, 8000))
    if (stderr) log(`stderr: ${stderr.slice(0, 4000)}`)

    let summary = ""
    try {
      summary = await sandbox.fs.readFile(`${workDir}/output/SUMMARY.md`, "utf8")
    } catch {
      summary = stdout.slice(0, 4000) || "Run finished without SUMMARY.md"
    }

    const artifacts = parseArtifactTree(stdout, workflow.output?.format)

    if (stopSandbox) {
      try {
        await sandbox.stop()
      } catch {
        // ignore
      }
    }

    const completedAt = new Date().toISOString()

    if (result.exitCode !== 0) {
      return {
        status: "failed",
        sandboxName,
        logs,
        summary,
        error: stderr || `Container exited with code ${result.exitCode}`,
        exitCode: result.exitCode,
        artifacts,
        startedAt,
        completedAt,
      }
    }

    log("Pipeline run completed successfully.")

    return {
      status: "completed",
      sandboxName,
      logs,
      summary,
      exitCode: 0,
      artifacts,
      startedAt,
      completedAt,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`Run failed: ${message}`)
    return {
      status: "failed",
      sandboxName,
      logs,
      error: message,
      artifacts: [],
      startedAt,
      completedAt: new Date().toISOString(),
    }
  }
}

function parseArtifactTree(stdout: string, defaultFormat?: ArtifactEntry["format"]): ArtifactEntry[] {
  const marker = "--- OUTPUT TREE ---"
  const idx = stdout.indexOf(marker)
  if (idx === -1) return []

  return stdout
    .slice(idx + marker.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/work/output/") || line.includes("/output/"))
    .map((path) => ({
      path: path.replace(/^\/work\//, ""),
      format: inferFormat(path) ?? defaultFormat,
    }))
}

function inferFormat(path: string): ArtifactEntry["format"] | undefined {
  if (path.endsWith(".jsonl")) return "jsonl"
  if (path.endsWith(".csv")) return "csv"
  if (path.endsWith(".md")) return "markdown"
  return undefined
}
