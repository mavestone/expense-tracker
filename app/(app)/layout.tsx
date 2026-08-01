import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/auth";
import AppShell from "@/components/AppShell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAuthed())) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
