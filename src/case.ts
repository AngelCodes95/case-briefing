import { clioGet, clioGetAll } from "./clio.js";

export type Status = "done" | "pending" | "overdue" | "waiting";
export type Lane = "Client" | "Treatment" | "Insurance & defense" | "Litigation" | "Costs" | "Case";
export type Role = "Medical providers" | "Insurance & the other side" | "Our firm & client";
export const ROLES: Role[] = ["Medical providers", "Insurance & the other side", "Our firm & client"];
const ROLE_OF_LANE: Record<Lane, Role> = {
  Treatment: "Medical providers",
  "Insurance & defense": "Insurance & the other side",
  Litigation: "Insurance & the other side",
  Client: "Our firm & client",
  Costs: "Our firm & client",
  Case: "Our firm & client",
};
export const LANES: Lane[] = ["Client", "Treatment", "Insurance & defense", "Litigation", "Costs", "Case"];

export type CaseEvent = {
  id: string;
  kind: "note" | "email" | "call" | "task" | "calendar" | "expense" | "document";
  date: string; // ISO timestamp
  title: string;
  detail: string;
  lane: Lane;
  role: Role;
  entity?: string;
  entityId?: number;
  status: Status;
  important: boolean;
  contacts: string[];
  direction?: "in" | "out";
  amount?: number;
  folder?: string;
  createdAt?: string;
  updatedAt?: string;
  waitingOn?: string;
};

type Category = "client" | "provider" | "insurance";

const STOP = new Set([
  "claims", "service", "services", "bureau", "insurance", "company", "commuter", "railroad", "surgical",
  "therapy", "physical", "hospital", "orthopaedic", "orthopedic", "chiropractic", "offices", "center",
  "medical", "provider", "treating", "adverse", "party", "carrier", "diagnostic", "imaging", "emergency",
  "client", "policy", "self-insured", "public", "authority", "driver", "records", "doctor", "associates",
]);

function categorize(desc: string): Category | null {
  const d = desc.toLowerCase();
  if (/treating|medical provider|hospital|surgical|physician|chiropract|therapy|imaging|radiolog|neurolog|physiatr|surgeon/.test(d)) return "provider";
  if (/carrier|insur|claims|adverse|administrator|adjuster|defendant|authority/.test(d)) return "insurance";
  return null;
}

type Contact = { id: number; name: string; category: Category; desc: string; tokens: string[] };

function buildTokens(name: string, desc: string, all: { name: string }[]): string[] {
  const words = (s: string) => (s.match(/[A-Za-z][A-Za-z'-]{4,}/g) ?? []).map((w) => w.toLowerCase());
  const candidates = new Set([...words(name), ...words(desc.replace(/\b(Medical provider|Treating provider)\b/gi, ""))]);
  const out: string[] = [name.toLowerCase()];
  for (const w of candidates) {
    if (STOP.has(w)) continue;
    // only keep tokens that identify a single contact
    const shared = all.filter((c) => c.name.toLowerCase().includes(w)).length;
    if (shared <= 1) out.push(w);
  }
  return out;
}

const KEY = /demand|surger|served|lien|ime\b|deposition|discovery|subpoena|compliance|valuation|coverage|limitation|settle|negotiat|offer|records received|expert|exposure|posture|evaluation|operative|conference/i;
const LIT = /discovery|compliance|deposition|subpoena|ime\b|independent medical|court|motion|pleading|expert|examination|objection|judge|conference|complaint|answer\b|bill of particulars|limitations|statute|litigation|suit\b/i;
const FOLDER_LANE: [RegExp, Lane][] = [
  [/pleading|discovery|expert|court/i, "Litigation"],
  [/medical|record/i, "Treatment"],
  [/insurance|settlement|lien/i, "Insurance & defense"],
  [/intake|retainer|correspondence/i, "Client"],
];
const WAITING_TEXT = /unanswered|no date|no response|not yet|owes|waiting|awaiting|outstanding/i;

export type CaseModel = Awaited<ReturnType<typeof buildCase>>;

export async function listMatters() {
  return clioGetAll("/matters.json", {
    fields: "id,display_number,description,status,client{id,name}",
  });
}

export async function buildCase(matterId: number) {
  const now = new Date();
  const [matterRes, notes, comms, tasks, cal, acts, docs, rels, stages] = await Promise.all([
    clioGet(`/matters/${matterId}.json`, {
      fields:
        "id,display_number,description,status,open_date,statute_of_limitations,client{id,name},practice_area{id,name},matter_stage{id,name},custom_field_values{id,field_name,field_type,value}",
    }),
    clioGetAll("/notes.json", { type: "Matter", matter_id: matterId, fields: "id,subject,detail,date,created_at,updated_at" }),
    clioGetAll("/communications.json", { matter_id: matterId, fields: "id,subject,body,date,type,senders,receivers,created_at,updated_at" }),
    clioGetAll("/tasks.json", { matter_id: matterId, fields: "id,name,description,due_at,status,completed_at,statute_of_limitations,created_at,updated_at" }),
    clioGetAll("/calendar_entries.json", { matter_id: matterId, fields: "id,summary,description,start_at,end_at,all_day,created_at,updated_at" }),
    clioGetAll("/activities.json", { matter_id: matterId, fields: "id,type,date,total,note,created_at,updated_at" }),
    clioGetAll("/documents.json", { matter_id: matterId, fields: "id,name,received_at,created_at,updated_at,parent{id,name},latest_document_version{size}" }),
    clioGetAll("/relationships.json", { matter_id: matterId, fields: "id,description,contact{id,name,type}" }),
    clioGetAll("/matter_stages.json", { fields: "id,name,practice_area_id" }),
  ]);
  const m = matterRes.data;
  const clientId: number = m.client?.id;

  const rawContacts = rels.filter((r) => r.contact).map((r) => ({ name: r.contact.name as string, id: r.contact.id as number, desc: (r.description ?? "") as string }));
  const contacts: Contact[] = rawContacts
    .map((c) => ({ ...c, category: categorize(c.desc) as Category | null }))
    .filter((c): c is typeof c & { category: Category } => c.category !== null)
    .map((c) => ({ ...c, tokens: buildTokens(c.name, c.desc, rawContacts) }));
  const byId = new Map(contacts.map((c) => [c.id, c]));

  const mentioned = (text: string): Contact[] => {
    const t = text.toLowerCase();
    return contacts.filter((c) => c.tokens.some((tok) => t.includes(tok)));
  };

  const laneFor = (text: string, people: Contact[], clientInvolved: boolean): Lane => {
    if (LIT.test(text.split("\n")[0])) return "Litigation";
    const counts: Record<Category, number> = { client: 0, provider: 0, insurance: 0 };
    for (const p of people) counts[p.category]++;
    if (counts.provider > counts.insurance && counts.provider > 0) return "Treatment";
    if (counts.insurance > 0) return "Insurance & defense";
    if (clientInvolved) return "Client";
    return "Case";
  };

  const events: CaseEvent[] = [];

  for (const n of notes) {
    const text = `${n.subject ?? ""}\n${n.detail ?? ""}`;
    const people = mentioned(text);
    events.push({
      id: `note:${n.id}`, kind: "note", date: toIso(n.date), title: n.subject ?? "(note)", detail: n.detail ?? "",
      lane: laneFor(text, people, /\bclient\b|justin|called/i.test(text) && people.length === 0), role: "Our firm & client", status: "done",
      important: KEY.test(n.subject ?? ""), contacts: people.map((p) => p.name), createdAt: n.created_at, updatedAt: n.updated_at,
    });
  }

  type Comm = { c: any; counterparts: { id: number; name: string; type: string }[]; outbound: boolean };
  const commInfo: Comm[] = comms.map((c) => {
    const senders = (c.senders ?? []) as any[];
    const receivers = (c.receivers ?? []) as any[];
    const outbound = senders.some((s) => s.type === "User");
    const others = (outbound ? receivers : senders).filter((p) => p.type !== "User");
    return { c, counterparts: others, outbound };
  });

  for (const { c, counterparts, outbound } of commInfo) {
    const known = counterparts.map((p) => byId.get(p.id)).filter((x): x is Contact => !!x);
    const clientInvolved = counterparts.some((p) => p.id === clientId);
    const text = `${c.subject ?? ""}\n${c.body ?? ""}`;
    const lane: Lane = clientInvolved ? "Client" : LIT.test(c.subject ?? "") ? "Litigation" : laneFor(text, known, false);
    events.push({
      id: `comm:${c.id}`, kind: c.type === "PhoneCommunication" ? "call" : "email", date: toIso(c.date),
      title: c.subject ?? "(communication)", detail: c.body ?? "", lane, role: "Our firm & client", status: "done", important: false,
      contacts: counterparts.map((p) => p.name), direction: outbound ? "out" : "in", createdAt: c.created_at, updatedAt: c.updated_at,
    });
  }

  // Waiting detection: the latest outbound email to a counterpart with no later inbound reply.
  const lastByContact = new Map<number, { out?: Comm; inn?: Comm }>();
  for (const ci of commInfo) {
    if (ci.c.type === "PhoneCommunication") continue;
    for (const p of ci.counterparts) {
      if (p.id === clientId) continue;
      const slot = lastByContact.get(p.id) ?? {};
      const key = ci.outbound ? "out" : "inn";
      if (!slot[key] || ci.c.date > slot[key]!.c.date) slot[key] = ci;
      lastByContact.set(p.id, slot);
    }
  }
  const waiting: { contact: string; contactId: number; since: string; subject: string; eventId: string; days: number }[] = [];
  const waitingContactIds = new Set<number>();
  for (const [id, slot] of lastByContact) {
    if (slot.out && (!slot.inn || slot.inn.c.date < slot.out.c.date)) {
      const cp = slot.out.counterparts.find((p) => p.id === id)!;
      waiting.push({
        contact: cp.name, contactId: id, since: slot.out.c.date, subject: slot.out.c.subject ?? "",
        eventId: `comm:${slot.out.c.id}`, days: Math.floor((now.getTime() - new Date(slot.out.c.date).getTime()) / 86_400_000),
      });
      waitingContactIds.add(id);
    }
  }
  waiting.sort((a, b) => b.days - a.days);
  for (const w of waiting) {
    const ev = events.find((e) => e.id === w.eventId);
    if (ev) { ev.status = "waiting"; ev.waitingOn = w.contact; ev.important = true; }
  }

  for (const t of tasks) {
    const text = `${t.name}\n${t.description ?? ""}`;
    const people = mentioned(text);
    const done = t.status === "complete";
    const due = t.due_at ? new Date(`${String(t.due_at).slice(0, 10)}T23:59:59`) : null;
    let status: Status = done ? "done" : due && due < now ? "overdue" : "pending";
    let waitingOn: string | undefined;
    if (!done) {
      const w = people.find((p) => waitingContactIds.has(p.id));
      if (w || WAITING_TEXT.test(text)) {
        waitingOn = w?.name ?? people[0]?.name;
        if (status === "pending") status = "waiting";
      }
    }
    events.push({
      id: `task:${t.id}`, kind: "task", date: toIso(t.due_at ?? t.created_at), title: t.name, detail: t.description ?? "",
      lane: laneFor(text, people, false), role: "Our firm & client", status, important: !done || !!t.statute_of_limitations,
      contacts: people.map((p) => p.name), createdAt: t.created_at, updatedAt: t.updated_at, waitingOn,
    });
  }

  for (const e of cal) {
    const text = `${e.summary}\n${e.description ?? ""}`;
    const people = mentioned(text);
    const start = new Date(e.start_at);
    events.push({
      id: `cal:${e.id}`, kind: "calendar", date: e.start_at, title: e.summary, detail: e.description ?? "",
      lane: laneFor(text, people, /client/i.test(text)), role: "Our firm & client", status: start > now ? "pending" : "done", important: true,
      contacts: people.map((p) => p.name), createdAt: e.created_at, updatedAt: e.updated_at,
    });
  }

  for (const a of acts.filter((x) => x.type === "ExpenseEntry")) {
    events.push({
      id: `exp:${a.id}`, kind: "expense", date: toIso(a.date), title: `Expense $${Number(a.total).toLocaleString()}`,
      detail: a.note ?? "", lane: "Costs", role: "Our firm & client", status: "done", important: false, contacts: [], amount: Number(a.total),
      createdAt: a.created_at, updatedAt: a.updated_at,
    });
  }

  for (const d of docs) {
    const folder: string = d.parent?.name ?? "";
    const lane = FOLDER_LANE.find(([re]) => re.test(folder))?.[1] ?? "Case";
    events.push({
      id: `doc:${d.id}`, kind: "document", date: d.received_at ?? d.created_at, title: d.name, detail: `Folder: ${folder}`,
      lane, role: "Our firm & client", status: "done", important: false, contacts: [], folder, createdAt: d.created_at, updatedAt: d.updated_at,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  const clientContact = { id: clientId, name: (m.client?.name ?? "") as string };
  const byName = new Map<string, { id: number; name: string; tokens?: string[] }>(contacts.map((c) => [c.name, c]));
  if (clientContact.name) byName.set(clientContact.name, clientContact);
  for (const e of events) {
    e.role = ROLE_OF_LANE[e.lane];
    const cands = e.contacts.map((n) => byName.get(n)).filter((x): x is NonNullable<typeof x> => !!x);
    let primary = cands[0];
    if (cands.length > 1 && e.kind !== "email" && e.kind !== "call") {
      // for text-based matches, the party named first in the text is the subject
      const text = `${e.title} ${e.detail}`.toLowerCase();
      let best = Infinity;
      for (const c of cands) {
        const idx = Math.min(...(c.tokens ?? [c.name.toLowerCase()]).map((t) => { const i = text.indexOf(t); return i < 0 ? Infinity : i; }));
        if (idx < best) { best = idx; primary = c; }
      }
    }
    if (primary) { e.entity = primary.name; e.entityId = primary.id; }
  }

  // KPIs: surface custom fields that answer "what is it worth" and "what is behind it".
  const fields: { name: string; type: string; value: any }[] = (m.custom_field_values ?? [])
    .map((f: any) => ({ name: f.field_name, type: f.field_type, value: f.value }))
    .filter((f: any) => f.value !== null && f.value !== "" && f.value !== undefined);
  const pick = (re: RegExp) => fields.find((f) => re.test(f.name));
  const kpis = [
    { label: "Case value", field: pick(/value(?!.*rationale)|worth/i) },
    { label: "Coverage", field: pick(/limit(?!.*confirm)|coverage/i) },
    { label: "Medical specials", field: pick(/special/i) },
    { label: "Liens and collateral", field: pick(/lien|health insurance/i) },
  ]
    .filter((k) => k.field)
    .map((k) => ({ label: k.label, source: k.field!.name, type: k.field!.type, value: k.field!.value }));

  const expenseTotal = events.filter((e) => e.kind === "expense").reduce((s, e) => s + (e.amount ?? 0), 0);

  const clientComms = commInfo.filter((ci) => ci.counterparts.some((p) => p.id === clientId));
  const last = clientComms.sort((a, b) => b.c.date.localeCompare(a.c.date))[0];
  const lastClientContact = last
    ? { date: last.c.date, subject: last.c.subject, type: last.c.type === "PhoneCommunication" ? "call" : "email", direction: last.outbound ? "out" : "in",
        days: Math.floor((now.getTime() - new Date(last.c.date).getTime()) / 86_400_000) }
    : null;

  const stageList = stages
    .filter((s) => s.practice_area_id === m.practice_area?.id)
    .map((s) => ({ id: s.id, name: s.name, current: s.id === m.matter_stage?.id }));

  const upcoming = events
    .filter((e) => (e.kind === "calendar" || e.kind === "task") && e.status !== "done" && e.status !== "overdue" && new Date(e.date) >= now)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8)
    .map((e) => e.id);
  const overdue = events.filter((e) => e.status === "overdue").map((e) => e.id);

  return {
    generatedAt: now.toISOString(),
    matter: {
      id: m.id, number: m.display_number, description: m.description, status: m.status, openDate: m.open_date,
      statuteOfLimitations: m.statute_of_limitations ?? null,
      client: m.client, practiceArea: m.practice_area?.name, stage: m.matter_stage?.name,
    },
    stages: stageList, kpis, fields, expenseTotal, lastClientContact, waiting, upcoming, overdue,
    lanes: LANES, roles: ROLES, events,
    entities: [
      ...(clientContact.name ? [{ id: clientContact.id, name: clientContact.name, category: "client" as Category }] : []),
      ...contacts.map((c) => ({ id: c.id, name: c.name, category: c.category })),
    ],
    counts: { notes: notes.length, communications: comms.length, tasks: tasks.length, calendar: cal.length, expenses: events.filter((e) => e.kind === "expense").length, documents: docs.length, contacts: contacts.length },
  };
}

function toIso(d: string | undefined): string {
  if (!d) return new Date(0).toISOString();
  return d.length === 10 ? `${d}T12:00:00` : d;
}
