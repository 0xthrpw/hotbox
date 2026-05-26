import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createDb } from '@hotbox/db';
import { hashPassword } from '../src/auth.js';

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('DATABASE_URL is required'); process.exit(1); }

  const email = process.env.SEED_ADMIN_EMAIL ?? (await ask('Admin email: '));
  const password = process.env.SEED_ADMIN_PASSWORD ?? (await ask('Admin password: ', true));
  const hostName = process.env.SEED_HOST_NAME ?? 'local';
  const hostAddress = process.env.SEED_HOST_ADDRESS ?? '127.0.0.1';

  if (!email || password.length < 8) {
    console.error('email is required and password must be >= 8 chars');
    process.exit(1);
  }

  const db = createDb({ connectionString: dbUrl });

  const existingHost = await db.selectFrom('hosts').select('id').where('name', '=', hostName).executeTakeFirst();
  let hostId: string;
  if (existingHost) {
    hostId = existingHost.id;
    console.log(`host '${hostName}' already exists: ${hostId}`);
  } else {
    const inserted = await db
      .insertInto('hosts')
      .values({ name: hostName, address: hostAddress, status: 'ready' })
      .returning('id')
      .executeTakeFirstOrThrow();
    hostId = inserted.id;
    console.log(`created host '${hostName}': ${hostId}`);
  }

  const existingUser = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
  if (existingUser) {
    console.log(`user '${email}' already exists: ${existingUser.id}`);
  } else {
    const hashed = await hashPassword(password);
    const user = await db
      .insertInto('users')
      .values({ email, password_hash: hashed, role: 'admin' })
      .returning('id')
      .executeTakeFirstOrThrow();
    console.log(`created user '${email}': ${user.id}`);
  }

  await db.destroy();
  console.log(`\nPaste this into .env:\n  HOST_ID=${hostId}\n`);
}

async function ask(prompt: string, silent = false): Promise<string> {
  const rl = createInterface({ input, output, terminal: true });
  if (silent) {
    // crude no-echo: rewrite the line as the user types
    const realWrite = (output as NodeJS.WriteStream).write.bind(output);
    rl.on('line', () => { /* noop */ });
    (output as NodeJS.WriteStream & { write: (...args: unknown[]) => boolean }).write = ((c: unknown, ...rest: unknown[]) => {
      if (typeof c === 'string' && c !== prompt && c !== '\n' && c !== '\r\n') return realWrite('*');
      return realWrite(c as string, ...(rest as []));
    }) as typeof realWrite;
    const ans = await rl.question(prompt);
    (output as NodeJS.WriteStream & { write: typeof realWrite }).write = realWrite;
    rl.close();
    return ans.trim();
  }
  const ans = await rl.question(prompt);
  rl.close();
  return ans.trim();
}

main().catch((err) => { console.error(err); process.exit(1); });
