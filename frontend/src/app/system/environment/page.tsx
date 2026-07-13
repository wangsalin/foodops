import { AppShell } from "@/components/layout/AppShell";
import { EnvironmentStatusPage } from "@/components/system/EnvironmentStatusPage";

export default function Page() {
  return (
    <AppShell>
      <EnvironmentStatusPage />
    </AppShell>
  );
}
