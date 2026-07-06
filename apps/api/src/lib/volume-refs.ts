import { dockerVolumeName } from '@hotbox/shared';
import type { HotboxDb, VolumeRef } from '@hotbox/db';

/**
 * Materialise a service's `config.volumes` declarations into `volumes` rows
 * and return the volume_refs to snapshot onto a new deployment. Idempotent —
 * called on every deployment creation (create, redeploy, github build), so
 * a config edit followed by a redeploy picks up new volumes, mirroring how
 * variables re-resolve into env_snapshot.
 */
export async function resolveVolumeRefs(db: HotboxDb, serviceId: string): Promise<VolumeRef[]> {
  const svc = await db
    .selectFrom('services')
    .innerJoin('projects', 'projects.id', 'services.project_id')
    .innerJoin('environments', 'environments.id', 'services.environment_id')
    .select([
      'services.host_id',
      'services.slug',
      'services.config',
      'projects.slug as project_slug',
      'environments.slug as environment_slug',
    ])
    .where('services.id', '=', serviceId)
    .executeTakeFirst();
  if (!svc) throw new Error(`service ${serviceId} not found`);

  const declared = Array.isArray(svc.config?.volumes) ? svc.config.volumes : [];
  const refs: VolumeRef[] = [];
  for (const v of declared) {
    const name = dockerVolumeName({
      projectSlug: svc.project_slug,
      environmentSlug: svc.environment_slug,
      serviceSlug: svc.slug,
      name: v.name,
    });
    // Upsert-returning in one statement: the no-op DO UPDATE (unlike DO
    // NOTHING) makes RETURNING yield the row on conflict too.
    const row = await db
      .insertInto('volumes')
      .values({ service_id: serviceId, host_id: svc.host_id, name })
      .onConflict((oc) =>
        oc.columns(['host_id', 'name']).doUpdateSet({ name: (eb) => eb.ref('excluded.name') }),
      )
      .returning(['id', 'service_id'])
      .executeTakeFirstOrThrow();
    // The qualified name is dash-joined from slugs that may themselves
    // contain dashes, so two different services *can* derive the same docker
    // volume name (or a row can survive an out-of-band hard delete). Sharing
    // a datadir across services silently is the one outcome we must never
    // allow — fail the deployment instead.
    if (row.service_id !== serviceId) {
      throw new Error(
        `volume name collision: docker volume "${name}" already belongs to another service — rename the volume or the service`,
      );
    }
    refs.push({ volume_id: row.id, name, mountpoint: v.mountpoint, ro: v.ro ?? false });
  }
  return refs;
}
