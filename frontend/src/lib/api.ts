import { getBackendToken } from './supabase';

const BASE = (import.meta.env as Record<string, string>).VITE_API_BASE || 'http://localhost:8000';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getBackendToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Add Authorization header if token exists
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    console.debug('[API] Using backend token for request:', path);
  }

  const res = await fetch(BASE + path, {
    headers: { ...headers, ...opts?.headers },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export interface Commit {
  commit_id: string;
  message: string;
  author_id: string;
  author_name?: string;
  submitter_role?: string;
  status: string;
  branch: string;
  created_at: string;
  merged_at?: string;
  github_sha?: string | null;
  github_synced_at?: string | null;
  change_count: number;
}

export interface StagingEntry {
  entry_id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  old_value_text?: string | null;
  new_value_text?: string | null;
  change_type: string;
  metadata?: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  submitted_by: string;
  submitter_name?: string;
  submitter_role?: string;
  review_note?: string | null;
  created_at: string;
  expires_at?: string | null;
}

export type EntityType = 'inventory' | 'menu' | 'user' | 'compliance' | 'event' | 'ops';

export interface SubmitStagingBody {
  entity_type: EntityType;
  entity_id: string;
  field_name: string;
  old_value?: string;
  new_value: string;
  change_type: string;
  metadata?: Record<string, unknown>;
}

export interface ApproveCommitBody {
  staging_ids: string[];
  message: string;
  author_id: string;
}

export const api = {
  async getCommits(limit = 50, offset = 0): Promise<Commit[]> {
    return req(`/api/commits?limit=${limit}&offset=${offset}`);
  },

  async getStaging(entityType?: string): Promise<StagingEntry[]> {
    const q = entityType ? `?entity_type=${encodeURIComponent(entityType)}` : '';
    return req(`/api/staging${q}`);
  },

  async submitStaging(body: SubmitStagingBody): Promise<StagingEntry> {
    return req('/api/staging', { method: 'POST', body: JSON.stringify(body) });
  },

  async approveCommit(body: ApproveCommitBody): Promise<Commit> {
    return req('/api/commits', { method: 'POST', body: JSON.stringify(body) });
  },

  async rejectStaging(id: string, reviewNote?: string): Promise<void> {
    return req(`/api/staging/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ review_note: reviewNote }),
    });
  },

  async ping(): Promise<boolean> {
    try {
      await req('/health');
      return true;
    } catch {
      return false;
    }
  },
};
