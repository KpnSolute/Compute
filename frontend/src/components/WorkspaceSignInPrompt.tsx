import { KpnMark } from '../lib/icons';

/**
 * Shown when a signed-out visitor lands on a workspace root.
 *
 * The client cannot verify that a slug is a real workspace, so it must not
 * render a branded credential form on arrival — otherwise every mistyped URL
 * becomes a convincing sign-in page for a workspace that does not exist.
 * Signing in is an explicit action that navigates to the tenant's own login.
 * Standard organizations use /{slug}; corporations use their approved host.
 */
export function WorkspaceSignInPrompt({
  slug,
  name,
  onSignIn,
  onHome,
}: {
  slug: string;
  name?: string | null;
  onSignIn: () => void;
  onHome: () => void;
}) {
  return (
    <main className="ws-screen">
      <section className="ws-card" aria-labelledby="ws-title">
        <div className="ws-mark"><KpnMark size={44} /></div>
        <div className="ws-eyebrow">KpnCompute workspace</div>
        <h1 id="ws-title">{name || slug.toUpperCase()}</h1>
        <p>Sign in with your staff account to open this workspace.</p>
        <div className="ws-actions">
          <button className="btn primary" onClick={onSignIn} autoFocus>
            Sign in
          </button>
          <button className="ws-link" onClick={onHome}>
            Not your workspace? Go to KpnCompute
          </button>
        </div>
      </section>
    </main>
  );
}

/**
 * Neutral screen for a workspace address while it resolves, or when it cannot
 * be resolved. It never shows credentials or the product landing, and it does
 * not reveal whether the workspace exists.
 */
export function WorkspaceStatusScreen({
  state,
  slug,
  onRetry,
  onHome,
}: {
  state: 'loading' | 'unavailable';
  slug: string;
  onRetry?: () => void;
  onHome: () => void;
}) {
  const loading = state === 'loading';
  return (
    <main className="ws-screen" aria-busy={loading}>
      <section className={'ws-card' + (loading ? ' is-loading' : '')} role={loading ? 'status' : 'alert'} aria-live="polite">
        <div className="ws-mark"><KpnMark size={44} /></div>
        {loading ? (
          <>
            <div className="ws-spinner" aria-hidden="true" />
            <h1>Opening workspace</h1>
            <p>Connecting to <b>{slug}</b>…</p>
          </>
        ) : (
          <>
            <div className="ws-eyebrow">Workspace unavailable</div>
            <h1>We couldn’t open {slug}</h1>
            <p>The address may be wrong, or the service is starting up. Try again in a moment.</p>
            <div className="ws-actions">
              {onRetry && (
                <button className="btn primary" onClick={onRetry} autoFocus>
                  Try again
                </button>
              )}
              <button className="ws-link" onClick={onHome}>
                Go to KpnCompute
              </button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
