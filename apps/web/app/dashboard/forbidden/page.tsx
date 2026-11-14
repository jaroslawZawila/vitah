import UnavailableNotice from "../../components/UnavailableNotice";

/** "No tienes permiso": where `forbidden()` (lib/access.ts) sends a role that may not see or do something. */
export default function ForbiddenPage() {
  return <UnavailableNotice kind="forbidden" />;
}
