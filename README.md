# hotbox

Internal Railway-style PaaS for a single Hetzner box, designed around running an Ethereum archive node and pointing our services at its RPC.

Paying Railway for hosting and Alchemy for RPC. Both got expensive. This is the smaller replacement we own.

## What it is

A control plane that talks directly to the Docker Engine API and keeps a Postgres-declared "desired state" reconciled against actual running containers. A small web UI on top. Plus an opinionated template for running Erigon (archive) + Lighthouse behind token-gated RPC.

```
              ┌────────────┐
public web ──▶│  Traefik   │── HTTPS ──┬── hotbox-web   (Next.js dashboard)
              │   (ACME)   │           ├── hotbox-api   (Fastify + reconciler + aggregator + retention)
              └─────┬──────┘           └── rpc.example  ─▶ rpc-proxy ─▶ erigon (in eth-archive service)
                    │                                          │
                    │ ForwardAuth                              │
                    └─▶ hotbox-api /internal/authz             │
                                                               │
              ┌─────────────────────────────────────────┐      │
              │           Docker Engine                 │      │
              │  ┌──────────────────────────────────┐   │      │
              │  │ eth-archive-eth (internal)       │   │      │
              │  │   erigon ──JWT── lighthouse      │   │      │
              │  └──────────────────────────────────┘   │      │
              │  ┌──────────────────────────────────┐   │      │
              │  │ hotbox-public                    │◀──┼──────┘
              │  │   erigon, hotbox-rpc-proxy,      │   │
              │  │   hotbox-api, traefik, …         │   │
              │  └──────────────────────────────────┘   │
              └─────────────────────────────────────────┘
```

The reconciler owns container identity via Docker labels (`hotbox.managed=true`, `hotbox.service_id`, `hotbox.deployment_id`, `hotbox.version`, `hotbox.role`). Container *names* are advisory; labels are authoritative. A `/api/drift` endpoint surfaces any container Docker knows about that Postgres doesn't (or vice versa).

## What you can do with it today

- **Deploy a service** from the web UI by image reference, or via `POST /api/services`. Stateless apps, apps with a managed Postgres/Redis sibling, and template-driven multi-container services (currently: Ethereum archive node).
- **Watch logs** stream from the container into the browser via SSE.
- **Issue an RPC token** scoped to a service, with optional per-token rate limit. Method allowlist enforced at the rpc-proxy (`admin_*`/`personal_*`/`miner_*` blocked; `debug_*`/`erigon_*` require `internal` tier).
- **Cap `eth_getLogs` ranges** at 10k blocks. Cap is on by default to avoid accidentally tying up Erigon for minutes.
- **See per-method RPC analytics** — top methods, p50/p99 latency, error rate, request counts, per-token attribution. Hourly aggregates retained indefinitely; raw rows for 90 days.
- **Sync-stage panel** for the Eth node — shows the 12 Erigon stages with progress bars, EL/CL peer counts, head block, beacon slot. Scraped from each container's Prometheus endpoint, stored in Postgres.
- **Redeploy** without supplying an image (reuses the previous one but resets pinned digests so a moved tag re-pulls). **Archive** to stop containers without losing data volumes.
- **Audit log** of every mutation, joinable to the user who did it.

## Architecture

Five processes in TypeScript, plus Traefik and Postgres.

| Process | Responsibility | Reads from | Writes to |
|---|---|---|---|
| **hotbox-api** (Fastify) | HTTP API + SSE logs + `/internal/authz` ForwardAuth target. Embeds the reconciler, the hourly aggregator, and the retention job. | Postgres, Docker socket | Postgres, Docker |
| **hotbox-web** (Next.js 15) | The dashboard. Server-rendered with `cookie` forwarding to the api. | hotbox-api | — |
| **hotbox-rpc-proxy** | Parses JSON-RPC bodies in front of Erigon. Validates token tier vs method, caps params, logs each call. | Postgres (service slug lookup, 60s cache), Erigon | Postgres (rpc_requests) |
| **hotbox-metrics-scraper** | Polls Erigon (`:6061`) and Lighthouse (`:5054`) Prometheus endpoints every 15s for every `eth-archive` service. | Erigon/Lighthouse metrics | Postgres (node_metrics) |
| **traefik** | Ingress + automatic TLS via ACME HTTP-01. Docker provider auto-discovers labels emitted by the reconciler. | Docker (labels), file (dynamic.yml) | — |

The reconciler runs inside hotbox-api today; it could be split into its own process per host once we go multi-host.

## Tech stack

- TypeScript on Node 22 LTS
- pnpm 10 monorepo (apps + packages workspaces)
- Fastify 5, Next.js 15 (App Router) + React 19, Tailwind 4, Kysely + raw SQL migrations
- Postgres 16, Traefik 3.2
- `dockerode` (pinned to Docker API v1.45) for container orchestration
- `@noble/ciphers` (XChaCha20-Poly1305) for at-rest secret encryption, pure JS — no native module headaches
- `argon2` for password hashing
- Vitest for tests

## Quick start

Local development — full walkthrough in [`docs/SETUP.md`](./docs/SETUP.md). The short version:

```bash
pnpm install                                 # also fetches argon2's prebuilt binary
openssl rand -hex 32 > master.key && chmod 0400 master.key
pnpm dev:pg:up                               # local Postgres on :5433
cp .env.example .env                         # the defaults work locally
pnpm db:migrate
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=changeme123 pnpm seed
# paste the HOST_ID it prints into .env

# two terminals:
pnpm dev:api      # Fastify on :3000
pnpm dev:web      # Next.js on :3001
```

Open <http://localhost:3001/login>, sign in, deploy `nginx:alpine` as a smoke test.

For Hetzner deployment (provisioning the box, master key handling, image builds, ACME, first-run migration, the eth-archive cutover): [`docs/SETUP.md`](./docs/SETUP.md).

## Repo layout

```
hotbox/
  apps/
    api/                 Fastify + reconciler + aggregator + retention
    reconciler/          imported by api; template runner, drift detection, traefik labels
    rpc-proxy/           JSON-RPC parser + token/method/range enforcement + request log
    metrics-scraper/     15s Prometheus poll → node_metrics
    web/                 Next.js 15 dashboard
  packages/
    db/                  Kysely schema + raw SQL migrations + Node migration runner
    docker/              dockerode wrapper, container-spec builder, event tail with reconnect
    shared/              zod schemas, label constants, service templates (eth-archive, managed-postgres, managed-redis)
    crypto/              XChaCha20-Poly1305 seal/open with a KeyRing for lazy rotation
  infra/
    compose.hotbox.yml   the prod stack (Traefik + Postgres + the 4 hotbox processes)
    compose.dev.yml      local Postgres only
    traefik/             traefik.yml + dynamic.yml (ForwardAuth middleware, file-provider services)
  docs/
    SETUP.md             local dev → Hetzner deploy → first eth-archive walk-through
    CHANGES.md           implementation log organized by tier
  .github/workflows/
    ci.yml               typecheck + tests on every push and PR
    release.yml          matrix build + push to GHCR for each app
```

## Development

```bash
pnpm typecheck            # tsc --noEmit across all 9 workspaces
pnpm test                 # vitest run — 36 tests, ~1 second
pnpm test:watch           # vitest dev loop
pnpm -F @hotbox/api dev   # any individual workspace
```

CI runs `pnpm typecheck` and `pnpm test` on every push and PR. Tests today are unit-only — pure logic over the highest-leverage paths (crypto round-trips, RPC policy, Prom parser, Traefik label generation, template interpolation, password hashing). Reconciler integration tests against real Docker would be the next meaningful add.

## Operational notes

The full operational guidance is in `docs/SETUP.md` §5; the short version:

- **Disk full corrupts Erigon's MDBX.** Alert at 80% on `/data`, hard-stop the container at 90%. We expect the Eth archive volume to be the dominant disk consumer.
- **Chain data isn't backed up.** Re-sync via Erigon's OtterSync takes ~6–12 h on AX102, faster than restoring 3 TB. The chain is the canonical source.
- **Master key (`/etc/hotbox/master.key`) is unrecoverable.** Lose it and every encrypted row in `secrets` is dead. Back it up offline.
- **Reconciler drift report** at `GET /api/drift`. Watch it in the first month — orphaned containers and orphaned DB rows are the most likely class of bug, and the report exists to surface them quickly.

## Cost math

On the AX102 (~$155/mo + $85 one-time setup) replacing $1,000/mo Alchemy:

- Payback: month 1
- Steady-state savings: ~$840/mo, ~$10k/yr
- Engineering time to set up: well under a week of one person's time

## What's not built

A few intentional omissions, with reasons:

- **No in-house image builder.** Build images in GitHub Actions (or wherever you already do) and give hotbox an image reference. The plan is "we run what you give us"; an in-house builder is a separate project with its own failure modes.
- **No CLI.** The web UI plus a documented HTTP API is enough for single-team use. A 10-line `curl -N` wrapper does `tail -f` over the SSE endpoint if anyone wants it.
- **No multi-host scheduling.** Every table has `host_id` and the API is parameterized by it; we just only ever have one row in `hosts`. Going multi-host is a scaling exercise, not a rewrite.
- **No hard-delete UI.** Archive stops containers and hides the service but preserves data volumes. Hard-delete-including-volumes is a separate, careful action — important enough to think through the confirmation UX, not important enough to ship in a hurry.
- **No automated Postgres backup.** SETUP §5 documents a nightly `pg_dump` to a Hetzner Storage Box; turning that into a managed cron is a v2 thing.

## License

MIT (see `LICENSE`).
