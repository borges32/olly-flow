import { useCallback, useState, type CSSProperties } from 'react';
import { loadColumnSizes, saveColumnSizes, type ColumnSizes } from './column-sizes';

const storage = () => window.localStorage;

/** Larguras das colunas do painel do nó (spec 025), lembradas no navegador. */
export function useColumnSizes() {
  const [sizes, setSizes] = useState<ColumnSizes>(() => loadColumnSizes(storage));
  const update = useCallback((next: ColumnSizes, persist: boolean) => {
    setSizes(next);
    if (persist) saveColumnSizes(storage, next);
  }, []);
  // Na tela larga: colunas nas larguras do estado, com as divisórias (`auto`) entre elas.
  const style = {
    '--ndv-cols': `minmax(0,${String(sizes[0])}fr) auto minmax(0,${String(sizes[1])}fr) auto minmax(0,${String(sizes[2])}fr)`,
  } as CSSProperties;
  return { sizes, update, style };
}
