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

# Import configuration
sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import config

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from backend.routes.auth import auth_bp  # noqa: E402
from backend.routes.files import files_bp  # noqa: E402
from backend.routes.inventory import inventory_bp  # noqa: E402
from backend.routes.settings import settings_bp  # noqa: E402
from backend.routes.users import users_bp  # noqa: E402

FRONTEND_DIR = BASE_DIR / 'frontend'

load_dotenv(BASE_DIR / '.env')

# Determine config based on environment
env = os.getenv('FLASK_ENV', 'development')
app_config = config.get(env, config['default'])

app = Flask(__name__, static_folder=None)
app.secret_key = app_config.SECRET_KEY
app.config.from_object(app_config)

# Setup logging
logging.basicConfig(level=getattr(logging, app_config.LOG_LEVEL), format=app_config.LOG_FORMAT)
logger = logging.getLogger(__name__)

CORS(app, supports_credentials=True, origins=app_config.CORS_ORIGINS)


# Add security headers
@app.after_request
def add_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    if not app_config.DEBUG:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response


app.register_blueprint(inventory_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(users_bp)
app.register_blueprint(files_bp)
app.register_blueprint(settings_bp)

logger.info(f'Starting application in {env} mode')


@app.after_request
def no_cache(response):
    response.headers['Cache-Control'] = 'no-store'
    return response


@app.get('/')
def index():
    if session.get('user'):
        return redirect('/dashboard')
    return send_from_directory(FRONTEND_DIR, 'index.html')


@app.get('/dashboard')
def dashboard():
    if not session.get('user'):
        return redirect('/')
    return send_from_directory(FRONTEND_DIR, 'dashboard.html')


@app.get('/app')
def app_shell():
    if not session.get('user'):
        return redirect('/')
    return send_from_directory(FRONTEND_DIR, 'app.html')


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


@app.get('/inventory_dashboard.html')
def inventory_dashboard():
    user = session.get('user')
    if not user:
        return redirect('/')
    return send_from_directory(BASE_DIR, 'inventory_dashboard.html')


@app.get('/static/<path:name>')
def static_files(name):
    return send_from_directory(FRONTEND_DIR / 'static', name)


@app.get('/pull-sheet')
def pull_sheet():
    user = session.get('user')
    if not user:
        return redirect('/')
    if user.get('role') not in ('admin', 'manager'):
        return redirect('/dashboard-staff')
    return send_from_directory(FRONTEND_DIR, 'pull_sheet.html')


@app.get('/logo-shield.svg')
def serve_logo():
    return send_from_directory(BASE_DIR, 'logo-shield.svg')


@app.get('/ping')
def ping():
    return {'status': 'alive', 'timestamp': datetime.now(timezone.utc).isoformat()}, 200


@app.errorhandler(404)
def not_found(error):
    logger.warning(f'404 error: {error}')
    return {'error': 'Not found'}, 404


@app.errorhandler(500)
def internal_error(error):
    logger.error(f'500 error: {error}')
    return {'error': 'Internal server error'}, 500


@app.errorhandler(Exception)
def unhandled_exception(error):
    logger.exception(f'Unhandled exception: {error}')
    return {'error': 'Internal server error'}, 500


def _keep_alive_worker():
    """Ping this service every 14 minutes so Render free tier does not spin down."""
    base_url = os.getenv('RENDER_EXTERNAL_URL', '').rstrip('/')
    if not base_url:
        return  # local dev — nothing to do
    while True:
        time.sleep(14 * 60)
        try:
            with urllib.request.urlopen(base_url + '/ping', timeout=10):
                logger.debug('keep-alive ping ok')
        except Exception as exc:
            logger.warning('keep-alive ping failed: %s', exc)


_keep_alive_thread = threading.Thread(target=_keep_alive_worker, daemon=True, name='keep-alive')
_keep_alive_thread.start()


if __name__ == '__main__':
    host = app_config.HOST if hasattr(app_config, 'HOST') else '0.0.0.0'
    port = app_config.PORT if hasattr(app_config, 'PORT') else 5000
    logger.info(f'Starting server on {host}:{port}')
    app.run(host=getattr(app_config, 'HOST', '0.0.0.0'), port=getattr(app_config, 'PORT', 5000), debug=app_config.DEBUG)
