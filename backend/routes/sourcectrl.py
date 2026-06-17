import os
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import create_client
from dotenv import load_dotenv
from typing import Optional
from backend.staging.dispatch import replay
from backend.routes._deps import _get_auth_user, _require_admin_or_manager

load_dotenv(Path(__file__).resolve().parents[2] / '.env')

router = APIRouter(prefix='/api')

_svc = None


def _client():
    global _svc
    if _svc is None:
        url = os.getenv('SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_KEY')
        if not url or not key:
            raise RuntimeError('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.')
        _svc = create_client(url, key)
    return _svc


ENTITY_TYPES = {'inventory', 'menu', 'user', 'compliance', 'event', 'ops'}


# ── models ──────────────────────────────────────────────────────────────────


class SubmitStagingBody(BaseModel):
    entity_type: str
    entity_id: str
    field_name: str
    old_value: Optional[str] = None
    new_value: str = ''
    change_type: str
    metadata: Optional[dict] = None
    summary: Optional[str] = None
    operation: Optional[str] = None
    full_payload: Optional[dict] = None


class ApproveCommitBody(BaseModel):
    staging_ids: list[str]
    message: str
    author_id: str


class OpenPRBody(BaseModel):
    title: str
    description: Optional[str] = None
    entry_ids: Optional[list[str]] = None


class ClosePRBody(BaseModel):
    note: Optional[str] = None


# ── core replay→commit helper ─────────────────────────────────────────────────


def _apply_entries(
    entries: list[dict],
    author_id: str,
    message: str,
    source: str,
    pr_id: Optional[str] = None,
) -> dict:
    """Replay entries, create commit for the applied subset, return result dict.

    Partition behavior (preserved from original approve_commit):
    - Replay ALL entries first, then split applied vs failed.
    - If nothing applied → raise HTTPException(500), leave all entries pending.
    - Else create commit (with optional pull_request_id), insert commit_changes for
      applied entries only, mark applied entries merged, leave failed pending with a
      retry review_note, enqueue push_archive_snapshot.
    Returns {**commit_row, change_count, replayed, applied, failed[]}.
    """
    now = datetime.now(timezone.utc).isoformat()

    # 1 — replay all operations; _override_published=True because callers are always managers/admins
    replay_results = []
    for entry in entries:
        op = entry.get('operation')
        fp = entry.get('full_payload')
        if op and fp:
            extra = {'_staging_entry_id': entry['entry_id'], '_override_published': True}
            result = replay(op, {**fp, **extra})
            replay_results.append({'entry_id': entry['entry_id'], 'operation': op, 'result': result})

    # 2 — partition
    applied_results = [r for r in replay_results if not r['result'].get('error')]
    failed_results = [r for r in replay_results if r['result'].get('error')]

    if not applied_results and failed_results:
        detail = '; '.join(f"{r['operation']}: {r['result']['error']}" for r in failed_results)
        raise HTTPException(
            status_code=500,
            detail=f'All replay operations failed (no commit created): {detail}',
        )

    applied_entry_ids = [r['entry_id'] for r in applied_results]
    applied_entries = [e for e in entries if e['entry_id'] in set(applied_entry_ids)]

    # 3 — create commit row for the applied subset
    commit_row: dict = {
        'message': message,
        'author_id': author_id,
        'status': 'merged',
        'branch': 'main',
        'merged_at': now,
        'merged_by': author_id,
        'source': source,
    }
    if pr_id:
        commit_row['pull_request_id'] = pr_id

    commit_r = _client().table('commits').insert(commit_row).execute()
    if not commit_r.data:
        raise HTTPException(status_code=500, detail='Failed to create commit.')
    commit = commit_r.data[0]
    commit_id = commit['commit_id']

    # 4 — commit_changes for applied only
    changes = []
    for entry in applied_entries:
        changes.append({
            'commit_id': commit_id,
            'entity_type': entry.get('entity_type', 'inventory'),
            'entity_id': entry.get('entity_id', ''),
            'field_name': entry.get('field_name', ''),
            'old_value_text': entry.get('old_value_text'),
            'new_value_text': entry.get('new_value_text'),
            'change_type': entry.get('change_type', 'update'),
            'metadata': entry.get('metadata', {}),
        })
    if changes:
        _client().table('commit_changes').insert(changes).execute()

    # 5 — mark applied merged; leave failed pending with retry note
    if applied_entry_ids:
        _client().table('staging_entries').update({
            'status': 'merged',
            'reviewed_by': author_id,
            'reviewed_at': now,
        }).in_('entry_id', applied_entry_ids).execute()

    for r in failed_results:
        err_msg = r['result'].get('error', 'Replay error')
        _client().table('staging_entries').update({
            'review_note': f'Replay error (left pending for retry): {err_msg}',
        }).eq('entry_id', r['entry_id']).execute()

    # 6 — enqueue github sync
    # NOTE: github_sync_queue_operation_check permits push_archive_snapshot, not push_snapshot.
    _client().table('github_sync_queue').insert({
        'operation': 'push_archive_snapshot',
        'payload': {'commit_id': commit_id, 'message': message, 'change_count': len(changes)},
        'commit_id': commit_id,
        'attempts': 0,
    }).execute()

    failed_summary = [
        {'entry_id': r['entry_id'], 'operation': r['operation'], 'error': r['result'].get('error')}
        for r in failed_results
    ]
    return {
        **commit,
        'change_count': len(changes),
        'replayed': len(applied_results),
        'applied': len(applied_results),
        'failed': failed_summary,
    }


# ── routes ───────────────────────────────────────────────────────────────────


@router.get('/commits')
async def get_commits(
    limit: int = 50, offset: int = 0, auth_user: dict = Depends(_get_auth_user)
):
    try:
        commits_r = (
            _client()
            .table('commits')
            .select(
                'commit_id,message,author_id,status,branch,created_at,merged_at,'
                'github_sha,github_synced_at,pull_request_id'
            )
            .order('created_at', desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        if not commits_r.data:
            return []

        commit_ids = [c['commit_id'] for c in commits_r.data]
        counts_r = (
            _client()
            .table('commit_changes')
            .select('commit_id')
            .in_('commit_id', commit_ids)
            .execute()
        )
        count_map: dict[str, int] = {}
        for row in counts_r.data or []:
            count_map[row['commit_id']] = count_map.get(row['commit_id'], 0) + 1

        author_ids = list({c['author_id'] for c in commits_r.data if c.get('author_id')})
        profiles_r = (
            _client()
            .table('user_profiles')
            .select('id,username,display_name,role')
            .in_('id', author_ids)
            .execute()
        )
        profile_map = {p['id']: p for p in (profiles_r.data or [])}

        # Enrich with PR number/title for commits back-linked to a pull request
        pr_ids = [c['pull_request_id'] for c in commits_r.data if c.get('pull_request_id')]
        pr_map: dict[str, dict] = {}
        if pr_ids:
            prs_r = (
                _client()
                .table('pull_requests')
                .select('pr_id,pr_number,title')
                .in_('pr_id', pr_ids)
                .execute()
            )
            for pr in prs_r.data or []:
                pr_map[pr['pr_id']] = pr

        result = []
        for c in commits_r.data:
            profile = profile_map.get(c['author_id'], {})
            pr = pr_map.get(c.get('pull_request_id') or '')
            result.append({
                **c,
                'change_count': count_map.get(c['commit_id'], 0),
                'author_name': profile.get('display_name') or profile.get('username') or c['author_id'],
                'submitter_role': profile.get('role'),
                'pr_number': pr['pr_number'] if pr else None,
                'pr_title': pr['title'] if pr else None,
            })
        result.sort(
            key=lambda c: (c.get('github_synced_at') or c.get('merged_at') or c.get('created_at') or ''),
            reverse=True,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/staging')
async def get_staging(
    entity_type: Optional[str] = None, auth_user: dict = Depends(_get_auth_user)
):
    try:
        q = (
            _client()
            .table('staging_entries')
            .select(
                'entry_id,entity_type,entity_id,field_name,old_value_text,new_value_text,'
                'change_type,metadata,status,submitted_by,review_note,created_at,expires_at,'
                'operation,full_payload,pull_request_id'
            )
            .eq('status', 'pending')
        )
        if entity_type:
            q = q.eq('entity_type', entity_type)
        # Staff only see their own pending entries; managers/admins see all
        role = (auth_user.get('role') or '').lower()
        if role not in ('admin', 'manager', 'sudo'):
            q = q.eq('submitted_by', auth_user['id'])
        r = q.order('created_at', desc=True).execute()

        if not r.data:
            return []

        author_ids = list({row['submitted_by'] for row in r.data if row.get('submitted_by')})
        profiles_r = (
            _client()
            .table('user_profiles')
            .select('id,username,display_name,role')
            .in_('id', author_ids)
            .execute()
        )
        profile_map = {p['id']: p for p in (profiles_r.data or [])}

        result = []
        for row in r.data:
            profile = profile_map.get(row['submitted_by'], {})
            result.append({
                **row,
                'submitter_name': profile.get('display_name') or profile.get('username') or row['submitted_by'],
                'submitter_role': profile.get('role'),
            })
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/staging', status_code=201)
async def submit_staging(
    body: SubmitStagingBody, auth_user: dict = Depends(_get_auth_user)
):
    if body.entity_type not in ENTITY_TYPES:
        raise HTTPException(
            status_code=422, detail=f'entity_type must be one of {sorted(ENTITY_TYPES)}'
        )
    try:
        caller_role = (auth_user.get('role') or '').lower()
        if caller_role not in ('admin', 'manager', 'sudo'):
            if body.operation in ('inventory_save', 'inventory_week_update') and body.full_payload:
                inv_month = (body.full_payload or {}).get('month')
                inv_year = (body.full_payload or {}).get('year')
                if inv_month and inv_year:
                    db_month = max(0, int(inv_month) - 1)
                    ms_r = (
                        _client()
                        .table('month_status')
                        .select('status')
                        .eq('month', db_month)
                        .eq('year', int(inv_year))
                        .limit(1)
                        .execute()
                    )
                    ms_row = (ms_r.data or [None])[0]
                    if ms_row and ms_row.get('status') == 'published':
                        raise HTTPException(
                            status_code=403,
                            detail=f'Period {inv_month}/{inv_year} is published and cannot be modified.',
                        )

        # Dedup: update existing pending entry rather than stacking duplicates
        existing_r = (
            _client()
            .table('staging_entries')
            .select('entry_id')
            .eq('entity_id', body.entity_id)
            .eq('field_name', body.field_name)
            .eq('submitted_by', auth_user['id'])
            .eq('status', 'pending')
            .limit(1)
            .execute()
        )
        if existing_r.data:
            entry_id = existing_r.data[0]['entry_id']
            update_fields = {
                'old_value_text': body.old_value,
                'new_value_text': body.new_value,
                'metadata': body.metadata or {},
                'operation': body.operation,
                'full_payload': body.full_payload,
            }
            r = _client().table('staging_entries').update(update_fields).eq('entry_id', entry_id).execute()
            if not r.data:
                raise HTTPException(status_code=500, detail='Dedup update returned no data.')
            return r.data[0]

        row = {
            'entity_type': body.entity_type,
            'entity_id': body.entity_id,
            'field_name': body.field_name,
            'old_value_text': body.old_value,
            'new_value_text': body.new_value,
            'change_type': body.change_type,
            'metadata': body.metadata or {},
            'status': 'pending',
            'submitted_by': auth_user['id'],
            'source': 'dashboard',
            'operation': body.operation,
            'full_payload': body.full_payload,
        }
        r = _client().table('staging_entries').insert(row).execute()
        if not r.data:
            raise HTTPException(status_code=500, detail='Insert returned no data.')
        return r.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/commits', status_code=201)
async def approve_commit(
    body: ApproveCommitBody,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Backward-compatible direct commit endpoint. Delegates to _apply_entries."""
    if not body.staging_ids:
        raise HTTPException(status_code=422, detail='staging_ids must not be empty.')
    try:
        staging_r = (
            _client()
            .table('staging_entries')
            .select('*')
            .in_('entry_id', body.staging_ids)
            .execute()
        )
        entries = staging_r.data or []
        return _apply_entries(
            entries,
            author_id=auth_user['id'],
            message=body.message,
            source='dashboard',
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete('/staging/{entry_id}', status_code=204)
async def reject_staging(
    entry_id: str,
    review_note: Optional[str] = None,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    try:
        now = datetime.now(timezone.utc).isoformat()
        r = (
            _client()
            .table('staging_entries')
            .update({
                'status': 'rejected',
                'review_note': review_note,
                'reviewed_by': auth_user['id'],
                'reviewed_at': now,
            })
            .eq('entry_id', entry_id)
            .eq('status', 'pending')
            .execute()
        )
        if not r.data:
            raise HTTPException(status_code=404, detail='Staging entry not found or already processed.')
        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── pull request routes ───────────────────────────────────────────────────────


@router.post('/pulls', status_code=201)
async def open_pull_request(
    body: OpenPRBody,
    auth_user: dict = Depends(_get_auth_user),
):
    """Open a PR from the caller's pending entries. Any signed-in user (lvl ≥ 10)."""
    try:
        entry_ids = list(body.entry_ids or [])
        if not entry_ids:
            # Default: all caller's own pending, unlinked entries
            r = (
                _client()
                .table('staging_entries')
                .select('entry_id')
                .eq('submitted_by', auth_user['id'])
                .eq('status', 'pending')
                .is_('pull_request_id', 'null')
                .execute()
            )
            entry_ids = [row['entry_id'] for row in (r.data or [])]

        if not entry_ids:
            raise HTTPException(status_code=422, detail='No pending entries to include in pull request.')

        result = _client().rpc('sc_open_pull_request', {
            'p_author': auth_user['id'],
            'p_title': body.title,
            'p_description': body.description or '',
            'p_entry_ids': entry_ids,
        }).execute()

        pr = result.data if isinstance(result.data, dict) else (result.data[0] if result.data else None)
        if not pr:
            raise HTTPException(status_code=500, detail='Failed to create pull request.')
        return pr
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/pulls')
async def list_pull_requests(
    status: str = 'open',
    limit: int = 50,
    offset: int = 0,
    auth_user: dict = Depends(_get_auth_user),
):
    """List PRs scoped by role (mirrors get_staging). Pass status='all' for no status filter."""
    try:
        q = (
            _client()
            .table('pull_requests')
            .select('*')
            .order('created_at', desc=True)
            .range(offset, offset + limit - 1)
        )
        if status and status != 'all':
            q = q.eq('status', status)

        role = (auth_user.get('role') or '').lower()
        if role not in ('admin', 'manager', 'sudo'):
            q = q.eq('author_id', auth_user['id'])

        r = q.execute()
        prs = r.data or []
        if not prs:
            return []

        author_ids = list({pr['author_id'] for pr in prs if pr.get('author_id')})
        profiles_r = (
            _client()
            .table('user_profiles')
            .select('id,username,display_name,role')
            .in_('id', author_ids)
            .execute()
        )
        profile_map = {p['id']: p for p in (profiles_r.data or [])}

        pr_ids = [pr['pr_id'] for pr in prs]
        counts_r = (
            _client()
            .table('staging_entries')
            .select('pull_request_id')
            .in_('pull_request_id', pr_ids)
            .execute()
        )
        count_map: dict[str, int] = {}
        for row in counts_r.data or []:
            pid = row['pull_request_id']
            count_map[pid] = count_map.get(pid, 0) + 1

        result = []
        for pr in prs:
            profile = profile_map.get(pr['author_id'], {})
            result.append({
                **pr,
                'author_name': profile.get('display_name') or profile.get('username') or pr['author_id'],
                'submitter_role': profile.get('role'),
                'entry_count': count_map.get(pr['pr_id'], 0),
            })
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get('/pulls/{pr_id}')
async def get_pull_request(
    pr_id: str,
    auth_user: dict = Depends(_get_auth_user),
):
    """PR detail: PR row + linked staging entries + linked commit. Staff may only fetch their own."""
    try:
        pr_r = _client().table('pull_requests').select('*').eq('pr_id', pr_id).limit(1).execute()
        if not pr_r.data:
            raise HTTPException(status_code=404, detail='Pull request not found.')
        pr = dict(pr_r.data[0])

        role = (auth_user.get('role') or '').lower()
        if role not in ('admin', 'manager', 'sudo') and pr.get('author_id') != auth_user['id']:
            raise HTTPException(status_code=403, detail='Access denied.')

        entries_r = (
            _client()
            .table('staging_entries')
            .select('*')
            .eq('pull_request_id', pr_id)
            .execute()
        )
        entries = entries_r.data or []

        commit = None
        if pr.get('commit_id'):
            c_r = _client().table('commits').select('*').eq('commit_id', pr['commit_id']).limit(1).execute()
            commit = (c_r.data or [None])[0]

        if pr.get('author_id'):
            p_r = (
                _client()
                .table('user_profiles')
                .select('id,username,display_name,role')
                .eq('id', pr['author_id'])
                .limit(1)
                .execute()
            )
            p = (p_r.data or [{}])[0]
            pr['author_name'] = p.get('display_name') or p.get('username') or pr['author_id']
            pr['submitter_role'] = p.get('role')

        return {'pr': pr, 'entries': entries, 'commit': commit}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/pulls/{pr_id}/merge')
async def merge_pull_request(
    pr_id: str,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Merge a PR: replay its pending entries → commit → finalize PR. Admin/manager/sudo only."""
    try:
        pr_r = _client().table('pull_requests').select('*').eq('pr_id', pr_id).limit(1).execute()
        if not pr_r.data:
            raise HTTPException(status_code=404, detail='Pull request not found.')
        pr = pr_r.data[0]

        if pr.get('status') not in ('open', 'merged'):
            raise HTTPException(status_code=409, detail=f"Pull request is {pr.get('status')} — cannot merge.")

        # Only pending entries; idempotent — re-merge only replays what's still pending
        entries_r = (
            _client()
            .table('staging_entries')
            .select('*')
            .eq('pull_request_id', pr_id)
            .eq('status', 'pending')
            .execute()
        )
        entries = entries_r.data or []
        if not entries:
            raise HTTPException(status_code=422, detail='No pending entries to merge.')

        result = _apply_entries(
            entries,
            author_id=pr['author_id'],
            message=pr['title'],
            source='pull_request',
            pr_id=pr_id,
        )

        _client().rpc('sc_finalize_merge', {
            'p_pr': pr_id,
            'p_commit': result['commit_id'],
            'p_merged_by': auth_user['id'],
        }).execute()

        updated_pr_r = _client().table('pull_requests').select('*').eq('pr_id', pr_id).limit(1).execute()
        updated_pr = (updated_pr_r.data or [pr])[0]
        return {**result, 'pr': updated_pr}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post('/pulls/{pr_id}/close')
async def close_pull_request(
    pr_id: str,
    body: ClosePRBody = ClosePRBody(),
    auth_user: dict = Depends(_get_auth_user),
):
    """Close a PR. Admin/manager/sudo or the PR's own author."""
    try:
        pr_r = _client().table('pull_requests').select('*').eq('pr_id', pr_id).limit(1).execute()
        if not pr_r.data:
            raise HTTPException(status_code=404, detail='Pull request not found.')
        pr = pr_r.data[0]

        role = (auth_user.get('role') or '').lower()
        if role not in ('admin', 'manager', 'sudo') and pr.get('author_id') != auth_user['id']:
            raise HTTPException(status_code=403, detail='Only the PR author or an admin/manager can close this PR.')

        if pr.get('status') not in ('open', 'draft'):
            raise HTTPException(status_code=409, detail=f"Pull request is {pr.get('status')} — cannot close.")

        _client().rpc('sc_close_pull_request', {
            'p_pr': pr_id,
            'p_closed_by': auth_user['id'],
            'p_note': body.note or '',
        }).execute()

        updated_pr_r = _client().table('pull_requests').select('*').eq('pr_id', pr_id).limit(1).execute()
        return (updated_pr_r.data or [pr])[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
