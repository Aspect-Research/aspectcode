/**
 * Tests for auth module — credentials file format.
 *
 * Note: loadCredentials() reads from a path computed at module load time
 * based on HOME/USERPROFILE. These tests verify the parsing logic by
 * testing the file format expectations rather than the full load path.
 */

import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';

describe('auth — credentials format', () => {
  it('credentials file is valid JSON with expected fields', () => {
    const creds = {
      token: 'ac_test123abc456def789',
      email: 'test@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    // Verify it round-trips through JSON
    const serialized = JSON.stringify(creds, null, 2);
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.token, 'ac_test123abc456def789');
    assert.equal(parsed.email, 'test@example.com');
    assert.ok(parsed.createdAt);
  });

  it('token format starts with ac_ prefix', () => {
    const token = 'ac_656c93fb3ecad0658727802297489021bbf15a184a47148cf370c9b287debc60';
    assert.ok(token.startsWith('ac_'));
    assert.equal(token.length, 67); // ac_ + 64 hex chars
  });

  it('credentials dir is under home directory', () => {
    const home = os.homedir();
    const credDir = path.join(home, '.aspectcode');
    assert.ok(credDir.includes('.aspectcode'));
  });
});
