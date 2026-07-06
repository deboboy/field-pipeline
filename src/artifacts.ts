import { mkdir } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import type { Sandbox } from "@vercel/sandbox"
import type { ArtifactEntry, OutputFormat } from "./types.js"

const OUTPUT_TREE_MARKER = "--- OUTPUT TREE ---"

export function parseArtifactTree(stdout: string, defaultFormat?: OutputFormat): ArtifactEntry[] {
  const idx = stdout.indexOf(OUTPUT_TREE_MARKER)
  if (idx === -1) return []

  return stdout
    .slice(idx + OUTPUT_TREE_MARKER.length)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("/work/output/") || line.includes("/output/"))
    .map((path) => ({
      path: normalizeArtifactPath(path),
      format: inferFormat(path) ?? defaultFormat,
    }))
}

export function inferFormat(path: string): OutputFormat | undefined {
  if (path.endsWith(".jsonl")) return "jsonl"
  if (path.endsWith(".csv")) return "csv"
  if (path.endsWith(".md")) return "markdown"
  return undefined
}

function normalizeArtifactPath(path: string): string {
  return path
    .replace(/^\/work\//, "")
    .replace(/^\.\//, "")
}

async function listFilesRecursive(
  sandbox: Sandbox,
  dir: string,
  files: string[] = []
): Promise<string[]> {
  let entries: Awaited<ReturnType<Sandbox["fs"]["readdir"]>>
  try {
    entries = await sandbox.fs.readdir(dir, { withFileTypes: true })
  } catch {
    return files
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      await listFilesRecursive(sandbox, fullPath, files)
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

function mergeArtifactEntries(
  discovered: ArtifactEntry[],
  parsed: ArtifactEntry[],
  defaultFormat?: OutputFormat
): ArtifactEntry[] {
  const byPath = new Map<string, ArtifactEntry>()
  for (const entry of [...parsed, ...discovered]) {
    const existing = byPath.get(entry.path)
    byPath.set(entry.path, {
      path: entry.path,
      format: entry.format ?? existing?.format ?? defaultFormat,
      localPath: entry.localPath ?? existing?.localPath,
    })
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

export interface DownloadArtifactsOptions {
  sandbox: Sandbox
  workDir: string
  outDir: string
  parsedArtifacts?: ArtifactEntry[]
  defaultFormat?: OutputFormat
  onLog?: (line: string) => void
}

/** Pull artifact bytes from the sandbox output tree into a local directory. */
export async function downloadSandboxArtifacts(
  options: DownloadArtifactsOptions
): Promise<ArtifactEntry[]> {
  const { sandbox, workDir, outDir, parsedArtifacts = [], defaultFormat, onLog } = options
  const outputDir = join(workDir, "output")
  const log = (line: string) => onLog?.(line)

  const sandboxFiles = await listFilesRecursive(sandbox, outputDir)
  if (sandboxFiles.length === 0) {
    log("No artifact files found under sandbox output directory.")
    return mergeArtifactEntries([], parsedArtifacts, defaultFormat)
  }

  const downloaded: ArtifactEntry[] = []

  for (const sandboxPath of sandboxFiles) {
    const relativePath = normalizeArtifactPath(relative(workDir, sandboxPath))
    const localPath = join(outDir, relativePath)
    await mkdir(dirname(localPath), { recursive: true })

    const written = await sandbox.downloadFile({ path: sandboxPath }, { path: localPath }, { mkdirRecursive: true })
    if (!written) {
      log(`Warning: failed to download ${relativePath}`)
      continue
    }

    downloaded.push({
      path: relativePath,
      localPath: written,
      format: inferFormat(relativePath) ?? defaultFormat,
    })
    log(`Downloaded ${relativePath} → ${written}`)
  }

  return mergeArtifactEntries(downloaded, parsedArtifacts, defaultFormat)
}
