/** Espaço vertical entre portas laterais (com o rótulo de 10px de cada uma). */
export const SIDE_PORT_SPACING = 22;
/** Espaço horizontal entre portas inferiores de sub-nó (rótulos como "Ferramentas"). */
export const BOTTOM_PORT_SPACING = 70;

/**
 * Tamanho mínimo do nó no canvas para as portas não se sobreporem: com muitas entradas ou saídas
 * (Merge, Switch), o nó cresce na altura; com várias portas de sub-nó embaixo (Agent), na
 * largura. `undefined` mantém o tamanho padrão.
 */
export function nodeMinSize(ports: { inputs: number; outputs: number; bottom: number }): {
  minHeight?: number;
  minWidth?: number;
} {
  const side = Math.max(ports.inputs, ports.outputs);
  return {
    ...(side > 2 && { minHeight: (side + 1) * SIDE_PORT_SPACING }),
    ...(ports.bottom > 1 && { minWidth: (ports.bottom + 1) * BOTTOM_PORT_SPACING }),
  };
}
