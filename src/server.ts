import crypto from "node:crypto";
import express from "express";
import { authorizeUrl, clioGet, clioGetAll, exchangeCode, isConnected } from "./clio.js";
import { buildCase, listMatters } from "./case.js";
import { createShare, getShare, listShares, listTemplates, revokeShare, saveTemplate, updateShare } from "./db.js";
import { buildProviderView } from "./share.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const pending = new Set<string>();

app.use(express.json());
app.use(express.static("public"));

app.get("/login", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  pending.add(state);
  res.redirect(authorizeUrl(state));
});

app.get("/callback", async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state || !pending.delete(state)) {
    res.status(400).send("Invalid OAuth callback");
    return;
  }
  try {
    await exchangeCode(code);
    res.redirect("/");
  } catch (e) {
    res.status(500).send(String(e));
  }
});

app.get("/api/status", (_req, res) => res.json({ connected: isConnected() }));

// Temporary: shows what Clio actually returns so we can shape the data model.
app.get("/api/probe", async (_req, res) => {
  try {
    const me = await clioGet("/users/who_am_i.json", { fields: "id,name,email" });
    const matters = await clioGetAll("/matters.json", {
      fields: "id,display_number,description,status,open_date,client{id,name},practice_area{id,name},matter_stage{id,name}",
    });
    res.json({ me: me.data, matters });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const cache = new Map<number, { at: number; data: Awaited<ReturnType<typeof buildCase>> }>();

app.get("/api/matters", async (_req, res) => {
  try { res.json(await listMatters()); } catch (e) { res.status(500).json({ error: String(e) }); }
});

app.get("/api/case", async (req, res) => {
  try {
    let id = Number(req.query.matter);
    if (!id) {
      const all = await listMatters();
      if (!all.length) { res.status(404).json({ error: "No matters found" }); return; }
      id = all[0].id;
    }
    const hit = cache.get(id);
    if (hit && !req.query.refresh && Date.now() - hit.at < 60_000) { res.json(hit.data); return; }
    const data = await buildCase(id);
    cache.set(id, { at: Date.now(), data });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

async function cachedCase(id: number) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.data;
  const data = await buildCase(id);
  cache.set(id, { at: Date.now(), data });
  return data;
}

// Share management (stored in the app's own database, never written to Clio)
app.get("/api/shares", (req, res) => res.json(listShares(Number(req.query.matter)).map(({ items, ...r }) => ({ ...r, itemCount: items.length }))));
app.get("/api/shares/:token", (req, res) => { const s = getShare(req.params.token); s ? res.json(s) : res.status(404).json({ error: "Not found" }); });
app.post("/api/shares", (req, res) => {
  const { matterId, providerId, providerName, items } = req.body ?? {};
  if (!matterId || !providerId || !providerName || !Array.isArray(items)) { res.status(400).json({ error: "Missing fields" }); return; }
  res.json({ token: createShare(Number(matterId), Number(providerId), String(providerName), items.map(String)) });
});
app.put("/api/shares/:token", (req, res) => { updateShare(req.params.token, (req.body?.items ?? []).map(String)); res.json({ ok: true }); });
app.post("/api/shares/:token/revoke", (req, res) => { revokeShare(req.params.token); res.json({ ok: true }); });
app.get("/api/templates", (_req, res) => res.json(listTemplates()));
app.post("/api/templates", (req, res) => {
  const { name, config } = req.body ?? {};
  if (!name || typeof config !== "object") { res.status(400).json({ error: "Missing fields" }); return; }
  saveTemplate(String(name).slice(0, 60), config); res.json({ ok: true });
});

// What a provider sees: read live from Clio, then filtered by the attorney's allow list.
app.get("/api/p/:token", async (req, res) => {
  const share = getShare(req.params.token);
  if (!share || share.revoked) { res.status(404).json({ error: "This link is no longer active." }); return; }
  try {
    const model = await cachedCase(share.matter_id);
    res.json(buildProviderView(model, share.provider_id, share.provider_name, new Set(share.items)));
  } catch (e) { res.status(500).json({ error: "Could not load the update. Please try again." }); }
});
app.get("/p/:token", (_req, res) => res.sendFile("provider.html", { root: "public" }));

app.listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
