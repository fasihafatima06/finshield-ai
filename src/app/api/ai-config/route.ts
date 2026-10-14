import { NextRequest, NextResponse } from 'next/server';
import { getActiveAIProvider, testAIProviderKey } from '@/lib/engine/ai-providers';

export async function GET() {
  try {
    const config = getActiveAIProvider();
    return NextResponse.json({
      success: true,
      data: {
        activeProvider: config.activeProvider,
        hasGemini: config.hasGemini,
        hasNemotron: config.hasNemotron,
        requestTimeoutMs: config.requestTimeoutMs,
        availableProviders: [
          {
            id: 'gemini',
            name: 'Google Gemini',
            description: 'Server-configured Gemini provider',
            isConfigured: config.hasGemini,
            docsUrl: 'https://aistudio.google.com/app/apikey',
          },
          {
            id: 'nemotron',
            name: 'Nemotron 3 Ultra via OpenRouter',
            description: 'Server-configured OpenRouter provider',
            isConfigured: config.hasNemotron,
            docsUrl: 'https://openrouter.ai/nvidia/nemotron-3-ultra-550b-a55b:free',
          },
        ],
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to get AI status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, provider } = body;

    if (action !== 'test_key' || !['gemini', 'nemotron'].includes(provider)) {
      return NextResponse.json(
        { success: false, error: 'Use action "test_key" and provider "gemini" or "nemotron".' },
        { status: 400 }
      );
    }

    if ('apiKey' in body) {
      return NextResponse.json(
        { success: false, error: 'API keys must be configured in the server-side .env.local file.' },
        { status: 400 }
      );
    }

    const selectedProvider = provider as 'gemini' | 'nemotron';
    const key = selectedProvider === 'gemini'
      ? process.env.GEMINI_API_KEY?.trim()
      : process.env.NEMOTRON_API_KEY?.trim();

    if (!key) {
      return NextResponse.json(
        { success: false, error: `No ${selectedProvider} key is configured in the server environment.` },
        { status: 400 }
      );
    }

    const testResult = await testAIProviderKey(selectedProvider, key);
    return NextResponse.json({
      success: testResult.success,
      data: testResult,
    }, { status: testResult.success ? 200 : 502 });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'AI configuration error' },
      { status: 500 }
    );
  }
}
