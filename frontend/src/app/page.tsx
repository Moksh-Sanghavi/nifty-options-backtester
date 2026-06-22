import { AppSidebar } from "@/components/app-sidebar";
import { Dashboard } from "@/components/dashboard";

export default function Home() {
  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <Dashboard />
    </div>
  );
}
