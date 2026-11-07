import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import Navbar from "@/components/Navbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="min-h-screen">
      <Navbar />
      {/* On a phone, room at the bottom for the tab bar and the home indicator. */}
      <main className="mx-auto max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-5 sm:py-6">{children}</main>
    </div>
  );
}
