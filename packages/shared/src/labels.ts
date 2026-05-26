export const LABEL_MANAGED = 'hotbox.managed';
export const LABEL_SERVICE_ID = 'hotbox.service_id';
export const LABEL_SERVICE_SLUG = 'hotbox.service_slug';
export const LABEL_DEPLOYMENT_ID = 'hotbox.deployment_id';
export const LABEL_VERSION = 'hotbox.version';
export const LABEL_ROLE = 'hotbox.role'; // 'primary' | 'managed_pg' | 'managed_redis'

export function managedFilter(): Record<string, string[]> {
  return { label: [`${LABEL_MANAGED}=true`] };
}

export function labelsFor(opts: {
  serviceId: string;
  serviceSlug: string;
  deploymentId: string;
  version: number;
  role?: string;
}): Record<string, string> {
  return {
    [LABEL_MANAGED]: 'true',
    [LABEL_SERVICE_ID]: opts.serviceId,
    [LABEL_SERVICE_SLUG]: opts.serviceSlug,
    [LABEL_DEPLOYMENT_ID]: opts.deploymentId,
    [LABEL_VERSION]: String(opts.version),
    ...(opts.role ? { [LABEL_ROLE]: opts.role } : {}),
  };
}
