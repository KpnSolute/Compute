import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { User } from '../lib/constants';
import { api, type WorkspaceProject, type WorkspaceSite, type WorkspaceSummary } from '../lib/api';
import type { Workspace } from '../lib/workspace';
import { KpnMark } from '../lib/icons';

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63);
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
}

export function ComputeLanding({ user, onSignIn, onOpenConsole, onOpenWorkspace, onLogout }: {
  user: User | null;
  onSignIn: () => void;
  onOpenConsole: (slug: string) => void;
  onOpenWorkspace: (slug: string) => void;
  onLogout: () => void;
}) {
  const workspaces = user?.workspaces || (user?.tenant ? [user.tenant as Workspace] : []);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await api.createWorkspace({ name, slug }, crypto.randomUUID());
      onOpenConsole(result.slug || slug);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Workspace could not be created.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="compute-home">
      <nav className="compute-nav" aria-label="KpnCompute">
        <a className="compute-brand" href="/" aria-label="KpnCompute home">
          <KpnMark size={30} /><span>KpnCompute</span>
        </a>
        <div className="compute-nav-links">
          <a href="#capabilities">Capabilities</a>
          <a href="#how-it-works">How it works</a>
          {user ? (
            <button className="compute-link-button" onClick={onLogout}>Sign out</button>
          ) : (
            <button className="compute-button quiet" onClick={onSignIn}>Sign in</button>
          )}
        </div>
      </nav>

      <section className="compute-hero">
        <div className="compute-kicker"><span /> Managed business software, shaped around your operation</div>
        <h1>Your business systems.<br /><em>One navigable workspace.</em></h1>
        <p>KpnCompute turns operating procedures into secure portals, workflows, integrations, and managed software your team can actually run.</p>
        <div className="compute-hero-actions">
          <button className="compute-button primary" onClick={user ? () => document.getElementById('workspaces')?.scrollIntoView() : onSignIn}>
            {user ? 'Open your workspaces' : 'Enter KpnCompute'} <ArrowIcon />
          </button>
          <a className="compute-text-link" href="#how-it-works">See how Compute works</a>
        </div>
        <div className="compute-orbit" aria-hidden="true">
          <div className="orbit-core"><KpnMark size={52} /><strong>Compute</strong></div>
          <span className="orbit-node n1">Operations</span><span className="orbit-node n2">Data</span>
          <span className="orbit-node n3">Automations</span><span className="orbit-node n4">KpnLink</span>
        </div>
      </section>

      {user && (
        <section className="workspace-gallery" id="workspaces">
          <div className="section-heading">
            <div><span className="eyebrow">Resource directory</span><h2>Your workspaces</h2></div>
            <button className="compute-button quiet" onClick={() => setShowCreate(true)}>+ New workspace</button>
          </div>
          <div className="workspace-grid">
            {workspaces.map((workspace) => (
              <article className="workspace-card" key={workspace.id || workspace.slug}>
                <div className="workspace-monogram">{workspace.name.slice(0, 2).toUpperCase()}</div>
                <div className="workspace-card-copy">
                  <span className="status-chip"><i /> Active</span>
                  <h3>{workspace.name}</h3>
                  <p>compute.kpnsolute.com/{workspace.slug}</p>
                </div>
                <div className="workspace-card-actions">
                  <button onClick={() => onOpenWorkspace(workspace.slug)}>Open operations</button>
                  <button onClick={() => onOpenConsole(workspace.slug)}>Manage workspace <ArrowIcon /></button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="compute-capabilities" id="capabilities">
        {[
          ['01', 'Operational portals', 'Inventory, compliance, finance, menus, service delivery, and the workflows unique to your organization.'],
          ['02', 'Tenant-safe projects', 'Each workspace owns its projects, files, configurations, audit trail, and deployment lifecycle.'],
          ['03', 'Connected products', 'KpnLink connects Compute with Scena, LunchVoice, and tenant-owned services through signed events and webhooks.'],
        ].map(([number, title, copy]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}
      </section>

      <section className="compute-process" id="how-it-works">
        <span className="eyebrow">From procedure to platform</span>
        <h2>Built around how your organization already works.</h2>
        <div><span>Discover</span><i /><span>Design</span><i /><span>Deploy</span><i /><span>Operate</span></div>
      </section>

      {showCreate && (
        <div className="compute-modal-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}>
          <form className="compute-modal" onSubmit={createWorkspace} onMouseDown={(event) => event.stopPropagation()} aria-labelledby="new-workspace-title">
            <button type="button" className="modal-close" onClick={() => setShowCreate(false)} aria-label="Close">×</button>
            <span className="eyebrow">New resource</span><h2 id="new-workspace-title">Create a workspace</h2>
            <p>A workspace is the secure boundary for one organization and its venues, projects, people, and integrations.</p>
            <label>Name<input value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug(slugify(e.target.value)); }} required minLength={2} placeholder="Northstar Hospitality" /></label>
            <label>Workspace address<div className="address-input"><span>compute.kpnsolute.com/</span><input value={slug} onChange={(e) => setSlug(slugify(e.target.value))} required minLength={2} placeholder="northstar" /></div></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" onClick={() => setShowCreate(false)}>Cancel</button><button className="compute-button primary" disabled={saving}>{saving ? 'Creating…' : 'Create workspace'}</button></div>
          </form>
        </div>
      )}
    </main>
  );
}

export function WorkspaceConsole({ user, slug, onBack, onOpenOperations, onLogout }: {
  user: User;
  slug: string;
  onBack: () => void;
  onOpenOperations: () => void;
  onLogout: () => void;
}) {
  const [summary, setSummary] = useState<WorkspaceSummary | null>(null);
  const [sites, setSites] = useState<WorkspaceSite[]>([]);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [active, setActive] = useState<'overview' | 'sites' | 'projects' | 'connections'>('overview');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState<'site' | 'project' | null>(null);
  const [resourceName, setResourceName] = useState('');
  const [resourceSlug, setResourceSlug] = useState('');
  const [siteType, setSiteType] = useState<'venue' | 'location'>('venue');
  const [parentId, setParentId] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([api.getWorkspaceSummary(slug), api.getWorkspaceSites(slug), api.getWorkspaceProjects(slug)])
      .then(([nextSummary, nextSites, nextProjects]) => {
        if (!live) return;
        setSummary(nextSummary); setSites(nextSites.sites); setProjects(nextProjects.projects);
      })
      .catch((cause) => live && setError(cause instanceof Error ? cause.message : 'Workspace resources could not be loaded.'));
    return () => { live = false; };
  }, [slug]);

  const workspace = summary?.workspace || user.workspaces?.find((item) => item.slug === slug) || user.tenant;
  const venues = useMemo(() => sites.filter((site) => site.site_type === 'venue'), [sites]);
  const locations = useMemo(() => sites.filter((site) => site.site_type === 'location'), [sites]);

  async function createResource(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError('');
    try {
      if (creating === 'site') {
        const created = await api.createWorkspaceSite(slug, {
          site_type: siteType,
          parent_id: siteType === 'location' ? parentId : null,
          slug: resourceSlug,
          name: resourceName,
          timezone: 'America/New_York',
        });
        setSites((current) => [...current, created]);
      } else if (creating === 'project') {
        const created = await api.createWorkspaceProject(slug, {
          slug: resourceSlug, name: resourceName, description,
        }, crypto.randomUUID());
        setProjects((current) => [created, ...current]);
      }
      setCreating(null); setResourceName(''); setResourceSlug(''); setParentId(''); setDescription('');
      const nextSummary = await api.getWorkspaceSummary(slug);
      setSummary(nextSummary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Resource could not be created.');
    } finally { setSaving(false); }
  }

  return (
    <div className="resource-console">
      <aside className="resource-sidebar">
        <button className="resource-brand" onClick={onBack}><KpnMark size={28} /><span>KpnCompute</span></button>
        <div className="resource-workspace"><div>{workspace?.name?.slice(0, 2).toUpperCase() || 'WS'}</div><span><b>{workspace?.name || slug}</b><small>Workspace</small></span></div>
        <nav aria-label="Workspace management">
          {([['overview', 'Overview'], ['sites', 'Venues & locations'], ['projects', 'Projects'], ['connections', 'Connections']] as const).map(([key, label]) => (
            <button key={key} data-active={active === key} onClick={() => setActive(key)}>{label}</button>
          ))}
        </nav>
        <div className="resource-sidebar-foot"><button onClick={onOpenOperations}>Open operations</button><button onClick={onLogout}>Sign out</button></div>
      </aside>
      <main className="resource-main">
        <header className="resource-header"><div><span className="eyebrow">Workspace console</span><h1>{workspace?.name || slug}</h1><p>/{slug}</p></div><span className="status-chip"><i /> Operational</span></header>
        {error && <div className="resource-alert" role="alert">{error}</div>}
        {active === 'overview' && <>
          <section className="metric-grid">
            {[['Venues', summary?.counts.venues], ['Locations', summary?.counts.locations], ['Projects', summary?.counts.projects], ['Members', summary?.counts.members]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value ?? '—'}</strong><small>Active resources</small></article>)}
          </section>
          <section className="resource-panel"><div className="panel-heading"><div><span className="eyebrow">Resource map</span><h2>Your operating footprint</h2></div><button onClick={() => setActive('sites')}>Manage sites</button></div>
            <div className="site-map">{venues.map((venue) => <article key={venue.id}><div className="site-icon">V</div><div><h3>{venue.name}</h3><p>{locations.filter((location) => location.parent_id === venue.id).length} locations · {venue.timezone}</p></div><span>Ready</span></article>)}{!venues.length && <p className="empty-copy">No venues have been added yet.</p>}</div>
          </section>
        </>}
        {active === 'sites' && <ResourceList title="Venues & locations" description="Structure the places where your teams operate." items={sites.map((site) => ({ id: site.id, title: site.name, meta: `${site.site_type} · ${site.timezone}`, status: site.status }))} empty="Add your first venue to organize locations and projects." onAdd={() => setCreating('site')} />}
        {active === 'projects' && <ResourceList title="Projects" description="Managed systems and implementations owned by this workspace." items={projects.map((project) => ({ id: project.id, title: project.name, meta: project.description || project.project_kind, status: project.status }))} empty="No projects are available in this workspace." onAdd={() => setCreating('project')} />}
        {active === 'connections' && <section className="resource-panel"><div className="panel-heading"><div><span className="eyebrow">KpnLink</span><h2>Connections</h2></div></div><div className="connection-list"><article><div className="connection-mark">KL</div><div><h3>KpnLink event transport</h3><p>Signed CloudEvents and webhooks for Scena, LunchVoice, and external services.</p></div><span className="status-chip"><i /> Available</span></article><p className="resource-note">Connection creation and delivery health will appear here when the KpnLink management release is deployed.</p></div></section>}
      </main>
      {creating && (
        <div className="compute-modal-backdrop" role="presentation" onMouseDown={() => setCreating(null)}>
          <form className="compute-modal" onSubmit={createResource} onMouseDown={(event) => event.stopPropagation()} aria-labelledby="new-resource-title">
            <button type="button" className="modal-close" onClick={() => setCreating(null)} aria-label="Close">×</button>
            <span className="eyebrow">Workspace resource</span><h2 id="new-resource-title">Add {creating === 'site' ? 'a site' : 'a project'}</h2>
            {creating === 'site' && <label>Resource type<select value={siteType} onChange={(event) => setSiteType(event.target.value as 'venue' | 'location')}><option value="venue">Venue</option><option value="location" disabled={!venues.length}>Location inside a venue</option></select></label>}
            {creating === 'site' && siteType === 'location' && <label>Parent venue<select value={parentId} onChange={(event) => setParentId(event.target.value)} required><option value="">Select a venue</option>{venues.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}</select></label>}
            <label>Name<input value={resourceName} onChange={(event) => { setResourceName(event.target.value); if (!resourceSlug) setResourceSlug(slugify(event.target.value)); }} required minLength={2} /></label>
            <label>Slug<input value={resourceSlug} onChange={(event) => setResourceSlug(slugify(event.target.value))} required minLength={2} /></label>
            {creating === 'project' && <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} /></label>}
            <div className="modal-actions"><button type="button" onClick={() => setCreating(null)}>Cancel</button><button className="compute-button primary" disabled={saving}>{saving ? 'Creating…' : 'Create resource'}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

function ResourceList({ title, description, items, empty, onAdd }: { title: string; description: string; items: Array<{ id: string; title: string; meta: string; status: string }>; empty: string; onAdd: () => void }) {
  return <section className="resource-panel"><div className="panel-heading"><div><span className="eyebrow">Directory</span><h2>{title}</h2><p>{description}</p></div><button onClick={onAdd}>+ Add</button></div><div className="resource-table">{items.map((item) => <article key={item.id}><div><h3>{item.title}</h3><p>{item.meta}</p></div><span>{item.status}</span></article>)}{!items.length && <p className="empty-copy">{empty}</p>}</div></section>;
}
