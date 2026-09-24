import { auth } from "../../auth";
import { redirect } from "next/navigation";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import styles from "./layout.module.css";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <div className={styles.wrapper}>
      <Sidebar
        name={session.user.name ?? null}
        email={session.user.email ?? null}
        isAdmin={session.user.role === "admin"}
      />
      <div className={styles.main}>
        <Topbar />
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
