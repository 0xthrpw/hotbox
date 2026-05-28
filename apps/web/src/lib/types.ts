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

export type ImageSource = 'image' | 'github';

export type BuildStatus =
  | 'queued'
  | 'cloning'
  | 'building'
  | 'deploying'
  | 'success'
  | 'failed';

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
  image_source: ImageSource;
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

export interface GithubSource {
  id: string;
  repo_full_name: string;
  branch: string;
  dockerfile_path: string;
  build_context: string;
  last_built_sha: string | null;
}

export interface Build {
  id: string;
  service_id: string;
  commit_sha: string | null;
  commit_message: string | null;
  commit_author: string | null;
  triggered_by: string;
  status: BuildStatus;
  image_tag: string | null;
  image_digest: string | null;
  error_message: string | null;
  log?: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}
