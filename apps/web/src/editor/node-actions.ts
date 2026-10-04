import { createContext, useContext } from 'react';

/** Ações disponíveis nos nós do canvas (ex.: botão de executar o nó, FR-020). */
export interface NodeActions {
  canExecute: boolean;
  running: boolean;
  runNode(nodeId: string): void;
}

export const NodeActionsContext = createContext<NodeActions>({
  canExecute: false,
  running: false,
  runNode: () => undefined,
});

export const useNodeActions = () => useContext(NodeActionsContext);
