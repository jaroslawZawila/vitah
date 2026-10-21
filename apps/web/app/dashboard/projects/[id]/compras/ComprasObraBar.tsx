"use client";

// Container for the obra picker on top of the project's Compras views (by
// line, requests, orders): another obra opens on the same view.

import { useRouter } from "next/navigation";
import ObraPicker from "../../components/ObraPicker";
import type { ObraOption } from "../../components/obra-options";
import { purchasesHref } from "../components/purchasing/links";

export default function ComprasObraBar({ projectId, options, vista }: { projectId: string; options: ObraOption[]; vista?: string }) {
  const router = useRouter();
  return (
    <ObraPicker
      className="mb-[18px]"
      options={options}
      currentId={projectId}
      onSelect={(id) => router.push(`${purchasesHref(id)}${vista ? `?vista=${encodeURIComponent(vista)}` : ""}`)}
    />
  );
}
