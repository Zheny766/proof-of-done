import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerTools } from '@/mcp/tools.mjs';
import { selfOrigin } from '@/lib/origin';
import { allowRequest } from '@/lib/rate-limit';

// The same agent tools as mcp/proof-of-done.mjs, hosted: `claude mcp add --transport http
// proof-of-done https://<host>/api/mcp`. Stateless: every request gets a fresh server, and the tools
// call this site's public API like any other client.
export const maxDuration = 300;

async function serve(request: Request): Promise<Response> {
  if (!allowRequest(request, 'mcp', 60)) return Response.json({ error: 'Too many requests, try again in a minute.' }, { status: 429 });
  // submit_work can carry files inline (base64), so allow up to 20 MB, but never a body of unknown size.
  if (request.body && (request.headers.get('content-length') === null || Number(request.headers.get('content-length')) > 20_000_000)) {
    return Response.json({ error: 'Send a JSON-RPC body of at most 20 MB with a Content-Length.' }, { status: 413 });
  }
  const base = selfOrigin(request);
  if (!base) return Response.json({ error: 'Set POD_PUBLIC_URL to this server’s public address to host the MCP server.' }, { status: 503 });
  const server = new McpServer({ name: 'proof-of-done', version: '1.1.0' });
  registerTools(server, { base, maxWaitSeconds: 240 });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  void server.close().catch(() => {});
  return response;
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
