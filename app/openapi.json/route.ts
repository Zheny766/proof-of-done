import { openApiDocument } from '@/lib/openapi';
import { publicOrigin } from '@/lib/origin';

// The HTTP API as OpenAPI 3.1 (lib/openapi.ts), for agents and for generating client SDKs.
export function GET(request: Request) {
  return Response.json(openApiDocument(publicOrigin(request)), { headers: { 'access-control-allow-origin': '*' } });
}
