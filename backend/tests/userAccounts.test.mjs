process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'sb_secret_dummy';
import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../dist/lib/userAccounts.js');

const actor = { id: 'a', name: 'Admin' };

test('createUserAccount rejects a missing name or email before touching the database', async () => {
  const { createUserAccount } = await load();
  const r = await createUserAccount({ dairyUnitId: '1', input: { full_name: '  ', email: '' }, actor });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('createUserAccount rejects an invalid email', async () => {
  const { createUserAccount } = await load();
  const r = await createUserAccount({ dairyUnitId: '1', input: { full_name: 'A', email: 'nope' }, actor });
  assert.equal(r.ok, false);
  assert.match(r.error, /valid email/i);
});

test('email check and temp password helpers', async () => {
  const { isValidEmail, generateTempPassword } = await load();
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(generateTempPassword().length, 12);
});
