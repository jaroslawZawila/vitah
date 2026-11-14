import { requireSession } from "@/lib/access";
import { getUsers } from "../../actions/users";
import { UsersClient } from "./UsersClient";

export default async function UsersPage() {
  const [userList, ctx] = await Promise.all([getUsers(), requireSession()]);
  return <UsersClient users={userList} currentUserId={ctx.userId} />;
}
