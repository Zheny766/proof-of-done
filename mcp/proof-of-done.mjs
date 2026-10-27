#!/usr/bin/env node
// Proof of Done as a local MCP server (stdio). An AI agent can find a paid job on the open board and
// do it, deliver through a freelancer link it was given, or post a job (a human approves the payment
// in PayPal). The tools are in ./tools.mjs; the hosted server at /api/mcp offers the same ones.
//
//   Claude Code:  claude mcp add proof-of-done -e POD_BASE_URL=http://localhost:3000 -- node /path/to/proof-of-done/mcp/proof-of-done.mjs
//   POD_BASE_URL  the Proof of Done server (default http://localhost:3000); deal links carry their own host.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.mjs';

const server = new McpServer({ name: 'proof-of-done', version: '1.1.0' });
registerTools(server, { base: process.env.POD_BASE_URL || 'http://localhost:3000', localFiles: true });
await server.connect(new StdioServerTransport());
