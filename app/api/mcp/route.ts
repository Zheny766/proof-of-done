import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { registerTools } from '@/mcp/tools.mjs';
import { publicOrigin } from '@/lib/origin';
import { allowRequest } from '@/lib/rate-limit';

// The same agent tools as mcp/proof-of-done.mjs, hosted: `claude mcp add --transport http
// proof-of-done https://<host>/api/mcp`. Stateless: every request gets a fresh server, and the tools
// call this site's public API like any other client.
export const maxDuration = 300;

async function serve(request: Request): Promise<Response> {
  if (!allowRequest(request, 'mcp', 60)) return Response.json({ error: 'Too many requests, try again in a minute.' }, { status: 429 });
  const server = new McpServer({ name: 'proof-of-done', version: '1.1.0' });
  registerTools(server, { base: publicOrigin(request), maxWaitSeconds: 240 });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  void server.close().catch(() => {});
  return response;
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
