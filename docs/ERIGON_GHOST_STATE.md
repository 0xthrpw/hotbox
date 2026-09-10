# Erigon ghost-state incident runbook

Covers the recurring erigon v3.4.x failure where the archive node rejects a
**canonical** block and loops on `Unwind Execution` forever, and the one-time
upgrade to v3.6.1 that stops it recurring.

Incidents so far:

| Date | Block | Error | Resolution |
|---|---|---|---|
| 2026-06-25 | 25393073 | `invalid block, txnIdx=1158, gas used by execution: … in header: …` | `integration reset_state` (stayed on v3.4.4) |
| 2026-09-09 | 25942034 | `invalid block, txnIdx=270, gas limit reached` | this runbook: chaindata wipe + upgrade to v3.6.1 |

## Recognizing it

- `[4/6 Execution] Execution failed … err="invalid block, txnIdx=N, …"` followed by
  `Cannot update chain head`, then `Unwind Execution from=X to=X-1`, then the same
  failure again — a tight loop on one block.
- The block is **canonical** (verify: its `header-hash` matches
  `eth_getBlockByNumber` on any public RPC, e.g. `https://eth.drpc.org`).
- Both error shapes are the same disease. "gas used mismatch" appears when the
  divergence survives to the end of the block; "gas limit reached" appears when the
  block is nearly full and erigon's divergent replay of earlier txs drains the block
  gas pool before the last txs can run.

## Root cause

erigon v3.4.x's tip-reorg unwind leaks state: writes from a discarded 1-block fork
survive in the DB ("ghost state"), and later canonical execution on top of it
computes different gas. Three separate unwind bugs were fixed piecemeal in
v3.4.2/v3.4.3 ([erigon#21515](https://github.com/erigontech/erigon/issues/21515))
but recurrence continued on v3.4.4
([erigon#22019](https://github.com/erigontech/erigon/issues/22019), closed
2026-07-01 with "re-open if it happens in v3.5.0 or later"). Operators on 3.4.x
report roughly monthly recurrence. The fix is structural in 3.5+/3.6.

Two independent things must happen:

1. **Repair** — the ghost state already in the DB must be cleared. Upstream fixes
   are preventative, not retroactive. Wiping `chaindata` (the mutable recent-state
   MDBX) and rebuilding from the frozen snapshots removes it, including the stale
   canonical header pointer that made plain unwind useless in June.
2. **Cure** — run a version whose unwind doesn't create new ghosts: v3.6.1
   (template bumped in this repo).

## Why the ordering below matters

- Templates are baked into the hotbox-api image at build time and cached in-process,
  so the control plane only sees the new template after CI builds and the box pulls
  hotbox-api (`apps/api/Dockerfile` copies `packages/`; loader:
  `packages/shared/src/template-loader.ts`).
- **Use Redeploy, not Stop→Start.** Redeploy creates a new deployment version,
  re-reads the template, and re-resolves the image digest
  (`apps/reconciler/src/template-runner.ts` `planRoles`/`ensureRoleDigest`).
  Stop→Start reuses the previous deployment's *cached digest* and would restart
  v3.4.4 even with the new template in place.
- Wiping chaindata sidesteps the 3.4→3.5→3.6 config-migration question entirely:
  fresh chaindata takes its prune config from the CLI flags in the template.
  The datadir uses the modern 390,625-tx step size (created under v3.4.3), so no
  `seg step-rebase` is needed. Do **not** run `erigon seg reset` — it is only for
  eagerly adopting the new plain-commitment snapshot format and would trigger a
  large re-download; 3.6 reads the old-format snapshot files fine and converts
  lazily during merges.

## Procedure

Estimated downtime: 1–3 h (snapshot/index checks + re-execution of ~10–15k recent
blocks; 3.6 executes in parallel by default).

1. **Ship the template.** Review and land the change to
   `packages/shared/templates/eth-archive.json` (image `erigontech/erigon:v3.6.1`,
   30304 mappings removed — 3.5+ listens only on `--port` 30303; 42069 stays for
   the snapshot downloader). Push to master; wait for the `release` workflow to
   publish `ghcr.io/<repo>/hotbox-api:latest`.

2. **Update the control plane on the box.**

   ```sh
   cd /opt/hotbox/infra
   docker compose -f compose.hotbox.yml --env-file ../.env pull hotbox-api
   docker compose -f compose.hotbox.yml --env-file ../.env up -d hotbox-api
   ```

3. **Stop the service** — hotbox UI → eth-archive → Stop. Then on the box confirm
   the erigon container is fully gone (June's port-collision deadlock came from a
   half-removed old container; the reconciler hardening for that never landed):

   ```sh
   docker ps -a | grep erigon    # expect: nothing
   ```

4. **Wipe chaindata only** (snapshots, Caplin data, and everything else stay):

   ```sh
   docker volume ls | grep erigon-data   # note the exact volume name
   docker run --rm -v <VOLUME>:/d alpine rm -rf /d/chaindata
   ```

   The volume root *is* the datadir. Only remove `chaindata/`.

5. **Redeploy** — hotbox UI → eth-archive → **Redeploy** (not Start). This pulls
   v3.6.1, resolves a fresh digest, and creates a new container.

6. **Watch first start.** Expected: downloader verifying snapshots, possible
   automatic accessor/index rebuilds, then `[4/6 Execution]` re-executing from the
   last frozen step (~block 25.94M) forward. The previously failing block must go
   through — watch for `blk=25942034` passing without `Execution failed`.

   If instead the container wedges in `created` state (port conflict): the
   reconciler swallows this error. `docker ps -a` for a `created` erigon container,
   `docker rm` it, make sure nothing holds 30303/42069, and Redeploy again.

7. **Verify.**

   ```sh
   # head advancing past the stuck range and tracking tip:
   curl -s <rpc> -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
   # the once-failing block executed correctly (last receipt's cumulative gas
   # must equal the header's gasUsed, 0x3928e24):
   curl -s <rpc> -d '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockReceipts","params":["0x18bd812"]}'
   ```

   Then confirm downstream consumers (EFP indexer, relics, ensnode) resume.

## Post-upgrade watch items (3.4.4 → 3.6.1 behavior changes)

- **Receipts/log RPC latency.** 3.6 defaults historical-receipt caching OFF for
  fresh datadirs in every prune mode, and the wipe may have discarded the stored
  setting. If `eth_getLogs`/receipt calls regress noticeably, add
  `--prune.include-receipts --prune.receipts.distance=keep-all` to the template
  command (see erigon#22296/#22349) and redeploy.
- **Installed filters expire after 5 idle minutes** (`eth_newFilter` etc.) —
  long-polling clients must poll faster or recreate filters
  (`--rpc.subscription.filters.timeout` to change).
- **`debug_trace*`**: `disableMemory`/`disableReturnData` became
  `enableMemory`/`enableReturnData`, default now excluded (3.5 change).
- **Quoted decimal block numbers** (`"3"`) are rejected; hex, bare int, or tags only.
- **Peers**: single listener on 30303; peer cache rebuilds from bootnodes on first
  start, so peer count recovers over a few minutes.
- **No downgrade** once 3.6 writes new-format snapshot files — rolling back to
  ≤3.5 is unsupported. There is no practical datadir backup on this box; accepted
  risk (3.6.0 shipped 2026-08-24, 3.6.1 is its bugfix release).

## If it ever recurs on 3.6+

Re-open [erigon#22019](https://github.com/erigontech/erigon/issues/22019) upstream
(the maintainers asked for exactly that), and repair with steps 3–7 above — the
chaindata wipe works regardless of version.
