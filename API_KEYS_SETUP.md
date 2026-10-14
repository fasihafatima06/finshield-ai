# Private local AI provider setup

**Never enter an API-key value in this document, in chat, or in any Git-tracked file.**

For local development, copy `.env.example` to `.env.local` in the project folder. `.env.local` is excluded from Git. Put your OpenRouter key for Nemotron in `NEMOTRON_API_KEY`; the app defaults to Nemotron and does not require a Gemini key. Alternatively, put a Gemini key in `GEMINI_API_KEY` if you explicitly select that provider. Supabase is not connected, so no Supabase settings or credentials are needed.

Do not copy credentials into `.env.example`; that file is a public template and contains placeholders only. Restart `npm run dev` after changing local environment settings.

The Settings workspace reports only whether each provider is configured; it never returns the credential or a masked fragment. A configured key is not proof that the provider will accept it or has quota. **Test connection** sends a small synthetic health-check prompt to the selected provider. Task evaluations require successful live model analysis and send task-analysis text to the configured provider, so do not submit confidential banking data.

## Provider details

- Gemini model: `gemini-3.1-pro-preview`. Requests send the key in Google's `x-goog-api-key` header rather than a URL.
- Nemotron model: `nvidia/nemotron-3-ultra-550b-a55b`, called through OpenRouter's OpenAI-compatible Chat Completions API. (The `:free` suffix is used in the model-page URL, not the API model ID.)
- `AI_PROVIDER=nemotron` is the default. Set `AI_PROVIDER=gemini` to select Gemini explicitly, or `AI_PROVIDER=auto` to try Nemotron first and Gemini only if Nemotron fails. A legacy `AI_PROVIDER=demo` value is treated as `auto`; it does not enable offline analysis. If no provider returns a valid response, the task fails visibly; no offline analyzer or policy rule creates a decision. Set `AI_REQUEST_TIMEOUT_MS` to a value between 1,000 and 120,000 milliseconds (the default is 20,000).

Use the [OpenRouter Nemotron 3 Ultra model page](https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free) to get an OpenRouter key and check model availability. For Gemini, see [Google's Gemini model list](https://ai.google.dev/gemini-api/docs/models) and [API key guidance](https://ai.google.dev/gemini-api/docs/api-key).

## Important limitations

This app is a prototype, not a production banking system. Text-based PDF, CSV, and TXT uploads are parsed in server memory, converted to CSV, and their extracted text is sent to the configured AI provider during analysis. Do not upload confidential banking or customer data. Scanned PDFs, images, and XLSX workbooks are not supported; the simulated Bank Agent cannot move real funds. Task submissions, Agent 1 extraction, Agent 2 security checks and findings, Agent 3 policy results, and converted CSV output persist in the local SQLite database at `data/finshield.sqlite` and are not uploaded to a database service. Clicking a task ID loads its persisted workflow results. The database file is ignored by Git; keep it private and use synthetic data only.
