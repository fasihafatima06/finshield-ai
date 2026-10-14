import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeWithGemini, getAIRequestTimeoutMs, runAIGovernanceDecision, runAISecurityInspection } from './ai-providers';

const validAnalysis = {
  promptInjectionDetected: false,
  injectionDetails: null,
  riskScore: 8,
  confidence: 0.91,
  threatLevel: 'low',
  findings: [],
  explanation: 'No material security concerns found in the supplied test document.',
  suggestedDecision: 'ALLOW',
};

const params = {
  taskType: 'invoice_verification',
  documentText: 'Invoice INV-100, amount $50, vendor Example Corp.',
  extractedFields: { invoice_number: 'INV-100', amount: 50, vendor_name: 'Example Corp' },
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GEMINI_API_KEY;
  delete process.env.NEMOTRON_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.AI_PROVIDER;
  delete process.env.AI_REQUEST_TIMEOUT_MS;
});

describe('AI provider integration', () => {
  it('clamps the configurable request timeout to a safe range', () => {
    process.env.AI_REQUEST_TIMEOUT_MS = '1';
    expect(getAIRequestTimeoutMs()).toBe(1_000);
    process.env.AI_REQUEST_TIMEOUT_MS = '900000';
    expect(getAIRequestTimeoutMs()).toBe(120_000);
    process.env.AI_REQUEST_TIMEOUT_MS = 'invalid';
    expect(getAIRequestTimeoutMs()).toBe(20_000);
  });

  it('sends Gemini credentials only in the request header and parses valid JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validAnalysis) }] } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await analyzeWithGemini(params, 'secret-test-key');
    expect(result.suggestedDecision).toBe('ALLOW');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).not.toContain('secret-test-key');
    expect(options.headers['x-goog-api-key']).toBe('secret-test-key');
  });

  it('fails over to Nemotron after a transient Gemini failure', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    process.env.NEMOTRON_API_KEY = 'nemotron-test-key';
    process.env.AI_PROVIDER = 'auto';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('service unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response('service unavailable', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(validAnalysis) } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAISecurityInspection(params);
    expect(result.provider).toBe('nemotron');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('requires live provider credentials instead of returning an offline decision', async () => {
    await expect(runAISecurityInspection(params)).rejects.toThrow('No live AI provider is available');
  });

  it('treats a legacy demo provider setting as live auto mode', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    process.env.AI_PROVIDER = 'demo';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validAnalysis) }] } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAISecurityInspection(params);
    expect(result.provider).toBe('gemini');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('sends active policy evidence to the live governance model', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    process.env.AI_PROVIDER = 'gemini';
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validAnalysis) }] } }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAIGovernanceDecision({
      ...params,
      activePolicies: [{ name: 'High amount review', description: 'Review payments over threshold', action: 'verify', conditions: { threshold: 10000 } }],
      policyChecks: [{ name: 'High amount review', action: 'verify', passed: false, details: 'Amount exceeds the configured threshold', evidence: '$12,450' }],
    });

    expect(result.suggestedDecision).toBe('ALLOW');
    expect(fetchMock.mock.calls[0][1].body).toContain('Amount exceeds the configured threshold');
    expect(fetchMock.mock.calls[0][1].body).toContain('make the final Allow, Verify, or Block decision yourself');
  });

  it('rejects a live response that omits required model confidence', async () => {
    const incompleteAnalysis: Record<string, unknown> = { ...validAnalysis };
    delete incompleteAnalysis.confidence;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(incompleteAnalysis) }] } }],
    }), { status: 200 })));

    await expect(analyzeWithGemini(params, 'secret-test-key'))
      .rejects.toThrow('invalid security analysis schema');
  });
});
