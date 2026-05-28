# Hetzner production deployment

This is the production deployment guide for the AX102. Follow it top to bottom — it incorporates the lessons from the 2026-05-26 LAN trial that uncovered eleven setup bugs (all fixed) and leaves one known issue you must address before the first ACME issuance attempt.

`docs/SETUP.md` is the comprehensive reference. This doc is the linear checklist — when a step says "see §3.2 in SETUP", that's where the longer explanation lives.

## Before you click "order"

Have these ready:

- An SSH key you've used recently (the trial bit me on this; `.ssh/authorized_keys` won't exist if you've only ever password-auth'd somewhere).
- DNS control over the domain you'll use. You need to be able to point A records at the box and have them propagate within ~10 minutes.
- A GitHub Personal Access Token with `write:packages` if you plan to push images to GHCR. Alternatively, plan to build on the box.
- A safe place to store the master key offline (1Password, Bitwarden, encrypted external drive). Losing it permanently bricks every encrypted secret in the DB.
- A pgAdmin or `psql` client on your laptop, for backups and the occasional manual query.

## 1. Provision

Order the AX102 in the Hetzner robot per `SETUP.md` §3.1:

- Ubuntu 24.04 LTS (not 20.04 — Docker's install script has flagged 20.04 as EOL).
- Software RAID-0 across both NVMes mounted at `/data`.
- SSH key in the order so you skip the password mailer.

When the rescue email arrives, SSH in as root and do the host-hygiene block from SETUP §3.1: create the `hotbox` deploy user, configure `ufw`, install Docker via the convenience script. Verify before moving on:

```bash
df -h /data           # should show ~3.5 TiB free on the RAID-0 mount
docker --version      # should be a recent Docker Engine + compose plugin
sudo -u hotbox docker ps   # the deploy user can talk to the socket without sudo
```

## 2. DNS

Point three A records at the box before you bring the stack up. ACME HTTP-01 needs working DNS at the moment Traefik tries to issue, and adding records after the fact means waiting for propagation while everything errors:

- `hotbox.your-org.example` → UI
- `hotbox-api.your-org.example` → API (used for ForwardAuth + RPC routes)
- `rpc.your-org.example` → RPC ingress for the eth-archive service (you can add this later if you're not deploying the node on day one)

`dig +short hotbox.your-org.example` should return the box's IPv4 before you continue.

## 3. Master key

On the box, as root:

```bash
sudo mkdir -p /etc/hotbox
openssl rand -hex 32 | sudo tee /etc/hotbox/master.key >/dev/null
sudo chmod 0400 /etc/hotbox/master.key
sudo chown root:root /etc/hotbox/master.key
```

**Back this up off-box right now**, before anything else. Don't wait. Recommended: paste into your password manager as a long string, and also write it to an encrypted USB stick that lives somewhere not in the same building.

## 4. Address the ACME email bug (one-time fix before bringing the stack up)

The trial validated everything except the ACME path (we ran HTTP-only on a LAN). There's one known issue: `infra/traefik/traefik.yml` has `email: ${ACME_EMAIL}` and Traefik **does not substitute env vars in its static YAML config**. As shipped, ACME will try to register with literal `${ACME_EMAIL}` as the email and Let's Encrypt will reject it.

Fix it on the box before the first start:

Edit `infra/traefik/traefik.yml` and remove the `email:` line entirely:

```yaml
certificatesResolvers:
  le:
    acme:
      storage: /etc/traefik/acme/acme.json
      httpChallenge:
        entryPoint: web
```

Then set the email via the env-var equivalent in `infra/compose.hotbox.yml` on the traefik service:

```yaml
  traefik:
    # ...existing config...
    environment:
      TRAEFIK_CERTIFICATESRESOLVERS_LE_ACME_EMAIL: "${ACME_EMAIL}"
      # ...existing HOTBOX_WEB_HOST / HOTBOX_API_HOST etc. if still there
```

Traefik *does* substitute env vars when they're presented through `TRAEFIK_*=...` env vars (its standard configuration-via-environment mechanism). This sidesteps the YAML-substitution gap.

Open a PR for this fix when you have a minute; it's a real bug, just one we deferred from the trial PR.

## 5. Images

Build and push to GHCR per SETUP §3.4. Tag with the short SHA you intend to deploy:

```bash
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

`HOTBOX_API_URL` is baked into the `hotbox-web` image at build time via the Dockerfile's `ARG` — it defaults to `http://hotbox-api:3000`, which is correct for the in-compose network, so no override needed for production.

## 6. Configure `.env` on the box

As the `hotbox` user:

```bash
mkdir -p /opt/hotbox && cd /opt/hotbox
git clone <repo-url> .

cat > .env <<EOF
ACME_EMAIL=ops@your-org.example
HOTBOX_WEB_HOST=hotbox.your-org.example
HOTBOX_API_HOST=hotbox-api.your-org.example
HOTBOX_PG_PASSWORD=$(openssl rand -hex 24)
HOTBOX_HOST_ID=
HOTBOX_REPO=your-org/hotbox
HOTBOX_VERSION=$(git rev-parse --short HEAD)
EOF
chmod 0600 .env

# So compose auto-loads it from infra/
cd infra && ln -sf ../.env .env
```

`-hex 24` rather than `-base64 24` — the latter produces `/` and `+` which break `postgres://` URL interpolation. (Trial bug #1.)

## 7. Bring up the stack

```bash
cd /opt/hotbox/infra
docker compose -f compose.hotbox.yml up -d
```

You'll get five containers, and **`hotbox-api` and `hotbox-metrics-scraper` will be in restart-loop**. That's expected pre-seed: the api requires `HOST_ID` at boot and you haven't seeded yet. Verify the other three (`hotbox-pg`, `hotbox-web`, `traefik`) are healthy:

```bash
docker compose -f compose.hotbox.yml ps
```

Watch traefik for ACME activity:

```bash
docker compose -f compose.hotbox.yml logs -f traefik | grep -i acme
```

You're looking for `Successfully obtained certificate` lines on both `hotbox.your-org.example` and `hotbox-api.your-org.example` within ~2 minutes. If it stalls:

- DNS not propagated: `dig +short hotbox.your-org.example` from a different network.
- :80 not reachable from the public internet: `curl -v http://hotbox.your-org.example/` from off-box.
- Email rejected: did you complete §4 above? If you skipped it, you'll see a literal `${ACME_EMAIL}` rejection in the logs.

## 8. Migrate + seed

Use `docker compose run --rm`, **not** `exec`. The api is restart-looping (see §7), so `exec` is unreliable. The migrate and seed scripts don't need `HOST_ID`, so a fresh one-shot container handles them cleanly:

```bash
docker compose -f compose.hotbox.yml run --rm hotbox-api pnpm db:migrate

docker compose -f compose.hotbox.yml run --rm \
  -e SEED_ADMIN_EMAIL=you@your-org.example \
  -e SEED_ADMIN_PASSWORD='use a long random one' \
  -e SEED_HOST_NAME=hetzner-ax102 \
  -e SEED_HOST_ADDRESS=<box public ip> \
  hotbox-api pnpm seed
```

Seed prints a host UUID. Paste it into `.env` as `HOTBOX_HOST_ID=…`, then recreate the api and scraper to pick up the change:

```bash
docker compose -f compose.hotbox.yml up -d --force-recreate hotbox-api hotbox-metrics-scraper
docker compose -f compose.hotbox.yml ps
```

All five containers should now be `Up`. If any aren't, check logs and reach for the trial memory or `SETUP.md` §6 troubleshooting table.

## 9. Verify before declaring production

Three checks, in order. Don't skip them.

**a. TLS works.** From your laptop:

```bash
curl -v https://hotbox.your-org.example/ 2>&1 | grep -E 'subject|issuer|SSL|HTTP'
```

You should see a Let's Encrypt-issued cert and a 200 or 302 response.

**b. Login works.** Browse to `https://hotbox.your-org.example`, sign in with the seeded admin. The cookie's `secure: true` derivation kicks in correctly because `WEB_ORIGIN` starts with `https://`. If you see "Internal Server Error" on login, check `WEB_ORIGIN` in `compose.hotbox.yml` (should be `https://${HOTBOX_WEB_HOST}` — the default).

**c. The smoke test from the trial.** Create an `nginx:alpine` service via the dashboard's "+ New service" button (template: none, image: `nginx:alpine`, public port: 80, hostname: blank for a quick smoke; leave-blank is fine here). Within ~5 seconds:

```bash
docker ps --filter "label=hotbox.managed=true"
# expect: hotbox-stack-hotbox-{api,web,pg,...}-1  AND  nginx-test-primary-v1
```

The smoking-gun assertion for the jsonb fix — confirm in psql that the deployment row has proper array shapes:

```bash
docker compose -f compose.hotbox.yml exec hotbox-pg \
  psql -U hotbox -d hotbox -c "select network_refs, secret_refs, volume_refs from deployments;"
# expect: [] [] []   (NOT {} {} {})
```

Archive the test service when done; data volumes are preserved but the container stops. Hard-delete (with volumes) isn't a UI action yet.

## 10. Deploy the eth-archive node

`SETUP.md` §4 covers this in full. Two things worth highlighting that the trial couldn't validate (we didn't have 3 TB of disk or 32 GB of RAM):

- **Initial sync is ~6–12 hours.** You can't shortcut it. Plan accordingly.
- **Disk-full corrupts MDBX.** Set up the cron disk alert from `SETUP.md` §5 *before* the sync starts, not after.

After sync completes, issue an RPC token and cut over one low-traffic internal service first. Watch the EthRpcPanel in the UI for 24–48 hours before rolling the rest of your services off Alchemy.

## 11. Operational handoff

Once the eth-archive is synced and the first service is cut over, set up:

- **Nightly `pg_dump`** to a Hetzner Storage Box. `SETUP.md` §5 has the command. The control-plane DB is small (~MB) and slow-growing.
- **Disk-usage alert at 80%** on `/data` (`SETUP.md` §5). Disk-full corrupts Erigon's MDBX and the only recovery is re-sync.
- **A `master.key` recovery drill.** Once. Restore it from your backup to a scratch directory and confirm an encrypted secret round-trips through `seal`/`open` (the `crypto/seal.test.ts` pattern). Better to know now than during an incident.

## Upgrading from pre-Phase-1 (projects + environments)

The `20260601000001_projects_environments.sql` migration is one-way for live data:

- A `default` project and `production` environment are auto-created. Every existing service is reassigned to that pair.
- Container names switch from `${slug}-primary-v${version}` to `${project_slug}-${env_slug}-${slug}-primary-v${version}` (e.g. `nginx-test-primary-v1` becomes `default-production-nginx-test-primary-v1`). Traefik router IDs follow the same shape.
- Existing containers don't match the new name pattern, so the reconciler treats them as drift and recreates each one on the next tick. Expect ~5s of churn per stateless service the first time the new code runs. Stateful services (Postgres siblings, eth-archive) restart but retain their data volumes.

Operator action: nothing required during the upgrade itself — `docker compose run --rm hotbox-api pnpm db:migrate` applies the schema change, then bring the api/reconciler back up and the rename happens automatically. After the upgrade you can browse to `/projects` in the dashboard and either rename the auto-created `default` project or move services into new projects via the API. Per-project / per-env service creation flows through the existing `/services/new` form, now with project + env selectors at the top.

## Known gaps not exercised by the trial

The 2026-05-26 trial was HTTP-only on a LAN. These paths run for the first time on production:

- **ACME HTTP-01 issuance.** Addressed by §4 above; if §9a fails, look there first.
- **Let's Encrypt rate limits.** If you tear down and rebuild the stack repeatedly during day-1 fiddling, you can hit the 50 issuances / week / domain limit. Use the LE staging server (`caServer: https://acme-staging-v02.api.letsencrypt.org/directory` in traefik.yml) for shakedown if you expect to recreate.
- **The eth-archive template's full sync** (template-driven multi-container orchestration past the "container created" milestone). The reconciler logic was validated with nginx; sync-stage UI and Lighthouse/Erigon JWT bootstrap haven't been hit on the trial box.

If you find any of these break in a way that suggests a code bug rather than a config one, that's worth a memory note for the next person.
