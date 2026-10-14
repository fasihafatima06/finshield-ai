# FinShield AI

FinShield AI is a banking-workflow governance **prototype**. It demonstrates a sequence of document/task checks, security findings, policy decisions, optional reviewer approval, and a simulated bank-agent executor. It is not a banking product, has no banking-rail connection, and makes no regulatory-compliance claim.

## Run locally

Requirements: Node.js 24+ and npm. Node's built-in SQLite module is used for local persistence.

```powershell
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With `AI_PROVIDER=auto` (the default), Gemini is selected first when its key is configured, then NVIDIA; otherwise the app uses the offline demo engine. Choose **Load sample data** on Overview to seed synthetic tasks and policies. Allocate Task accepts up to 8 text-based PDF (50 pages maximum), CSV, or TXT files (10 MB each); every file becomes a separate task, is parsed on the server, and gets a downloadable CSV conversion. Scanned PDFs, image files, and XLSX workbooks are not supported. No real funds are transferred.

## AI provider keys

The project root has a local `.env.local` file, ignored by Git. The app needs only two AI credentials: `GEMINI_API_KEY` and `NEMOTRON_API_KEY`. No Supabase key is needed because the app does not connect to Supabase. Never put credential values in this README or another tracked file.

The task-analysis pipeline uses Gemini (`gemini-3.1-pro-preview`) when selected, then NVIDIA Nemotron 3 Ultra (`nvidia/nemotron-3-ultra-550b-a55b`) when selected, and otherwise the offline demo analyzer. Never put secrets in `NEXT_PUBLIC_*`, Git-tracked files, or chat. `.env.example` contains placeholders only.

To demonstrate the full workflow without uploading a file, open **Allocate Task**, select **Use sample**, then **Submit for evaluation**. This prefills a synthetic $12,450 invoice. With the high-amount verification policy active, it should produce **Verify** for human review. The task is automatically opened in **FinShield AI**; click its task ID later to revisit the saved Agent 1 extraction, Agent 2 findings and checks, and Agent 3 policy checks and decision rationale.

The provider adapters use configured model IDs and endpoints in `src/lib/engine/ai-providers.ts`; verify those values against the model access and official API instructions for your account before enabling live provider calls. The Settings screen can test a configured server-side key with a synthetic sample. Live calls send the task-analysis prompt to that third-party provider.

## What works in this prototype

- Responsive control dashboard with Overview, Allocate Task, FinShield AI, Bank Agent, History, and Settings workspaces.
- Single and bulk task submission, automatic pipeline processing, task status polling, complete task details, findings, and event timeline.
- Three sequential stages: server-side text extraction and CSV conversion, deterministic security checks plus optional strict-schema model analysis, then deterministic policy evaluation.
- Agent 1 parses supported document text and extracts task fields; Agent 2 checks for security risks and suspicious content; Agent 3 applies deterministic policy rules to those inputs and decides Allow, Verify, or Block. The AI can contribute security findings, but does not decide the final outcome.
- Separate task IDs and pipeline runs for each file in a bulk submission; Bank Agent shows ready, executing, and executed tasks.
- Parsed CSV downloads for supported uploads. Uploaded document text is evaluated as untrusted input.
- ALLOW, BLOCK, and VERIFY outcomes; reviewer-reason capture for VERIFY; server-side state/decision checks before sandbox execution.
- Idempotency key handling for repeated task submission and duplicate sandbox-execution protection.
- Provider status, server-only connection tests, policy toggles, and explicit offline/demo indicators.
- API and UI limits for supported file formats, batches of 8 files, and 10 MB maximum size per file.

## Architecture and limitations

The Next.js App Router UI calls server Route Handlers. The pipeline runs in-process and sequentially within a task. Tasks, Agent 1 extracted fields and source text, Agent 2 security findings and check summaries, Agent 3 policy checks and decision rationale, converted CSV, reviews, execution records, and audit events persist in a local SQLite database at `data/finshield.sqlite` (override with `FINSHIELD_DB_PATH`). Opening a task by ID retrieves those saved results from SQLite. The database and SQLite sidecar files are ignored by Git. Uploaded original file bytes are parsed in memory and are not written as files. This local SQLite store is intended for a single-machine classroom demonstration, not as a production or multi-user database. Treat the local database as sensitive: evaluation data and extracted document text remain on disk after the app exits, so use synthetic documents only and protect or delete the database file when finished. There is no durable queue, worker service, scanned-document OCR or image/XLSX parser, database migrations/RLS, or application authentication yet. The current demo identity and API routes are not suitable for network exposure or production authorization.

The AI model can contribute findings but the deterministic policy engine owns final decisions. Invalid provider output or provider failure fails the mandatory security stage rather than being treated as a clean result. Demo model confidence is not fabricated. The sandbox executor is illustrative only.

Before any production use, implement and independently review authenticated roles, persistent PostgreSQL storage and migrations, RLS, private file storage and scanned-document/OCR support as required, a durable worker queue, transactionally enforced state/idempotency constraints, monitoring, data-retention controls, rate limits, and deployment secrets management. Review external model data handling and configure provider/model identifiers using current vendor documentation.

## Commands

```powershell
npm run dev
npm run lint
npm run build
npm start
```

There is not yet a test suite or production database integration configured in this prototype. Do not use real banking, customer, account, or payment data.
