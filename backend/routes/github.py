import logging

from flask import Blueprint, request

from backend.rbac import require_manager
from backend.response import api_response, error_response

logger = logging.getLogger(__name__)

github_bp = Blueprint('github', __name__, url_prefix='/api/github')


@github_bp.get('/status')
@require_manager
def status():
    """
    Returns GitHub sync status — connected, pending count, last sync.
    Used by the source control page to show the sync banner.
    """
    try:
        from backend.github_sync import get_status
        return api_response(get_status())
    except Exception as e:
        logger.exception(f'Error in github status: {e}')
        return error_response('Internal server error', status_code=500)


@github_bp.post('/sync')
@require_manager
def manual_sync():
    """
    Force a full inventory snapshot push for a given month/year.
    Used from the source control connectors page.
    """
    try:
        from backend.github_sync import push_inventory_snapshot
        from backend.supabase_client import get_client

        data  = request.get_json(silent=True) or {}
        month = data.get('month')
        year  = data.get('year')

        if month is None or year is None:
            return error_response('month and year required', status_code=400)

        db       = get_client()
        inv_resp = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year).execute()
        inv_raw  = inv_resp.data or []

        inv_data: dict = {}
        for item in inv_raw:
            cat = item.get('category', 'Uncategorized')
            if cat not in inv_data:
                inv_data[cat] = []
            inv_data[cat].append({
                'sku':    item.get('sku', ''),
                'desc':   item.get('description', ''),
                'price':  float(item.get('unit_price') or 0),
                'onHand': float(item.get('on_hand') or 0),
                'par':    float(item.get('par_level') or 0),
                'w1r': float(item.get('w1_received') or 0),
                'w2r': float(item.get('w2_received') or 0),
                'w3r': float(item.get('w3_received') or 0),
                'w4r': float(item.get('w4_received') or 0),
                'w1i': float(item.get('w1_issued') or 0),
                'w2i': float(item.get('w2_issued') or 0),
                'w3i': float(item.get('w3_issued') or 0),
                'w4i': float(item.get('w4_issued') or 0),
            })

        user   = request.current_user
        author = user.get('display_name') or user.get('username', 'MJCC')
        sha    = push_inventory_snapshot(
            month, year, inv_data,
            commit_id=None,
            author_name=author,
            message=f'manual sync: {month + 1}/{year}',
        )

        return api_response({'synced': True, 'sha': sha, 'items': len(inv_raw)})

    except Exception as e:
        from backend.github_sync import GitHubDownError
        if isinstance(e, GitHubDownError):
            return error_response('GitHub is currently unreachable', status_code=503)
        logger.exception(f'Error in github manual sync: {e}')
        return error_response('Internal server error', status_code=500)


@github_bp.get('/files')
@require_manager
def list_files():
    """
    List files in a directory of the data store repo.
    Used by the archives pages to browse historical files.
    Query param: path (e.g. data/archives/snapshots)
    """
    try:
        from backend.github_sync import list_files as _list

        path = request.args.get('path', 'data')
        files = _list(path)
        # Filter out .gitkeep
        files = [f for f in files if not f['name'].endswith('.gitkeep')]
        return api_response(files)
    except Exception as e:
        logger.exception(f'Error listing GitHub files: {e}')
        return error_response('Internal server error', status_code=500)


@github_bp.get('/file')
@require_manager
def get_file():
    """
    Get the content of a specific file in the data store repo.
    Used by the archives detail viewer.
    Query param: path (e.g. data/archives/snapshots/2026-04.json)
    """
    try:
        from backend.github_sync import get_file_content
        import json

        path = request.args.get('path')
        if not path:
            return error_response('path required', status_code=400)

        content = get_file_content(path)
        # Parse JSON files automatically
        if path.endswith('.json'):
            return api_response(json.loads(content))
        return api_response({'content': content, 'path': path})
    except Exception as e:
        logger.exception(f'Error getting GitHub file: {e}')
        return error_response('Internal server error', status_code=500)


@github_bp.get('/commits')
@require_manager
def list_commits():
    """
    List recent commits from Supabase with their GitHub SHAs.
    Used by the source control view page.
    """
    try:
        from backend.supabase_client import get_client

        page     = request.args.get('page', 1, type=int)
        per_page = min(request.args.get('per_page', 20, type=int), 100)
        offset   = (page - 1) * per_page

        db   = get_client()
        resp = (
            db.table('commits_compat')
            .select('*', count='exact')
            .order('created_at', desc=True)
            .range(offset, offset + per_page - 1)
            .execute()
        )
        total   = resp.count or 0
        commits = resp.data or []

        # Build GitHub commit URL for each row that has a SHA
        from backend.github_sync import GITHUB_REPO
        for c in commits:
            sha = c.get('github_sha')
            if sha:
                c['github_url'] = f'https://github.com/{GITHUB_REPO}/commit/{sha}'

        return api_response({
            'commits': commits,
            'page':     page,
            'per_page': per_page,
            'total':    total,
        })
    except Exception as e:
        logger.exception(f'Error listing GitHub commits: {e}')
        return error_response('Internal server error', status_code=500)
