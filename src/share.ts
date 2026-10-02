import type { CaseModel } from "./case.js";

export type ProviderView = {
  providerName: string;
  patient?: string;
  status?: { stage: string; open: boolean };
  coverage?: { confirmed: boolean };
  needs: { title: string; date: string; kind: string }[];
  appointments: { title: string; date: string }[];
  comms: { title: string; date: string; direction?: string }[];
  generatedAt: string;
};

const cleanTitle = (t: string) => t.replace(/^By medical provider:\s*/i, "").replace(/^.*?\s+-\s+(?=\S)/, (m) => (/^By medical provider/i.test(t) ? "" : m));

/**
 * The only function that decides what a provider can see. It builds the view
 * from the allow list, so anything the attorney did not approve is never put
 * into the response, and no free-text note bodies are ever included.
 */
export function buildProviderView(model: CaseModel, providerId: number, providerName: string, allowed: Set<string>): ProviderView {
  const mine = model.events.filter((e) => e.entityId === providerId && allowed.has(e.id));
  const view: ProviderView = {
    providerName,
    needs: mine
      .filter((e) => (e.kind === "task" && e.status !== "done") || (e.status === "waiting" && (e.kind === "email" || e.kind === "call")))
      .map((e) => ({ title: cleanTitle(e.title), date: e.date, kind: e.kind })),
    appointments: mine.filter((e) => e.kind === "calendar" && +new Date(e.date) >= Date.now()).map((e) => ({ title: e.title, date: e.date })),
    comms: mine
      .filter((e) => (e.kind === "email" || e.kind === "call") && e.status !== "waiting")
      .map((e) => ({ title: e.title, date: e.date, direction: e.direction })),
    generatedAt: new Date().toISOString(),
  };
  if (allowed.has("block:status")) {
    view.status = { stage: model.matter.stage ?? model.matter.status, open: model.matter.status === "Open" };
    view.patient = model.matter.client?.name;
  }
  if (allowed.has("block:coverage")) {
    const f = model.fields.find((x) => /confirm/i.test(x.name) && /limit|coverage|policy/i.test(x.name));
    if (f) view.coverage = { confirmed: f.value === true };
  }
  view.needs.sort((a, b) => a.date.localeCompare(b.date));
  view.appointments.sort((a, b) => a.date.localeCompare(b.date));
  view.comms.sort((a, b) => b.date.localeCompare(a.date));
  return view;
}
