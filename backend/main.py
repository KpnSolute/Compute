from flask import Flask, jsonify, redirect, request, session, send_from_directory
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / 'frontend'
APP_SECRET = 'mjc-inventory-secret'
USERS = {
    'admin': {'role': 'admin', 'password': 'Admin@MJC2026'},
    'fs_manager': {'role': 'manager', 'password': 'Manager@MJC2026'},
    'staff1': {'role': 'staff', 'pin': '1234'},
    'staff2': {'role': 'staff', 'pin': '1234'},
}

app = Flask(__name__, static_folder=None)
app.secret_key = APP_SECRET
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'

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

@app.get('/inventory_dashboard.html')
def inventory_dashboard():
    if not session.get('user'):
        return redirect('/')
    return send_from_directory(BASE_DIR, 'inventory_dashboard.html')

@app.get('/frontend/<path:name>')
def frontend_files(name):
    return send_from_directory(FRONTEND_DIR, name)

@app.post('/api/auth/login')
def login():
    payload = request.get_json(silent=True) or {}
    username = (payload.get('username') or '').strip()
    login_type = payload.get('type')
    user = USERS.get(username)
    if not user:
        return jsonify(error='Username not recognised.'), 401
    if login_type == 'staff':
        if user['role'] != 'staff':
            return jsonify(error='Staff accounts must use the Staff login type.'), 401
        if str(payload.get('pin') or '') != user['pin']:
            return jsonify(error='Incorrect PIN.'), 401
    else:
        if user['role'] == 'staff':
            return jsonify(error='Staff accounts must use the Staff login type.'), 401
        if str(payload.get('password') or '') != user['password']:
            return jsonify(error='Incorrect password.'), 401
    session['user'] = {'username': username, 'role': user['role']}
    return jsonify(ok=True, user=session['user'])

@app.get('/api/auth/me')
def me():
    if not session.get('user'):
        return jsonify(authenticated=False), 401
    return jsonify(authenticated=True, user=session['user'])

@app.post('/api/auth/logout')
def logout():
    session.clear()
    return jsonify(ok=True)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
