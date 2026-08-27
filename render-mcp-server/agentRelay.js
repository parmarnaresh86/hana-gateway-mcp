import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

// Parses CONNECTOR_TOKENS="office-pc:token1,warehouse-pc:token2" into a Map.
function parseConnectorTokens() {
  const raw = process.env.CONNECTOR_TOKENS || '';
  const map = new Map();
  raw
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const idx = pair.indexOf(':');
      if (idx === -1) return;
      const id = pair.slice(0, idx).trim();
      const token = pair.slice(idx + 1).trim();
      if (id && token) map.set(id, token);
    });
  return map;
}

export function createAgentRelay() {
  const connectors = new Map(); // connectorId -> ws
  const pending = new Map(); // requestId -> { resolve, reject, timeout }

  function attach(server) {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      let url;
      try {
        url = new URL(req.url, 'http://localhost');
      } catch {
        socket.destroy();
        return;
      }

      if (url.pathname !== '/agent') {
        socket.destroy();
        return;
      }

      const connectorId = url.searchParams.get('connectorId');
      const token = url.searchParams.get('token');
      const tokens = parseConnectorTokens();

      if (!connectorId || !token || tokens.get(connectorId) !== token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, connectorId);
      });
    });

    wss.on('connection', (ws, req, connectorId) => {
      // A new connection for the same ID replaces the old one (e.g. the
      // agent restarted). Close the stale socket rather than leaving it
      // as a zombie entry.
      const existing = connectors.get(connectorId);
      if (existing && existing !== ws) {
        try {
          existing.close();
        } catch {
          // ignore
        }
      }

      connectors.set(connectorId, ws);
      console.log(`[agent-relay] connector online: ${connectorId}`);

      ws.on('message', (data) => {
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }

        if (msg.type === 'job_result' && msg.requestId) {
          const entry = pending.get(msg.requestId);
          if (!entry) return;
          clearTimeout(entry.timeout);
          pending.delete(msg.requestId);
          if (msg.error) entry.reject(new Error(msg.error));
          else entry.resolve(msg.result);
        }
      });

      ws.on('close', () => {
        if (connectors.get(connectorId) === ws) {
          connectors.delete(connectorId);
          console.log(`[agent-relay] connector offline: ${connectorId}`);
        }
      });

      ws.on('error', () => {
        // 'close' fires after 'error' for the same socket; cleanup happens there.
      });
    });
  }

  function sendJob(connectorId, job, timeoutMs = 20000) {
    const ws = connectors.get(connectorId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Connector "${connectorId}" is not connected.`));
    }

    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Timed out waiting for connector "${connectorId}" to respond.`));
      }, timeoutMs);

      pending.set(requestId, { resolve, reject, timeout });
      ws.send(JSON.stringify({ type: 'job', requestId, ...job }));
    });
  }

  function listConnectors() {
    return Array.from(connectors.keys());
  }

  return { attach, sendJob, listConnectors };
}
