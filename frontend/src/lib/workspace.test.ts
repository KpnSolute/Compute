import { beforeEach, describe, expect, it } from 'vitest';
import { corporateTenantLabel, getActiveWorkspaceSlug, isCanonicalWorkspacePath, isLegacyWorkspacePath, isProviderOrigin, providerOriginRedirectUrl, resolveTenantFromRequest, setActiveWorkspaceContext, setActiveWorkspaceSlug, tenantPathSuffix, workspaceCompatibilityRedirect, workspaceHeaders, workspaceLoginPath, workspacePath, workspaceRouteSurface, workspaceSlugFromPath } from './workspace';

describe('workspace selection', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('uses the canonical direct workspace URL first', () => {
    window.history.replaceState(null, '', '/acme');
    expect(workspaceSlugFromPath()).toBe('acme');
    expect(workspaceHeaders()).toEqual({ 'X-Kpn-Workspace': 'acme' });
  });

  it('stores a valid selection and updates the URL', () => {
    setActiveWorkspaceSlug('MJCC');
    expect(getActiveWorkspaceSlug()).toBe('mjcc');
    expect(window.location.pathname).toBe('/mjcc');
  });

  it('accepts compatibility paths and rejects reserved product routes', () => {
    expect(workspaceSlugFromPath('/workspaces/mjcc/inventory')).toBe('mjcc');
    expect(workspaceSlugFromPath('/login')).toBeNull();
    expect(workspaceSlugFromPath('/api/health')).toBeNull();
    expect(workspacePath('MJCC')).toBe('/mjcc');
    expect(isLegacyWorkspacePath('/workspaces/mjcc')).toBe(true);
    expect(isLegacyWorkspacePath('/mjcc')).toBe(false);
    expect(() => workspacePath('admin')).toThrow('Invalid workspace slug');
  });

  it('rejects unsafe workspace slugs', () => {
    expect(() => setActiveWorkspaceSlug('../other')).toThrow('Invalid workspace slug');
    expect(() => setActiveWorkspaceSlug('login')).toThrow('Invalid workspace slug');
  });
});

// --- Canonical tenant routing (ADR-0007) -------------------------------------
// These assert the boundary the route registry defines: /{slug} is canonical,
// /workspaces/{slug} is a compatibility redirect, and reserved
// paths never resolve to a tenant.

describe('canonical workspace routing', () => {
  it('builds the canonical tenant path', () => {
    expect(workspacePath('mjcc')).toBe('/mjcc');
  });

  it('builds tenant-branded login beneath the tenant, never at generic /login', () => {
    expect(workspaceLoginPath('mjcc')).toBe('/mjcc/login');
    expect(workspaceLoginPath('mjcc')).not.toBe('/login');
  });

  it('resolves a slug from the canonical direct path', () => {
    expect(workspaceSlugFromPath('/mjcc')).toBe('mjcc');
    expect(workspaceSlugFromPath('/mjcc/console')).toBe('mjcc');
    expect(workspaceSlugFromPath('/mjcc/login')).toBe('mjcc');
  });

  it('carries the resolved immutable tenant id and clears it on a slug-only switch', () => {
    setActiveWorkspaceContext('mjcc', 'tenant-mjcc', false);
    expect(workspaceHeaders()).toEqual({
      'X-Kpn-Workspace': 'mjcc',
      'X-Kpn-Tenant-Id': 'tenant-mjcc',
    });
    setActiveWorkspaceSlug('acme', false);
    expect(workspaceHeaders()).toEqual({ 'X-Kpn-Workspace': 'acme' });
  });

  it('still resolves the prefixed compatibility form so redirects can work', () => {
    expect(workspaceSlugFromPath('/workspaces/mjcc')).toBe('mjcc');
    expect(workspaceSlugFromPath('/workspaces/mjcc/console')).toBe('mjcc');
    expect(
      workspaceCompatibilityRedirect(
        '/workspaces/mjcc/console',
        '?tab=health',
        '#display',
      ),
    ).toBe('/mjcc/console?tab=health#display');
  });

  it('treats the prefixed form as legacy and direct form as canonical', () => {
    expect(isLegacyWorkspacePath('/mjcc')).toBe(false);
    expect(isLegacyWorkspacePath('/workspaces/mjcc')).toBe(true);
    expect(isCanonicalWorkspacePath('/workspaces/mjcc')).toBe(false);
    expect(isCanonicalWorkspacePath('/mjcc')).toBe(true);
  });

  it('never treats a reserved path as a tenant needing redirect', () => {
    for (const reserved of ['/login', '/api', '/admin', '/docs', '/health', '/workspaces']) {
      expect(isLegacyWorkspacePath(reserved)).toBe(false);
      expect(workspaceSlugFromPath(reserved)).toBeNull();
    }
  });

  it('refuses to build a path for a reserved or malformed slug', () => {
    expect(() => workspacePath('login')).toThrow();
    expect(() => workspacePath('workspaces')).toThrow();
    expect(() => workspacePath('')).toThrow();
    expect(() => workspacePath('Bad Slug')).toThrow();
  });

  it('does not resolve the root path to a tenant', () => {
    expect(workspaceSlugFromPath('/')).toBeNull();
    expect(isLegacyWorkspacePath('/')).toBe(false);
  });
});

// --- Tenant class resolution -------------------------------------------------
// Mirrors Website/packages/contracts/src/tenancy.ts. Corporations are addressed
// by subdomain, organizations by slug path.

describe('tenant class resolution', () => {
  it('resolves a corporation from its subdomain', () => {
    expect(resolveTenantFromRequest('mjcc.kpnsolute.com', '/')).toEqual({
      by: 'subdomain',
      slug: 'mjcc',
    });
  });

  it('resolves an organization from the canonical direct slug path', () => {
    expect(resolveTenantFromRequest('compute.kpnsolute.com', '/acme')).toEqual({
      by: 'path',
      slug: 'acme',
    });
  });

  it('lets the corporate host win over a path slug', () => {
    expect(resolveTenantFromRequest('mjcc.kpnsolute.com', '/workspaces/acme')).toEqual({
      by: 'subdomain',
      slug: 'mjcc',
    });
  });

  it('never resolves a reserved platform host as a tenant', () => {
    for (const host of [
      'api.kpnsolute.com',
      'auth.kpnsolute.com',
      'compute.kpnsolute.com',
      'platform.kpnsolute.com',
      'workforce.kpnsolute.com',
      'www.kpnsolute.com',
    ]) {
      expect(corporateTenantLabel(host)).toBeNull();
    }
  });

  it('rejects malformed, nested, and foreign hosts', () => {
    expect(corporateTenantLabel('kpnsolute.com')).toBeNull();
    expect(corporateTenantLabel('a.b.kpnsolute.com')).toBeNull();
    expect(corporateTenantLabel('-bad.kpnsolute.com')).toBeNull();
    expect(corporateTenantLabel('evil.example.com')).toBeNull();
    expect(corporateTenantLabel('')).toBeNull();
  });

  it('returns null when neither host nor path identifies a tenant', () => {
    expect(resolveTenantFromRequest('compute.kpnsolute.com', '/')).toBeNull();
    expect(resolveTenantFromRequest('compute.kpnsolute.com', '/login')).toBeNull();
  });

  it('still resolves the prefixed compatibility path form', () => {
    expect(resolveTenantFromRequest('compute.kpnsolute.com', '/workspaces/mjcc')).toEqual({
      by: 'path',
      slug: 'mjcc',
    });
  });

  it('resolves path-based tenants on canonical hosts', () => {
    expect(resolveTenantFromRequest('compute.kpnsolute.com', '/acme')).toEqual({
      by: 'path',
      slug: 'acme',
    });
    expect(resolveTenantFromRequest('localhost', '/acme')).toEqual({
      by: 'path',
      slug: 'acme',
    });
    expect(resolveTenantFromRequest('127.0.0.1', '/acme')).toEqual({
      by: 'path',
      slug: 'acme',
    });
  });

  it('returns null on non-canonical hosts even with a valid path slug', () => {
    expect(resolveTenantFromRequest('kpncompute.onrender.com', '/mjcc')).toBeNull();
    expect(resolveTenantFromRequest('myapp.onrender.com', '/acme/login')).toBeNull();
    expect(resolveTenantFromRequest('random-host.example.com', '/acme')).toBeNull();
  });

  it('still resolves corporate subdomains on any host', () => {
    expect(resolveTenantFromRequest('mjcc.kpnsolute.com', '/anything')).toEqual({
      by: 'subdomain',
      slug: 'mjcc',
    });
    expect(resolveTenantFromRequest('mjcc.kpnsolute.com', '/')).toEqual({
      by: 'subdomain',
      slug: 'mjcc',
    });
  });
});

// Regression: an unmatched path must never be treated as a confirmed tenant in
// a way that produces a branded credential prompt. Browser verification caught
// this; see Website/docs/ROUTE_E2E_RESULTS.md.
describe('unmatched path safety', () => {
  it('never resolves a reserved route to a tenant', () => {
    for (const p of ['/login', '/api/health', '/docs', '/admin', '/workspaces']) {
      expect(resolveTenantFromRequest('compute.kpnsolute.com', p)).toBeNull();
    }
  });

  it('builds a tenant login path beneath the canonical direct tenant path', () => {
    expect(workspaceLoginPath('mjcc')).toBe('/mjcc/login');
  });

  it('computes suffixes for direct, compatibility, and corporate routes', () => {
    expect(tenantPathSuffix({ by: 'path', slug: 'acme' }, '/acme/login')).toBe('/login');
    expect(tenantPathSuffix({ by: 'path', slug: 'acme' }, '/workspaces/acme/console')).toBe('/console');
    expect(tenantPathSuffix({ by: 'subdomain', slug: 'mjcc' }, '/login')).toBe('/login');
    expect(tenantPathSuffix({ by: 'subdomain', slug: 'mjcc' }, '/')).toBe('');
  });

  it('covers product root, generic login, corporate login, org routes, and unknown routes', () => {
    expect(workspaceRouteSurface('compute.kpnsolute.com', '/', null)).toBe('product');
    expect(workspaceRouteSurface('compute.kpnsolute.com', '/login', null)).toBe('product');
    expect(workspaceRouteSurface('mjcc.kpnsolute.com', '/', 'mjcc')).toBe('tenant-entry');
    expect(workspaceRouteSurface('mjcc.kpnsolute.com', '/login', 'mjcc')).toBe('tenant-login');
    expect(workspaceRouteSurface('compute.kpnsolute.com', '/acme', 'acme')).toBe('tenant-entry');
    expect(workspaceRouteSurface('compute.kpnsolute.com', '/acme/console', 'acme')).toBe('tenant-console');
    expect(workspaceRouteSurface('compute.kpnsolute.com', '/unknown', null)).toBe('product');
    expect(workspaceRouteSurface('compute.kpnsolute.com', '/unknown/login', null)).toBe('product');
  });
});

// --- Provider-origin redirect ------------------------------------------------
// Only known cloud-provider origins (*.onrender.com) redirect to the canonical
// Compute origin. Corporate subdomains and future custom domains are never
// redirected.

describe('provider origin redirect', () => {
  it('identifies Render provider origins', () => {
    expect(isProviderOrigin('kpncompute.onrender.com')).toBe(true);
    expect(isProviderOrigin('mjcc-app.onrender.com')).toBe(true);
    expect(isProviderOrigin('onrender.com')).toBe(true);
    expect(isProviderOrigin('some-random-service.onrender.com')).toBe(true);
  });

  it('does not identify corporate subdomains as provider origins', () => {
    expect(isProviderOrigin('mjcc.kpnsolute.com')).toBe(false);
    expect(isProviderOrigin('acme.kpnsolute.com')).toBe(false);
  });

  it('does not identify canonical hosts as provider origins', () => {
    expect(isProviderOrigin('compute.kpnsolute.com')).toBe(false);
    expect(isProviderOrigin('localhost')).toBe(false);
    expect(isProviderOrigin('127.0.0.1')).toBe(false);
  });

  it('does not identify unknown hosts as provider origins', () => {
    expect(isProviderOrigin('custom-domain.com')).toBe(false);
    expect(isProviderOrigin('myapp.vercel.app')).toBe(false);
    expect(isProviderOrigin('')).toBe(false);
  });

  it('builds a safe redirect URL from a provider origin', () => {
    expect(providerOriginRedirectUrl('kpncompute.onrender.com', '/mjcc/login', '?tab=1', '#s1')).toBe(
      'https://compute.kpnsolute.com/mjcc/login?tab=1#s1',
    );
  });

  it('preserves root path for provider origin redirect', () => {
    expect(providerOriginRedirectUrl('kpncompute.onrender.com', '/', '', '')).toBe(
      'https://compute.kpnsolute.com/',
    );
  });

  it('returns null for non-provider origins', () => {
    expect(providerOriginRedirectUrl('mjcc.kpnsolute.com', '/login', '', '')).toBeNull();
    expect(providerOriginRedirectUrl('compute.kpnsolute.com', '/acme', '', '')).toBeNull();
    expect(providerOriginRedirectUrl('localhost', '/acme', '', '')).toBeNull();
    expect(providerOriginRedirectUrl('custom-domain.com', '/', '', '')).toBeNull();
  });

  it('still resolves corporate subdomains on canonical hosts (not redirected)', () => {
    // mjcc.kpnsolute.com should resolve a tenant, not redirect
    expect(resolveTenantFromRequest('mjcc.kpnsolute.com', '/')).toEqual({
      by: 'subdomain',
      slug: 'mjcc',
    });
    // kpncompute.onrender.com should not resolve a tenant (provider origin)
    expect(resolveTenantFromRequest('kpncompute.onrender.com', '/mjcc')).toBeNull();
  });
});
