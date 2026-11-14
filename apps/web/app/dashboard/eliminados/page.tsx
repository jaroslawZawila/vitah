import { notFound } from "next/navigation";
import { getDeleted } from "../../actions/deleted";
import EliminadosScreen from "./EliminadosScreen";

/** Elementos eliminados: what users deleted, for an admin to restore (from the rail's settings menu). */
export default async function DeletedPage() {
  const list = await getDeleted();
  if (!list) notFound();
  return <EliminadosScreen initial={list} />;
}
