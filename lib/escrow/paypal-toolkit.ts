import 'server-only';
// PayPal's own Agent Toolkit, read-only: before asking for a release, the reviewer looks the order up
// on PayPal itself. The toolkit runs in-process as an MCP server and only `get_order` is switched on,
// so nothing it exposes can move money; the release still goes through policy.ts and the second opinion.

import { mcpTools, type MCPCallToolResultLike, type MCPClientLike } from '@anthropic-ai/sdk/helpers/beta/mcp';
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/mcp';
import { paypalAccessToken } from '../paypal.ts';

export async function paypalOrderTools(onCall: (orderId: string) => void): Promise<{ tools: BetaRunnableTool[]; close: () => Promise<void> }> {
  const server = new PayPalAgentToolkit({
    accessToken: await paypalAccessToken(),
    configuration: { actions: { orders: { get: true } }, context: { sandbox: true } },
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'proof-of-done-reviewer', version: '1.0.0' });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  // The MCP SDK still types an old `toolResult` result shape; the toolkit always answers with content.
  const caller: MCPClientLike = {
    callTool: async (params) => {
      const result = await client.callTool(params);
      return 'content' in result ? (result as MCPCallToolResultLike) : { content: [{ type: 'text', text: JSON.stringify(result.toolResult) }] };
    },
  };
  const runnable = mcpTools(
    tools.filter((t) => t.name === 'get_order'),
    caller,
  ).map((t) => ({
    ...t,
    run: (args: Record<string, unknown>, ctx?: Parameters<typeof t.run>[1]) => {
      onCall(String(args.id ?? ''));
      return t.run(args, ctx);
    },
  }));
  return {
    tools: runnable,
    close: async () => {
      await client.close().catch(() => {});
      await server.close().catch(() => {});
    },
  };
}
