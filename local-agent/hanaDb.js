// SAP HANA access via ODBC (the `odbc` npm package + the SAP HANA ODBC
// driver installed on this machine - HDBODBC on Windows/Linux, HDBODBC32
// for 32-bit). This is a native driver, unlike the pure-JS `hdb` client:
// it requires the HANA client/ODBC driver to already be installed and
// registered with the OS (Windows ODBC Data Source Administrator, or
// odbcinst.ini on Linux/macOS).
//
// Connection is DSN-less by default, built from env vars. Set
// HANA_CONNECTION_STRING to override with a full custom ODBC string
// instead (e.g. to use a named DSN or extra driver options).

let poolPromise = null;

function buildConnectionString() {
  if (process.env.HANA_CONNECTION_STRING) {
    return process.env.HANA_CONNECTION_STRING;
  }

  const driver = process.env.HANA_ODBC_DRIVER || 'HDBODBC';
  const host = process.env.HANA_HOST;
  const port = process.env.HANA_PORT || '30015';
  const user = process.env.HANA_USER;
  const password = process.env.HANA_PASSWORD;
  const encrypt = String(process.env.HANA_ENCRYPT || 'false').toLowerCase() === 'true';

  if (!host || !user || !password) {
    throw new Error(
      'HANA is not configured on this connector: set HANA_HOST, HANA_USER, HANA_PASSWORD (and HANA_PORT) in .env, or provide HANA_CONNECTION_STRING directly.'
    );
  }

  let cs = `Driver={${driver}};ServerNode=${host}:${port};UID=${user};PWD=${password};`;
  if (encrypt) {
    cs += 'ENCRYPT=TRUE;sslValidateCertificate=false;';
  }
  if (process.env.HANA_DATABASE) {
    // Tenant/MDC database name, when connecting via the system-DB port.
    cs += `DATABASENAME=${process.env.HANA_DATABASE};`;
  }
  if (process.env.HANA_ODBC_EXTRA) {
    cs += `${process.env.HANA_ODBC_EXTRA};`;
  }
  return cs;
}

async function getPool() {
  if (!poolPromise) {
    poolPromise = (async () => {
      const odbc = (await import('odbc')).default;
      const connectionString = buildConnectionString();
      return odbc.pool({
        connectionString,
        initialSize: 1,
        maxSize: Number(process.env.HANA_POOL_MAX || 5)
      });
    })();
  }
  return poolPromise;
}

export async function runQuery(sql, values) {
  const pool = await getPool();
  const result = await pool.query(sql, values && values.length ? values : undefined);
  return result;
}

export async function runRawQuery(sql) {
  return runQuery(sql, []);
}
