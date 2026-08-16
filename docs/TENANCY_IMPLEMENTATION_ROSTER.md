# KpnCompute tenant-proof implementation roster

Status: application implementation complete locally; tenant database foundation
applied to production. Git publication, application deployment, and
`shadow`/`enforced` cutover remain pending.

## Implemented foundation

- `tenants` and `tenant_memberships` establish immutable workspace identity,
  membership roles, lifecycle status, and one default workspace per user.
- Every existing MJCC business row is backfilled to the generated `mjcc`
  tenant. No tenant UUID is hardcoded.
- Tenant-owned tables receive `tenant_id`, tenant-local natural keys, composite
  parent/child constraints, membership-scoped read policies, and backend-only
  writes.
- Privileged inventory, source-control, SKU, and rollover RPCs require an
  explicit tenant UUID and constrain every read and mutation to it.
- The FastAPI service wraps its privileged Supabase client. Reads receive an
  automatic tenant predicate; writes are stamped; cross-tenant writes and RPCs
  fail closed.
- Authentication resolves `X-Kpn-Workspace` against active membership and uses
  the membership role. PIN sessions cannot gain elevated workspace access.
- User administration lists, changes, and removes membership within the active
  workspace instead of globally disabling an identity shared by other tenants.
- File archive keys, audit/error telemetry, AI parsing threads, GitHub archive
  jobs, public-menu access, SSO handoffs, and KpnSolute CloudEvents retain the
  originating workspace.
- The portal sends the workspace on normal requests, retries, forms, uploads,
  and session telemetry. Multiple memberships expose a workspace switcher and
  canonical `/workspaces/{slug}` URL.
- Each workspace owns projects. Every project receives a constrained tree with
  `/documents/sops`, `/source`, `/generated`, `/data`, and `/archive` roots.
- Artifact metadata enforces a private Storage key rooted at
  `tenants/{tenant_id}/projects/{project_id}`. SOP versions, generation source
  manifests, and reviewable blueprint versions retain immutable provenance.

## Safe rollout sequence

1. Keep `KPNCOMPUTE_TENANCY_MODE=legacy` while application code is deployed.
2. Apply and verify the six tenant migrations. Completed in production on
   2026-08-15 after local grammar and test validation.
3. Run database advisors and disposition findings. Completed for the tenant
   tables; backend-only tables intentionally retain deny-all RLS with no client
   policy. Existing password-protection and legacy function findings remain.
4. Set `KPNCOMPUTE_TENANCY_MODE=shadow`; verify MJCC login, inventory, rollover,
   source control, uploads, SSO, menu events, and workspace user management.
5. Create a disposable second tenant and prove identical natural keys and data
   cannot cross workspace boundaries.
6. Set `KPNCOMPUTE_TENANCY_MODE=enforced` only after acceptance evidence.
7. Remove legacy RPC overloads, MJCC insert triggers, and the legacy event
   tenant fallback in a later, separately approved migration.

## Acceptance evidence required before calling it live

- Migration rehearsal and rollback on a non-production database.
- Zero null tenant IDs outside intentionally unassigned platform telemetry.
- Composite foreign-key validation succeeds for every tenant-owned relation.
- RLS and database security advisors are clean or explicitly dispositioned.
- Two-tenant negative tests cover reads, writes, RPCs, files, SSO, events, user
  management, and background work.
- Authenticated browser acceptance proves workspace switching and MJCC parity.
- Git commit, GitHub push, CI, deployment, migration, and live acceptance are
  reported as separate states.
