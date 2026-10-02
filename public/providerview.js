// Shared by the provider's page and the attorney's live preview, so they cannot drift apart.
function renderProviderView(root, v) {
  const fmt = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  root.replaceChildren();
  root.classList.add("pv");
  root.append(mk("h1", "", "Case update"));
  root.append(mk("div", "pvsub", `Prepared for ${v.providerName}`));
  let any = false;

  if (v.status) {
    any = true;
    const s = mk("section"); s.append(mk("h2", "", "Where the case stands"));
    const b = mk("div", "big");
    b.append(`${v.patient ?? "The patient"}'s matter is `, mk("span", "ok", v.status.open ? "open and active" : "closed"), `, currently in the ${v.status.stage} stage.`);
    s.append(b); root.append(s);
  }
  if (v.coverage) {
    any = true;
    const s = mk("section"); s.append(mk("h2", "", "Coverage"));
    s.append(mk("div", "big", v.coverage.confirmed ? "Coverage has been confirmed in writing." : "Coverage has not been confirmed yet."));
    root.append(s);
  }
  const list = (title, rows, build) => {
    if (!rows.length) return;
    any = true;
    const s = mk("section"); s.append(mk("h2", "", title));
    const ul = mk("ul");
    for (const r of rows) ul.append(build(r));
    s.append(ul); root.append(s);
  };
  list("What the firm needs from your office", v.needs, (r) => {
    const li = mk("li"); li.append(mk("span", "d", fmt(r.date)), mk("span", "", r.title));
    li.append(mk("span", "tg" + (r.kind === "task" ? " open" : ""), r.kind === "task" ? "To do" : "Awaiting your reply"));
    return li;
  });
  list("Upcoming appointments", v.appointments, (r) => {
    const li = mk("li"); li.append(mk("span", "d", fmt(r.date)), mk("span", "", r.title), mk("span")); return li;
  });
  list("Recent correspondence", v.comms.slice(0, 8), (r) => {
    const li = mk("li"); li.append(mk("span", "d", fmt(r.date)), mk("span", "", r.title), mk("span", "", r.direction === "out" ? "From the firm" : "To the firm")); return li;
  });
  if (!any) root.append(mk("section", "empty", "Nothing has been shared yet."));
  root.append(mk("div", "foot", `Updated ${new Date(v.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. This page shows only what the firm chose to share, read live from the firm's case file.`));
}
