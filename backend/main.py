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

BASE_DIR = Path(__file__).resolve().parent.parent

from backend.routes.auth import auth_bp  # noqa: E402
from backend.routes.github import github_bp  # noqa: E402
from backend.routes.files import files_bp  # noqa: E402
from backend.routes.inventory import inventory_bp  # noqa: E402
from backend.routes.settings import settings_bp  # noqa: E402
from backend.routes.users import users_bp  # noqa: E402

FRONTEND_DIR = BASE_DIR / 'frontend'

load_dotenv(BASE_DIR / '.env')

env = os.getenv('FLASK_ENV', 'development')
app_config = config.get(env, config['default'])

app = Flask(__name__, static_folder=None)
app.secret_key = app_config.SECRET_KEY
app.config.from_object(app_config)

logging.basicConfig(level=getattr(logging, app_config.LOG_LEVEL), format=app_config.LOG_FORMAT)
logger = logging.getLogger(__name__)

CORS(app, supports_credentials=True, origins=app_config.CORS_ORIGINS)


@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    if not app_config.DEBUG:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


@app.after_request
def no_cache(response):
    response.headers['Cache-Control'] = 'no-store'
    return response


app.register_blueprint(inventory_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(users_bp)
app.register_blueprint(files_bp)
app.register_blueprint(settings_bp)
app.register_blueprint(github_bp)

logger.info(f'Starting MJCC application in {env} mode')


# ── Health check ──────────────────────────────────────────────────────

@app.get('/ping')
def ping():
    from flask import jsonify
    return jsonify(ok=True, ts=datetime.now(timezone.utc).isoformat(), env=env)


# ── Frontend routes ───────────────────────────────────────────────────

@app.get('/')
def index():
    if session.get('user'):
        return redirect('/app')
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.get('/app')
def app_shell():
    if not session.get('user'):
        return redirect('/')
    return send_from_directory(FRONTEND_DIR, 'app.html')


@app.get('/dashboard')
def dashboard():
    if not session.get('user'):
        return redirect('/')
    return send_from_directory(FRONTEND_DIR, 'dashboard.html')


@app.get('/dashboard-admin')
def admin_dashboard():
    user = session.get('user')
    if not user:
        return redirect('/')
    return send_from_directory(FRONTEND_DIR, 'admin_dashboard.html')


@app.get('/dashboard-staff')
def staff_dashboard():
    user = session.get('user')
    if not user:
        return redirect('/')
    return send_from_directory(FRONTEND_DIR, 'staff_dashboard.html')


@app.get('/inventory')
@app.get('/source-control')
@app.get('/reports')
@app.get('/users')
@app.get('/barcodes')
@app.get('/settings')
@app.get('/files')
@app.get('/qr-portal')
def spa_routes():
    if not session.get('user'):
        return redirect('/')
    return send_from_directory(FRONTEND_DIR, 'app.html')


@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(FRONTEND_DIR / 'static', filename)


# ── Keep-alive (Render free tier) ────────────────────────────────────

def _keep_alive():
    port = os.getenv('PORT', '5000')
    url = f'http://localhost:{port}/ping'
    while True:
        time.sleep(600)
        try:
            urllib.request.urlopen(url, timeout=5)
        except Exception:
            pass


if os.getenv('FLASK_ENV') != 'testing':
    threading.Thread(target=_keep_alive, daemon=True).start()

    # Start GitHub sync retry worker (drains github_sync_queue every 60s)
    try:
        from backend.github_sync import start_retry_worker
        if os.getenv('GITHUB_TOKEN'):
            start_retry_worker()
        else:
            logger.warning('GITHUB_TOKEN not set — GitHub sync disabled')
    except Exception as _gh_err:
        logger.warning(f'Could not start GitHub sync worker: {_gh_err}')
