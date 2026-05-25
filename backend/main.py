import logging
import os
import sys
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
from backend.routes.inventory import inventory_bp  # noqa: E402
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

# Configure CORS with more specific settings for production
if app_config.DEBUG:
    # Development: allow all origins
    CORS(app, supports_credentials=True, origins=app_config.CORS_ORIGINS)
else:
    # Production: restrict origins
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
    user = session.get('user')
    if not user:
        return redirect('/')
    if user['role'] == 'staff':
        return send_from_directory(FRONTEND_DIR, 'staff_dashboard.html')
    return send_from_directory(FRONTEND_DIR, 'admin_dashboard.html')


@app.get('/inventory_dashboard.html')
def inventory_dashboard():
    user = session.get('user')
    if not user:
        return redirect('/')
    return send_from_directory(BASE_DIR, 'inventory_dashboard.html')


@app.get('/static/<path:name>')
def static_files(name):
    return send_from_directory(FRONTEND_DIR, name)


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


if __name__ == '__main__':
    host = app_config.HOST if hasattr(app_config, 'HOST') else '0.0.0.0'
    port = app_config.PORT if hasattr(app_config, 'PORT') else 5000
    logger.info(f'Starting server on {host}:{port}')
    app.run(host=getattr(app_config, 'HOST', '0.0.0.0'), port=getattr(app_config, 'PORT', 5000), debug=app_config.DEBUG)
