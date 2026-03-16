/**
 * Unified LLM Provider Interface — native HTTP fetch, zero dependencies.
 * Supports: OpenAI, Anthropic, Gemini, DeepSeek, Ollama, Groq, Kimi.
 */

export interface LLMRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
}

export interface LLMProvider {
  name: string;
  /** Check if this provider handles the given model string */
  match(model: string): boolean;
  /** Call the LLM and return the text response */
  call(req: LLMRequest): Promise<string>;
}

// ─── OpenAI-compatible base (also used by DeepSeek, Groq, Kimi) ─────────────

function openAICompatibleProvider(
  name: string,
  envKey: string,
  defaultBaseUrl: string,
  baseUrlEnv?: string,
): LLMProvider & { callWithConfig(req: LLMRequest, apiKey: string, baseUrl: string): Promise<string> } {
  async function callWithConfig(req: LLMRequest, apiKey: string, baseUrl: string): Promise<string> {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userPrompt },
        ],
        temperature: req.temperature ?? 0,
      }),
    });
    if (!resp.ok) {
      throw new Error(`[${name}] API error ${resp.status}: ${await resp.text()}`);
    }
    const data: any = await resp.json();
    return data.choices[0].message.content;
  }

  return {
    name,
    match: () => false, // overridden per-provider
    call: async (req: LLMRequest) => {
      const apiKey = process.env[envKey];
      if (!apiKey) throw new Error(`${envKey} env var required for ${name} provider.`);
      const baseUrl = (baseUrlEnv && process.env[baseUrlEnv]) || defaultBaseUrl;
      return callWithConfig(req, apiKey, baseUrl);
    },
    callWithConfig,
  };
}

// ─── Concrete Providers ──────────────────────────────────────────────────────

const openaiBase = openAICompatibleProvider('openai', 'OPENAI_API_KEY', 'https://api.openai.com/v1', 'OPENAI_BASE_URL');
const deepseekBase = openAICompatibleProvider('deepseek', 'DEEPSEEK_API_KEY', 'https://api.deepseek.com/v1', 'DEEPSEEK_BASE_URL');
const groqBase = openAICompatibleProvider('groq', 'GROQ_API_KEY', 'https://api.groq.com/openai/v1', 'GROQ_BASE_URL');
const kimiBase = openAICompatibleProvider('kimi', 'KIMI_API_KEY', 'https://api.moonshot.cn/v1', 'KIMI_BASE_URL');

export const openaiProvider: LLMProvider = {
  name: 'openai',
  match: (m) => m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4'),
  call: openaiBase.call,
};

export const deepseekProvider: LLMProvider = {
  name: 'deepseek',
  match: (m) => m.startsWith('deepseek'),
  call: deepseekBase.call,
};

export const groqProvider: LLMProvider = {
  name: 'groq',
  match: (m) => m.startsWith('llama') || m.startsWith('mixtral') || m.startsWith('gemma'),
  call: groqBase.call,
};

export const kimiProvider: LLMProvider = {
  name: 'kimi',
  match: (m) => m.startsWith('moonshot') || m.startsWith('kimi'),
  call: kimiBase.call,
};

// ─── Anthropic (native API) ─────────────────────────────────────────────────

export const anthropicProvider: LLMProvider = {
  name: 'anthropic',
  match: (m) => m.startsWith('claude'),
  async call(req: LLMRequest): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY env var required for Anthropic provider.');
    const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
    const resp = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: 1024,
        system: req.systemPrompt,
        messages: [{ role: 'user', content: req.userPrompt }],
        temperature: req.temperature ?? 0,
      }),
    });
    if (!resp.ok) {
      throw new Error(`[anthropic] API error ${resp.status}: ${await resp.text()}`);
    }
    const data: any = await resp.json();
    const textBlock = data.content?.find((b: any) => b.type === 'text');
    return textBlock?.text ?? '';
  },
};

// ─── Google Gemini (native API) ─────────────────────────────────────────────

export const geminiProvider: LLMProvider = {
  name: 'gemini',
  match: (m) => m.startsWith('gemini'),
  async call(req: LLMRequest): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY env var required for Gemini provider.');
    const baseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    const resp = await fetch(`${baseUrl}/models/${req.model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: req.userPrompt }] }],
        generationConfig: { temperature: req.temperature ?? 0 },
      }),
    });
    if (!resp.ok) {
      throw new Error(`[gemini] API error ${resp.status}: ${await resp.text()}`);
    }
    const data: any = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  },
};

// ─── Ollama (local) ─────────────────────────────────────────────────────────

export const ollamaProvider: LLMProvider = {
  name: 'ollama',
  match: (m) => m.startsWith('ollama:') || m.startsWith('llama3') || m.startsWith('phi') || m.startsWith('qwen') || m.startsWith('mistral'),
  async call(req: LLMRequest): Promise<string> {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    // Strip "ollama:" prefix if present
    const model = req.model.startsWith('ollama:') ? req.model.slice(7) : req.model;
    const resp = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: req.systemPrompt },
          { role: 'user', content: req.userPrompt },
        ],
        stream: false,
        options: { temperature: req.temperature ?? 0 },
      }),
    });
    if (!resp.ok) {
      throw new Error(`[ollama] API error ${resp.status}: ${await resp.text()}`);
    }
    const data: any = await resp.json();
    return data.message?.content ?? '';
  },
};

// ─── Provider Registry ──────────────────────────────────────────────────────

const providers: LLMProvider[] = [
  anthropicProvider,
  geminiProvider,
  ollamaProvider,
  deepseekProvider,
  groqProvider,
  kimiProvider,
  openaiProvider, // fallback — last because it's the most generic
];

/**
 * Resolve a provider from a model name.
 * Falls back to OpenAI-compatible if no specific match.
 */
export function resolveProvider(model: string): LLMProvider {
  for (const p of providers) {
    if (p.match(model)) return p;
  }
  // Default: OpenAI-compatible with OPENAI_API_KEY
  return openaiProvider;
}

/**
 * Call any LLM by model name — auto-routes to the right provider.
 */
export async function callLLM(model: string, systemPrompt: string, userPrompt: string): Promise<string> {
  const provider = resolveProvider(model);
  return provider.call({ model, systemPrompt, userPrompt });
}
