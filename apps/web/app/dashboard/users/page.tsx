import { getSessionContext } from "@repo/auth/context";
import { getUsers } from "../../actions/users";
import { UsersClient } from "./UsersClient";

export default async function UsersPage() {
  const [userList, ctx] = await Promise.all([getUsers(), getSessionContext()]);
  return <UsersClient users={userList} currentUserId={ctx?.userId ?? null} />;
}
