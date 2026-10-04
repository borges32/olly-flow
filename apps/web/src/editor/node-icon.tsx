import { Box, PenLine, Play, type LucideIcon } from 'lucide-react';

// O catálogo de nós usa nomes de ícones lucide; nós novos acrescentam o seu aqui.
const ICONS: Record<string, LucideIcon> = { play: Play, 'pen-line': PenLine };

export function NodeIcon({ name, className }: { name: string | undefined; className?: string }) {
  const Icon = (name && ICONS[name]) || Box;
  return <Icon className={className} aria-hidden />;
}
