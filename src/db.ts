import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import crypto from "node:crypto";

// The app's own storage. Share choices and templates live here, never in Clio.
fs.mkdirSync(".data", { recursive: true });
const db = new DatabaseSync(".data/app.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY,
    matter_id INTEGER NOT NULL,
    provider_id INTEGER NOT NULL,
    provider_name TEXT NOT NULL,
    items TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS templates (
    name TEXT PRIMARY KEY,
    config TEXT NOT NULL
  );
`);

export type ShareRow = { token: string; matter_id: number; provider_id: number; provider_name: string; items: string[]; created_at: string; revoked: number };

export function createShare(matterId: number, providerId: number, providerName: string, items: string[]): string {
  const token = crypto.randomBytes(18).toString("base64url");
  db.prepare("INSERT INTO shares (token, matter_id, provider_id, provider_name, items, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(token, matterId, providerId, providerName, JSON.stringify(items), new Date().toISOString());
  return token;
}

function parse(r: any): ShareRow { return { ...r, items: JSON.parse(r.items) }; }

export function getShare(token: string): ShareRow | null {
  const r = db.prepare("SELECT * FROM shares WHERE token = ?").get(token);
  return r ? parse(r) : null;
}

export function listShares(matterId: number): ShareRow[] {
  return db.prepare("SELECT * FROM shares WHERE matter_id = ? ORDER BY created_at DESC").all(matterId).map(parse);
}

export function updateShare(token: string, items: string[]) {
  db.prepare("UPDATE shares SET items = ? WHERE token = ? AND revoked = 0").run(JSON.stringify(items), token);
}

export function revokeShare(token: string) {
  db.prepare("UPDATE shares SET revoked = 1 WHERE token = ?").run(token);
}

export function listTemplates(): { name: string; config: any }[] {
  return db.prepare("SELECT * FROM templates ORDER BY name").all().map((r: any) => ({ name: r.name, config: JSON.parse(r.config) }));
}

export function saveTemplate(name: string, config: unknown) {
  db.prepare("INSERT INTO templates (name, config) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET config = excluded.config").run(name, JSON.stringify(config));
}
