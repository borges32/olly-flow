import { Box } from 'lucide-react';
import { NODE_ICONS } from './node-icons';

export function NodeIcon({ name, className }: { name: string | undefined; className?: string }) {
  const Icon = (name && NODE_ICONS[name]) || Box;
  return <Icon className={className} aria-hidden />;
}
