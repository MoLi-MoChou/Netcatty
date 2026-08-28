import type { OpenAIApiFormat } from './types';
import type {
  ProviderContinuation,
  ProviderContinuationOptions,
  ProviderContinuationReasoningPart,
} from './providerContinuation';

const OPENAI_RESPONSES_CONTINUATION_KEYS = new Set([
  'responseid',
  'itemid',
  'previousresponseid',
  'conversation',
  'reasoningencryptedcontent',
  'encryptedcontent',
]);

function normalizeContinuationKey(key: string): string {
  return key.replace(/_/g, '').toLowerCase();
}

export function isOpenAIResponsesContinuationKey(key: string): boolean {
  return OPENAI_RESPONSES_CONTINUATION_KEYS.has(normalizeContinuationKey(key));
}

export function isOpenAIChatApi(openaiApi: OpenAIApiFormat | undefined): boolean {
  return openaiApi !== 'responses';
}

export function isOpenAIChatLanguageModel(model: { provider?: string } | null | undefined): boolean {
  const provider = model?.provider ?? '';
  return provider === 'openai.chat' || provider.startsWith('openai.chat');
}

/**
 * AI SDK 7 renamed `system` → `instructions` for every provider. Chat Completions
 * still maps `system` onto a `/chat/completions` system message, while Responses
 * uses `instructions` (and may chain `previous_response_id`). Keep Responses
 * opt-in on `instructions`; chat stays on `system` so the SDK does not treat the
 * turn as a stored Responses continuation.
 */
export function cattyStreamSystemPromptFields(
  model: { provider?: string } | null | undefined,
  systemPrompt: string,
): { system: string } | { instructions: string } {
  if (isOpenAIChatLanguageModel(model)) {
    return { system: systemPrompt };
  }
  return { instructions: systemPrompt };
}

export function stripOpenAIResponsesContinuationOptions(
  options: ProviderContinuationOptions | undefined,
): ProviderContinuationOptions | undefined {
  if (!options) return undefined;
  const openaiOptions = options.openai;
  if (!openaiOptions) return options;

  const nextOpenAI: Record<string, (typeof openaiOptions)[string]> = {};
  for (const [key, value] of Object.entries(openaiOptions)) {
    if (isOpenAIResponsesContinuationKey(key)) continue;
    nextOpenAI[key] = value;
  }

  const next: ProviderContinuationOptions = { ...options };
  if (Object.keys(nextOpenAI).length) {
    next.openai = nextOpenAI;
  } else {
    delete next.openai;
  }
  return Object.keys(next).length ? next : undefined;
}

function stripReasoningParts(
  parts: ProviderContinuationReasoningPart[] | undefined,
): ProviderContinuationReasoningPart[] | undefined {
  if (!parts?.length) return undefined;
  const next = parts.map((part) => {
    const providerOptions = stripOpenAIResponsesContinuationOptions(part.providerOptions);
    return {
      text: part.text,
      ...(providerOptions ? { providerOptions } : {}),
    };
  });
  return next.length ? next : undefined;
}

function stripToolCallProviderOptions(
  byId: Record<string, ProviderContinuationOptions> | undefined,
): Record<string, ProviderContinuationOptions> | undefined {
  if (!byId) return undefined;
  const next: Record<string, ProviderContinuationOptions> = {};
  for (const [toolCallId, options] of Object.entries(byId)) {
    const stripped = stripOpenAIResponsesContinuationOptions(options);
    if (stripped) next[toolCallId] = stripped;
  }
  return Object.keys(next).length ? next : undefined;
}

export function stripOpenAIResponsesContinuation(
  continuation: ProviderContinuation | undefined,
): ProviderContinuation | undefined {
  if (!continuation) return undefined;
  const reasoningParts = stripReasoningParts(continuation.reasoningParts);
  const textProviderOptions = stripOpenAIResponsesContinuationOptions(continuation.textProviderOptions);
  const toolCallProviderOptionsById = stripToolCallProviderOptions(continuation.toolCallProviderOptionsById);
  const openAIChatAssistantFields = stripOpenAIResponsesAssistantFields(
    continuation.openAIChatAssistantFields,
  );

  if (!reasoningParts && !textProviderOptions && !toolCallProviderOptionsById && !openAIChatAssistantFields && !continuation.source) {
    return undefined;
  }

  return {
    ...(continuation.source ? { source: continuation.source } : {}),
    ...(reasoningParts ? { reasoningParts } : {}),
    ...(textProviderOptions ? { textProviderOptions } : {}),
    ...(toolCallProviderOptionsById ? { toolCallProviderOptionsById } : {}),
    ...(openAIChatAssistantFields ? { openAIChatAssistantFields } : {}),
  };
}

export function stripOpenAIResponsesAssistantFields(
  fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isOpenAIResponsesContinuationKey(key)) continue;
    next[key] = value;
  }
  return Object.keys(next).length ? next : undefined;
}

export function continuationForOpenAIApi(
  continuation: ProviderContinuation | undefined,
  openaiApi: OpenAIApiFormat | undefined,
): ProviderContinuation | undefined {
  if (!isOpenAIChatApi(openaiApi)) return continuation;
  return stripOpenAIResponsesContinuation(continuation);
}

export function providerOptionsForOpenAIApi(
  options: ProviderContinuationOptions | undefined,
  openaiApi: OpenAIApiFormat | undefined,
): ProviderContinuationOptions | undefined {
  if (!isOpenAIChatApi(openaiApi)) return options;
  return stripOpenAIResponsesContinuationOptions(options);
}

export function isOpenAIResponsesUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.replace(/\/+$/, '');
    return /\/responses(?:\/|$)/.test(`${pathname}/`);
  } catch {
    return /\/responses(?:\/|$|\?)/.test(url);
  }
}

export function isOpenAIResponsesStyleRequest(url: string, body?: string): boolean {
  if (isOpenAIResponsesUrl(url)) return true;
  if (!body) return false;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const record = parsed as Record<string, unknown>;
    return hasPreviousResponseId(record) || (Array.isArray(record.input) && !Array.isArray(record.messages));
  } catch {
    return /previous_response_id/.test(body);
  }
}

function hasPreviousResponseId(record: Record<string, unknown>): boolean {
  return typeof record.previous_response_id === 'string'
    || typeof record.previousResponseId === 'string';
}

export function shouldRetryOpenAIChatCompletionsFallback(args: {
  openaiApi: OpenAIApiFormat | undefined;
  method: string;
  url: string;
  body?: string;
  statusCode: number;
}): boolean {
  if (!isOpenAIChatApi(args.openaiApi)) return false;
  if (args.statusCode !== 404) return false;
  if (args.method.toUpperCase() !== 'POST') return false;
  return isOpenAIResponsesStyleRequest(args.url, args.body);
}

export function rewriteOpenAIResponsesUrlToChatCompletions(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/\/responses(?:\/[^/]*)?\/?$/, '/chat/completions');
    return parsed.toString();
  } catch {
    return url.replace(/\/responses(?:\/[^/?#]*)?/, '/chat/completions');
  }
}

function flattenResponsesContent(content: unknown): unknown {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content;
  const texts = content.flatMap((part) => {
    if (typeof part === 'string') return [part];
    if (!part || typeof part !== 'object') return [];
    const record = part as Record<string, unknown>;
    if (typeof record.text === 'string') return [record.text];
    return [];
  });
  if (texts.length === content.length) return texts.join('');
  return content;
}

/**
 * Convert a Responses-API JSON body into a stateless Chat Completions payload:
 * messages only, no stored response ids.
 */
export function toStatelessOpenAIChatCompletionsBody(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return body;

  const record = { ...(parsed as Record<string, unknown>) };
  delete record.previous_response_id;
  delete record.previousResponseId;
  delete record.response_id;
  delete record.responseId;
  delete record.conversation;
  delete record.store;

  const messages: unknown[] = Array.isArray(record.messages) ? [...record.messages] : [];
  if (!messages.length && Array.isArray(record.input)) {
    if (typeof record.instructions === 'string' && record.instructions) {
      messages.push({ role: 'system', content: record.instructions });
    }
    for (const item of record.input) {
      if (!item || typeof item !== 'object') continue;
      const entry = item as Record<string, unknown>;
      if (entry.type === 'item_reference') continue;
      if (typeof entry.role === 'string' && entry.content != null) {
        messages.push({
          role: entry.role,
          content: flattenResponsesContent(entry.content),
        });
      }
    }
    record.messages = messages;
    delete record.input;
    delete record.instructions;
  } else if (messages.length) {
    record.messages = messages;
  }

  return JSON.stringify(record);
}

export function buildOpenAIChatCompletionsFallbackRequest(url: string, body: string): { url: string; body: string } {
  return {
    url: rewriteOpenAIResponsesUrlToChatCompletions(url),
    body: toStatelessOpenAIChatCompletionsBody(body),
  };
}
