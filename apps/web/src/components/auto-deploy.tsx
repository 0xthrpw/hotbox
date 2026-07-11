'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Callout } from '@/components/ui';
import type { GithubSource } from '@/lib/types';

/**
 * Push-to-deploy setup for a github-source service: shows the webhook URL +
 * per-source secret to paste into the repo's webhook settings, and lets the
 * operator rotate the secret (or mint one for sources created before 4b).
 */
export function AutoDeployCard({
  serviceId,
  source,
  apiBase,
}: {
  serviceId: string;
  source: GithubSource;
  apiBase: string | null;
}) {
  const router = useRouter();
  // A freshly rotated secret overrides the server-rendered one until refresh.
  const [secret, setSecret] = useState(source.webhook_secret);
  const [revealed, setRevealed] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const base = apiBase ?? 'https://<api-host>';
  const url = `${base}/webhooks/github/${source.id}`;

  async function onRotate() {
    if (secret && !confirm('Rotate the webhook secret? The repo webhook must be updated to match.')) {
      return;
    }
    setError(null);
    setRotating(true);
    try {
      const res = await fetch(`/api/services/${serviceId}/webhook-secret`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: 'rotate failed' }));
        setError(payload.error ?? 'rotate failed');
        return;
      }
      const { webhook_secret } = await res.json();
      setSecret(webhook_secret);
      setRevealed(true);
      router.refresh();
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="border border-(--color-border) rounded p-4 space-y-3">
      <p className="text-xs text-(--color-muted)">
        Every push to <span className="mono">{source.branch}</span> queues a build. In the
        GitHub repo: Settings → Webhooks → Add webhook, with content type{' '}
        <span className="mono">application/json</span>, the secret below, and only the{' '}
        <span className="mono">push</span> event.
      </p>

      <div>
        <div className="text-xs text-(--color-muted) mb-1">Payload URL</div>
        <div className="flex items-center gap-2">
          <code className="mono text-xs bg-(--color-bg) px-2 py-1.5 rounded border border-(--color-border) flex-1 break-all">
            {url}
          </code>
          <Button variant="secondary" onClick={() => navigator.clipboard.writeText(url)}>
            Copy
          </Button>
        </div>
      </div>

      <div>
        <div className="text-xs text-(--color-muted) mb-1">Secret</div>
        {secret ? (
          <div className="flex items-center gap-2">
            <code className="mono text-xs bg-(--color-bg) px-2 py-1.5 rounded border border-(--color-border) flex-1 break-all">
              {revealed ? secret : '•'.repeat(24)}
            </code>
            <Button variant="secondary" onClick={() => setRevealed(!revealed)}>
              {revealed ? 'Hide' : 'Reveal'}
            </Button>
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(secret)}>
              Copy
            </Button>
            <Button variant="secondary" onClick={onRotate} disabled={rotating}>
              {rotating ? 'Rotating…' : 'Rotate'}
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-(--color-muted) italic flex-1">
              No secret yet — this source predates push-to-deploy.
            </span>
            <Button onClick={onRotate} disabled={rotating}>
              {rotating ? 'Generating…' : 'Generate secret'}
            </Button>
          </div>
        )}
      </div>

      {error && <Callout tone="error">{error}</Callout>}
      {!apiBase && (
        <p className="text-xs text-(--color-warn)">
          HOTBOX_API_HOST isn&apos;t set on the API, so the URL above shows a placeholder —
          substitute your API host.
        </p>
      )}
    </div>
  );
}
