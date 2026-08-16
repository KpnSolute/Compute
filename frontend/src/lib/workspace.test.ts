import { beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveWorkspaceSlug,
  setActiveWorkspaceSlug,
  workspaceHeaders,
  workspaceSlugFromPath,
} from './workspace';

describe('workspace selection', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('uses the canonical workspace URL first', () => {
    window.history.replaceState(null, '', '/workspaces/acme');
    expect(workspaceSlugFromPath()).toBe('acme');
    expect(workspaceHeaders()).toEqual({ 'X-Kpn-Workspace': 'acme' });
  });

  it('stores a valid selection and updates the URL', () => {
    setActiveWorkspaceSlug('MJCC');
    expect(getActiveWorkspaceSlug()).toBe('mjcc');
    expect(window.location.pathname).toBe('/workspaces/mjcc');
  });

  it('rejects unsafe workspace slugs', () => {
    expect(() => setActiveWorkspaceSlug('../other')).toThrow('Invalid workspace slug');
  });
});
