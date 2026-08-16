import { beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveWorkspaceSlug,
  isLegacyWorkspacePath,
  setActiveWorkspaceSlug,
  workspaceHeaders,
  workspacePath,
  workspaceSlugFromPath,
} from './workspace';

describe('workspace selection', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('uses the canonical workspace URL first', () => {
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
