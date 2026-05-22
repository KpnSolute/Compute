const express = require('express');
const session = require('express-session');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'mjc-inventory-secret';

const USERS = {
  admin: { role: 'admin', password: 'Admin@MJC2026' },
  fs_manager: { role: 'manager', password: 'Manager@MJC2026' },
  staff1: { role: 'staff', pin: '1234' },
  staff2: { role: 'staff', pin: '1234' },
};

app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
  })
);

app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use('/frontend', express.static(path.join(__dirname, '..', 'frontend')));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/frontend/dashboard.html');
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, '..', 'frontend', 'dashboard.html'));
});

app.get('/inventory_dashboard.html', (req, res) => {
  if (!req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, '..', 'inventory_dashboard.html'));
});

app.post('/api/auth/login', (req, res) => {
  const { username, password, pin, type } = req.body || {};
  const user = USERS[username];
  if (!user) return res.status(401).json({ error: 'Username not recognised.' });
  if (type === 'staff') {
    if (user.role !== 'staff') return res.status(401).json({ error: 'Staff accounts must use the Staff login type.' });
    if (String(pin || '') !== user.pin) return res.status(401).json({ error: 'Incorrect PIN.' });
  } else {
    if (user.role === 'staff') return res.status(401).json({ error: 'Staff accounts must use the Staff login type.' });
    if (String(password || '') !== user.password) return res.status(401).json({ error: 'Incorrect password.' });
  }
  req.session.user = { username, role: user.role };
  res.json({ ok: true, user: req.session.user });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, user: req.session.user });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});