import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Jsonb<T = unknown> = ColumnType<T, T | string, T | string>;
type JsonbDef<T = unknown> = ColumnType<T, T | string | undefined, T | string>;

export type ServiceKind = 'app' | 'managed_pg' | 'managed_redis';
export type DesiredState = 'running' | 'stopped' | 'archived';
export type CurrentState =
  | 'pending'
  | 'creating'
  | 'starting'
  | 'running'
  | 'degraded'
  | 'stopped'
  | 'failed';
export type DeploymentStatus =
  | 'pending'
  | 'active'
  | 'superseded'
  | 'failed'
  | 'rolled_back';
export type TokenKind = 'api' | 'rpc';
export type TokenTier = 'public' | 'internal';
export type MetricSource = 'erigon' | 'lighthouse' | 'host';

export interface HostsTable {
  id: Generated<string>;
  name: string;
  address: string;
  docker_socket: Generated<string>;
  labels: Jsonb<Record<string, string>>;
  status: Generated<string>;
  last_seen_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  role: Generated<string>;
  totp_secret: string | null;
  disabled_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface SessionsTable {
  id: Generated<string>;
  user_id: string;
  token_hash: Buffer;
  expires_at: Timestamp;
  created_ip: string | null;
  user_agent: string | null;
  created_at: Generated<Timestamp>;
}

export interface ServiceConfig {
  restart_policy?: 'no' | 'on-failure' | 'always' | 'unless-stopped';
  replace_strategy?: 'start_then_stop' | 'stop_then_start';
  resources?: { cpu_quota?: number; mem_limit_bytes?: number };
  healthcheck?: { type: 'http' | 'cmd'; path?: string; cmd?: string[]; interval_s?: number; retries?: number };
  stop_grace_period_sec?: number;
  requires?: Array<{ kind: 'postgres' | 'redis'; name: string }>;
}

export interface ServicesTable {
  id: Generated<string>;
  slug: string;
  name: string;
  host_id: string;
  kind: ServiceKind;
  desired_state: Generated<DesiredState>;
  current_state: Generated<CurrentState>;
  hostname: string | null;
  public_port: number | null;
  config: Jsonb<ServiceConfig>;
  template: string | null;
  owner_id: string | null;
  parent_service_id: string | null;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
  archived_at: Timestamp | null;
}

export interface VolumeRef {
  volume_id: string;
  mountpoint: string;
  ro?: boolean;
}

export interface NetworkRef {
  network_id: string;
  alias?: string;
}

export interface SecretRef {
  secret_id: string;
  inject_as: 'env' | 'file';
  key?: string;       // env var name
  mount?: string;     // /run/secrets/<x>
}

export interface DeploymentsTable {
  id: Generated<string>;
  service_id: string;
  version: number;
  image: string;
  image_digest: string | null;
  container_digests: JsonbDef<Record<string, string>>;
  env_snapshot: JsonbDef<Record<string, string>>;
  secret_refs: JsonbDef<SecretRef[]>;
  volume_refs: JsonbDef<VolumeRef[]>;
  network_refs: JsonbDef<NetworkRef[]>;
  command: Jsonb<string[]> | null;
  entrypoint: Jsonb<string[]> | null;
  healthcheck: Jsonb<ServiceConfig['healthcheck']> | null;
  created_by: string | null;
  created_at: Generated<Timestamp>;
  status: Generated<DeploymentStatus>;
}

export interface ContainersTable {
  id: Generated<string>;
  deployment_id: string;
  host_id: string;
  docker_id: string;
  name: string | null;
  state: string;
  exit_code: number | null;
  started_at: Timestamp | null;
  stopped_at: Timestamp | null;
  last_observed_at: Generated<Timestamp>;
  created_at: Generated<Timestamp>;
}

export interface VolumesTable {
  id: Generated<string>;
  service_id: string | null;
  host_id: string;
  name: string;
  driver: Generated<string>;
  mountpoint: string | null;
  size_bytes_estimate: number | null;
  created_at: Generated<Timestamp>;
}

export interface NetworksTable {
  id: Generated<string>;
  host_id: string;
  name: string;
  driver: Generated<string>;
  internal: Generated<boolean>;
  created_at: Generated<Timestamp>;
}

export interface EnvVarsTable {
  id: Generated<string>;
  service_id: string;
  key: string;
  value: string;
  is_secret: Generated<boolean>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface SecretsTable {
  id: Generated<string>;
  service_id: string | null;
  key: string;
  ciphertext: Buffer;
  nonce: Buffer;
  key_version: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface TokensTable {
  id: Generated<string>;
  kind: TokenKind;
  name: string;
  hash: Buffer;
  prefix: string;
  service_id: string | null;
  user_id: string | null;
  scopes: Generated<string[]>;
  tier: Generated<TokenTier>;
  rate_limit_per_min: number | null;
  expires_at: Timestamp | null;
  revoked_at: Timestamp | null;
  last_used_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface AuditLogTable {
  id: Generated<number>;
  actor_user_id: string | null;
  actor_token_id: string | null;
  action: string;
  target_kind: string;
  target_id: string | null;
  payload: Jsonb<Record<string, unknown>>;
  ip: string | null;
  at: Generated<Timestamp>;
}

export interface NodeMetricsTable {
  time: Generated<Timestamp>;
  service_id: string;
  source: MetricSource;
  metric: string;
  labels: Jsonb<Record<string, string>>;
  value: number;
}

export interface RpcRequestsTable {
  time: Generated<Timestamp>;
  token_id: string | null;
  service_id: string;
  method: string;
  params_bytes: Generated<number>;
  response_bytes: Generated<number>;
  latency_ms: number;
  status: number;
  error_code: string | null;
}

export interface RpcMethodStatsTable {
  id: Generated<string>;
  hour: Timestamp;
  service_id: string;
  token_id: string | null;
  method: string;
  count: number;
  error_count: number;
  p50_ms: number;
  p99_ms: number;
}

export interface Database {
  hosts: HostsTable;
  users: UsersTable;
  sessions: SessionsTable;
  services: ServicesTable;
  deployments: DeploymentsTable;
  containers: ContainersTable;
  volumes: VolumesTable;
  networks: NetworksTable;
  env_vars: EnvVarsTable;
  secrets: SecretsTable;
  tokens: TokensTable;
  audit_log: AuditLogTable;
  node_metrics: NodeMetricsTable;
  rpc_requests: RpcRequestsTable;
  rpc_method_stats: RpcMethodStatsTable;
}

export type Host = Selectable<HostsTable>;
export type User = Selectable<UsersTable>;
export type Service = Selectable<ServicesTable>;
export type NewService = Insertable<ServicesTable>;
export type ServiceUpdate = Updateable<ServicesTable>;
export type Deployment = Selectable<DeploymentsTable>;
export type NewDeployment = Insertable<DeploymentsTable>;
export type Container = Selectable<ContainersTable>;
export type Token = Selectable<TokensTable>;
export type Secret = Selectable<SecretsTable>;
