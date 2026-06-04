/**
 * EXAMPLE: Frontend Authentication Integration
 * 
 * This file demonstrates how the new backend authentication is used
 * throughout the frontend application.
 * 
 * NOT part of the actual codebase - this is documentation/reference.
 */

// ============================================================================
// EXAMPLE 1: Basic Admin/Manager Login Flow
// ============================================================================

import { realLogin, backendLogin, getBackendToken } from '@/lib/supabase';

async function adminLoginExample() {
  // Step 1: Authenticate with Supabase
  const supabaseRes = await realLogin({
    username: 'amartin',
    type: 'admin',
    password: 'kpn2026',
  });

  if (!supabaseRes.ok) {
    console.error('Supabase auth failed:', supabaseRes.error);
    return;
  }

  console.log('✓ Supabase Auth successful');
  console.log('  User:', supabaseRes.user);
  console.log('  Token:', supabaseRes.user?.access_token?.substring(0, 20) + '...');

  // Step 2: Send token to backend for validation
  if (!supabaseRes.user?.access_token) {
    console.error('No access_token in response');
    return;
  }

  const backendRes = await backendLogin(supabaseRes.user.access_token);

  if (!backendRes.ok) {
    console.error('Backend validation failed:', backendRes.error);
    return;
  }

  console.log('✓ Backend validation successful');
  console.log('  User:', backendRes.user);
  console.log('  Backend Token:', backendRes.token?.substring(0, 20) + '...');

  // Step 3: Token is now stored in localStorage automatically
  const storedToken = getBackendToken();
  console.log('✓ Token stored in localStorage:', !!storedToken);

  // Step 4: All subsequent API calls will include this token automatically
  return backendRes.user;
}

// ============================================================================
// EXAMPLE 2: Staff PIN Login Flow
// ============================================================================

import { backendPinLogin } from '@/lib/supabase';

async function staffPinLoginExample() {
  // Staff uses PIN login - no Supabase Auth needed
  const res = await backendPinLogin('rkhan', '4729');

  if (!res.ok) {
    console.error('PIN login failed:', res.error);
    return;
  }

  console.log('✓ Staff PIN login successful');
  console.log('  User:', res.user);
  console.log('  Token:', res.token); // Will be: pin_{user_id}

  // Token is stored automatically and used in subsequent API calls
  return res.user;
}

// ============================================================================
// EXAMPLE 3: Making API Calls with Automatic Token Injection
// ============================================================================

import { api } from '@/lib/api';

async function apiCallsExample() {
  // After login, all these calls automatically include the Authorization header
  
  try {
    // These are examples of existing API calls
    const commits = await api.getCommits(50, 0);
    console.log('✓ Fetched commits:', commits.length);

    const staging = await api.getStaging('inventory');
    console.log('✓ Fetched staging entries:', staging.length);

    const commit = await api.approveCommit({
      staging_ids: ['id1', 'id2'],
      message: 'Approve inventory changes',
      author_id: 'user-123',
    });
    console.log('✓ Created commit:', commit.commit_id);
  } catch (err) {
    console.error('API call failed:', err);
  }
}

// ============================================================================
// EXAMPLE 4: Custom API Calls with Manual Token Injection
// ============================================================================

import { getBackendToken } from '@/lib/supabase';

async function customApiCallExample() {
  const token = getBackendToken();

  if (!token) {
    console.error('No authentication token found');
    return;
  }

  try {
    const response = await fetch('/api/some-custom-endpoint', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        someField: 'someValue',
      }),
    });

    if (!response.ok) {
      throw new Error(`${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    console.log('✓ Custom API call successful:', data);
    return data;
  } catch (err) {
    console.error('Custom API call failed:', err);
  }
}

// ============================================================================
// EXAMPLE 5: Logout Flow
// ============================================================================

import { clearBackendToken, realLogout } from '@/lib/supabase';

async function logoutExample() {
  console.log('Logging out...');

  // Clear backend token first
  clearBackendToken();
  console.log('✓ Backend token cleared');

  // Sign out from Supabase
  await realLogout();
  console.log('✓ Supabase session cleared');

  // Clear local session state
  localStorage.removeItem('kpn_session');
  console.log('✓ Local session cleared');

  console.log('Logout complete - redirecting to login page');
}

// ============================================================================
// EXAMPLE 6: Handling Token Expiry
// ============================================================================

import { getBackendToken } from '@/lib/supabase';

async function apiCallWithErrorHandling(endpoint: string, options?: RequestInit) {
  const token = getBackendToken();

  if (!token) {
    console.warn('No token available - user may not be authenticated');
    // Could redirect to login here
    return null;
  }

  try {
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options?.headers,
      },
    });

    // Handle 401 - token may have expired
    if (response.status === 401) {
      console.error('Token expired or invalid - redirecting to login');
      clearBackendToken();
      realLogout();
      window.location.href = '/login';
      return null;
    }

    if (!response.ok) {
      throw new Error(`${response.status}: ${await response.text()}`);
    }

    return await response.json();
  } catch (err) {
    console.error('API call failed:', err);
    throw err;
  }
}

// ============================================================================
// EXAMPLE 7: Login Component Integration
// ============================================================================

import React, { useState } from 'react';
import { realLogin, backendLogin, backendPinLogin } from '@/lib/supabase';

export function LoginComponentExample() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Step 1: Supabase Auth
      const supaRes = await realLogin({
        username,
        type: 'admin',
        password,
      });

      if (!supaRes.ok) {
        setError(supaRes.error || 'Login failed');
        setLoading(false);
        return;
      }

      // Step 2: Backend Validation
      if (!supaRes.user?.access_token) {
        setError('No token received');
        setLoading(false);
        return;
      }

      const backendRes = await backendLogin(supaRes.user.access_token);

      if (!backendRes.ok) {
        setError(backendRes.error || 'Backend validation failed');
        setLoading(false);
        return;
      }

      // Step 3: Success - redirect to dashboard
      console.log('Login successful:', backendRes.user);
      // Trigger parent callback or navigate
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      setLoading(false);
    }
  }

  async function handleStaffLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await backendPinLogin(username, pin);

      if (!res.ok) {
        setError(res.error || 'PIN login failed');
        setLoading(false);
        return;
      }

      console.log('Staff login successful:', res.user);
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err.message || 'An error occurred');
      setLoading(false);
    }
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}

      <form onSubmit={handleAdminLogin}>
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Logging in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// ============================================================================
// EXAMPLE 8: Checking Authentication Status
// ============================================================================

import { getBackendToken } from '@/lib/supabase';

function useIsAuthenticated(): boolean {
  const token = getBackendToken();
  return !!token;
}

export function ProtectedRouteExample() {
  const isAuthenticated = useIsAuthenticated();

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <Dashboard />;
}

// ============================================================================
// EXAMPLE 9: Debugging - Console Inspection
// ============================================================================

/*
When troubleshooting, you can inspect the authentication state in browser console:

// Check if backend token exists
console.log('Backend Token:', localStorage.getItem('mjc_backend_token'));

// Check if Supabase session exists
console.log('Supabase Session:', localStorage.getItem('kpn_supa_auth'));

// Check local user profile
console.log('User Session:', JSON.parse(localStorage.getItem('kpn_session') || '{}'));

// Clear all auth data (useful for testing)
localStorage.removeItem('mjc_backend_token');
localStorage.removeItem('kpn_supa_auth');
localStorage.removeItem('kpn_session');

// Monitor all auth-related logs
// 1. Open DevTools
// 2. Filter console by: [Auth] or [API]
// 3. Perform login - will see detailed flow
*/

// ============================================================================
// EXAMPLE 10: Error Scenarios and Recovery
// ============================================================================

async function errorHandlingExample() {
  // Scenario 1: Invalid Supabase credentials
  let res = await realLogin({
    username: 'amartin',
    type: 'admin',
    password: 'wrong_password',
  });
  console.log('Expected Error:', res.error); // "Incorrect password. Please try again."

  // Scenario 2: Invalid backend token
  res = await backendLogin('invalid_token_123');
  console.log('Expected Error:', res.error); // "Invalid or expired access token"

  // Scenario 3: Invalid PIN
  res = await backendPinLogin('rkhan', '0000');
  console.log('Expected Error:', res.error); // "Invalid PIN"

  // Scenario 4: User not found
  res = await backendPinLogin('nonexistent', '1234');
  console.log('Expected Error:', res.error); // "Invalid credentials"

  // Scenario 5: Disabled user account
  // (Would need a disabled user in Supabase)
  res = await realLogin({
    username: 'tobrien', // inactive user in demo data
    type: 'admin',
    password: 'kpn2026',
  });
  console.log('Expected Error:', res.error); // "Account is disabled."
}
