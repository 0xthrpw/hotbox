import type { CurrentState, DesiredState, ServiceKind } from '@hotbox/shared';

export type { CurrentState, DesiredState, ServiceKind };

export interface Project {
  id: string;
  slug: string;
  name: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface Environment {
  id: string;
  project_id: string;
  slug: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectWithEnvironments extends Project {
  environments: Environment[];
}

export interface EnvironmentWithCount extends Environment {
  service_count: number;
}

export interface ServiceListItem {
  id: string;
  slug: string;
  name: string;
  kind: ServiceKind;
  desired_state: DesiredState;
  current_state: CurrentState;
  hostname: string | null;
  public_port: number | null;
  auto_subdomain: boolean;
  template: string | null;
  project_id: string;
  environment_id: string;
  project_slug: string;
  project_name: string;
  environment_slug: string;
  environment_name: string;
}

export interface ServiceDetail extends ServiceListItem {
  config: Record<string, unknown>;
  created_at: string;
}
