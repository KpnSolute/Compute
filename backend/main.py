import os
import sys
from pathlib import Path
from flask import Flask, redirect, session, send_from_directory
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from backend.routes.inventory import inventory_bp
from backend.routes.auth import auth_bp
from backend.routes.users import users_bp

FRONTEND_DIR = BASE_DIR / 'frontend'

load_dotenv(BASE_DIR / '.env')

app = Flask(__name__, static_folder=None)
app.secret_key = os.getenv('SECRET_KEY', 'fallback-dev-key')
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = False
app.register_blueprint(inventory_bp)
app.register_blueprint(auth_bp)
app.register_blueprint(users_bp)


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


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
