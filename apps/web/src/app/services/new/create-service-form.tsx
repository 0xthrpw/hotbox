'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
// Subpath import, NOT the barrel: this is a client component and the barrel
// re-exports template-loader, whose node:fs import would break the browser
// bundle at next build.
import { parseCommandLine } from '@hotbox/shared/command';
import { Button, Callout, Field, Input, Select } from '@/components/ui';
import type { ProjectWithEnvironments } from '@/lib/types';

interface TemplateRow {
  id: string;
  label: string;
  description: string;
  primary_image: string | null;
  requires_hostname: boolean;
}

interface EnvRow { key: string; value: string }
interface RequireRow { kind: 'postgres' | 'redis'; name: string }
interface VolumeRow { name: string; mountpoint: string }

interface GithubInstallation {
  installation_id: string;
  account_login: string;
  suspended_at: string | null;
}
interface GithubRepo { full_name: string; private: boolean; default_branch: string }

const fetcher = (url: string) => fetch(url, { credentials: 'include' }).then((r) => r.json());

export function CreateServiceForm() {
  const router = useRouter();
  const params = useSearchParams();
  const initialProjectId = params.get('projectId') ?? '';
  const initialEnvId = params.get('envId') ?? '';

  const { data: tmplData } = useSWR<{ templates: TemplateRow[] }>('/api/templates', fetcher);
  const { data: projData } = useSWR<{ projects: ProjectWithEnvironments[] }>('/api/projects', fetcher);
  const templates = tmplData?.templates ?? [];
  const projects = projData?.projects ?? [];

  const [projectId, setProjectId] = useState(initialProjectId);
  const [environmentId, setEnvironmentId] = useState(initialEnvId);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [template, setTemplate] = useState('');
  const [imageSource, setImageSource] = useState<'image' | 'github'>('image');
  const [image, setImage] = useState('');
  const [repoFullName, setRepoFullName] = useState('');
  // '' = credential-less public clone; otherwise a GitHub App installation id.
  const [installationId, setInstallationId] = useState('');
  const [branch, setBranch] = useState('main');
  const [dockerfilePath, setDockerfilePath] = useState('Dockerfile');
  const [buildContext, setBuildContext] = useState('.');
  const [hostname, setHostname] = useState('');
  const [publicPort, setPublicPort] = useState('');
  const [autoSubdomain, setAutoSubdomain] = useState(false);
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [requires, setRequires] = useState<RequireRow[]>([]);
  const [volumes, setVolumes] = useState<VolumeRow[]>([]);
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: metaData } = useSWR<{ auto_subdomain_base: string | null }>('/api/meta', fetcher);
  const autoSubdomainBase = metaData?.auto_subdomain_base ?? null;

  const { data: ghInstData } = useSWR<{ configured: boolean; installations: GithubInstallation[] }>(
    imageSource === 'github' ? '/api/github/installations' : null,
    fetcher,
  );
  const installations = (ghInstData?.installations ?? []).filter((i) => !i.suspended_at);
  const { data: ghRepoData } = useSWR<{ repos: GithubRepo[] }>(
    installationId ? `/api/github/repos?installation_id=${installationId}` : null,
    fetcher,
  );
  const installationRepos = ghRepoData?.repos ?? [];

  const selectedTemplate = templates.find((t) => t.id === template);
  const selectedProject = projects.find((p) => p.id === projectId);
  const availableEnvs = selectedProject?.environments ?? [];
  const selectedEnv = availableEnvs.find((e) => e.id === environmentId);

  // Live preview of the auto subdomain so operators don't have to guess what
  // they'd get. Only meaningful once project + env + slug are all picked.
  const autoSubdomainPreview =
    autoSubdomain && autoSubdomainBase && selectedProject && selectedEnv && slug
      ? `${slug}-${selectedEnv.slug}-${selectedProject.slug}.${autoSubdomainBase}`
      : null;

  // Auto-pick a sensible default project + env once data lands and nothing
  // came from the URL — keeps the form usable in a single-project setup.
  useEffect(() => {
    if (!projectId && projects.length === 1 && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    // If the active project's env list doesn't contain the selected env,
    // reset to the first env in that project. This catches the case where
    // the user changes projects after URL-prefilled an env id.
    if (!availableEnvs.find((e) => e.id === environmentId)) {
      setEnvironmentId(availableEnvs[0]?.id ?? '');
    }
  }, [availableEnvs, environmentId]);

  // Auto-fill image when a template is picked (only if image hasn't been touched).
  useEffect(() => {
    if (selectedTemplate?.primary_image && !image) {
      setImage(selectedTemplate.primary_image);
    }
  }, [selectedTemplate, image]);

  // Auto-slug from name: lowercase, dashes.
  const onNameChange = (v: string) => {
    setName(v);
    if (!slug || slug === slugify(name)) setSlug(slugify(v));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!projectId) { setError('Pick a project'); return; }
    if (!environmentId) { setError('Pick an environment'); return; }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        project_id: projectId,
        environment_id: environmentId,
        name,
        slug,
        kind: 'app',
        image_source: imageSource,
        env: Object.fromEntries(env.filter((row) => row.key).map((row) => [row.key, row.value])),
      };
      const config: Record<string, unknown> = {};
      if (imageSource === 'github') {
        body.github = {
          repo_full_name: repoFullName,
          branch,
          dockerfile_path: dockerfilePath,
          build_context: buildContext,
          ...(installationId ? { installation_id: Number(installationId) } : {}),
        };
      } else {
        body.image = image;
        if (template) body.template = template;
        // Managed siblings only apply to registry-image services in this slice.
        const filteredRequires = requires.filter((r) => r.name.trim());
        if (filteredRequires.length > 0) {
          config.requires = filteredRequires;
        }
      }
      // A half-filled volume row is almost certainly a mistake — silently
      // dropping it would create the service without persistence, the exact
      // data loss volumes exist to prevent. Surface it instead.
      const halfFilled = volumes.find((v) => !v.name.trim() !== !v.mountpoint.trim());
      if (halfFilled) {
        setError('volume rows need both a name and a mountpoint — remove the incomplete row or fill it in');
        return;
      }
      const filteredVolumes = volumes.filter((v) => v.name.trim() && v.mountpoint.trim());
      if (filteredVolumes.length > 0) config.volumes = filteredVolumes;
      if (command.trim()) {
        try {
          config.command = parseCommandLine(command);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'invalid start command');
          return;
        }
      }
      if (Object.keys(config).length > 0) body.config = config;
      if (hostname) body.hostname = hostname;
      if (publicPort) body.public_port = Number(publicPort);
      if (autoSubdomain) body.auto_subdomain = true;

      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'create failed' }));
        setError(payload.error ?? 'create failed');
        return;
      }
      const result = await res.json();
      router.push(`/services/${result.service.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  const noProjects = projData && projects.length === 0;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {noProjects && (
        <Callout tone="warn">
          No projects yet. <a href="/projects" className="underline">Create one first.</a>
        </Callout>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} required>
            <option value="">— pick a project —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.slug})</option>
            ))}
          </Select>
        </Field>
        <Field label="Environment">
          <Select
            value={environmentId}
            onChange={(e) => setEnvironmentId(e.target.value)}
            required
            disabled={!projectId || availableEnvs.length === 0}
          >
            <option value="">
              {projectId
                ? (availableEnvs.length === 0 ? '— no envs in this project —' : '— pick an environment —')
                : '— pick a project first —'}
            </option>
            {availableEnvs.map((e) => (
              <option key={e.id} value={e.id}>{e.name} ({e.slug})</option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="my-api" required />
        </Field>
        <Field label="Slug" hint="lowercase, dashes; unique within the env">
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]$"
            required
          />
        </Field>
      </div>

      <Field label="Source">
        <div className="flex gap-2">
          <Button
            type="button"
            variant={imageSource === 'image' ? 'primary' : 'secondary'}
            onClick={() => setImageSource('image')}
          >
            Image registry
          </Button>
          <Button
            type="button"
            variant={imageSource === 'github' ? 'primary' : 'secondary'}
            onClick={() => setImageSource('github')}
          >
            GitHub repo
          </Button>
        </div>
      </Field>

      {imageSource === 'image' ? (
        <>
          <Field label="Template" hint="optional">
            <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">— none —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </Select>
          </Field>
          {selectedTemplate && (
            <p className="text-xs text-(--color-muted) -mt-2">{selectedTemplate.description}</p>
          )}

          <Field label="Image" hint="image:tag or image@sha256:...">
            <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="ghcr.io/org/app:latest" required />
          </Field>
        </>
      ) : (
        <>
          <p className="text-xs text-(--color-muted)">
            hotbox shallow-clones the repo and builds the image on the host. Set up
            push-to-deploy from the &ldquo;Auto-deploy on push&rdquo; card on the service page.
            Private repos need a GitHub App installation.
          </p>
          {installations.length > 0 && (
            <Field label="GitHub App installation" hint="pick one to browse its repos (incl. private)">
              <Select
                value={installationId}
                onChange={(e) => {
                  setInstallationId(e.target.value);
                  setRepoFullName('');
                }}
              >
                <option value="">— public repo, no App —</option>
                {installations.map((i) => (
                  <option key={i.installation_id} value={i.installation_id}>{i.account_login}</option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            {installationId ? (
              <Field label="Repository">
                <Select
                  value={repoFullName}
                  onChange={(e) => {
                    setRepoFullName(e.target.value);
                    const repo = installationRepos.find((r) => r.full_name === e.target.value);
                    if (repo && branch === 'main') setBranch(repo.default_branch);
                  }}
                  required
                >
                  <option value="">{ghRepoData ? '— pick a repo —' : 'loading…'}</option>
                  {installationRepos.map((r) => (
                    <option key={r.full_name} value={r.full_name}>
                      {r.full_name}{r.private ? ' (private)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Repository" hint="owner/repo (public)">
                <Input
                  value={repoFullName}
                  onChange={(e) => setRepoFullName(e.target.value)}
                  placeholder="vercel/next.js"
                  pattern="^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$"
                  required
                />
              </Field>
            )}
            <Field label="Branch">
              <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" required />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dockerfile path" hint="relative to build context">
              <Input value={dockerfilePath} onChange={(e) => setDockerfilePath(e.target.value)} placeholder="Dockerfile" required />
            </Field>
            <Field label="Build context" hint="relative to repo root">
              <Input value={buildContext} onChange={(e) => setBuildContext(e.target.value)} placeholder="." required />
            </Field>
          </div>
        </>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Field label="Custom hostname" hint={selectedTemplate?.requires_hostname ? 'required for this template' : 'optional'}>
            <Input
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="api.example.com"
              required={selectedTemplate?.requires_hostname}
            />
          </Field>
        </div>
        <Field label="Public port">
          <Input type="number" value={publicPort} onChange={(e) => setPublicPort(e.target.value)} placeholder="8080" />
        </Field>
      </div>

      {autoSubdomainBase ? (
        <div>
          <label className="flex items-start gap-2 text-xs text-(--color-muted)">
            <input
              type="checkbox"
              checked={autoSubdomain}
              onChange={(e) => setAutoSubdomain(e.target.checked)}
              className="mt-0.5"
            />
            <div>
              <div>Auto subdomain on <span className="mono">{autoSubdomainBase}</span></div>
              <p className="text-(--color-muted)/70 mt-0.5">
                Wildcard cert covers the whole base — no DNS or cert action needed per service.
                Can coexist with a custom hostname; both will route to this container.
              </p>
              {autoSubdomainPreview && (
                <div className="mt-1.5 mono text-(--color-accent)">
                  https://{autoSubdomainPreview}
                </div>
              )}
            </div>
          </label>
        </div>
      ) : (
        <p className="text-xs text-(--color-muted)/70 italic">
          Auto subdomain disabled — operator hasn&apos;t set HOTBOX_AUTO_SUBDOMAIN_BASE. See
          docs/AUTO_SUBDOMAINS.md to enable.
        </p>
      )}

      <div>
        <div className="text-xs text-(--color-muted) mb-2 flex items-center justify-between">
          <span>Environment variables</span>
          <button
            type="button"
            onClick={() => setEnv([...env, { key: '', value: '' }])}
            className="text-(--color-accent) hover:underline text-xs"
          >+ add</button>
        </div>
        {env.length === 0 ? (
          <div className="text-xs text-(--color-muted)/70 italic">No env vars</div>
        ) : (
          <div className="space-y-2">
            {env.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                <Input
                  value={row.key}
                  onChange={(e) => setEnv(env.map((r, j) => (i === j ? { ...r, key: e.target.value } : r)))}
                  placeholder="KEY"
                />
                <Input
                  value={row.value}
                  onChange={(e) => setEnv(env.map((r, j) => (i === j ? { ...r, value: e.target.value } : r)))}
                  placeholder="value"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setEnv(env.filter((_, j) => j !== i))}
                >×</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="text-xs text-(--color-muted) mb-2 flex items-start justify-between gap-4">
          <div>
            <div>Volumes</div>
            <p className="text-(--color-muted)/70 mt-0.5">
              Named persistent volumes — data survives redeploys. Services with volumes
              replace containers stop-then-start (brief downtime) so two containers never
              write to one volume.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVolumes([...volumes, { name: '', mountpoint: '' }])}
            className="text-(--color-accent) hover:underline text-xs shrink-0"
          >+ add</button>
        </div>
        {volumes.length === 0 ? (
          <div className="text-xs text-(--color-muted)/70 italic">No volumes</div>
        ) : (
          <div className="space-y-2">
            {volumes.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                <Input
                  value={row.name}
                  onChange={(e) =>
                    setVolumes(volumes.map((r, j) => (i === j ? { ...r, name: e.target.value } : r)))
                  }
                  placeholder="data"
                  pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]?$"
                />
                <Input
                  value={row.mountpoint}
                  onChange={(e) =>
                    setVolumes(volumes.map((r, j) => (i === j ? { ...r, mountpoint: e.target.value } : r)))
                  }
                  placeholder="/var/lib/postgresql/data"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setVolumes(volumes.filter((_, j) => j !== i))}
                >×</Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Field
        label="Start command"
        hint="optional — overrides the image CMD; quotes group arguments, no shell runs"
      >
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="postgres -c wal_level=logical"
        />
      </Field>

      {imageSource === 'image' && (
        <div>
          <div className="text-xs text-(--color-muted) mb-2 flex items-start justify-between gap-4">
            <div>
              <div>Requires</div>
              <p className="text-(--color-muted)/70 mt-0.5">
                Spin up a managed Postgres or Redis sibling. Connection string is injected as{' '}
                <code className="mono">&lt;NAME&gt;_URL</code> on this service. (Not available for
                GitHub services yet — run the dependency separately and wire it with a variable.)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRequires([...requires, { kind: 'postgres', name: '' }])}
              className="text-(--color-accent) hover:underline text-xs shrink-0"
            >+ add</button>
          </div>
          {requires.length === 0 ? (
            <div className="text-xs text-(--color-muted)/70 italic">No managed siblings</div>
          ) : (
            <div className="space-y-2">
              {requires.map((row, i) => (
                <div key={i} className="grid grid-cols-[140px_1fr_auto] gap-2">
                  <Select
                    value={row.kind}
                    onChange={(e) =>
                      setRequires(
                        requires.map((r, j) =>
                          i === j ? { ...r, kind: e.target.value as RequireRow['kind'] } : r,
                        ),
                      )
                    }
                  >
                    <option value="postgres">postgres</option>
                    <option value="redis">redis</option>
                  </Select>
                  <Input
                    value={row.name}
                    onChange={(e) =>
                      setRequires(
                        requires.map((r, j) => (i === j ? { ...r, name: e.target.value } : r)),
                      )
                    }
                    placeholder="db"
                    pattern="^[a-z0-9][a-z0-9-]*[a-z0-9]?$"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setRequires(requires.filter((_, j) => j !== i))}
                  >×</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <Callout tone="error">{error}</Callout>}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={submitting || noProjects}>
          {submitting ? 'Creating…' : 'Create service'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
}
