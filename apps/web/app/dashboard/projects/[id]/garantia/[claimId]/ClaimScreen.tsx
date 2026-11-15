"use client";

// Container for a warranty claim: the only part of it that calls a server
// action. The views in ../../components/warranty take props only.

import { useState } from "react";
import { useTranslations } from "next-intl";
import { warrantyRef, type WarrantyClaim } from "@repo/core/contract";
import { updateClaimAction, type WarrantyState } from "../../../../../actions/warranty";
import BackLink from "../../../../components/BackLink";
import { useConfirm } from "../../../../components/useConfirm";
import { useObraAction } from "../../components/obra/useObraAction";
import TabHeader from "../../components/TabHeader";
import { ClaimFacts, ClaimForm, ClaimHistory, type ClaimValues } from "../../components/warranty/WarrantyViews";

/** A claim's photo (or its thumbnail), served by /api/v1 with the session. */
export const claimPhotoUrl = (projectId: string, claimId: string, photoId: string, thumb: boolean) =>
  `/api/v1/projects/${projectId}/warranty/${claimId}/photos/${photoId}${thumb ? "?size=thumb" : ""}`;

export default function ClaimScreen({
  projectId,
  projectRef,
  claim,
  canManage,
}: {
  projectId: string;
  projectRef: string;
  claim: WarrantyClaim;
  canManage: boolean;
}) {
  const t = useTranslations("warranty");
  const { state, pending, run } = useObraAction<WarrantyState>();
  const confirm = useConfirm("warranty.errors");
  const [saved, setSaved] = useState(false);

  const save = (values: ClaimValues) => {
    setSaved(false);
    run(() => updateClaimAction(projectId, claim.id, values), () => setSaved(true));
  };
  // Not accepting a request tells the client in the app: say so before it does.
  const submit = (values: ClaimValues) => {
    if (values.status !== "rejected") return save(values);
    setSaved(false);
    confirm.ask({
      t,
      key: "reject",
      keep: true,
      values: { ref: warrantyRef(claim.number) },
      destructive: true,
      action: () => updateClaimAction(projectId, claim.id, values),
      onDone: () => setSaved(true),
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <BackLink href={`/dashboard/projects/${projectId}/garantia`} />
      <TabHeader
        projectRef={t("claim.label", { ref: projectRef })}
        title={warrantyRef(claim.number)}
        summary={`${t(`kind.${claim.kind}`)} · ${t(`room.${claim.room}`)}`}
      />
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <ClaimFacts claim={claim} photoUrl={(photoId, thumb) => claimPhotoUrl(projectId, claim.id, photoId, thumb)} />
          <ClaimHistory events={claim.events} />
        </div>
        {canManage && (
          <aside className="flex min-w-0 flex-col gap-5">
            <ClaimForm
              // A fresh form once the saved claim comes back.
              key={claim.updatedAt}
              claim={claim}
              pending={pending}
              error={state?.error}
              saved={saved}
              onSubmit={submit}
            />
          </aside>
        )}
      </div>
      {confirm.dialog}
    </div>
  );
}
