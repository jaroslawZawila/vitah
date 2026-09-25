"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ClientOption } from "@repo/core/contract";
import { fieldStyles as f } from "../../../components/wizard/fields";
import SummaryList from "../../../components/wizard/SummaryList";
import type { ProjectDraft, ProjectFlowOptions, ProjectStepProps } from "../draft";

/** Show a search box once the list gets longer than this. */
const SEARCH_THRESHOLD = 6;

function matches(client: ClientOption, query: string) {
  const q = query.trim().toLowerCase();
  return !q || `${client.name ?? ""} ${client.email}`.toLowerCase().includes(q);
}

/** Step: optionally attach an existing client who will see the project in the app. */
export function ClientStep({ draft, onChange, options }: ProjectStepProps) {
  const t = useTranslations("newProjectPage.client");
  const [query, setQuery] = useState("");
  const { clients } = options;
  const visible = clients.filter((client) => matches(client, query));

  return (
    <fieldset className={f.choices}>
      <legend className={f.intro}>{t("intro")}</legend>

      {clients.length > SEARCH_THRESHOLD && (
        <div className={f.field}>
          <label htmlFor="client-search">{t("search")}</label>
          <input
            id="client-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
          />
        </div>
      )}

      <label className={f.choice}>
        <input
          type="radio"
          name="clientId"
          value=""
          checked={draft.clientId === ""}
          onChange={() => onChange({ clientId: "" })}
        />
        <span className={f.choiceText}>
          <span>{t("none")}</span>
          <span className={f.choiceHint}>{t("noneHint")}</span>
        </span>
      </label>

      {visible.map((client) => (
        <label key={client.id} className={f.choice}>
          <input
            type="radio"
            name="clientId"
            value={client.id}
            checked={draft.clientId === client.id}
            onChange={() => onChange({ clientId: client.id })}
          />
          <span className={f.choiceText}>
            <span>{client.name ?? client.email}</span>
            {client.name && <span className={f.choiceHint}>{client.email}</span>}
          </span>
        </label>
      ))}

      {clients.length === 0 && <p className={f.intro}>{t("noClients")}</p>}
      {clients.length > 0 && visible.length === 0 && (
        <p className={f.intro}>{t("noMatches")}</p>
      )}
    </fieldset>
  );
}

export function ClientSummary({
  draft,
  options,
}: {
  draft: ProjectDraft;
  options: ProjectFlowOptions;
}) {
  const t = useTranslations("newProjectPage.client");
  const client = options.clients.find((c) => c.id === draft.clientId);

  return (
    <SummaryList
      items={[
        {
          label: t("label"),
          value: client ? `${client.name ?? client.email} (${client.email})` : t("none"),
        },
      ]}
    />
  );
}
