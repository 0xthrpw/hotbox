'use client';

import Link from 'next/link';
import { Button } from '@/components/ui';

/**
 * CI deploy-hook snippets for a service. github-source services rebuild from
 * the branch head (`POST …/builds`); image services cut a new deployment
 * (`POST …/deployments` — pass {"image": "…"} to move to a new tag).
 * Auth is a service-scoped api token with the 'deploy' scope.
 */
export function DeployHookPanel({
  serviceId,
  imageSource,
  apiBase,
}: {
  serviceId: string;
  imageSource: 'image' | 'github';
  apiBase: string | null;
}) {
  const base = apiBase ?? 'https://<api-host>';
  const path = imageSource === 'github' ? 'builds' : 'deployments';
  const url = `${base}/api/services/${serviceId}/${path}`;

  const curl = `curl -fsS -X POST "${url}" \\
  -H "Authorization: Bearer $HOTBOX_DEPLOY_TOKEN"`;

  const actionsStep = `- name: Deploy to hotbox
  run: |
    curl -fsS -X POST "${url}" \\
      -H "Authorization: Bearer \${{ secrets.HOTBOX_DEPLOY_TOKEN }}"`;

  return (
    <div className="border border-(--color-border) rounded p-4 space-y-3">
      <p className="text-xs text-(--color-muted)">
        Trigger a {imageSource === 'github' ? 'rebuild from source' : 'redeploy'} from CI.
        Create an <span className="mono">api</span>-kind token scoped to this service on the{' '}
        <Link href="/tokens" className="underline">Tokens</Link> page and store it as a CI
        secret — it authorizes deploys for this service only.
      </p>
      <Snippet label="curl" text={curl} />
      <Snippet label="GitHub Actions step" text={actionsStep} />
      {!apiBase && (
        <p className="text-xs text-(--color-warn)">
          HOTBOX_API_HOST isn&apos;t set on the API, so the URL above shows a placeholder —
          substitute your API host.
        </p>
      )}
    </div>
  );
}

function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="text-xs text-(--color-muted) mb-1">{label}</div>
      <div className="flex items-start gap-2">
        <pre className="mono text-xs bg-(--color-bg) px-2 py-1.5 rounded border border-(--color-border) flex-1 overflow-x-auto whitespace-pre">
          {text}
        </pre>
        <Button variant="secondary" onClick={() => navigator.clipboard.writeText(text)}>
          Copy
        </Button>
      </div>
    </div>
  );
}
