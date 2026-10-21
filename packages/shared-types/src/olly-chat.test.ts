import { describe, expect, it } from 'vitest';
import { ollyChatReplyText } from './olly-chat.js';

describe('spec 028 — FR-005 (21/10/2026): texto da resposta do Olly Chat', () => {
  it('FR-005: usa o campo report do JSON final, em lista ou objeto', () => {
    const report = '## Análise\n\n- mobile pf: ok';
    expect(ollyChatReplyText([{ client: 'chat-olly', report, memoria: {} }])).toBe(report);
    expect(ollyChatReplyText({ client: 'chat-olly', report, memoria: {} })).toBe(report);
  });

  it('FR-005: sem report, output ou text; senão o JSON formatado; texto puro como está', () => {
    expect(ollyChatReplyText({ output: 'do Agent' })).toBe('do Agent');
    expect(ollyChatReplyText([{ text: 'da Chain' }])).toBe('da Chain');
    expect(ollyChatReplyText({ report: 7 })).toBe('{\n  "report": 7\n}');
    expect(ollyChatReplyText('texto puro')).toBe('texto puro');
    expect(ollyChatReplyText([])).toBe('[]');
    expect(ollyChatReplyText(null)).toBe('');
  });

  it('FR-005 (correção 21/10/2026): o JSON que chega como texto também é lido (Responder em texto, output do Agent)', () => {
    const report =
      '**Registro:** P-261034459 · **Escopo:** `cronjob`\n\n```mermaid\nflowchart LR\n  A --> B\n```';
    const final = [
      {
        client: 'chat-olly',
        origem: 'orquestrador',
        report,
        memoria: { gist: 'Falhas', coleta: {} },
      },
    ];
    // Responder ao Webhook com "Texto": o corpo é o JSON serializado.
    expect(ollyChatReplyText(JSON.stringify(final, null, 2))).toBe(report);
    expect(ollyChatReplyText(`\n ${JSON.stringify(final[0])} \n`)).toBe(report);
    // Agent cujo output é o JSON (às vezes num bloco ```json).
    expect(ollyChatReplyText([{ output: JSON.stringify(final) }])).toBe(report);
    expect(ollyChatReplyText({ output: '```json\n' + JSON.stringify(final) + '\n```' })).toBe(
      report,
    );
    // Formato de itens do N8N ({ json: {...} }).
    expect(ollyChatReplyText([{ json: final[0] }])).toBe(report);
    // Texto que não é um JSON com report continua como está.
    expect(ollyChatReplyText('[nota] texto { solto }')).toBe('[nota] texto { solto }');
    expect(ollyChatReplyText({ output: '{"a":1}' })).toBe('{"a":1}');
  });
});
