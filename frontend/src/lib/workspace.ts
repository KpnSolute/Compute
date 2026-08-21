export interface Workspace {
  id: string;
  slug: string;
  name: string;
  role: string;
  is_default?: boolean;
  brand_config?: Record<string, unknown>;
}

const ACTIVE_WORKSPACE_KEY = 'kpn_active_workspace';
const ACTIVE_TENANT_ID_KEY = 'kpn_active_tenant_id';

export const RESERVED_WORKSPACE_SLUGS = new Set([
  'api', 'app', 'auth', 'login', 'logout', 'signup', 'account', 'admin',
  'docs', 'pricing', 'templates', 'health', 'status', 'workspaces',
]);

function normalizedSlug(value: string | null | undefined): string | null {
  const slug = (value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) ? slug : null;
}

// Canonical standard-organization path is /{slug} under ADR-0007. The older
// /workspaces/{slug} form remains a compatibility route during migration.
export function workspaceSlugFromPath(pathname = window.location.pathname): string | null {
  const compatibility = pathname.match(/^\/workspaces\/([^/]+)(?:\/|$)/i);
  const direct = pathname.match(/^\/([^/]+)(?:\/|$)/i);
  const encoded = compatibility?.[1] || direct?.[1];
  const slug = normalizedSlug(encoded ? decodeURIComponent(encoded) : null);
  return slug && !RESERVED_WORKSPACE_SLUGS.has(slug) ? slug : null;
}

export function workspacePath(slug: string): string {
  const normalized = normalizedSlug(slug);
  if (!normalized || RESERVED_WORKSPACE_SLUGS.has(normalized)) {
    throw new Error('Invalid workspace slug');
  }
  return `/${encodeURIComponent(normalized)}`;
}

/** Tenant-branded staff sign-in. Never the generic /login. */
export function workspaceLoginPath(slug: string): string {
  return `${workspacePath(slug)}/login`;
}

export function isCanonicalWorkspacePath(pathname = window.location.pathname): boolean {
  if (/^\/workspaces(?:\/|$)/i.test(pathname)) return false;
  const direct = pathname.match(/^\/([^/]+)(?:\/|$)/i);
  const slug = normalizedSlug(direct?.[1] ? decodeURIComponent(direct[1]) : null);
  return Boolean(slug && !RESERVED_WORKSPACE_SLUGS.has(slug));
}

/**
 * True for the compatibility `/workspaces/{slug}` form, which redirects to
 * the canonical direct `/{slug}` path.
 */
export function isLegacyWorkspacePath(pathname = window.location.pathname): boolean {
  const compatibility = pathname.match(/^\/workspaces\/([^/]+)(?:\/|$)/i);
  const slug = normalizedSlug(
    compatibility?.[1] ? decodeURIComponent(compatibility[1]) : null,
  );
  return Boolean(slug && !RESERVED_WORKSPACE_SLUGS.has(slug));
}

export function workspaceCompatibilityRedirect(
  pathname: string,
  search = '',
  hash = '',
): string | null {
  if (!isLegacyWorkspacePath(pathname)) return null;
  const slug = workspaceSlugFromPath(pathname);
  if (!slug) return null;
  const suffix = pathname.replace(/^\/workspaces\/[^/]+/i, '');
  return `${workspacePath(slug)}${suffix}${search}${hash}`;
}

export function getActiveWorkspaceSlug(): string | null {
  const requestTenant = resolveTenantFromRequest();
  if (requestTenant) return requestTenant.slug;
  try {
    return normalizedSlug(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY));
  } catch {
    return null;
  }
}

export function setActiveWorkspaceSlug(slug: string, updatePath = true): void {
  const normalized = normalizedSlug(slug);
  if (!normalized || RESERVED_WORKSPACE_SLUGS.has(normalized)) throw new Error('Invalid workspace slug');
  try {
    sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, normalized);
    // A tenant id belongs to one exact resolved slug. Clear a stale immutable
    // id whenever callers switch by slug alone; the next authenticated response
    // will establish the new pair.
    sessionStorage.removeItem(ACTIVE_TENANT_ID_KEY);
  } catch {}
  if (updatePath && workspaceSlugFromPath() !== normalized) {
    const next = `${workspacePath(normalized)}${window.location.search}${window.location.hash}`;
    window.history.replaceState(null, '', next);
  }
  window.dispatchEvent(new CustomEvent('kpn:workspace-changed', { detail: { slug: normalized } }));
}

export function setActiveWorkspaceContext(
  slug: string,
  tenantId: string,
  updatePath = true,
): void {
  const normalized = normalizedSlug(slug);
  const immutableId = (tenantId || '').trim();
  if (!normalized || RESERVED_WORKSPACE_SLUGS.has(normalized)) throw new Error('Invalid workspace slug');
  if (!immutableId) throw new Error('Tenant id is required');
  setActiveWorkspaceSlug(normalized, updatePath);
  try { sessionStorage.setItem(ACTIVE_TENANT_ID_KEY, immutableId); } catch {}
}

export function workspaceHeaders(): Record<string, string> {
  const slug = getActiveWorkspaceSlug();
  if (!slug) return {};
  let tenantId = '';
  try { tenantId = sessionStorage.getItem(ACTIVE_TENANT_ID_KEY) || ''; } catch {}
  return {
    'X-Kpn-Workspace': slug,
    ...(tenantId ? { 'X-Kpn-Tenant-Id': tenantId } : {}),
  };
}

// --- Tenant class resolution -------------------------------------------------
// KpnCompute has two commercial tenant classes:
//   organization -> addressed by direct slug path, /{slug}
//   corporation  -> addressed by its own subdomain, {subdomain}.kpnsolute.com
//
// The canonical model lives in the Website monorepo at
// packages/contracts/src/tenancy.ts. Compute is a separate repository and
// cannot import it, so this is a deliberate mirror. Keep the reserved list and
// the label pattern in sync with that file and with
// Website/apps/gateway/src/index.mjs.

const ROOT_DOMAIN = 'kpnsolute.com';

const RESERVED_SUBDOMAINS = new Set([
  'accounts', 'api', 'auth', 'billing', 'compute', 'create', 'docs',
  'events', 'flow', 'link', 'lunchvoice', 'platform', 'scena', 'status',
  'support', 'tradora', 'workforce', 'www',
]);

const TENANT_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface ResolvedTenant {
  by: 'subdomain' | 'path';
  slug: string;
}

export type WorkspaceRouteSurface =
  | 'product'
  | 'tenant-entry'
  | 'tenant-login'
  | 'tenant-console'
  | 'tenant-operations';

/**
 * True when the hostname is a known cloud-provider origin (e.g. *.onrender.com)
 * that must not render tenant credentials and should redirect to the canonical
 * Compute origin.  Corporate subdomains, canonical hosts, localhost, and future
 * custom domains are never provider origins.
 */
export function isProviderOrigin(hostname: string): boolean {
  const host = (hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  if (host.endsWith('.onrender.com')) return true;
  if (host === 'onrender.com') return true;
  return false;
}

/**
 * Build the redirect target URL for a provider origin, preserving the original
 * path, query string, and fragment safely.
 */
export function providerOriginRedirectUrl(
  hostname: string,
  pathname: string,
  search = '',
  hash = '',
): string | null {
  if (!isProviderOrigin(hostname)) return null;
  const safePath = pathname.startsWith('/') ? pathname : '/';
  return `https://compute.kpnsolute.com${safePath}${search}${hash}`;
}

/** The corporate subdomain label for a host, or null when it is not one. */
export function corporateTenantLabel(hostname: string): string | null {
  const host = (hostname || '').trim().toLowerCase().replace(/\.$/, '');
  const suffix = `.${ROOT_DOMAIN}`;
  if (!host.endsWith(suffix)) return null;
  const label = host.slice(0, -suffix.length);
  if (!label || label.includes('.')) return null;
  if (!TENANT_LABEL.test(label)) return null;
  // A reserved label is a platform or product host, never a tenant.
  if (RESERVED_SUBDOMAINS.has(label)) return null;
  return label;
}

/** Hosts where organisation-path tenancy is allowed. */
const CANONICAL_HOSTS = new Set([
  'compute.kpnsolute.com',
  'localhost',
  '127.0.0.1',
]);

/**
 * Resolve which tenant a request addresses, from host and path together.
 * A corporate subdomain wins over a path slug: the host is the stronger claim.
 * Path-based tenancy is only resolved on canonical Compute hosts — provider
 * origins (e.g. *.onrender.com) must never render a tenant credential surface.
 */
export function resolveTenantFromRequest(
  hostname = window.location.hostname,
  pathname = window.location.pathname,
): ResolvedTenant | null {
  const corporate = corporateTenantLabel(hostname);
  if (corporate) return { by: 'subdomain', slug: corporate };
  if (!CANONICAL_HOSTS.has(hostname)) {
    // Non-canonical host: never resolve a tenant from the path.
    // Known provider origins should redirect to canonical; unknown hosts must
    // not render credential UI.
    return null;
  }
  const slug = workspaceSlugFromPath(pathname);
  return slug ? { by: 'path', slug } : null;
}

/** Return the path remaining after the resolved tenant entry point. */
export function tenantPathSuffix(
  tenant: ResolvedTenant,
  pathname = window.location.pathname,
): string {
  if (tenant.by === 'subdomain') return pathname === '/' ? '' : pathname;
  const compatibility = pathname.match(/^\/workspaces\/[^/]+(.*)$/i);
  if (compatibility) return compatibility[1] || '';
  const direct = pathname.match(/^\/[^/]+(.*)$/i);
  return direct?.[1] || '';
}

/**
 * Decide which surface a request may render after backend tenant resolution.
 * A syntactically valid path is not enough: until `verifiedTenantSlug` matches,
 * the route remains on the neutral product surface.
 */
export function workspaceRouteSurface(
  hostname: string,
  pathname: string,
  verifiedTenantSlug: string | null,
): WorkspaceRouteSurface {
  const tenant = resolveTenantFromRequest(hostname, pathname);
  if (!tenant || tenant.slug !== normalizedSlug(verifiedTenantSlug)) return 'product';
  const suffix = tenantPathSuffix(tenant, pathname);
  if (suffix === '/login' || suffix.startsWith('/login/')) return 'tenant-login';
  if (suffix === '/console' || suffix.startsWith('/console/')) return 'tenant-console';
  return suffix === '' || suffix === '/' ? 'tenant-entry' : 'tenant-operations';
}
