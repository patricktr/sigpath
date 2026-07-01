import type { InstallStatus } from "./schema";

/**
 * Cable install-tracking helpers (p3-cableschedule). A run advances
 * Planned → Pulled → Terminated → Tested as it's installed; the checklist pill
 * cycles through these. Pure — the status lives on the cable (persisted); this
 * module just orders and labels it.
 */
export const INSTALL_STAGES: InstallStatus[] = ["planned", "pulled", "terminated", "tested"];

export const INSTALL_LABEL: Record<InstallStatus, string> = {
  planned: "Planned",
  pulled: "Pulled",
  terminated: "Terminated",
  tested: "Tested",
};

/** Absent status reads as the first stage. */
export function installStage(status: InstallStatus | undefined): InstallStatus {
  return status ?? "planned";
}

/** The next stage in the cycle (wraps Tested → Planned). */
export function nextInstall(status: InstallStatus | undefined): InstallStatus {
  const i = INSTALL_STAGES.indexOf(installStage(status));
  return INSTALL_STAGES[(i + 1) % INSTALL_STAGES.length];
}

/** A run is "done" for the hide-completed filter once it's tested. */
export function isCableDone(status: InstallStatus | undefined): boolean {
  return status === "tested";
}
