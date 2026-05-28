# Auto subdomains under your hotbox base domain

Hotbox can hand out a free public URL to every service you create — no per-service DNS edit, no per-service cert issuance. This is the `auto_subdomain` flag you'll see on the service create form once you've completed the one-time setup below.

The shape is deterministic: a service named `api` in env `production` of project `widget-sales`, with the base set to `on.hotbox.wtf`, lands at:

```
https://api-production-widget-sales.on.hotbox.wtf
```

Same-slugged services in different envs (a "dev" copy of the same `api`) get their own unique subdomain because the env and project slugs are baked in. Custom hostnames (`api.widget-sales.com`) still work in parallel — Traefik routes both to the same container.

## How it works

- Traefik holds a single wildcard cert for `*.${base}`, issued via the ACME DNS-01 challenge against your DNS provider. One cert covers every service, so adding a service is just a label change — no new ACME issuance, no rate-limit risk.
- Each service that opts in gets an extra Traefik router (`<id>-auto`) using the `le-dns` resolver. Services with a custom hostname additionally get an `<id>-custom` router using `le-http` (HTTP-01 challenge per hostname). The same loadbalancer service backs both routers.
- The ForwardAuth path (`/internal/authz`) accepts either hostname for token scope validation, so RPC tokens scoped to a service work over either URL.

## One-time setup (Cloudflare)

This guide assumes Cloudflare; Traefik's lego ACME client supports many other DNS providers — adjust the env var name + Traefik config to taste if you're using a different one.

### 1. Transfer or delegate your zone to Cloudflare

You need a zone you can hit with an API token from the hotbox box. If your domain is at another registrar, either transfer it to Cloudflare or delegate the subzone you intend to use as the auto-subdomain base. The free Cloudflare plan is fine.

### 2. Wildcard A record

In the Cloudflare DNS settings for the zone, add an A record:

```
*.on.hotbox.wtf  →  <your hotbox box IPv4>   (Proxy status: DNS only)
```

"Proxy status: DNS only" matters — the Cloudflare proxy strips ACME challenge metadata. Verify with:

```bash
dig +short whatever.on.hotbox.wtf
# should return your box IPv4
```

### 3. Create an API token

Cloudflare → My Profile → API Tokens → Create Token → "Custom token":

- **Permissions:** `Zone : DNS : Edit`
- **Zone Resources:** Include specific zone — the one hosting your base (e.g. `hotbox.wtf`)

Copy the token. You won't see it again.

### 4. Set the env vars on the box

In `/opt/hotbox/.env`:

```
# Already there from initial setup
ACME_EMAIL=ops@your-org.example

# New for auto subdomains
HOTBOX_AUTO_SUBDOMAIN_BASE=on.hotbox.wtf
CLOUDFLARE_DNS_API_TOKEN=<the token from step 3>
```

Recreate the traefik + hotbox-api containers so they pick up the new env:

```bash
cd /opt/hotbox/infra
docker compose -f compose.hotbox.yml up -d --force-recreate traefik hotbox-api
```

### 5. First-cert verification

The wildcard cert is issued lazily — Traefik requests it the first time a router references the `le-dns` resolver. Trigger that by enabling the auto subdomain on any service (the create form or the service-detail "edit ingress" panel both work).

Watch traefik logs as the first request goes out:

```bash
docker compose -f compose.hotbox.yml logs -f traefik | grep -i acme
```

Expected sequence (~30-60s end to end):

```
... Building ACME client for HTTPS challenge resolver "le-dns"
... Trying to challenge certificate for domain [*.on.hotbox.wtf]
... Validations succeeded; requesting certificates
... Certificates obtained for domains [*.on.hotbox.wtf]
```

Then `curl -v https://anything.on.hotbox.wtf/` returns the underlying service with a valid Let's Encrypt cert. Every subsequent service that opts in to auto subdomains reuses this cert — no further ACME activity.

## Disabling auto subdomains

Leaving `HOTBOX_AUTO_SUBDOMAIN_BASE` unset disables the feature globally. Services that have `auto_subdomain=true` still keep the flag in the DB, but the reconciler skips emitting the auto router — only the custom hostname (if any) routes traffic. This is the safe default for trial deploys without DNS configured.

## Picking a different DNS provider

Traefik's lego library supports many providers. To switch:

1. Update `infra/traefik/traefik.yml`'s `le-dns` resolver — change `provider: cloudflare` to your provider's identifier (e.g. `route53`, `digitalocean`, `gandi`).
2. Update the env var name in `infra/compose.hotbox.yml`'s traefik service to whatever credentials your provider needs (e.g. `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` for Route 53).
3. The hotbox-side env (`HOTBOX_AUTO_SUBDOMAIN_BASE`) doesn't change — only the cert issuance plumbing does.

## Troubleshooting

- **Cert never issues**: check Traefik logs for the actual ACME error. Most often: wrong API token scope (needs `Zone:DNS:Edit`), token scoped to the wrong zone, or DNS propagation slow on first run. Bump `delayBeforeCheck` in `traefik.yml` from 10s to 30s if you see repeated "challenge failed" messages.
- **Some subdomains 404**: the wildcard cert covers `*.${base}` (one level deep). `foo.bar.on.hotbox.wtf` would need a different cert pattern. The auto-subdomain feature only ever generates single-label subdomains under the base, so this only matters if you've manually pointed an `*.*.on.hotbox.wtf` style hostname at the box.
- **Rate-limit hit on the staging server**: use Let's Encrypt's staging server (`caServer: https://acme-staging-v02.api.letsencrypt.org/directory` under each resolver in `traefik.yml`) while iterating; switch back to prod once stable.
