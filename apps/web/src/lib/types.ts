import type { CurrentState, DesiredState, ServiceKind } from '@hotbox/shared';

export type { CurrentState, DesiredState, ServiceKind };

export interface ServiceListItem {
  id: string;
  slug: string;
  name: string;
  kind: ServiceKind;
  desired_state: DesiredState;
  current_state: CurrentState;
  hostname: string | null;
  public_port: number | null;
  template: string | null;
}

export interface ServiceDetail extends ServiceListItem {
  config: Record<string, unknown>;
  created_at: string;
}
