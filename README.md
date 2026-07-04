# field-pipeline

**Training data from the field, not from engineers.**

A lightweight, fast pipeline for AI engineers to turn **frontline / domain expert input** into export-ready training artifacts. Built on [Vercel Sandbox](https://vercel.com/docs/sandbox) (Docker) + [Pi](https://pi.dev/) + **your choice of LLM**.

No heavy orchestration. No vendor lock-in on model provider. YAML in, artifacts out.

---

## Why this exists

Most training-data workflows are built by engineers guessing what frontline workers mean. **field-pipeline** inverts that:

| Layer | Who | What they provide |
|-------|-----|-------------------|
| **Field inputs** | Domain experts — GCs, nurses, technicians, associates | Raw briefs, examples, label rules, edge cases |
| **Engineer prompt** | You (AI engineer) | How Pi should structure, validate, and write artifacts |
| **Run** | Vercel Sandbox + Pi + LLM | Isolated Docker run produces files under `/work/output` |
| **Export** | Your training stack | JSONL / CSV / manifest → Hugging Face, OpenAI fine-tune, custom |

### Key benefits

1. **Field-sourced, not engineer-sourced** — Capture requirements from people who actually do the work; Pi handles structuring and generation.
2. **Lightweight but fast** — One microVM, Docker, Pi print mode. Smoke tests complete in ~1–2 minutes.
3. **Flexible export** — Declare output format in workflow YAML; get manifests and dataset-card stubs for downstream pipelines.

---

## How it works

```
Domain expert brief (fieldInputs)
        ↓
AI engineer workflow YAML (engineerPrompt + output spec)
        ↓
field-pipeline run workflow.yaml
        ↓
Vercel Sandbox → Docker → Pi (-p prompt)
        ↓
/work/output/*  +  SUMMARY.md
        ↓
Export manifest → your trainer (HF, OpenAI, custom)
```

---

## Quick start

### Prerequisites

- Node.js 20+
- A [Vercel](https://vercel.com) project linked for Sandbox OIDC
- An LLM API key for Pi: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`

### Install

```bash
git clone https://github.com/deboboy/field-pipeline.git
cd field-pipeline
pnpm install   # or npm install
```

### Auth (local)

```bash
vercel link
vercel env pull   # writes VERCEL_OIDC_TOKEN (~12h lifetime)
export ANTHROPIC_API_KEY=sk-ant-...   # or OPENAI_API_KEY
```

On Vercel deployments, OIDC is automatic.

### Validate & run

```bash
pnpm exec tsx bin/field-pipeline.ts validate examples/smoke-test.yaml
pnpm exec tsx bin/field-pipeline.ts run examples/smoke-test.yaml --out .runs
```

Or after `pnpm link`:

```bash
field-pipeline run examples/smoke-test.yaml --out .runs
```

---

## Workflow YAML

```yaml
name: My workflow
description: Optional summary
domain: construction   # optional industry tag

# From domain experts — paste their brief verbatim
fieldInputs: |
  What frontline users need labeled, formatted, or exemplified…

# Your Pi instructions — schema, file paths, constraints
engineerPrompt: |
  Write /work/output/dataset.jsonl with …
  Write /work/output/SUMMARY.md with …

dockerImage: node:22-bookworm   # optional

output:
  format: jsonl                 # jsonl | csv | markdown | custom
  schema: |
    field_a (string), field_b (enum: x|y)
  artifacts:
    - output/dataset.jsonl
    - output/SUMMARY.md
```

See [`examples/`](examples/) for construction, healthcare, and retail starters.

---

## Programmatic API

```typescript
import {
  runPipeline,
  buildExportManifest,
  toHuggingFaceDatasetCard,
} from "field-pipeline"

const result = await runPipeline({
  name: "Smoke test",
  fieldInputs: "…",
  engineerPrompt: "…",
  output: { format: "jsonl" },
})

const manifest = buildExportManifest(workflow, result)
const card = toHuggingFaceDatasetCard(manifest)
```

---

## Export model

After a run, use `--out` to write:

| File | Purpose |
|------|---------|
| `*.manifest.json` | Portable metadata: workflow, run, artifact paths, export hints |
| `*.dataset-card.md` | Hugging Face dataset card stub |
| `*.logs.txt` | Full sandbox log |

Artifact **bytes** live in the sandbox filesystem at `/work/output`. For v0, copy them from logs or extend with sandbox file download. The manifest tells your training pipeline what to expect.

**Suggested importers**

- `generic-jsonl` — any JSONL fine-tune or eval harness
- `openai-finetune` — use `toOpenAiFineTuneEnvelope()` metadata wrapper
- `huggingface` — upload artifacts + generated dataset card

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VERCEL_OIDC_TOKEN` | Local dev | From `vercel env pull`; automatic on Vercel |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Yes | Passed into Pi container |
| `VERCEL_TOKEN` + team/project IDs | External CI only | Alternative to OIDC |

---

## Relationship to PocketForeman

This repo is the **open-source core** extracted from the training-data pipeline prototyped in [PocketForeman](https://github.com/deboboy/pocket-foreman). PocketForeman adds auth, roles, and a mobile UI for construction owners + AI engineers. **field-pipeline** is the portable engine any industry can embed.

---

## Roadmap

- [ ] Pull artifact bytes from sandbox to local `--out` directory
- [ ] CSV / Parquet export helpers
- [ ] GitHub Action for scheduled workflow runs
- [ ] Webhook adapter for field-input collection apps

---

## License

MIT — see [LICENSE](LICENSE)
