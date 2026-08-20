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
  onSignIn,
  onHome,
}: {
  slug: string;
  onSignIn: () => void;
  onHome: () => void;
}) {
  return (
    <main className="compute-shell" style={{ display: 'grid', placeItems: 'center', minHeight: '70vh', padding: 24 }}>
      <div style={{ maxWidth: 460, textAlign: 'center' }}>
        <h1 style={{ marginBottom: 8 }}>Sign in to continue</h1>
        <p style={{ opacity: 0.8, marginBottom: 24 }}>
          This workspace requires you to sign in. If <code>{slug}</code> is not your workspace,
          check the address.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="compute-button primary" onClick={onSignIn}>
            Sign in to {slug}
          </button>
          <button className="compute-link-button" onClick={onHome}>
            Back to KpnCompute
          </button>
        </div>
      </div>
    </main>
  );
}
