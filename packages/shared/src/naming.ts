/**
 * Host-wide unique name for a service: `<project>-<env>-<service>`. Matches
 * the prefix used for container names, image tags, and the qualified DNS
 * aliases, so operators see one consistent identity everywhere.
 *
 * Note the parts are dash-joined and slugs may contain dashes, so the string
 * is not unambiguously parseable back into its parts — fine for display and
 * DNS, but anything that must not collide across *different* (project, env,
 * service) triples needs an extra guard (see resolveVolumeRefs' ownership
 * check in apps/api).
 */
export function qualifiedServiceName(opts: {
  projectSlug: string;
  environmentSlug: string;
  serviceSlug: string;
}): string {
  return `${opts.projectSlug}-${opts.environmentSlug}-${opts.serviceSlug}`;
}

/**
 * Docker volume name for a service-declared volume. The volume name is joined
 * with `_` — a character slugs can never contain — so a (service, volume)
 * pair can't collide with a differently-split neighbour (`web` + `db-data`
 * vs `web-db` + `data`).
 */
export function dockerVolumeName(opts: {
  projectSlug: string;
  environmentSlug: string;
  serviceSlug: string;
  name: string;
}): string {
  return `${qualifiedServiceName(opts)}_${opts.name}`;
}
