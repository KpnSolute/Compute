# Retired: Compute-owned gateway Worker configuration

This directory previously declared a Cloudflare Worker named
`kpnsolute-api-gateway` bound to `compute.kpnsolute.com`, `api.kpnsolute.com`,
and `api.compute.kpnsolute.com` — the **same Worker name and the same custom
domains** as `Website/apps/gateway/wrangler.jsonc`.

Two repositories declaring one Worker means whichever deploys last silently
wins. This copy carried no `vars` block, so deploying it would have replaced the
live gateway with one that has no origin URLs configured and returns 503 for
every route.

**The single owner of the edge gateway is `Website/apps/gateway`.**

The old configuration is preserved as `wrangler.jsonc.retired` for reference. It
is intentionally not a `.jsonc` file so that `wrangler deploy` cannot pick it up
from this directory.

Corporate tenant subdomains and all gateway routing now live in
`Website/apps/gateway/wrangler.jsonc` and `Website/docs/ROUTE_REGISTRY.md`.
