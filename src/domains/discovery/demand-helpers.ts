import type { DemandProfile } from "../../types.js";

/**
 * Describes specialized demand gate data shared by deterministic selection and recommendation suppression.
 */
export interface SpecializedDemandGate {
  id: string;
  entryTermGroups: string[][];
  demandTermGroups: string[][];
}

/**
 * Shared specialized-domain gates that should only activate when demand explicitly includes those domains.
 */
export const SPECIALIZED_GATES = [
  {
    id: "firebase",
    entryTermGroups: [["firebase"]],
    demandTermGroups: [["firebase"]],
  },
  {
    id: "power-platform",
    entryTermGroups: [
      ["dataverse"],
      ["power", "platform"],
      ["power", "apps"],
      ["power", "bi"],
    ],
    demandTermGroups: [
      ["dataverse"],
      ["power", "platform"],
      ["power", "apps"],
      ["power", "bi"],
    ],
  },
  {
    id: "azure",
    entryTermGroups: [["azure"]],
    demandTermGroups: [["azure"]],
  },
  {
    id: "kubernetes",
    entryTermGroups: [["kubernetes"], ["helm"], ["k8s"]],
    demandTermGroups: [["kubernetes"], ["helm"], ["k8s"]],
  },
] satisfies readonly SpecializedDemandGate[];

/**
 * Detects whether a demand profile contains design-system / design-asset signals that should bridge into Penpot recall.
 */
export function hasDesignSystemSignals(demandProfile: DemandProfile): boolean {
  return (
    demandProfile.signals.concerns.some((concern) =>
      ["design-assets", "design-systems", "frontend"].includes(concern),
    ) ||
    demandProfile.signals.tooling.some((tooling) =>
      ["detector:design-system", "design-system"].includes(tooling),
    )
  );
}
