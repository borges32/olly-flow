import { describe, expect, it } from 'vitest';
import { dataFileName, itemsFileContent } from './data-download';

describe('spec 019 — arquivo dos dados do nó', () => {
  it('FR-002/FR-005: o conteúdo é a lista com os dados de cada item, como exibidos (sem binário nem origem)', () => {
    const items = [
      { json: { nome: 'Ana', cpf: '***' }, pairedItem: { item: 0 } },
      { json: { nome: 'Bruno' }, binary: { data: { id: 'b1', mimeType: 'text/plain' } } },
    ];
    expect(itemsFileContent(items)).toEqual([{ nome: 'Ana', cpf: '***' }, { nome: 'Bruno' }]);
    expect(itemsFileContent([])).toEqual([]);
  });

  it('FR-003: o nome junta as partes informadas e troca os caracteres inválidos', () => {
    expect(dataFileName(['Adulto?', 'saida', 'Verdadeiro'])).toBe('Adulto_-saida-Verdadeiro.json');
    expect(dataFileName(['HTTP: GET /clientes', 'entrada', undefined])).toBe(
      'HTTP_ GET _clientes-entrada.json',
    );
    expect(dataFileName(['Laço', 'saida', 'execucao-2'])).toBe('Laço-saida-execucao-2.json');
    expect(dataFileName(['a\u0007b"c<d>e|f*g\\h'])).toBe('a_b_c_d_e_f_g_h.json');
    expect(dataFileName([' ', undefined])).toBe('dados.json');
  });
});
