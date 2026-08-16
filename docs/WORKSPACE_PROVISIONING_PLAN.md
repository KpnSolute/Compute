# Workspace, project, and SOP provisioning plan

This is the next KpnCompute product layer. It is planned here; it is not yet a
deployed capability.

## Product contract

KpnCompute creates a company workspace, stores one or more projects inside it,
and turns user-owned SOPs into a reviewable project blueprint. AI may propose
configuration, workflows, roles, data models, integrations, and deployment
steps. A human must approve a versioned blueprint before provisioning begins.

MJCC is the first source system and template candidate, not the universal data
model. Private customer files and values never enter the template gallery.
Only a reviewed, sanitized, generalized template version may be promoted.

## Foundation data model

- `workspace_projects` and `tenant_tree_nodes`: project identity and an
  automatically-created logical tree for documents, SOPs, source, generated
  output, data, and archives.
- `project_artifacts` and `project_source_documents`: private object reference,
  checksum, media type, lifecycle status, retention, immutable SOP versions,
  and uploader provenance.
- `project_generation_runs`, `generation_run_sources`, and
  `project_blueprint_versions`: model/policy identity, immutable source
  manifests, validation findings, and human review evidence.
- `provisioning_jobs` and `provisioning_steps`: idempotent execution state,
  dependencies, logs, rollback state, and produced resource references.
- `template_catalog` and `template_versions`: public/private visibility,
  sanitization evidence, compatibility contract, and source lineage without
  customer content.

These foundation tables are implemented by migration. Their API workflow is
not yet exposed. Every row is workspace-scoped unless it is an explicitly
public template.

## Proposed API workflow

1. `POST /api/v1/workspaces` creates a provisioning request with an
   `Idempotency-Key`; it does not synchronously create infrastructure.
2. `POST /api/v1/workspaces/{workspace}/projects` creates a draft project from
   an empty blueprint or a permitted template version.
3. `POST /api/v1/projects/{project}/documents:prepare-upload` returns a short
   lived, size/type-limited upload target.
4. `POST /api/v1/projects/{project}/generation-runs` freezes the selected source
   document versions and queues blueprint generation.
5. `GET /api/v1/generation-runs/{run}` and an event stream expose progress,
   validation findings, and generated blueprint versions.
6. `POST /api/v1/blueprints/{version}:approve` records a human decision and
   policy checks. Approval is required before the next endpoint works.
7. `POST /api/v1/projects/{project}:provision` starts an idempotent job from the
   approved immutable blueprint.
8. `POST /api/v1/template-versions/{version}:submit` begins a separate privacy,
   security, and generalization review before gallery publication.

## Required controls

- Organization-level authorization, idempotency, quotas, cancellation, and a
  complete audit trail on every state transition.
- File allowlists, size limits, malware scanning, encryption, retention,
  export, and deletion.
- Prompt-injection resistance: uploaded SOP text is untrusted data and cannot
  redefine system policy or authorize tools.
- Generated output is declarative and schema-validated. It cannot directly run
  arbitrary privileged code or create infrastructure before approval.
- Template promotion includes automated secret/PII detection plus a named
  human reviewer. Gallery consumers receive a versioned compatibility contract.
- Provisioning uses a queue/state machine with compensating rollback, not one
  long HTTP request.

## Planning decisions still required

- Which project resource types V1 may provision.
- Supported file types, size/retention limits, and geographic data residency.
- Approval roles and whether enterprise customers require two-person approval.
- Template ownership, licensing, revenue sharing, and private-gallery policy.
- Model providers, tenant-level AI controls, budget limits, and opt-out policy.
- Billing meter: workspace, project, seat, generation, provisioned resources,
  or a documented combination.
