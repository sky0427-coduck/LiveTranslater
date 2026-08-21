import fs from 'fs';
import path from 'path';
import type { TranslationEngine } from '../../../shared/types';

export interface TranslationResult {
  translated: string;
  sourceLang: string;
  targetLang: string;
  engine: TranslationEngine;
}

interface TranslationConfig {
  deepl?: {
    apiKey?: string;
    apiUrl?: string;
  };
  openai?: {
    apiKey?: string;
    model?: string;
  };
}

interface ITranslationEngine {
  translate(text: string, sourceLang: string, targetLang: string): Promise<TranslationResult>;
  name: TranslationEngine;
}

function loadTranslationConfig(): TranslationConfig {
  const candidates = [
    path.resolve(process.cwd(), 'transmodel.json'),
    path.resolve(process.cwd(), '..', 'transmodel.json'),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as TranslationConfig;
    } catch (err) {
      console.warn(`[translation] transmodel.json parse failed: ${filePath}`, err);
    }
  }

  return {};
}

const translationConfig = loadTranslationConfig();

class DeepLTranslationEngine implements ITranslationEngine {
  name: TranslationEngine = 'deepl';
  private apiKey: string;
  private apiUrl: string;

  constructor() {
    this.apiKey = translationConfig.deepl?.apiKey || process.env.DEEPL_API_KEY || '';
    this.apiUrl = translationConfig.deepl?.apiUrl || 'https://api-free.deepl.com/v2/translate';
    if (!this.apiKey) console.warn('[translation] DeepL API key is missing');
  }

  async translate(text: string, sourceLang: string, targetLang: string): Promise<TranslationResult> {
    if (!this.apiKey) throw new Error('DeepL API key is missing');
    if (!text.trim()) throw new Error('Nothing to translate');

    const deeplSource = sourceLang === 'auto' ? null : sourceLang.toUpperCase();
    const deeplTarget = targetLang.toUpperCase();

    const params = new URLSearchParams();
    params.append('text', text);
    params.append('target_lang', deeplTarget);
    if (deeplSource) params.append('source_lang', deeplSource);
    params.append('formality', 'default');

    const { default: fetch } = await import('node-fetch');
    const res = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `DeepL-Auth-Key ${this.apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`DeepL API error ${res.status}: ${err}`);
    }

    const data = await res.json() as {
      translations: Array<{ detected_source_language: string; text: string }>;
    };
    const result = data.translations[0];

    return {
      translated: result.text,
      sourceLang: result.detected_source_language.toLowerCase(),
      targetLang,
      engine: 'deepl',
    };
  }
}

class OpenAITranslationEngine implements ITranslationEngine {
  name: TranslationEngine = 'openai-realtime';
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = translationConfig.openai?.apiKey || process.env.OPENAI_API_KEY || '';
    this.model = translationConfig.openai?.model || 'gpt-4o-mini';
    if (!this.apiKey) console.warn('[translation] OpenAI API key is missing');
  }

  async translate(text: string, sourceLang: string, targetLang: string): Promise<TranslationResult> {
    if (!this.apiKey) throw new Error('OpenAI API key is missing');
    if (!text.trim()) throw new Error('Nothing to translate');

    const langNames: Record<string, string> = {
      ko: 'Korean',
      en: 'English',
      ja: 'Japanese',
      zh: 'Chinese',
      fr: 'French',
      de: 'German',
      es: 'Spanish',
      auto: 'detected language',
    };
    const targetName = langNames[targetLang] ?? targetLang;

    const { default: fetch } = await import('node-fetch');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: `You are a professional interpreter at a debate tournament. Translate the following text to ${targetName}. Output only the translated text.`,
          },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${err}`);
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string } }>;
    };

    return {
      translated: data.choices[0]?.message?.content?.trim() ?? '',
      sourceLang,
      targetLang,
      engine: 'openai-realtime',
    };
  }
}

class TranslationServiceManager {
  private engines: Map<TranslationEngine, ITranslationEngine>;
  private currentEngine: TranslationEngine = 'deepl';

  constructor() {
    this.engines = new Map<TranslationEngine, ITranslationEngine>([
      ['deepl', new DeepLTranslationEngine()],
      ['openai-realtime', new OpenAITranslationEngine()],
    ]);
  }

  switchEngine(engine: TranslationEngine): void {
    if (!this.engines.has(engine)) throw new Error(`Unknown translation engine: ${engine}`);
    this.currentEngine = engine;
    console.log(`[translation] engine switched to ${engine}`);
  }

  getCurrentEngine(): TranslationEngine {
    return this.currentEngine;
  }

  async translate(
    text: string,
    sourceLang: string,
    targetLang: string,
    engineOverride?: TranslationEngine
  ): Promise<TranslationResult> {
    const engineName = engineOverride ?? this.currentEngine;
    const engine = this.engines.get(engineName);
    if (!engine) throw new Error(`Translation engine missing: ${engineName}`);
    return engine.translate(text, sourceLang, targetLang);
  }
}

export const translationService = new TranslationServiceManager();
