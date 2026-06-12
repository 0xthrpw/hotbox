import { redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { TopNav } from '@/components/nav';
import { TeamClient, type UserRow, type InviteRow } from './team-client';

export default async function TeamPage() {
  let users: UserRow[];
  let invites: InviteRow[];
  let me: { id: string };
  try {
    [{ users }, { invites }, { user: me }] = await Promise.all([
      apiFetch<{ users: UserRow[] }>('/api/users'),
      apiFetch<{ invites: InviteRow[] }>('/api/users/invites'),
      apiFetch<{ user: { id: string } }>('/api/me'),
    ]);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('401')) redirect('/login');
    if (msg.includes('403')) redirect('/');
    throw err;
  }

  return (
    <>
      <TopNav />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <TeamClient initialUsers={users} initialInvites={invites} meId={me.id} />
      </main>
    </>
  );
}
