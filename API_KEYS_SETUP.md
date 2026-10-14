# Private local AI provider setup

**Never enter an API-key value in this document, in chat, or in any Git-tracked file.**

For local development, use the existing `.env.local` file in the project folder. It is excluded from Git by `.gitignore`. The app needs only two provider credentials: put your Gemini credential in `GEMINI_API_KEY` and your Nemotron credential in `NEMOTRON_API_KEY`. Supabase is not connected, so no Supabase settings or credentials are needed.

Do not copy credentials into `.env.example`; that file is a public template and contains placeholders only. Restart `npm run dev` after changing local environment settings.

The Settings workspace reports only whether each provider is configured; it never returns the credential or a masked fragment. A configured key is not proof that the provider will accept it or has quota. **Test connection** sends a small synthetic health-check prompt to the selected provider. Task evaluations require successful live model analysis and send task-analysis text to the configured provider, so do not submit confidential banking data.

## Provider details

- Gemini model: `gemini-3.1-pro-preview`. Requests send the key in Google's `x-goog-api-key` header rather than a URL.
- NVIDIA model: `nvidia/nemotron-3-ultra-550b-a55b` (Nemotron 3 Ultra 550B A55B), using NVIDIA's OpenAI-compatible NIM endpoint.
- When `AI_PROVIDER=auto` (the default), Gemini is tried first when configured, then NVIDIA if Gemini fails. Set `AI_PROVIDER=gemini` or `AI_PROVIDER=nemotron` to select a provider explicitly. A legacy `AI_PROVIDER=demo` value is treated as `auto`; it does not enable offline analysis. If no provider returns a valid response, the task fails visibly; no offline analyzer or policy rule creates a decision. Set `AI_REQUEST_TIMEOUT_MS` to a value between 1,000 and 120,000 milliseconds (the default is 20,000).

Check the [NVIDIA Nemotron 3 Ultra model card](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b), [Google's Gemini model list](https://ai.google.dev/gemini-api/docs/models), and [Google Gemini API key guidance](https://ai.google.dev/gemini-api/docs/api-key) for current provider details.

## Important limitations

This app is a prototype, not a production banking system. Text-based PDF, CSV, and TXT uploads are parsed in server memory, converted to CSV, and their extracted text is sent to the configured AI provider during analysis. Do not upload confidential banking or customer data. Scanned PDFs, images, and XLSX workbooks are not supported; the simulated Bank Agent cannot move real funds. Task submissions, Agent 1 extraction, Agent 2 security checks and findings, Agent 3 policy results, and converted CSV output persist in the local SQLite database at `data/finshield.sqlite` and are not uploaded to a database service. Clicking a task ID loads its persisted workflow results. The database file is ignored by Git; keep it private and use synthetic data only.
