"use client";

// Container for the General tab's process stepper: the only part of it that
// knows about server actions. ObraStages takes props only.

import type { ProjectObra } from "@repo/core/contract";
import { setObraStageAction } from "../../../actions/obra";
import FormError from "../../components/FormError";
import ObraStages from "./components/obra/ObraStages";
import { useObraAction } from "./components/obra/useObraAction";

/** The project's 8 stages: everyone sees where it is, editors move it. */
export default function ProjectStages({
  projectId,
  obra,
  canManage,
}: {
  projectId: string;
  obra: ProjectObra;
  canManage: boolean;
}) {
  const { state, run } = useObraAction();
  return (
    <>
      <ObraStages obra={obra} onSetStage={canManage ? (stage) => run(() => setObraStageAction(projectId, stage)) : undefined} />
      <FormError namespace="obra.errors" error={state?.error} />
    </>
  );
}
