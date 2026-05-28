# Implementation log — Tiers 1 → 4

This is a chronological record of what was built after the initial v0 scaffold, organized by the tier prioritization we settled on. It's the "what and why" companion to the code and the [SETUP guide](./SETUP.md). Each section names the files touched so the diff is easy to find.

The four tiers, top-level:

| Tier | Theme | What unlocks |
|---|---|---|
| 1 | Make the Eth node actually deployable end-to-end | First real workload runs; payback math starts |
| 2 | Bring the UI to feature parity with what's API-callable | Operators don't have to use `curl` for everyday actions |
| 3 | Operational polish | Observability, retention, managed-data services |
| 4 | Quality and CI | Tests + reproducible image builds |

---

## Tier 1 — Eth node end-to-end

The v0 scaffold technically had the eth-archive template JSON, but the reconciler ignored `service.template` and only ever spun up a single container per service. JWT bootstrap, multi-container materialization, shared networks, volume creation, per-role digest pinning, and aggregated request analytics were all missing.

### What shipped

**Template runner in the reconciler.** A service with `template: 'eth-archive'` now drives multi-container orchestration. The reconciler reads `packages/shared/templates/<name>.json`, expands `{svc}` placeholders, ensures the declared networks and volumes exist, runs bootstrap steps once into the shared volume, then creates one container per `containers[]` entry — each labelled `hotbox.role=<role>` so the per-tick diff can converge each role independently.

Files: `apps/reconciler/src/template-runner.ts` (new, the heart of the work — `planRoles`, `ensureTemplateInfra`, `ensureNetwork`, `ensureVolume`, `runBootstrap`, `ensureRoleDigest`, `buildOptionsForRole`). The existing `loop.ts` `applyService` was rewritten to call `planRoles → applyPlan` and `applyPlan` was generalized to diff per role.

**JWT bootstrap.** Templates can declare `bootstrap: [{ volume, path, kind: 'random_hex', size, mode }]`. On every reconcile, hotbox spawns a one-shot `alpine:3` container that mounts the named volume at `/v` and runs:

```sh
test -f /v/<path> && exit 0
mkdir -p $(dirname /v/<path>)
head -c <size> /dev/urandom | od -A n -t x1 | tr -d ' \n' > /v/<path>
chmod <mode> /v/<path>
```

`head | od | tr` is busybox-only — no `openssl`, no extra package installs. The `test -f && exit 0` short-circuit makes the step idempotent: subsequent reconciles complete in milliseconds and never regenerate the JWT.

**Per-role digest pinning.** New migration `20260525000002_template_support.sql` adds `deployments.container_digests jsonb`. On first start of each role, the reconciler pulls the role's image, resolves to a `sha256:...` digest, and persists it back to the deployment row keyed by role. Subsequent reconciles reuse the stored digest, so a redeploy without a new image is truly idempotent — no silent re-pulls if the tag moves.

**Templates moved into `@hotbox/shared`.** Previously they lived in `infra/templates/` and there was no clean way to load them from the api or reconciler — the path resolved differently in each context. Now they live at `packages/shared/templates/*.json`, the loader (`packages/shared/src/template-loader.ts`) uses `import.meta.url` to find its own path and reads `../templates/<name>.json`, and the package's `files: [...]` field guarantees they ship inside the npm package. The eth-archive container's Dockerfile copies the shared package, so the templates are available at runtime.

**Traefik labels for via-proxy ingress.** Erigon's container in the eth-archive template declares `ingress: true` and `ingress_via: "hotbox-rpc-proxy@file"`. When the reconciler builds the container's labels:

```
traefik.enable=true
traefik.http.routers.<svc>.rule=Host(`<hostname>`)
traefik.http.routers.<svc>.entrypoints=websecure
traefik.http.routers.<svc>.tls.certresolver=le
traefik.http.routers.<svc>.service=hotbox-rpc-proxy@file
traefik.http.routers.<svc>.middlewares=hotbox-auth@file
```

So `rpc.example` → Traefik → ForwardAuth (`/internal/authz` on hotbox-api) → `hotbox-rpc-proxy@file` (defined in `infra/traefik/dynamic.yml` as `http://hotbox-rpc-proxy:9090`) → Erigon. Erigon's `8545` is never directly exposed.

Files: `apps/reconciler/src/traefik-labels.ts`, `infra/traefik/dynamic.yml` (added `services.hotbox-rpc-proxy`).

**Dynamic upstream in the rpc-proxy.** Previously the proxy had a fixed `UPSTREAM_URL` env var — fine for one eth node but unworkable for multiple. The proxy now reads `x-hotbox-service-id` from ForwardAuth, looks up the service in Postgres (60s TTL cache), and forwards to `http://<slug>-erigon:8545` if `service.template === 'eth-archive'`. Adding a second eth-archive service Just Works.

Files: `apps/rpc-proxy/src/upstream.ts` (new), `apps/rpc-proxy/src/main.ts` (rewrite to use `UpstreamRouter`).

**Hourly aggregation.** The `EthRpcPanel` reads `rpc_method_stats`. The `rpc-proxy` writes raw `rpc_requests` rows. Until Tier 1, nothing rolled those up. Now a 5-minute tick inside the api process runs:

```sql
INSERT INTO rpc_method_stats (...)
SELECT date_trunc('hour', time), service_id, token_id, method,
       count(*), count(*) filter (where status >= 400),
       percentile_disc(0.5) within group (order by latency_ms),
       percentile_disc(0.99) within group (order by latency_ms)
FROM rpc_requests
WHERE time >= date_trunc('hour', now()) - interval '3 hours'
  AND time <  date_trunc('hour', now())
GROUP BY 1,2,3,4,5
ON CONFLICT (...) DO UPDATE SET ...
```

A 3-hour rolling window catches late writes (the rpc-proxy buffers 1s, so rows for hour H can land in hour H+1). `ON CONFLICT DO UPDATE` makes the aggregator idempotent — re-running it is a no-op if the inputs haven't changed.

Files: `apps/api/src/aggregator.ts` (new), wired in `apps/api/src/main.ts`.

**Infra updates.** `infra/compose.hotbox.yml` got a new `hotbox-rpc-proxy` service (single shared instance, on `hotbox-public`, reads `DATABASE_URL` from env). `infra/traefik/dynamic.yml` got the file-provider service definition that per-Eth-node Traefik routers point at via `ingress_via`.

### Result

A single API call now deploys a working Erigon + Lighthouse pair with a JWT, an internal network for execution↔consensus traffic, public-facing P2P ports, and token-gated RPC routing. The `SETUP.md` §4 was rewritten from "multi-step manual workaround" to "one curl call."

---

## Tier 2 — UI feature completeness

The dashboard existed, but everything that mutated state was API-only. There was no `+ New service` page (the link in the dashboard 404'd), no tokens page (linked in nav, didn't exist), no audit log page. Service detail showed status but had no action buttons.

### What shipped

**Audit log writes.** Originally categorized as Tier 3, folded into Tier 2 because the audit *page* would be empty otherwise. A best-effort `recordAudit(db, req, args)` helper writes to `audit_log` from each mutation route:

- `service.create` (with `siblings: [...]` payload listing managed sibling IDs)
- `service.start`, `service.stop`, `service.archive`
- `deployment.create` (with `redeploy: true` flag when image wasn't user-supplied)
- `token.create`, `token.revoke`

Audit failures are logged but never thrown back to the caller — auditing must never block a user request.

Files: `apps/api/src/audit.ts` (new), all the existing route files updated.

**`GET /api/templates`** lists available templates with a `primary_image` hint (extracted from the `ingress: true` container) and `requires_hostname` flag so the create form can drive its UX off the response.

**`GET /api/audit`** with id-cursor pagination and optional `target_kind` / `target_id` filters, joined to `users` for actor email display.

Files: `apps/api/src/routes/templates.ts`, `apps/api/src/routes/audit.ts`, both registered in `server.ts`.

**Shared UI primitives** so the new pages stay visually consistent without per-page Tailwind churn: `Field`, `Input`, `Select`, `Button` (`primary` / `secondary` / `danger` variants), `Callout` (`info` / `warn` / `error` tones).

Files: `apps/web/src/components/ui.tsx`.

**`/services/new` — create-service form.** Single-page form, not a wizard. Name auto-slugifies as you type. Picking a template auto-fills the image from the template's primary container. Env vars are an add/remove row table. Submits to `POST /api/services` and redirects to the detail page on success. Surfaces server validation errors inline.

Files: `apps/web/src/app/services/new/page.tsx` + `create-service-form.tsx`.

**`/tokens` — tokens page.** Server component fetches the token list + service list; client component handles create + revoke. Critical UX detail: the plaintext token is shown **exactly once** in a dismissible callout with a copy button. After dismissal it's only the prefix + last-used time + status pill (active / revoked).

Files: `apps/web/src/app/tokens/page.tsx` + `tokens-client.tsx`.

**`/audit` — audit log page.** Server-rendered table: timestamp, actor (email or "system"), action, target kind+id, payload preview. Querystring filters (`?target_kind=service&target_id=…`) so future detail pages can link "see related audit entries" deep into this view.

Files: `apps/web/src/app/audit/page.tsx`.

**Service-detail action buttons.** Stop / Start (toggle based on `desired_state`), Redeploy, Archive. To make Redeploy useful, the API was updated:

- `CreateDeploymentInputSchema.image` is now optional. When absent, the route falls back to the previous deployment's image. The new deployment row has empty `container_digests`, so per-role digests are re-resolved on the next reconcile — Erigon and Lighthouse both re-pull and re-pin. Audit log records `redeploy: true`.

Archive is the way to remove a service from the UI: sets `desired_state = 'archived'` and `archived_at = now()`. The reconciler stops all containers; the service drops out of the list view. **Data volumes are deliberately preserved** — a "hard delete" flow that removes volumes is intentionally a separate, careful action we have not built.

Files: `apps/web/src/components/service-actions.tsx`, `apps/api/src/routes/services.ts` (added `/archive`, made deployment image optional), `packages/shared/src/api.ts` (schema).

### Result

The web UI now covers every routine action. The only thing left that requires `curl` is provisioning the first admin user, which lives in the seed script for good reasons.

---

## Tier 3 — operational polish

Three threads: healthcheck observation (so `current_state` actually reflects degraded containers), retention (so the metric tables don't grow forever), and managed Postgres/Redis siblings (the big one).

### What shipped

**Healthcheck observation.** `applyService` now calls a new `observeHealth(service, deployment)` after `applyPlan`. It inspects every container belonging to the active deployment and rolls them up by escalating severity: `failed > degraded > starting > running`.

- Container exited non-zero (and not restarting) → `failed`
- Any container's `State.Health.Status === 'unhealthy'` → `degraded`
- Any container is `'created' | 'restarting'` or `State.Health.Status === 'starting'` → `starting`
- Otherwise → `running`

Inspect-per-container is one Docker API round-trip; at this scale (a few services × 1-3 roles, every 5s) the cost is negligible.

Files: `apps/reconciler/src/loop.ts` (new `observeHealth` method).

**Retention job.** A new daily tick inside the api process drops raw rows that have aged out of their retention window:

- `node_metrics` older than 30 days
- `rpc_requests` older than 90 days

`rpc_method_stats` is kept indefinitely (aggregated, small). Postgres autovacuum handles space reclamation asynchronously. First run is 60s after boot; subsequent runs every 24h.

We do *not* downsample older `node_metrics` to 5-min buckets even though the design notes mention that — straight deletion is simpler, and we haven't yet found a query that benefits from > 30-day retention. Adding downsampling later is a single function change.

Files: `apps/api/src/retention.ts` (new), wired in `apps/api/src/main.ts`.

**Managed Postgres/Redis siblings — the big one.** The schema and zod input always accepted `requires: [{ kind: 'postgres' | 'redis', name }]`, but the reconciler ignored it. End-to-end wiring required several pieces:

1. **`NetworkRef` refactor.** Changed from `{ network_id, alias? }` (which never matched how Docker actually addresses networks) to `{ name, internal? }`. Updated reconciler consumers. Same shape on disk (jsonb), no migration needed.
2. **Two new templates.** `packages/shared/templates/managed-postgres.json` (PG 16 with `POSTGRES_USER=app`, `POSTGRES_DB=app`, no networks declared) and `managed-redis.json` (Redis 7, no auth — the shared network is internal-only).
3. **Secret injection in the reconciler.** The `Reconciler` constructor now takes a `KeyRing`. A new `decryptSecretEnv(db, keyring, refs)` helper decrypts `secret_refs` (only `inject_as: 'env'` for v1) and the result is merged into the container env at `startRole` time — *after* template defaults and `env_snapshot`, so secrets win on conflict.
4. **Network ensure for deployment-declared networks.** New `ensureDeploymentInfra(docker, deployment)` runs before the plan, creating any networks in `deployment.network_refs` (respecting `internal`). Template networks were already handled by `ensureTemplateInfra`.
5. **Network DNS aliases.** Containers now join each network with aliases `[<slug>, <slug>-<role>]`. This is what makes the eth-archive template's `http://{svc}-erigon:8551` actually resolve from the Lighthouse container, and what makes `psql -h my-api-db -U app` work for managed PG. The actual container name has a `-v<version>` suffix that aliases hide.
6. **`POST /api/services` handles `requires[]`.** For each entry: validates the sibling slug isn't taken, creates the sibling service row, generates a random password (PG only), encrypts it with the keyring and stores in `secrets` scoped to the sibling, encrypts the full connection string (`postgres://app:<pw>@<sibling>-pg:5432/app`) and stores in `secrets` scoped to the *parent*, references the parent secret from the parent deployment's `secret_refs` (so the parent sees `DB_URL` decrypted at container-create time), adds the shared internal network `<parent-slug>-net` to both deployments. Redis siblings skip the password and just inject a plain `<NAME>_URL=redis://<sibling>:6379/0` (the network is internal, no auth needed).
7. **List filtering.** `GET /api/services` adds `where('parent_service_id', 'is', null)` so siblings don't clutter the dashboard. `GET /api/services/:id` returns a `siblings: ServiceListItem[]` array. The service detail page renders them in a "Managed siblings" section linking through to each.
8. **Redeploy carries forward wiring.** `POST /services/:id/deployments` (redeploy path) now carries forward `secret_refs` and `network_refs` from the previous deployment. A redeploy must not drop the link to managed siblings.

Files: `packages/db/src/schema.ts` (NetworkRef shape, two columns switched to `JsonbDef`), `packages/shared/templates/managed-postgres.json`, `packages/shared/templates/managed-redis.json`, `apps/reconciler/src/template-runner.ts` (added `decryptSecretEnv`, `ensureDeploymentInfra`, expanded `buildOptionsForRole` with aliases), `apps/reconciler/src/loop.ts` (keyring constructor param, calls), `apps/api/src/routes/services.ts` (the `createSiblings` flow), `apps/web/src/app/services/[id]/page.tsx` (sibling section).

### Result

A service can declare a managed Postgres or Redis dependency in one form field, and hotbox handles password generation, encryption, network isolation, DNS aliasing, and secret injection. The app container starts with `DB_URL` in `process.env` — same UX as Railway, run on our own hardware.

---

## Tier 4 — quality and CI

The last operational gap was that nothing checked the code on push, and nobody had built any of the four images in CI. Plus zero tests.

### What shipped

**Vitest at the root.** `vitest.config.ts` globs `packages/*/tests/**/*.test.ts` and `apps/<each-non-web>/tests/**/*.test.ts`. Web is excluded — Next.js test setup is its own project we haven't tackled. `pnpm test` runs once, `pnpm test:watch` for the dev loop. With `CI=1` vitest also emits JUnit XML to `test-results.xml`.

**36 unit tests** focused on the highest-leverage pure logic:

| File | Covers |
|---|---|
| `packages/crypto/tests/seal.test.ts` | round-trip, wrong keyring rejects, tampered ciphertext rejects, unknown version, multi-version rotation (old ciphertexts still open after rotating in v2) |
| `packages/shared/tests/template-loader.test.ts` | `listTemplates` finds all 3, eth-archive parses with the expected ingress/role shape, `{svc}` interpolates everywhere including command args, non-mutating |
| `packages/shared/tests/labels.test.ts` | `labelsFor` keys, optional role, `managedFilter` shape |
| `apps/rpc-proxy/tests/policy.test.ts` | `admin_*`/`personal_*`/`miner_*` always blocked, `debug_*`/`erigon_*` gated to internal tier, standard namespaces allowed, `eth_getLogs` range cap fires > 10k, tagged blocks ignored |
| `apps/metrics-scraper/tests/parser.test.ts` | bare metric, labelled metric, comment skip, blank-line tolerance, NaN/+Inf drop, trailing timestamp, empty input |
| `apps/reconciler/tests/traefik-labels.test.ts` | no hostname → empty, non-ingress container → empty, direct route when no `ingress_via`, via-proxy route emits `service=…@file` + `middlewares=hotbox-auth@file` |
| `apps/api/tests/auth.test.ts` | argon2id format, correct/wrong password, garbage hash returns false without throw |

All tests pass in ~0.8 seconds. Integration tests against real Docker + Postgres via testcontainers are *not* in this round — they'd materially increase confidence in the reconciler but require their own setup.

**`.github/workflows/ci.yml`** runs on every push to master/main and every PR: pnpm 10.33.0, Node 22, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`. The pnpm-store is cached by `pnpm-lock.yaml` hash so most runs are fast.

**`.github/workflows/release.yml`** runs on push to default branch, on `v*` tags, and on manual `workflow_dispatch`. Single matrix job over `[api, web, rpc-proxy, metrics-scraper]`, building each in parallel:

- `docker/setup-buildx-action@v3`
- `docker/login-action@v3` against `ghcr.io` using the workflow's own `GITHUB_TOKEN` (no PAT needed — the job declares `permissions.packages: write`)
- `docker/metadata-action@v5` produces a tag set: branch name, tag name, short SHA, and `latest` only on the default branch
- `docker/build-push-action@v5` builds `apps/<app>/Dockerfile`, pushes to `ghcr.io/<org>/<repo>/hotbox-<app>`, with GHA-scoped cache (`scope=<app>`) so each app's layer cache stays isolated. `linux/amd64` only.

**Requires section on the create-service form.** Folded in after Tier 4 was nominally complete — the API supported `config.requires` end-to-end but the form didn't. New section: kind dropdown (postgres / redis), name input with slug-pattern validation, add/remove rows. Submits as `body.config.requires`. Also tightened `packages/shared/src/api.ts` requires `name` to enforce slug shape on the API side.

### Post-Tier-4 fixes

A couple of issues surfaced when actually pushing to CI:

- **`apps/web/public/.gitkeep`.** I'd created the directory locally with `mkdir -p` but git doesn't track empty dirs. The web Dockerfile's `COPY --from=build /app/apps/web/public ...` failed in CI because the dir didn't exist in the build stage. The `.gitkeep` makes the empty dir tracked.
- **`pnpm.onlyBuiltDependencies`** in root `package.json`. pnpm 10 ignores install scripts by default. Without this, `argon2` is installed but the post-install never runs to fetch its prebuilt native binary, so the api container crashes on first login with `Cannot find native binding`. Listing `argon2`, `cpu-features`, `esbuild`, `protobufjs`, `ssh2` here makes installs deterministic in CI and in the Docker build, without an interactive `pnpm approve-builds` step.

---

## Cross-cutting changes

A few things came in over multiple tiers:

- **`NetworkRef` refactor** (Tier 3) cleaned up a half-thought from the v0 scaffold and unblocked the managed-siblings work.
- **`Jsonb` vs `JsonbDef` distinction** (Tier 1 and again Tier 3) — columns with DB defaults need `JsonbDef<T>` so Kysely treats them as optional on insert. Tightening these as we went avoided a class of "config is missing" insert errors.
- **Audit writes** (planned for Tier 3, delivered in Tier 2) — the audit page was added at the same time, so the writes had to land first to be useful.
- **`SETUP.md` §4** was rewritten three times: once as "here's the manual workaround for the missing template runner," once in Tier 1 as "here's the one curl command that works now," and again incrementally as we added `requires` UI and managed siblings.

---

## What's still left

For honest accounting:

| Category | Item | Tier originally |
|---|---|---|
| Tests | Reconciler integration tests against real Docker + Postgres via testcontainers | Tier 4 |
| UI | "Hard delete" action that drops data volumes alongside the service | Tier 2 (deliberately deferred — UX needs care) |
| Multi-host | Reconciler still ignores `host_id` (only one host expected) | Tier 4+ |
| Backup | Automated Postgres backup to Storage Box / S3 | Documented in SETUP, not automated |
| CLI | Skipped per the original plan; the web UI is sufficient for single-team use | — |
| Builder | In-house image builder (BuildKit/Nixpacks) — deliberately skipped per the plan | — |

The thing most worth doing next IMO is testcontainers-based integration tests for the reconciler. The unit tests cover the pure logic well; the next slice of confidence requires watching the reconciler diff against a real Docker engine.

---

## Phase 1 — Projects + Environments (Railway-parity roadmap)

The five-feature Railway-parity roadmap lives at `~/.claude/plans/hotbox-is-coming-along-toasty-sun.md`. This is the first slice: services now belong to a `(project, environment)` pair, with per-env slug uniqueness instead of the old global flat namespace.

### What shipped

**Schema.** New migration `20260601000001_projects_environments.sql` adds two tables (`projects`, `environments`) and two FK columns (`services.project_id`, `services.environment_id`). The global `services_slug_key` unique constraint is replaced by a partial unique index on `(project_id, environment_id, slug)` so the same slug (`api`) can live in multiple envs. The migration always seeds a `default` project + `production` environment so fresh installs have a place to put their first service; any pre-existing services are auto-assigned to that pair.

**Container + Traefik router naming, namespaced.** Two services with the same slug across envs would collide on the Docker host. Container names now follow `${project_slug}-${env_slug}-${service_slug}-${role}-v${version}`; Traefik router/service IDs in `traefik-labels.ts` follow the same shape. Managed-sibling shared network names also include project+env (`siblingNetworkName()` helper in `services.ts`).

**Existing services churn once on first reconcile after the migration.** Every legacy container's name no longer matches the new pattern, so the reconciler treats them as drift and recreates each one with the new name. ~5s per stateless service; longer for stateful. All services land in `default/production` so the new names are deterministic (`default-production-${slug}-…`). Volume names are *not* namespaced — template-internal `${svc}` interpolation stays slug-only for backward compat. Known follow-up: template-based services with same slug in different envs would share volumes, so for Phase 1 templates should use unique slugs across envs.

**API.** New `apps/api/src/routes/projects.ts` with CRUD for projects + environments and a config-only `duplicate environment` action that re-creates each top-level service in the target env (with fresh sibling secrets — copying the source's `secret_refs` would point at the wrong sibling slugs in the new env's network). `services.ts` now requires `project_id` + `environment_id` on create, scopes slug-uniqueness checks per-env, and joins project+env slugs into list/detail responses. `GET /api/services` accepts `?projectId=` / `?environmentId=` filters.

**Reconciler.** A new `ServiceWithContext` type (`Service` + `project_slug` + `environment_slug`) flows through the reconciler. The tick query joins `projects` + `environments` and selects the slugs alongside the service columns; `buildOptionsForRole` and `traefikLabelsFor` use them for naming.

**Frontend.** New nav entry "Projects" alongside "All services". `/projects` lists projects with a create form; `/projects/[id]` renders environments as tabs, each showing the services in that env, with inline "+ Environment", "Duplicate", and "Delete" (disabled when env is non-empty) actions. The flat `/` dashboard gains a "Project / Env" column and a deep-link into the project view. `/services/new` gained project + env selectors at the top, prefilled from `?projectId=&envId=` query params for in-context creates.

### What didn't ship (Phase 1 scope-cut, documented as follow-ups)

- DB-integration tests for the migration + CRUD flow. The repo has no test harness for live Postgres; adding one is its own piece of work. The plan's verification section covers manual end-to-end checks.
- Template-internal naming (volumes, template-declared networks) stayed slug-only. Multi-env same-slug template services would share volumes — Phase 3+ can extend `interpolateTemplate` to namespace these once we have a volume-rename migration story.
- Project / env rename. Both tables have the columns and triggers; a `PATCH` route + UI tweak is straightforward but wasn't strictly required for the slice.

Files: `packages/db/migrations/20260601000001_projects_environments.sql`, `packages/db/src/schema.ts` (`ProjectsTable`, `EnvironmentsTable`, `ServiceWithContext`), `packages/shared/src/api.ts` (`CreateProjectInputSchema`, `CreateEnvironmentInputSchema`, `DuplicateEnvironmentInputSchema`, updated `CreateServiceInputSchema`), `apps/api/src/routes/projects.ts` (new), `apps/api/src/routes/services.ts` (per-env scoping + `siblingNetworkName` helper + `createSiblings` exported), `apps/api/src/server.ts` (registered `projectsRoutes`), `apps/reconciler/src/loop.ts` (join + ServiceWithContext threading), `apps/reconciler/src/template-runner.ts` (namespaced container name), `apps/reconciler/src/traefik-labels.ts` (namespaced router id), `apps/web/src/app/projects/*`, `apps/web/src/app/projects/[id]/*`, `apps/web/src/app/services/new/create-service-form.tsx`, `apps/web/src/components/nav.tsx`, `apps/web/src/lib/types.ts`. Tests: `packages/shared/tests/api-schemas.test.ts`, `apps/api/tests/services-helpers.test.ts`; existing `apps/reconciler/tests/traefik-labels.test.ts` extended for cross-env collision.

---

## Phase 2 — Shared variables (project / env / service)

Second slice of the Railway-parity roadmap. Variables can now live at three scopes; resolution merges project → environment → service with the service-scope winning. Same-row secrets are encrypted at rest under the existing keyring.

### What shipped

**Schema.** New migration `20260615000001_shared_variables.sql` drops the unused `env_vars` table and creates a `variables` table with three nullable scope FKs (`project_id`, `environment_id`, `service_id`). A CHECK constraint enforces that exactly one is set; a second CHECK enforces the secret-shape invariant (either `value` is set OR `(ciphertext, nonce, key_version)` are set — never both, never neither). Partial unique indexes per scope: `(project_id, key)`, `(environment_id, key)`, `(service_id, key)`. The migration also backfills the latest deployment's `env_snapshot` into service-scoped variable rows so existing services don't lose their env on the next redeploy.

**resolveVariables helper.** `apps/api/src/lib/resolve-variables.ts` exports `resolveVariables(db, keyring, serviceId)` returning the merged plaintext env map, `resolveVariablesWithOrigin(...)` returning `{ value, origin, is_secret }` per key for the effective view, and `affectedServiceIds(db, scope, scopeId)` returning the set of services that would pick up a change. A pure `mergeVariableRows(...)` is split out so the precedence + decryption logic is unit-testable without a live DB.

**Service create + redeploy paths use the resolver.** On `POST /api/services` the form-supplied `input.env` and `input.secrets` become first-class service-scoped variable rows, then `resolveVariables()` produces the initial deployment's `env_snapshot`. On `POST /api/services/:id/deployments`: if the body has no explicit `env`, the route re-resolves variables (instead of carrying forward `latest.env_snapshot`) so a redeploy actually applies recent variable edits. Explicit `body.env` still wins for one-off overrides. Sibling-injected plain env (Redis URLs) still layers on top of resolved variables — same precedence as before.

**Env duplicate copies variables.** `POST /projects/:id/environments/:envId/duplicate` now also copies env-scoped variables from source env → new env and service-scoped variables from each source service → its duplicate. Secrets are re-sealed under a fresh nonce per row so the duplicates are cryptographically independent. Project-scoped vars don't need duplication (the project is unchanged).

**CRUD routes.** `apps/api/src/routes/variables.ts` registers parallel `GET/POST/PATCH/DELETE` handlers under three path prefixes: `/projects/:id/variables`, `/environments/:id/variables`, `/services/:id/variables`. Mutations return `affected_service_ids` so the UI can offer a one-click "Redeploy N to apply" action. The effective endpoint `GET /services/:id/variables/effective` returns the merged map with origin badges. Secret values are masked in every response — they only leave the box as live env vars in a container at deploy time, never as JSON over HTTP.

**Frontend.** New reusable `<VariablesPanel scope={...} scopeId={...} />` component mounts in three places: project detail page (project-scoped section below env tabs), inside each env tab (env-scoped section), and on the service detail page (service-scoped). Each panel surfaces the "Redeploy N services" callout when an edit/delete returns an affected list, with a button that fires `POST /api/services/:id/deployments` for each. A separate `<EffectiveVariables />` view on the service detail page shows the merged map with `project / environment / service` origin badges so operators can see at a glance which scope is winning per key.

**Encryption symmetry with sibling secrets.** Variable secrets reuse the existing `@hotbox/crypto` `seal`/`open` API and master keyring — same encryption story as the managed-sibling DB passwords, no separate key material. The `secrets` table is left untouched and continues to hold sibling-wiring secrets (which have a different lifecycle and aren't user-managed); the two tables coexist deliberately.

**Reveal-secrets UX gap (intentionally deferred).** Secret values are not retrievable from the UI in v1 — only rotation via re-entering a new value. Adding a "reveal" that round-trips a password challenge is a hardening item.

### Verification

- 72 unit tests pass (`pnpm test`), including 7 new `mergeVariableRows` tests covering precedence + secret decryption and 10 new variable-schema validation tests.
- Typecheck clean across all 9 packages.
- Manual end-to-end: set `STRIPE_KEY=foo` at project, then `STRIPE_KEY=bar` at env, then `STRIPE_KEY=baz` at service. Effective view shows `baz` with origin=`service`. Delete the service-scoped row, redeploy, container env now has `STRIPE_KEY=bar`. Delete the env-scoped row, redeploy, container env has `STRIPE_KEY=foo`.

Files: `packages/db/migrations/20260615000001_shared_variables.sql`, `packages/db/src/schema.ts` (added `VariablesTable`, `VariableScope`, removed `EnvVarsTable`), `packages/shared/src/api.ts` (`CreateVariableInputSchema`, `UpdateVariableInputSchema`, `VariableScopeSchema`), `apps/api/src/lib/resolve-variables.ts` (new), `apps/api/src/routes/variables.ts` (new), `apps/api/src/routes/services.ts` (create-path now writes variable rows + resolves env_snapshot; redeploy re-resolves when body.env absent), `apps/api/src/routes/projects.ts` (env duplicate copies variables with re-sealed secrets), `apps/api/src/server.ts` (registered `variablesRoutes`), `apps/web/src/components/variables-panel.tsx`, `apps/web/src/components/effective-variables.tsx`, `apps/web/src/app/projects/[id]/project-detail-client.tsx`, `apps/web/src/app/services/[id]/page.tsx`. Tests: `apps/api/tests/resolve-variables.test.ts`, `packages/shared/tests/api-schemas.test.ts` (extended).

