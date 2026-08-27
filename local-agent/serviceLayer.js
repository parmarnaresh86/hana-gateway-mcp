// SAP Business One Service Layer client. Cookie-based session (B1SESSION +
// ROUTEID), auto re-login on 401. Only GET is ever issued from this module -
// there is no method for POST/PATCH/DELETE, so a compromised/misbehaving
// server side can never turn a "query" job into a write against SAP B1.

import { Agent, fetch as undiciFetch } from 'undici';

let sessionCookie = null;
let loginPromise = null;

function requireConfig() {
  const { SAP_B1_BASE_URL, SAP_B1_COMPANY, SAP_B1_USER, SAP_B1_PASSWORD } = process.env;
  if (!SAP_B1_BASE_URL || !SAP_B1_COMPANY || !SAP_B1_USER || !SAP_B1_PASSWORD) {
    throw new Error(
      'Service Layer is not configured on this connector: set SAP_B1_BASE_URL, SAP_B1_COMPANY, SAP_B1_USER, SAP_B1_PASSWORD in .env.'
    );
  }
  return { SAP_B1_BASE_URL, SAP_B1_COMPANY, SAP_B1_USER, SAP_B1_PASSWORD };
}

function getDispatcher() {
  const rejectUnauthorized = String(process.env.SAP_B1_REJECT_UNAUTHORIZED || 'true').toLowerCase() !== 'false';
  return new Agent({ connect: { rejectUnauthorized } });
}

async function login() {
  const { SAP_B1_BASE_URL, SAP_B1_COMPANY, SAP_B1_USER, SAP_B1_PASSWORD } = requireConfig();

  const res = await undiciFetch(`${SAP_B1_BASE_URL.replace(/\/$/, '')}/Login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      CompanyDB: SAP_B1_COMPANY,
      UserName: SAP_B1_USER,
      Password: SAP_B1_PASSWORD
    }),
    dispatcher: getDispatcher()
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Service Layer login failed (${res.status}): ${text || res.statusText}`);
  }

  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  const cookie = setCookie
    .map((c) => c.split(';')[0])
    .filter((c) => c.startsWith('B1SESSION=') || c.startsWith('ROUTEID='))
    .join('; ');

  if (!cookie) {
    throw new Error('Service Layer login succeeded but no session cookie was returned.');
  }

  sessionCookie = cookie;
  return cookie;
}

async function ensureSession() {
  if (sessionCookie) return sessionCookie;
  if (!loginPromise) {
    loginPromise = login().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
}

function buildUrl(baseUrl, path, query) {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

// GET-only: `path` is a Service Layer resource path (e.g. "Items" or
// "Items('A001')"), `query` is a plain object of OData query options
// (e.g. { $filter, $select, $top, $orderby, $expand }).
export async function serviceLayerGet(path, query) {
  const { SAP_B1_BASE_URL } = requireConfig();
  const url = buildUrl(SAP_B1_BASE_URL, path, query);

  let cookie = await ensureSession();
  let res = await undiciFetch(url, {
    method: 'GET',
    headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    dispatcher: getDispatcher()
  });

  if (res.status === 401) {
    // Session expired - force a fresh login and retry once.
    sessionCookie = null;
    cookie = await ensureSession();
    res = await undiciFetch(url, {
      method: 'GET',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      dispatcher: getDispatcher()
    });
  }

  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const message = body && body.error ? body.error.message?.value || JSON.stringify(body.error) : text;
    throw new Error(`Service Layer GET ${path} failed (${res.status}): ${message}`);
  }

  return body;
}
