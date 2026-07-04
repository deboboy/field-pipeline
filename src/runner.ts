import { buildAgentsMd, buildPiPrompt } from "./prompt.js"
import type { ArtifactEntry, PipelineRunResult, PipelineWorkflow, RunPipelineOptions } from "./types.js"

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function resolveLlmEnv(): string {
  if (process.env.ANTHROPIC_API_KEY) {
    return `-e ANTHROPIC_API_KEY=${shellQuote(process.env.ANTHROPIC_API_KEY)}`
  }
  if (process.env.OPENAI_API_KEY) {
    return `-e OPENAI_API_KEY=${shellQuote(process.env.OPENAI_API_KEY)}`
  }
  return ""
}

/**
 * Run a training-data workflow in a Vercel Sandbox with Docker + Pi.
 *
 * Auth: Vercel OIDC (`vercel link` + `vercel env pull` locally; automatic on Vercel).
 * LLM: set ANTHROPIC_API_KEY or OPENAI_API_KEY (passed into the Pi container).
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
    await sandbox.runCommand({ cmd: "mkdir", args: ["-p", workDir, `${workDir}/output`] })

    await sandbox.fs.writeFile(`${workDir}/PROMPT.md`, buildPiPrompt(workflow))
    await sandbox.fs.writeFile(`${workDir}/AGENTS.md`, buildAgentsMd(workflow))

    log(`Pulling image ${dockerImage} and starting Pi…`)

    const apiKeyEnv = resolveLlmEnv()
    if (!apiKeyEnv) {
      log("Warning: no ANTHROPIC_API_KEY or OPENAI_API_KEY set; Pi may fail to authenticate.")
    }

    const containerScript = [
      "set -euo pipefail",
      "npm install -g @mariozechner/pi-coding-agent",
      "mkdir -p /work/output",
      'pi -p "$(cat /work/PROMPT.md)"',
      "echo '--- OUTPUT TREE ---'",
      "find /work/output -type f | sort",
    ].join(" && ")

    const shellDocker = [
      "sudo docker run --rm",
      `-v ${workDir}:/work`,
      "-w /work",
      apiKeyEnv,
      dockerImage,
      `bash -lc ${shellQuote(containerScript)}`,
    ]
      .filter(Boolean)
      .join(" ")

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
