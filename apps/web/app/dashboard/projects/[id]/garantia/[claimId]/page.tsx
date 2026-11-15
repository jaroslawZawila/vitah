import { notFound } from "next/navigation";
import { getProject } from "../../../../../actions/projects";
import { getWarrantyClaim } from "../../../../../actions/warranty";
import ClaimScreen from "./ClaimScreen";

/** A warranty claim: what the client sent, staff's answer and its history. A claim that isn't there is "No encontrado". */
export default async function WarrantyClaimPage({ params }: { params: Promise<{ id: string; claimId: string }> }) {
  const { id, claimId } = await params;
  const [project, result] = await Promise.all([getProject(id), getWarrantyClaim(id, claimId)]);
  if (!result) notFound();
  return <ClaimScreen projectId={project.id} projectRef={project.ref} claim={result.claim} canManage={result.canManage} />;
}
