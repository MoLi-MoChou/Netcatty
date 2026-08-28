import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOpenAIChatCompletionsFallbackRequest,
  cattyStreamSystemPromptFields,
  continuationForOpenAIApi,
  isOpenAIChatLanguageModel,
  isOpenAIResponsesStyleRequest,
  isOpenAIResponsesUrl,
  providerOptionsForOpenAIApi,
  rewriteOpenAIResponsesUrlToChatCompletions,
  shouldRetryOpenAIChatCompletionsFallback,
  stripOpenAIResponsesContinuation,
  toStatelessOpenAIChatCompletionsBody,
} from './openaiChatContinuationGuard';

test('chat-mode continuation strips OpenAI Responses ids and keeps other metadata', () => {
  const continuation = {
    source: { providerConfigId: 'qwen-1', providerType: 'qwen', modelId: 'qwen3.5-plus' },
    textProviderOptions: {
      openai: {
        responseId: 'resp_123',
        itemId: 'msg_abc',
        previousResponseId: 'resp_prev',
        conversation: 'conv_1',
        logprobs: [{ token: 'ok' }],
      },
      anthropic: { signature: 'sig-keep' },
    },
    reasoningParts: [{
      text: 'think',
      providerOptions: { openai: { itemId: 'rs_1', reasoningEncryptedContent: 'enc' } },
    }],
    toolCallProviderOptionsById: {
      call_1: { openai: { itemId: 'fc_1' } },
    },
    openAIChatAssistantFields: {
      reasoning_content: 'need context',
      previousResponseId: 'resp_should_drop',
    },
  };

  const stripped = continuationForOpenAIApi(continuation, 'chat');

  assert.deepEqual(stripped?.textProviderOptions, {
    openai: { logprobs: [{ token: 'ok' }] },
    anthropic: { signature: 'sig-keep' },
  });
  assert.deepEqual(stripped?.reasoningParts, [{ text: 'think' }]);
  assert.equal(stripped?.toolCallProviderOptionsById, undefined);
  assert.deepEqual(stripped?.openAIChatAssistantFields, { reasoning_content: 'need context' });
  assert.deepEqual(stripped?.source, continuation.source);
});

test('responses-mode continuation keeps OpenAI response ids', () => {
  const continuation = {
    textProviderOptions: {
      openai: { responseId: 'resp_123', itemId: 'msg_abc' },
    },
    reasoningParts: [{
      text: 'think',
      providerOptions: { openai: { itemId: 'rs_1' } },
    }],
  };

  assert.deepEqual(continuationForOpenAIApi(continuation, 'responses'), continuation);
  assert.deepEqual(
    providerOptionsForOpenAIApi(continuation.textProviderOptions, 'responses'),
    continuation.textProviderOptions,
  );
});

test('missing openaiApi defaults to chat and strips Responses ids', () => {
  const stripped = stripOpenAIResponsesContinuation({
    textProviderOptions: { openai: { item_id: 'msg_snake', previous_response_id: 'resp_snake' } },
  });
  assert.equal(stripped, undefined);
  assert.equal(
    providerOptionsForOpenAIApi({ openai: { itemId: 'msg_1' } }, undefined),
    undefined,
  );
});

test('catty streamText uses system for openai.chat and instructions otherwise', () => {
  assert.equal(isOpenAIChatLanguageModel({ provider: 'openai.chat' }), true);
  assert.equal(isOpenAIChatLanguageModel({ provider: 'openai.responses' }), false);
  assert.deepEqual(
    cattyStreamSystemPromptFields({ provider: 'openai.chat' }, 'be helpful'),
    { system: 'be helpful' },
  );
  assert.deepEqual(
    cattyStreamSystemPromptFields({ provider: 'openai.responses' }, 'be helpful'),
    { instructions: 'be helpful' },
  );
  assert.deepEqual(
    cattyStreamSystemPromptFields({ provider: 'anthropic.messages' }, 'be helpful'),
    { instructions: 'be helpful' },
  );
});

test('detects DashScope-compatible Responses URLs and previous_response_id bodies', () => {
  const dashscopeResponses = 'https://dashscope.aliyuncs.com/compatible-mode/v1/responses';
  const dashscopeChat = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const dashscopeGet = 'https://dashscope.aliyuncs.com/compatible-mode/v1/responses/resp_123';

  assert.equal(isOpenAIResponsesUrl(dashscopeResponses), true);
  assert.equal(isOpenAIResponsesUrl(dashscopeGet), true);
  assert.equal(isOpenAIResponsesUrl(dashscopeChat), false);
  assert.equal(isOpenAIResponsesStyleRequest(dashscopeChat, JSON.stringify({
    previous_response_id: 'resp_123',
    messages: [{ role: 'user', content: 'hi' }],
  })), true);
  assert.equal(isOpenAIResponsesStyleRequest(dashscopeChat, JSON.stringify({
    model: 'qwen3.5-plus',
    messages: [{ role: 'user', content: 'hi' }],
  })), false);
});

test('rewrites Responses URLs to chat/completions and strips response ids from the body', () => {
  const originalUrl = 'https://dashscope.aliyuncs.com/compatible-mode/v1/responses';
  const body = JSON.stringify({
    model: 'qwen3.5-plus',
    instructions: 'You are Catty.',
    previous_response_id: 'resp_123',
    store: true,
    stream: true,
    input: [
      { type: 'item_reference', id: 'msg_old' },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: [{ type: 'output_text', text: '你好！' }] },
      { role: 'user', content: '你是谁' },
    ],
  });

  const fallback = buildOpenAIChatCompletionsFallbackRequest(originalUrl, body);
  assert.equal(
    fallback.url,
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  );
  assert.deepEqual(JSON.parse(fallback.body), {
    model: 'qwen3.5-plus',
    stream: true,
    messages: [
      { role: 'system', content: 'You are Catty.' },
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！' },
      { role: 'user', content: '你是谁' },
    ],
  });
});

test('404 retry helper only fires for chat-mode POST Responses-style requests', () => {
  const url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/responses';
  const body = JSON.stringify({ previous_response_id: 'resp_1', input: [] });

  assert.equal(shouldRetryOpenAIChatCompletionsFallback({
    openaiApi: 'chat',
    method: 'POST',
    url,
    body,
    statusCode: 404,
  }), true);
  assert.equal(shouldRetryOpenAIChatCompletionsFallback({
    openaiApi: 'responses',
    method: 'POST',
    url,
    body,
    statusCode: 404,
  }), false);
  assert.equal(shouldRetryOpenAIChatCompletionsFallback({
    openaiApi: 'chat',
    method: 'GET',
    url,
    statusCode: 404,
  }), false);
  assert.equal(shouldRetryOpenAIChatCompletionsFallback({
    openaiApi: undefined,
    method: 'POST',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    statusCode: 404,
  }), false);
});

test('rewrite helper maps GET /responses/{id} onto chat/completions', () => {
  assert.equal(
    rewriteOpenAIResponsesUrlToChatCompletions(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/responses/resp_abc',
    ),
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  );
  assert.equal(
    toStatelessOpenAIChatCompletionsBody(JSON.stringify({
      model: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hi' }],
      previous_response_id: 'resp_1',
    })),
    JSON.stringify({
      model: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hi' }],
    }),
  );
});
