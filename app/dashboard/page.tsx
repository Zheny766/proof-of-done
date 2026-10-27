import type { Metadata } from "next";
import { connection } from "next/server";
import { aiModels, isClaudeConfigured } from "@/lib/ai";
import { getEscrowDashboardData } from "@/lib/escrow/analytics";
import { seedDemoIfEmpty } from "@/lib/escrow/demo";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "Escrow analytics",
};

export default async function DashboardPage() {
  // Live escrow data: render per request, not at build time.
  await connection();
  seedDemoIfEmpty();
  const data = getEscrowDashboardData();

  // Only the model ids reach the client; the Anthropic key stays on the server (lib/ai.ts).
  return (
    <Dashboard
      data={data}
      licenseKey={process.env.AG_STUDIO}
      aiModels={isClaudeConfigured() ? aiModels() : undefined}
    />
  );
}
