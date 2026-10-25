import type { Metadata } from "next";
import { connection } from "next/server";
import { aiEnabled, aiModels } from "@/lib/ai";
import { getEscrowDashboardData } from "@/lib/escrow/analytics";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = {
  title: "Escrow analytics",
};

export default async function DashboardPage() {
  // Live escrow data: render per request, not at build time.
  await connection();
  const data = getEscrowDashboardData();

  // Only the model ids reach the client; the Anthropic key stays on the server (lib/ai.ts).
  return (
    <Dashboard
      data={data}
      licenseKey={process.env.AG_STUDIO}
      aiModels={aiEnabled() ? aiModels() : undefined}
    />
  );
}
