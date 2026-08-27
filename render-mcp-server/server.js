import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createAgentRelay } from './agentRelay.js';

const relay = createAgentRelay();
const MCP_ACCESS_TOKEN = (process.env.MCP_ACCESS_TOKEN || '').trim();

if (!MCP_ACCESS_TOKEN) {
  console.warn(
    '[security] MCP_ACCESS_TOKEN is not set - /mcp is open to anyone with the URL. Set MCP_ACCESS_TOKEN in the environment to require a token.'
  );
}

function requireMcpAuth(req, res, next) {
  if (!MCP_ACCESS_TOKEN) return next();

  const auth = req.headers.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const queryToken = typeof req.query.key === 'string' ? req.query.key : '';

  if (bearer === MCP_ACCESS_TOKEN || queryToken === MCP_ACCESS_TOKEN) return next();

  res.status(401).json({
    jsonrpc: '2.0',
    error: { code: -32001, message: 'Unauthorized: missing or invalid access token' },
    id: null
  });
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/healthz', (req, res) => {
  res.json({ ok: true, connectors: relay.listConnectors() });
});

function createMcpServer() {
  const server = new McpServer({ name: 'hana-gateway-mcp', version: '1.0.0' });

  server.tool(
    'list_connectors',
    'List which local HANA/Service-Layer connectors are currently online and reachable.',
    {},
    async () => {
      const connectors = relay.listConnectors();
      return {
        content: [
          {
            type: 'text',
            text: connectors.length
              ? `Online connectors: ${connectors.join(', ')}`
              : 'No connectors are currently online.'
          }
        ]
      };
    }
  );

  server.tool(
    'run_named_query',
    'Run a pre-approved, named, parameterized SQL query against a specific connector\'s HANA database (over its ODBC connection). This never accepts raw SQL - only a queryName that must already be allowlisted on that connector, plus named params.',
    {
      connectorId: z
        .string()
        .describe('Which connector/PC to run the query on. Use list_connectors to see available IDs.'),
      queryName: z.string().describe('The name of an allowlisted query defined on that connector.'),
      params: z.record(z.any()).optional().describe('Named parameters required by that query.')
    },
    async ({ connectorId, queryName, params }) => {
      try {
        const result = await relay.sendJob(connectorId, { queryName, params: params || {} });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'run_sql_query',
    'Run an ad-hoc, read-only SQL SELECT query against a specific connector\'s HANA database over its ODBC connection. Write HANA SQL yourself based on the schema you know or discover (e.g. via SYS.TABLES / SYS.TABLE_COLUMNS). The connector enforces read-only (SELECT-only) at the agent side regardless of what is sent - INSERT/UPDATE/DELETE/DDL will be rejected.',
    {
      connectorId: z
        .string()
        .describe('Which connector/PC to run the query on. Use list_connectors to see available IDs.'),
      sql: z.string().describe('A single read-only SQL SELECT statement to run against HANA.')
    },
    async ({ connectorId, sql }) => {
      try {
        const result = await relay.sendJob(connectorId, { sql });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'run_service_layer_query',
    'Run a read-only GET request against a specific connector\'s SAP Business One Service Layer (OData). The connector logs into Service Layer itself (cookie-based, auto-renewed) - the client just supplies the resource path and optional OData query options. Only GET is ever issued, regardless of what is requested - no create/update/delete.',
    {
      connectorId: z
        .string()
        .describe('Which connector/PC to run the request on. Use list_connectors to see available IDs.'),
      path: z
        .string()
        .describe('Service Layer resource path, e.g. "Items", "Items(\'A001\')", "BusinessPartners", "SalesOrders(123)".'),
      query: z
        .record(z.string())
        .optional()
        .describe('OData query options as key/value pairs, e.g. { "$filter": "ItemsGroupCode eq 100", "$select": "ItemCode,ItemName", "$top": "20" }.')
    },
    async ({ connectorId, path, query }) => {
      try {
        const result = await relay.sendJob(connectorId, { slPath: path, slQuery: query || {} });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  return server;
}

// One MCP session per Streamable HTTP session ID, per the SDK's documented pattern.
const transports = {};

app.post('/mcp', requireMcpAuth, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  let transport;

  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports[sid] = transport;
      }
    });

    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };

    const server = createMcpServer();
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
      id: null
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

async function handleSessionRequest(req, res) {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
}

app.get('/mcp', requireMcpAuth, handleSessionRequest);
app.delete('/mcp', requireMcpAuth, handleSessionRequest);

const PORT = process.env.PORT || 3000;
const httpServer = http.createServer(app);
relay.attach(httpServer);

httpServer.listen(PORT, () => {
  console.log(`HANA Gateway MCP server listening on port ${PORT}`);
  console.log('MCP endpoint:   /mcp');
  console.log('Agent relay:    /agent');
  console.log('Health check:   /healthz');
});
