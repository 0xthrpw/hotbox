import type { ComponentType } from 'react';
import { EthSyncPanel } from './eth/eth-sync-panel';
import { EthRpcPanel } from './eth/eth-rpc-panel';

export interface PanelProps {
  serviceId: string;
  serviceSlug: string;
}

const REGISTRY: Record<string, Array<ComponentType<PanelProps>>> = {
  'eth-archive': [EthSyncPanel, EthRpcPanel],
};

export function resolvePanels(template: string | null): Array<ComponentType<PanelProps>> {
  if (!template) return [];
  return REGISTRY[template] ?? [];
}
