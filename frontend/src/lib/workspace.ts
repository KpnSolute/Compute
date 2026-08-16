export interface Workspace {
  id: string;
  slug: string;
  name: string;
  role: string;
  is_default?: boolean;
  brand_config?: Record<string, unknown>;
}

const ACTIVE_WORKSPACE_KEY = 'kpn_active_workspace';

export const RESERVED_WORKSPACE_SLUGS = new Set([
  'api', 'app', 'auth', 'login', 'logout', 'signup', 'account', 'admin',
  'docs', 'pricing', 'templates', 'health', 'status', 'workspaces',
]);

function normalizedSlug(value: string | null | undefined): string | null {
  const slug = (value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) ? slug : null;
}

export function workspaceSlugFromPath(pathname = window.location.pathname): string | null {
  const legacy = pathname.match(/^\/workspaces\/([^/]+)(?:\/|$)/i);
  const direct = pathname.match(/^\/([^/]+)(?:\/|$)/i);
  const encoded = legacy?.[1] || direct?.[1];
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

export function isLegacyWorkspacePath(pathname = window.location.pathname): boolean {
  return /^\/workspaces\/[^/]+(?:\/|$)/i.test(pathname);
}

export function getActiveWorkspaceSlug(): string | null {
  const pathSlug = workspaceSlugFromPath();
  if (pathSlug) return pathSlug;
  try {
    return normalizedSlug(sessionStorage.getItem(ACTIVE_WORKSPACE_KEY));
  } catch {
    return null;
  }
}

export function setActiveWorkspaceSlug(slug: string, updatePath = true): void {
  const normalized = normalizedSlug(slug);
  if (!normalized || RESERVED_WORKSPACE_SLUGS.has(normalized)) throw new Error('Invalid workspace slug');
  try { sessionStorage.setItem(ACTIVE_WORKSPACE_KEY, normalized); } catch {}
  if (updatePath && workspaceSlugFromPath() !== normalized) {
    const next = `${workspacePath(normalized)}${window.location.search}${window.location.hash}`;
    window.history.replaceState(null, '', next);
  }
  window.dispatchEvent(new CustomEvent('kpn:workspace-changed', { detail: { slug: normalized } }));
}

export function workspaceHeaders(): Record<string, string> {
  const slug = getActiveWorkspaceSlug();
  return slug ? { 'X-Kpn-Workspace': slug } : {};
}
