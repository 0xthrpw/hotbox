import { apiFetch } from '@/lib/api';
import { SignupClient } from './signup-client';

const STATUS_MESSAGES: Record<string, string> = {
  invalid: 'This invite link is not valid.',
  revoked: 'This invite link has been revoked.',
  used: 'This invite link has already been used.',
  expired: 'This invite link has expired.',
};

export default async function SignupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { status } = await apiFetch<{ status: string; note?: string | null }>(
    `/api/signup/${encodeURIComponent(token)}`,
  );

  if (status !== 'valid') {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="w-80 border border-(--color-border) rounded-lg p-6 bg-(--color-surface)">
          <h1 className="text-lg font-semibold mb-3">hotbox</h1>
          <p className="text-sm text-(--color-muted)">
            {STATUS_MESSAGES[status] ?? STATUS_MESSAGES.invalid} Ask your admin for a new one.
          </p>
        </div>
      </main>
    );
  }

  return <SignupClient token={token} />;
}
