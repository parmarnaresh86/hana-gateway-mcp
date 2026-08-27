// Guards ad-hoc SQL text (from the run_sql_query tool) to read-only SELECTs.
// This is defense in depth on the agent side, independent of whatever the
// server/client claims - the agent decides what it's willing to run.

const BLOCKED_KEYWORDS = [
  'insert', 'update', 'delete', 'drop', 'alter', 'truncate', 'merge',
  'create', 'grant', 'revoke', 'exec', 'execute', 'call', 'sp_', 'xp_',
  'into', 'backup', 'restore', 'shutdown', 'openrowset', 'opendatasource'
];

export function assertReadOnlySelect(sql) {
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('SQL text is empty.');
  }

  const stripped = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  const statements = stripped.split(';').map((s) => s.trim()).filter(Boolean);
  if (statements.length > 1) {
    throw new Error('Only a single SELECT statement is allowed per query.');
  }

  const body = statements[0] || '';
  const firstWord = body.split(/\s+/)[0]?.toLowerCase();
  if (firstWord !== 'select' && firstWord !== 'with') {
    throw new Error('Only SELECT statements are allowed.');
  }

  const lower = body.toLowerCase();
  for (const keyword of BLOCKED_KEYWORDS) {
    const pattern = new RegExp(`(^|[^a-z0-9_])${keyword}([^a-z0-9_]|$)`, 'i');
    if (pattern.test(lower)) {
      throw new Error(`Blocked keyword "${keyword}" found in query. Only read-only SELECT statements are allowed.`);
    }
  }

  return body;
}
