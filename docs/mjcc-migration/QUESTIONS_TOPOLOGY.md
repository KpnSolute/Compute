# CEngine topology and KpnSolute structure: questions for the owner

Answer inline under each question. Short answers are fine. Where the answer is already in your docs, the question says so and only asks for confirmation or for the decision they leave open.

What I already understand from Loom ADR-0007, `spec/modular-runtime-mjcc-integration.md`, `spec/persona-private-plugins-pipeline.md`, `spec/groups-and-connectors.md` and this week's conversation:

- CEngine = runtime. Modules = libraries. Plugins = tenant policy packs. Template = skeleton. Instance = a tenant's workspace.
- CEngine runs **up to 10 tenants**, and it stays at that scale for those customers.
- One Supabase project (the "Testing" org) is CEngine's home; MJCC's new schema is built there for testing, then wiped and re-laid in the customer's project.
- The live MJCCv1 project stays JobCorp's, and it is where the real production data lives.

## A. The KpnSolute structure

1. Which Supabase org/projects are KpnSolute's own (as opposed to a customer's)? Today the token sees only **JobCorp** and **Testing**. Is "Testing" effectively KpnSolute's, and does a separate KpnSolute org exist outside Supabase (Cloudflare, Render, etc.)?
2. Who are the other 9 tenants besides MJCC: real customers, subsidiaries, or test tenants? Do they each own their Supabase project in their own org, like JobCorp does?
3. For a new customer: who creates their project and org? CEngine, KpnSolute Platform, Infajn, or a human?
4. Where do the shared, non-customer things live (Templates v1 registry, module catalog, plugin artifacts, docs)? Today plugins live in `MJCC-workspace/plugin/.cengine` and installs in `installs.json`; is that final, or does a registry service come later?

## B. The 10-tenant ceiling: why 10, and what happens at 11?

5. Is 10 a hard technical limit (one process, one database, connection pool), a commercial tier, or a "we'll see" number?
6. In the 10-tenant model, does **each tenant get its own schema inside CEngine's home project**, or does each tenant's data live in **that tenant's own project**? Right now staging uses one schema per installation (`CE_SCHEMA`, default `ce_` + installation id) inside one project. Which is the target?
7. If tenants live in one project: can JobCorp's customer data ever sit in KpnSolute's project, or is the plan always "customer project for customer data"?
8. If tenants each have their own project: how does CEngine reach them at runtime — one `CE_DATABASE_URL` per process (one `ce-serve` per tenant, up to 10), or one process with a connection per tenant? (Today `ce-serve` takes one `CE_DATABASE_URL`.)

## C. CEngine's home project

9. Confirm: after the MJCC test schema is proven and wiped, **the CEngine home project itself remains and is not wiped**, correct? What stays in it permanently (installation registry, module catalog, plugin approvals, metering)?
10. Does "wipe" mean: drop schema `ce_mjcc_staging`, then recreate the same schema (or a fresh one) in **MJCCv1 `mgvyylvmkxhhataavqjz`** and run the migration there? Or recreate it in the Testing project and keep running MJCC there?
11. The final CEngine schema layout: is that something you want designed *before* Monday's work (so it is not reworked Wednesday), or is the week's build meant to discover it and the layout comes after acceptance? If before, do you want me to propose it as a design doc this evening?
12. Does CEngine's home project hold any customer data at all in production — including audit, notifications, jobs, or idempotency records?

## D. Authentication, users and staff

13. Who owns identity for the 10 tenants: Supabase Auth per customer project (as MJCCv1 does today with staff PINs + Supabase sessions), a central KpnSolute identity server, or the Platform?
14. In CEngine today, staff accounts live in `_ce_staff` inside the installation schema and CEngine issues its own JWT (`CE_JWT_KEY`). Is that the production model for all 10 tenants, or a staging convenience to be replaced by the Platform/Infajn?
15. Cross-tenant staff (a KpnSolute operator, a shared accountant) — do they get one login that can reach several tenants, or one account per tenant?

## E. Platform vs CEngine vs Persona vs Infajn, as of today

16. Which of these actually exist and run today: KpnSolute Platform, Persona, Infajn, Templates v1 registry? For each: URL or repo, if any.
17. For **this MJCC template specifically**, you said there is no Infajn. Does the AI service (ported from Compute, keys in the tenant project) count as a temporary connector to be replaced by Infajn for tenants 2–10, or as the permanent design for all tenants?
18. Where will the UI for the MJCC template live, and who builds it — `MJCC-workspace/ui` or the Platform? Does it authenticate against CEngine directly or through the Platform?

## F. Production path for MJCC specifically

19. Cutover: does the real system at go-live write into **MJCCv1 `mgvyylvmkxhhataavqjz`** (same project, new schema, old schema kept read-only for rollback), or into a **new JobCorp project**?
20. When is Compute retired for MJCC? Immediately after cutover, or does it stay up as a fallback for a defined window?
21. Files: the 45 archived MVCC files sit on the old "home archive" S3, not in Supabase. At cutover do they move into **MJCCv1's Supabase Storage**, into a JobCorp-owned bucket, or stay where they are and get referenced?

## G. People and process for this week

22. Who reviews and merges PRs on `KpnSolute/CEngine` and `KpnWorld/MJCC-workspace` this week? Is Claude merging to `main` directly, or does every PR need your approval?
23. Who is the "owner acceptance" person for Wednesday night — you, the food-service manager, or both?
24. Does the Wednesday deadline include the migration of **real** MJCC history into staging (read-only copy, totals reconciled), or only synthetic proof that the migration works?
25. If something slips, what drops first: the AI assistant pass, custom reports, the migration, or the scheduler?

## H. Anything my plan still gets wrong

26. Read §4c of `KpnSolute/CEngine/spec/mjcc-backend-complete-by-wednesday.md` (control DB vs tenant DB) and §4a (AI) and mark anything false. In particular: is "CEngine control-plane DB separate from tenant business DB" correct at 10 tenants, or is the real model "one CEngine project, one schema per tenant, customer projects only where the customer demands their own"?
