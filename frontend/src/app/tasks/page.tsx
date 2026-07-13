import { AppShell } from "@/components/layout/AppShell";
import { TasksPage } from "@/components/tasks/TasksPage";

export default function Tasks() {
  return (
    <AppShell>
      <TasksPage />
    </AppShell>
  );
}
