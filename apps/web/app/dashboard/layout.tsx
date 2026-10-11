import { auth } from "../../auth";
import { redirect } from "next/navigation";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <Sidebar
        name={session.user.name ?? null}
        email={session.user.email ?? null}
        isAdmin={session.user.role === "admin"}
      />
      <div className="flex min-w-0 flex-col">
        <Topbar />
        <div className="flex w-full max-w-[1300px] min-w-0 flex-col gap-5 px-4 pt-[18px] pb-16 sm:px-7 sm:pt-6">
          {children}
        </div>
      </div>
    </div>
  );
}
