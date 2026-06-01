import logging
import os
import sys
import threading
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, redirect, send_from_directory, session
from flask_cors import CORS

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.config import config  # noqa: E402

BASE_DIR     = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / 'frontend'

load_dotenv(BASE_DIR / '.env')

env        = os.getenv('FLASK_ENV', 'development')
app_config = config.get(env, config['default'])

app = Flask(__name__, static_folder=None)
app.secret_key = app_config.SECRET_KEY
app.config.from_object(app_config)

logging.basicConfig(
    level=getattr(logging, app_config.LOG_LEVEL),
    format=app_config.LOG_FORMAT,
)
logger = logging.getLogger(__name__)

CORS(app, supports_credentials=True, origins=app_config.CORS_ORIGINS)

# ── Security & cache headers ──────────────────────────────────────────

@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options']        = 'DENY'
    response.headers['X-XSS-Protection']       = '1; mode=block'
    if not app_config.DEBUG:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


@app.after_request
def no_cache(response):
    response.headers['Cache-Control'] = 'no-store'
    return response


# ── Register API blueprints ───────────────────────────────────────────
#
# All API routes live under /api/ and are mounted here.
# Route ownership:
#   /api/auth/*        backend/routes/auth.py
#   /api/inventory/*   backend/routes/inventory.py
#   /api/users/*       backend/routes/users.py
#   /api/settings/*    backend/routes/settings.py
#   /api/github/*      backend/routes/github.py
#   /api/files/*       backend/routes/files.py

from backend.routes.auth      import auth_bp       # noqa: E402
from backend.routes.github    import github_bp     # noqa: E402
from backend.routes.files     import files_bp      # noqa: E402
from backend.routes.inventory import inventory_bp  # noqa: E402
from backend.routes.settings  import settings_bp   # noqa: E402
from backend.routes.users     import users_bp      # noqa: E402

app.register_blueprint(auth_bp)
app.register_blueprint(inventory_bp)
app.register_blueprint(users_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(github_bp)
app.register_blueprint(files_bp)

logger.info(f'Starting MJCC application in {env} mode')


# ── Health ────────────────────────────────────────────────────────────

@app.get('/ping')
def ping():
    from flask import jsonify
    return jsonify(ok=True, ts=datetime.now(timezone.utc).isoformat(), env=env)


# ── Auth guard helper ─────────────────────────────────────────────────

def _require_auth(min_role=None):
    """
    Returns (user, None) if authenticated and role is satisfied.
    Returns (None, redirect_response) otherwise.
    min_role: None=any, 'staff'=10, 'assistant'=20, 'manager'=30, 'admin'=40
    """
    user = session.get('user')
    if not user:
        return None, redirect('/?expired=1')
    if min_role:
        levels = {'staff': 10, 'assistant': 20, 'manager': 30, 'admin': 40}
        if levels.get(user.get('role', ''), 0) < levels.get(min_role, 0):
            return None, redirect('/mjcc/portal')
    return user, None


# ── Login / logout pages ──────────────────────────────────────────────

@app.get('/')
def login_page():
    user = session.get('user')
    if user:
        # Redirect to role-appropriate portal
        role = user.get('role', 'staff')
        if role in ('admin', 'manager', 'assistant'):
            return redirect('/mjcc/admin/portal')
        return redirect('/mjcc/staff/portal')
    return send_from_directory(FRONTEND_DIR, 'index.html')


# ── /mjcc/portal — smart redirect based on role ───────────────────────

@app.get('/mjcc/portal')
def portal_redirect():
    user, err = _require_auth()
    if err:
        return err
    role = user.get('role', 'staff')
    if role in ('admin', 'manager', 'assistant'):
        return redirect('/mjcc/admin/portal')
    return redirect('/mjcc/staff/portal')


# ── Admin portal routes (/mjcc/admin/*) ──────────────────────────────
#
# All serve app.html (the SPA shell).
# The SPA reads window.location.pathname to activate the correct page.
# Role gate: assistant minimum for /admin/, admin for /users/ and /settings/

@app.get('/mjcc/admin/portal')
def admin_portal():
    user, err = _require_auth('assistant')
    return err or send_from_directory(FRONTEND_DIR, 'app.html')


@app.get('/mjcc/admin/inventory')
@app.get('/mjcc/admin/inventory/<path:subpage>')
def admin_inventory(subpage='editor'):
    user, err = _require_auth('assistant')
    return err or send_from_directory(FRONTEND_DIR, 'app.html')


@app.get('/mjcc/admin/menu')
@app.get('/mjcc/admin/menu/<path:subpage>')
def admin_menu(subpage='calendar'):
    user, err = _require_auth('assistant')
    return err or send_from_directory(FRONTEND_DIR, 'app.html')


@app.get('/mjcc/admin/sourcectrl')
@app.get('/mjcc/admin/sourcectrl/<path:subpage>')
def admin_sourcectrl(subpage='view'):
    user, err = _require_auth('assistant')
    return err or send_from_directory(FRONTEND_DIR, 'app.html')


@app.get('/mjcc/admin/archives')
@app.get('/mjcc/admin/archives/<path:subpage>')
def admin_archives(subpage='snapshots'):
    user, err = _require_auth('assistant')
    return err or send_from_directory(FRONTEND_DIR, 'app.html')


@app.get('/mjcc/admin/users')
@app.get('/mjcc/admin/users/<path:subpage>')
def admin_users(subpage='manage'):
    user, err = _require_auth('admin')
    return err or send_from_directory(FRONTEND_DIR, 'app.html')


@app.get('/mjcc/admin/settings')
@app.get('/mjcc/admin/settings/<path:subpage>')
def admin_settings(subpage='general'):
    user, err = _require_auth('admin')
    return err or send_from_directory(FRONTEND_DIR, 'app.html')


# ── Staff portal routes (/mjcc/staff/*) ──────────────────────────────

@app.get('/mjcc/staff/portal')
def staff_portal():
    user, err = _require_auth('staff')
    return err or send_from_directory(FRONTEND_DIR, 'app.html')


@app.get('/mjcc/staff/inventory')
def staff_inventory():
    user, err = _require_auth('staff')
    return err or send_from_directory(FRONTEND_DIR, 'app.html')


@app.get('/mjcc/staff/sourcectrl')
def staff_sourcectrl():
    user, err = _require_auth('staff')
    return err or send_from_directory(FRONTEND_DIR, 'app.html')


@app.get('/mjcc/staff/barcodes')
def staff_barcodes():
    user, err = _require_auth('staff')
    return err or send_from_directory(FRONTEND_DIR, 'app.html')


# ── Legacy redirects (old single-page URLs → new structure) ──────────
# These keep old bookmarks working.

@app.get('/app')
def legacy_app():
    user = session.get('user')
    if not user:
        return redirect('/')
    return redirect('/mjcc/portal')


@app.get('/inventory')
def legacy_inventory():
    user = session.get('user')
    if not user:
        return redirect('/')
    role = user.get('role', 'staff')
    if role in ('admin', 'manager', 'assistant'):
        return redirect('/mjcc/admin/inventory/editor')
    return redirect('/mjcc/staff/inventory')


@app.get('/source-control')
def legacy_source_control():
    user = session.get('user')
    if not user:
        return redirect('/')
    role = user.get('role', 'staff')
    if role in ('admin', 'manager', 'assistant'):
        return redirect('/mjcc/admin/sourcectrl/view')
    return redirect('/mjcc/staff/sourcectrl')


@app.get('/reports')
def legacy_reports():
    user = session.get('user')
    if not user:
        return redirect('/')
    return redirect('/mjcc/admin/inventory/reports')


@app.get('/users')
def legacy_users():
    user = session.get('user')
    if not user:
        return redirect('/')
    return redirect('/mjcc/admin/users/manage')


@app.get('/barcodes')
def legacy_barcodes():
    user = session.get('user')
    if not user:
        return redirect('/')
    role = user.get('role', 'staff')
    if role in ('admin', 'manager', 'assistant'):
        return redirect('/mjcc/admin/inventory/barcodes')
    return redirect('/mjcc/staff/barcodes')


@app.get('/settings')
def legacy_settings():
    user = session.get('user')
    if not user:
        return redirect('/')
    return redirect('/mjcc/admin/settings')


@app.get('/files')
def legacy_files():
    user = session.get('user')
    if not user:
        return redirect('/')
    return redirect('/mjcc/admin/archives/invoices')


@app.get('/qr-portal')
def legacy_qr():
    user = session.get('user')
    if not user:
        return redirect('/')
    return redirect('/mjcc/staff/barcodes')


@app.get('/dashboard')
@app.get('/dashboard-admin')
@app.get('/dashboard-staff')
def legacy_dashboard():
    user = session.get('user')
    if not user:
        return redirect('/')
    return redirect('/mjcc/portal')


# ── Static assets ─────────────────────────────────────────────────────

@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(FRONTEND_DIR / 'static', filename)


@app.get('/logo-shield.svg')
def logo():
    return send_from_directory(FRONTEND_DIR, 'logo-shield.svg')


# ── Background workers ────────────────────────────────────────────────

def _keep_alive():
    port = os.getenv('PORT', '5000')
    url  = f'http://localhost:{port}/ping'
    while True:
        time.sleep(600)
        try:
            urllib.request.urlopen(url, timeout=5)
        except Exception:
            pass


if os.getenv('FLASK_ENV') != 'testing':
    threading.Thread(target=_keep_alive, daemon=True).start()

    try:
        from backend.github_sync import start_retry_worker
        if os.getenv('GITHUB_TOKEN'):
            start_retry_worker()
        else:
            logger.warning('GITHUB_TOKEN not set — GitHub sync disabled')
    except Exception as _gh_err:
        logger.warning(f'Could not start GitHub sync worker: {_gh_err}')
