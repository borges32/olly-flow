import { resolveNodePorts } from '@olly/shared-types';
import { describe, expect, it } from 'vitest';
import { createNodeRegistry } from '../../builtin.js';
import { chatConfig, chatSettings, isValidWebhookId } from './config.js';
import { chatTrigger } from './definition.js';
import { chatMessageText, chatResponseBody, fileAllowed } from './response.js';

describe('spec 021 — nó Chat Trigger', () => {
  it('FR-001: repassa o item da mensagem; sem itens, emite uma mensagem vazia de uma sessão nova', async () => {
    const item = { json: { sessionId: 's-1', action: 'sendMessage', chatInput: 'Oi' } };
    expect(
      await chatTrigger.execute({ inputs: { main: [item] }, items: [item] }, {} as never),
    ).toEqual({ main: [item] });
    const empty = await chatTrigger.execute({ inputs: {}, items: [] }, {} as never);
    expect(empty.main).toEqual([
      { json: { sessionId: expect.any(String) as string, action: 'sendMessage', chatInput: '' } },
    ]);
  });

  it('FR-001/FR-006: está no catálogo, sem entradas; "Da memória" acrescenta a entrada de memória', () => {
    const description = createNodeRegistry().get('trigger.chat');
    expect(description).toMatchObject({ category: 'trigger', inputs: [] });
    const ports = resolveNodePorts(chatTrigger, {
      params: { options: { loadPreviousSession: 'memory' } },
    });
    expect(ports.inputs.map((p) => p.kind)).toEqual(['ai_memory']);
    expect(ports.outputs.map((p) => p.name)).toEqual(['main']);
  });

  it('FR-003/NFR-004: a configuração da página traz só textos e opções, com os padrões', () => {
    const settings = chatSettings({
      params: {
        webhookId: 'c0ffee00-1234',
        public: true,
        authentication: 'basicAuth',
        initialMessages: 'Olá!\n\nSou o assistente.',
        options: { allowFileUploads: true, allowedFilesMimeTypes: 'image/*', title: 'Suporte' },
      },
    });
    expect(chatConfig(settings)).toEqual({
      title: 'Suporte',
      subtitle: 'Comece uma conversa. Estamos aqui para ajudar.',
      initialMessages: ['Olá!', 'Sou o assistente.'],
      inputPlaceholder: 'Digite sua pergunta...',
      showWelcomeScreen: false,
      getStarted: 'Nova conversa',
      allowFileUploads: true,
      allowedFilesMimeTypes: 'image/*',
      authentication: 'basicAuth',
      loadPreviousSession: false,
    });
    // Modo incorporado: sem mensagens iniciais; valores desconhecidos caem no padrão.
    const embedded = chatSettings({ params: { mode: 'webhook', authentication: 'x' } });
    expect(chatConfig(embedded).initialMessages).toEqual([]);
    expect(embedded.authentication).toBe('none');
    expect(embedded.options.responseMode).toBe('lastNode');
    expect(isValidWebhookId('c0ffee00-1234')).toBe(true);
    expect(isValidWebhookId('../x')).toBe(false);
  });

  it('FR-005: a resposta é o JSON do último nó; o texto exibido é output, text ou o JSON', () => {
    expect(chatResponseBody([{ json: { output: 'Oi!' } }, { json: { output: 'outro' } }])).toEqual({
      output: 'Oi!',
    });
    expect(chatResponseBody(undefined)).toEqual({});
    expect(chatMessageText({ output: 'Resposta do agente' })).toBe('Resposta do agente');
    expect(chatMessageText({ text: 'Resposta da chain' })).toBe('Resposta da chain');
    expect(chatMessageText({ nota: 7 })).toBe('{\n  "nota": 7\n}');
    expect(chatMessageText('texto puro')).toBe('texto puro');
    expect(chatMessageText(undefined)).toBe('');
  });

  it('FR-007: tipos de arquivo permitidos com curingas, lista e `*`', () => {
    expect(fileAllowed('image/png', 'image/*,application/pdf')).toBe(true);
    expect(fileAllowed('application/pdf; charset=binary', 'image/*,application/pdf')).toBe(true);
    expect(fileAllowed('text/plain', 'image/*,application/pdf')).toBe(false);
    expect(fileAllowed('text/plain', '*')).toBe(true);
    expect(fileAllowed('text/plain', '')).toBe(false);
  });
});
