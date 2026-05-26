# Hotbox setup guide

This walks through standing up hotbox from scratch — locally for development, then on a Hetzner box for production — and deploying the first Ethereum archive node.

For the architectural context behind these choices see the plan at `/home/throw/.claude/plans/we-ve-been-using-railway-dynamic-hellman.md` (or wherever you've stashed it).

---

## 1. What you're standing up

Hotbox consists of five processes, all written in TypeScript:

| Process | What it does | Talks to |
|---|---|---|
| `hotbox-api` (Fastify) | HTTP API + SSE log streams + ForwardAuth endpoint. **Embeds the reconciler.** | Postgres, Docker socket |
| `hotbox-web` (Next.js) | The UI you log in to | `hotbox-api` over HTTP |
| `hotbox-rpc-proxy` | JSON-RPC body parser in front of Erigon: token tier checks, method filter, request log | Postgres, Erigon |
| `hotbox-metrics-scraper` | Polls Erigon/Lighthouse Prometheus endpoints every 15s | Postgres, the eth-node containers |
| `traefik` | Reverse proxy + ACME TLS. Watches Docker labels and routes automatically. | Docker socket |

Plus **Postgres** for control-plane state.

The reconciler reads desired state from Postgres and converges Docker. Containers it creates are labelled with `hotbox.managed=true`, `hotbox.service_id`, `hotbox.deployment_id`, `hotbox.version` — those labels are the authoritative identity, not container names.

---

## 2. Local development

You don't need a Hetzner box or any TLS to run hotbox locally. You do need Docker (for the reconciler to talk to a real engine and for the local Postgres) and Node 22.

### 2.1 Prerequisites

- **Node 22** (the repo's `.node-version` says `22`). `nvm install 22 && nvm use` works.
- **pnpm 10** — `corepack enable && corepack prepare pnpm@10.33.0 --activate`
- **Docker Engine** — recent version with `compose` plugin
- **Make sure your user can talk to the Docker socket** (`docker ps` works without `sudo`). The reconciler reads `/var/run/docker.sock`.

### 2.2 Clone and install

```bash
git clone <repo-url> hotbox && cd hotbox
pnpm install
```

The install warns about `argon2` build scripts being ignored. Approve them so the prebuilt binary is fetched:

```bash
pnpm approve-builds
# select argon2 (space to toggle, enter to confirm)
```

If your platform doesn't have a prebuilt argon2 binary, swap to `hash-wasm` — but on linux-x64 + macOS this Just Works.

### 2.3 Start the local Postgres

```bash
pnpm dev:pg:up
```

This runs `infra/compose.dev.yml`, which exposes Postgres on `127.0.0.1:5433` with user/pass/db `hotbox/hotbox/hotbox`. Data lives in a named volume (`hotbox-dev-pg`) so it survives restarts.

### 2.4 Generate a master key

The master key encrypts row-level secrets in the `secrets` table. For local dev a throwaway is fine:

```bash
openssl rand -hex 32 > master.key
chmod 0400 master.key
```

(`master.key` and `*.key` are gitignored.)

### 2.5 Configure `.env`

```bash
cp .env.example .env
```

The defaults already point at the dev Postgres (`postgres://hotbox:hotbox@127.0.0.1:5433/hotbox`) and the local master key. You'll fill in `HOST_ID` after seeding.

### 2.6 Run migrations

```bash
pnpm db:migrate
```

This applies `packages/db/migrations/*.sql` and writes to a `schema_migrations` table. Idempotent — safe to re-run.

### 2.7 Seed a host row and an admin user

```bash
SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=changeme123 pnpm seed
```

Or run it interactively (`pnpm seed` and answer the prompts). The script prints the new host UUID — paste it into `.env`:

```env
HOST_ID=01935a2e-…
```

### 2.8 Run the API and the web app

In two terminals:

```bash
# terminal A — API + reconciler
pnpm dev:api

# terminal B — Next.js dev server
pnpm dev:web
```

The API listens on `http://localhost:3000`, the web on `http://localhost:3001`. The web's `next.config.ts` rewrites `/api/*` to `http://127.0.0.1:3000/api/*` so cookies flow correctly.

Open <http://localhost:3001/login> and sign in with the credentials you seeded.

### 2.9 Smoke test: deploy nginx

From the dashboard, hit **+ New service** (TODO: this UI screen is not yet built — for now create via the API directly):

```bash
curl -X POST http://localhost:3000/api/services \
  -H 'content-type: application/json' \
  -b cookies.txt \                              # login first to obtain cookies
  -d '{
    "name": "test nginx",
    "slug": "test-nginx",
    "kind": "app",
    "image": "nginx:alpine",
    "public_port": 80,
    "env": {}
  }'
```

Within 5 seconds the reconciler pulls `nginx:alpine`, resolves its digest, creates a labelled container, and starts it. Watch:

```bash
docker ps --filter "label=hotbox.managed=true"
```

In the UI, the service appears in the list with a healthy pill; clicking through shows live logs via SSE.

To verify drift handling: `docker stop <id>` the nginx container manually. Within one tick the UI flips to `stopped`; `POST /api/services/<id>/start` brings it back.

---

## 3. Production deployment to Hetzner

### 3.1 Provision the box

- Order an **AX102** in the Hetzner robot. Ubuntu 24.04 LTS.
- Request **software RAID-0 across both NVMes** mounted at `/data`. (Robot's auto-installer can do this; otherwise do it manually post-install with `mdadm`.)
- Add your SSH key in the order.

You'll get an IPv4, an IPv6, and root SSH. First-time setup:

```bash
ssh root@<ip>
# create a deploy user (don't run hotbox as root long-term)
adduser hotbox && usermod -aG sudo,docker hotbox
mkdir -p /home/hotbox/.ssh && cp ~/.ssh/authorized_keys /home/hotbox/.ssh/
chown -R hotbox:hotbox /home/hotbox/.ssh && chmod 700 /home/hotbox/.ssh

# firewall — open only the ports we use
apt update && apt install -y ufw
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp && ufw allow 443/tcp
ufw allow 30303/tcp && ufw allow 30303/udp
ufw allow 30304/tcp && ufw allow 30304/udp
ufw allow 42069/tcp && ufw allow 42069/udp    # required for Erigon OtterSync
ufw allow 9000/tcp && ufw allow 9000/udp      # Lighthouse P2P
ufw enable

# install Docker Engine + Compose plugin (official script)
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
```

Verify `/data` is the RAID-0 volume: `df -h /data` should show ~3.5 TiB free.

### 3.2 DNS records

Point two A records at the box:

- `hotbox.example` → UI
- `hotbox-api.example` → API (only ForwardAuth + per-token RPC routes are exposed publicly)

Plus one per service you create — for the Eth node you'll want `rpc.example`. You can add these later, before flipping the service on.

### 3.3 Master key on the host

```bash
sudo mkdir -p /etc/hotbox
openssl rand -hex 32 | sudo tee /etc/hotbox/master.key >/dev/null
sudo chmod 0400 /etc/hotbox/master.key
sudo chown root:root /etc/hotbox/master.key
```

**Back this file up somewhere safe (1Password, KMS, paper).** Lose it and every encrypted secret in Postgres is gone.

### 3.4 Build and push the four images

The simplest path is GitHub Actions building to GHCR; for the first deploy you can build locally and push:

```bash
# from your laptop
export REPO=ghcr.io/your-org/hotbox
export VERSION=$(git rev-parse --short HEAD)

for app in api web rpc-proxy metrics-scraper; do
  docker buildx build \
    --platform linux/amd64 \
    -f apps/$app/Dockerfile \
    -t $REPO/hotbox-$app:$VERSION \
    -t $REPO/hotbox-$app:latest \
    --push .
done
```

You'll need `docker login ghcr.io` first (with a PAT that has `write:packages`).

### 3.5 Configure environment on the box

On the box, as the `hotbox` user:

```bash
mkdir -p /opt/hotbox && cd /opt/hotbox
git clone <repo-url> .

cat > .env <<'EOF'
ACME_EMAIL=ops@your-org.example
HOTBOX_WEB_HOST=hotbox.example
HOTBOX_API_HOST=hotbox-api.example
HOTBOX_PG_PASSWORD=$(openssl rand -base64 24)
HOTBOX_HOST_ID=                # fill in after first seed run
HOTBOX_REPO=your-org/hotbox
HOTBOX_VERSION=<git short sha>
EOF
chmod 0600 .env
```

`HOTBOX_PG_PASSWORD` is the password Postgres uses internally — it's not stored elsewhere, so generate once and keep it in `.env`.

### 3.6 Start the stack

```bash
cd /opt/hotbox/infra
docker compose -f compose.hotbox.yml --env-file ../.env up -d
```

This brings up:
- `traefik` — listens on :80/:443
- `hotbox-pg` — Postgres 16
- `hotbox-api`, `hotbox-web`, `hotbox-metrics-scraper`

Watch logs:

```bash
docker compose -f compose.hotbox.yml logs -f traefik
```

Traefik will negotiate Let's Encrypt certs over HTTP-01 on :80. Look for `successfully obtained certificate` lines. If you don't see them within a couple of minutes, check:
- DNS actually points at the box (`dig hotbox.example`)
- :80 is reachable from the public internet (`curl http://hotbox.example/.well-known/acme-challenge/test`)
- `ACME_EMAIL` is set and valid

### 3.7 First-run migrations and seed (in-container)

```bash
docker compose -f compose.hotbox.yml exec hotbox-api pnpm db:migrate
docker compose -f compose.hotbox.yml exec \
  -e SEED_ADMIN_EMAIL=you@your-org.example \
  -e SEED_ADMIN_PASSWORD='use a strong one' \
  -e SEED_HOST_NAME=hetzner-ax102 \
  -e SEED_HOST_ADDRESS=<box public ip> \
  hotbox-api pnpm seed
```

The seed prints the new host UUID. Paste it back into `.env` as `HOTBOX_HOST_ID=` and recreate the api/scraper containers so they see the change:

```bash
docker compose -f compose.hotbox.yml --env-file ../.env up -d --force-recreate hotbox-api hotbox-metrics-scraper
```

### 3.8 First login

Browse to `https://hotbox.example`, sign in with the seeded admin. You're done with the platform setup.

---

## 4. Deploying the Ethereum archive node

The Eth node is the first "real" workload. The plan is to declare a service with `template: "eth-archive"`, let the reconciler stand up Erigon + Lighthouse, wait for sync, then issue an RPC token and start pointing internal services at it.

### 4.1 What's not yet wired (heads-up)

In this v0 there are two known gaps you'll hit when you try this:

1. **The template-aware service creation flow is not in the UI.** The current `POST /services` accepts a `template` field, but the reconciler does not yet read `infra/templates/eth-archive.json` and materialize the two containers + the JWT bootstrap file. That orchestration is the next implementation step. Until then, the workaround below uses two manual `POST /services` calls — one for `<svc>-erigon` and one for `<svc>-lighthouse`.
2. **The JWT bootstrap step isn't automated.** You'll generate the JWT on the host once and bind-mount it.

Both are listed in the plan's "next-iteration work" and are small relative to what's already built.

### 4.2 Create the JWT secret on the host

```bash
sudo mkdir -p /data/eth-archive/jwt
sudo openssl rand -hex 32 | sudo tee /data/eth-archive/jwt/jwt.hex >/dev/null
sudo chmod 0640 /data/eth-archive/jwt/jwt.hex
```

### 4.3 Pre-create volumes and network

```bash
docker network create --internal eth-archive-eth
docker volume create eth-archive-erigon-data
docker volume create eth-archive-lighthouse-data
```

(Once template-aware reconciliation lands, hotbox will do this.)

### 4.4 Create the two services via API

After logging in via the UI, your browser holds a session cookie. From the same machine:

```bash
# get the cookie from your browser devtools (Application → Cookies → hotbox_session)
COOKIE='hotbox_session=…'
API=https://hotbox-api.example

curl -X POST $API/api/services -H 'content-type: application/json' -H "cookie: $COOKIE" -d '{
  "name": "Eth archive — Lighthouse",
  "slug": "eth-archive-lighthouse",
  "kind": "app",
  "template": "eth-archive",
  "image": "sigp/lighthouse:v8",
  "env": {}
}'

curl -X POST $API/api/services -H 'content-type: application/json' -H "cookie: $COOKIE" -d '{
  "name": "Eth archive — Erigon",
  "slug": "eth-archive-erigon",
  "kind": "app",
  "template": "eth-archive",
  "image": "erigontech/erigon:v3",
  "hostname": "rpc.example",
  "public_port": 8545,
  "env": {}
}'
```

Then put the containers on the `eth-archive-eth` network and bind-mount the JWT + data volumes. (Again — once the template runner lands, this drops to a single API call.)

### 4.5 Watch the sync

Open the service detail page in the UI. With `template: "eth-archive"` and the metrics-scraper running, you should see the `EthSyncPanel` populate within a minute or two with stage progress bars. The full archive sync via Erigon OtterSync typically completes in **~6–12 hours** on this hardware.

Lighthouse comes online faster — checkpoint sync usually catches up in under an hour.

### 4.6 Issue an RPC token

Once Erigon's `Execution` stage hits 100% and `chain_head_block` is climbing, issue a token:

```bash
curl -X POST $API/api/tokens -H 'content-type: application/json' -H "cookie: $COOKIE" -d '{
  "name": "internal-service-X",
  "kind": "rpc",
  "service_id": "<eth-archive-erigon service id>",
  "tier": "public",
  "rate_limit_per_min": 6000
}'
```

The response includes the plaintext token **exactly once** — `hbx_rpc_<…>`. Stash it in your service's secret store.

### 4.7 First RPC call

```bash
curl -s -X POST https://rpc.example \
  -H 'content-type: application/json' \
  -H "authorization: Bearer hbx_rpc_…" \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

A successful response means the full chain is working: Traefik → ForwardAuth → rpc-proxy → Erigon. Failed (401) means the token was rejected — check it isn't revoked and that the `service_id` matches the routed hostname.

### 4.8 Cut over from Alchemy

1. Pick a single low-traffic internal service first.
2. Flip its RPC URL env var from `https://eth-mainnet.g.alchemy.com/v2/…` to `https://rpc.example` with the bearer token.
3. Watch the **EthRpcPanel** in the UI for 24–48 hours. Specifically:
   - Error rate stays near zero.
   - p99 latency is acceptable for your workload.
   - No 403s (means a method your service uses isn't allowed — most common is `alchemy_*` namespace methods that need rewriting).
4. Roll forward one service at a time. The whole portfolio cutting over saves ~$845/mo at the AX102 price point.

---

## 5. Operational notes

### Logs
- API: `docker compose logs -f hotbox-api`
- A service's logs: stream in the UI, or `docker logs -f <container>` directly on the host.

### Drift report
`GET /api/drift` returns containers Docker knows about that Postgres doesn't (orphans) and rows in Postgres without a matching container. **Read this regularly in month one.** Anything in `orphanContainers` is fair game to `docker rm`; anything in `orphanRecords` is fair game to delete from `containers`.

### Disk full = catastrophic
Erigon corrupts MDBX if it runs out of disk mid-write — recovery means re-sync. Set up alerts at 80% on `/data`. A simple cron suffices until you do it properly:

```bash
echo "*/15 * * * * df /data | awk 'NR==2 && \$5+0 > 80 {print \$0}' | mail -s 'hotbox disk' ops@example" | crontab -
```

### Backups
- **Postgres** (control-plane state, tokens, metrics history): nightly `pg_dump` to a Hetzner Storage Box.
- **Master key** (`/etc/hotbox/master.key`): off-box, encrypted at rest. Loss = total secret loss.
- **JWT secrets** like `/data/eth-archive/jwt/jwt.hex`: trivial to regenerate (coordinated EL/CL restart), but back up anyway.
- **Chain data**: **do not back up.** Re-sync via OtterSync is faster than restoring 3 TB. The chain is the canonical source.

### Upgrading hotbox itself
Build new image tags, set `HOTBOX_VERSION=<new tag>` in `.env`, then:

```bash
docker compose -f compose.hotbox.yml --env-file ../.env up -d
```

Migrations are idempotent — if the new release includes a migration, run it before recreating the api:

```bash
docker compose -f compose.hotbox.yml exec hotbox-api pnpm db:migrate
```

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| API container restart-looping with `EACCES /var/run/docker.sock` | Container can't write to the socket | Ensure the API container mounts the socket and runs as a user in the `docker` group — easiest is to add `group_add: ["docker"]` to the compose service. |
| `pnpm seed` fails with `ENOTFOUND postgres` | Container can't resolve the DB hostname | Either run seed inside the compose network (`docker compose exec`) or set `DATABASE_URL` to the host-mapped port. |
| Traefik never gets a cert | DNS not propagated; or :80 not actually open | `dig hotbox.example`; from another host: `curl -v http://hotbox.example/`. |
| 401 on every API call | Cookie not set / `WEB_ORIGIN` mismatch | If you changed `HOTBOX_WEB_HOST`, set `WEB_ORIGIN` to match and recreate `hotbox-api`. |
| RPC 401 | Token typo, token revoked, or `service_id` mismatch | `select prefix, revoked_at, service_id from tokens` to inspect. |
| RPC 403 with `internal token required` | Token tier is `public` but caller used `debug_*`/`erigon_*` | Either change the call or issue a new token with `tier: "internal"`. |
| Eth panel stays blank | metrics-scraper can't reach Erigon's metrics port | The scraper expects `<slug>-erigon:6061` resolvable. Make sure both containers are on a shared network where DNS works. |
| Drift report keeps growing | Manual `docker run`s, or reconciler crashes mid-operation | First-line: list, decide, clean up. If it's chronic, check the API logs for reconciler errors. |
| `argon2` install fails | No prebuilt for your platform | Swap to `hash-wasm` in `apps/api/src/auth.ts` (signature is the same — `await hash.argon2id`). |
