#!/usr/bin/env node
// Send Withings weight (with body composition) and blood pressure to Garmin
// Connect, adding only readings Garmin doesn't already have.
//
//   node sync.mjs login                 sign in to Withings once (asks in the terminal)
//   node sync.mjs check                 test the Withings and Garmin sign-ins
//   node sync.mjs preview [range]       show what's missing, change nothing
//   node sync.mjs sync [range]          upload what's missing
//   node sync.mjs status                what's been uploaded
//
//   range: --days N (default 30), --since YYYY-MM-DD, or --all
//
// A reading is "already on Garmin" when Garmin has a weigh-in (or a blood
// pressure reading) within 2 minutes of the Withings timestamp. Weight and blood
// pressure are checked separately, so a missing one is sent on its own.
//
// Exit codes: 0 ok, 1 something failed, 2 a sign-in is needed.
import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GarminAuth, FileTokenStore } from "garmin-auth";
import { FitWriter } from "@markw65/fit-file-writer";

const ROOT = dirname(fileURLToPath(import.meta.url));
const DATA = join(ROOT, "data");
const TOKENS = join(DATA, "withings_tokens.json");
const LEDGER = join(DATA, "ledger.json");
const STATUS = join(DATA, "status.json");    // read by garmin-dashboard for its warning banner
const BP_FILE = join(DATA, "blood_pressure.json"); // read by garmin-dashboard for its chart

const WITHINGS_API = "https://wbsapi.withings.net";
const AUTHORIZE_URL = "https://account.withings.com/oauth2_user/authorize2";
// The redirect already registered on the Withings app for the Raycast extension.
// After approving, the browser lands there and the address holds the code.
const DEFAULT_REDIRECT = "https://raycast.com/redirect?packageName=Extension";
const MATCH_WINDOW_S = 120;
const TYPES = { WEIGHT: 1, FAT_RATIO: 6, DIASTOLIC: 9, SYSTOLIC: 10, PULSE: 11, MUSCLE: 76, HYDRATION: 77, BONE: 88 };

const args = process.argv.slice(2);
const cmd = args[0] || "sync";
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const fmt = s => new Date(s * 1000).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const kg2lb = kg => (kg * 2.20462).toFixed(1);

function env() {
  const out = {};
  const file = join(ROOT, ".env.local");
  if (existsSync(file))
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  return out;
}
const ENV = env();

function readJson(path, dflt) { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : dflt; }
function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path + ".tmp", JSON.stringify(obj, null, 1), { mode: 0o600 });
  renameSync(path + ".tmp", path);
}
function writeStatus(fields) { try { writeJson(STATUS, { at: new Date().toISOString(), ...fields }); } catch {} }

function fail(msg, code = 1) {
  console.error(msg);
  if (cmd === "sync" && code !== 0) writeStatus({ ok: false, needsLogin: code === 2, message: msg });
  process.exit(code);
}

function ask(question) {
  return new Promise(res => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, a => { rl.close(); res(a.trim()); });
  });
}

// ---------- Withings ----------
function credentials() {
  const id = ENV.WITHINGS_CLIENT_ID, secret = ENV.WITHINGS_CLIENT_SECRET;
  if (!id || !secret) fail(`WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET must be set in ${join(ROOT, ".env.local")}.`);
  return { id, secret, redirect: ENV.WITHINGS_REDIRECT_URI || DEFAULT_REDIRECT };
}

async function tokenRequest(params) {
  const res = await fetch(`${WITHINGS_API}/v2/oauth2`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ action: "requesttoken", ...params }),
  });
  const j = await res.json();
  if (j.status !== 0) throw new Error(`Withings sign-in refused (status ${j.status}${j.error ? `: ${j.error}` : ""})`);
  const b = j.body;
  // Withings rotates the refresh token on every refresh: save the new one at once.
  const tokens = { access_token: b.access_token, refresh_token: b.refresh_token, userid: b.userid,
                   expires_at: Date.now() + b.expires_in * 1000 };
  writeJson(TOKENS, tokens);
  return tokens;
}

async function accessToken() {
  const t = readJson(TOKENS, null);
  if (!t) fail("Not signed in to Withings yet. Run: node sync.mjs login", 2);
  if (Date.now() < t.expires_at - 5 * 60e3) return t.access_token;
  const { id, secret } = credentials();
  try {
    return (await tokenRequest({ grant_type: "refresh_token", client_id: id, client_secret: secret, refresh_token: t.refresh_token })).access_token;
  } catch (e) {
    fail(`Withings sign-in needs renewing (${e.message}). Run: node sync.mjs login`, 2);
  }
}

/** Withings readings since `since` (unix seconds), oldest first, one per measurement group. */
async function withingsReadings(since) {
  const token = await accessToken();
  const readings = [];
  let offset = 0;
  for (;;) {
    const body = new URLSearchParams({
      action: "getmeas", category: "1",
      meastypes: Object.values(TYPES).join(","),
      startdate: String(since), enddate: String(Math.floor(Date.now() / 1000)),
      ...(offset ? { offset: String(offset) } : {}),
    });
    const res = await fetch(`${WITHINGS_API}/measure`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" }, body,
    });
    const j = await res.json();
    if (j.status !== 0) {
      if (j.status === 401) fail("Withings refused the sign-in. Run: node sync.mjs login", 2);
      throw new Error(`Withings error (status ${j.status})`);
    }
    for (const g of j.body.measuregrps || []) {
      const r = { grpid: g.grpid, ts: g.date };
      for (const m of g.measures) {
        const v = m.value * 10 ** m.unit;
        switch (m.type) {
          case TYPES.WEIGHT: r.weight = v; break;
          case TYPES.FAT_RATIO: r.fatPct = v; break;
          case TYPES.HYDRATION: r.waterKg = v; break;
          case TYPES.BONE: r.boneKg = v; break;
          case TYPES.MUSCLE: r.muscleKg = v; break;
          case TYPES.SYSTOLIC: r.sys = v; break;
          case TYPES.DIASTOLIC: r.dia = v; break;
          case TYPES.PULSE: r.pulse = v; break;
        }
      }
      if (r.weight || (r.sys && r.dia)) readings.push(r);
    }
    if (!j.body.more) break;
    offset = j.body.offset;
  }
  return readings.sort((a, b) => a.ts - b.ts);
}

// ---------- Garmin ----------
async function garminClient() {
  const dir = resolve(ROOT, ENV.GARMIN_TOKENS_DIR || "../hevy-sync/data/garmin");
  if (!existsSync(dir)) fail(`No Garmin sign-in at ${dir}. Sign in with hevy-sync (node sync.mjs login there).`, 2);
  try {
    return await new GarminAuth({ store: new FileTokenStore(dir) }).client();
  } catch (e) {
    fail(`Garmin sign-in needs renewing (${e.message}). Sign in again with hevy-sync.`, 2);
  }
}

const ymd = d => d.toISOString().slice(0, 10);
/** Timestamps (unix seconds) of Garmin weigh-ins and blood pressure readings since `since`. */
async function garminTimestamps(client, since) {
  const weights = [], bps = [];
  const end = new Date();
  for (let start = new Date(since * 1000); start <= end; ) {
    const stop = new Date(Math.min(end.getTime(), start.getTime() + 364 * 864e5));
    const range = `${ymd(start)}/${ymd(stop)}?includeAll=true`;
    const w = await client.connectapi(`/weight-service/weight/range/${range}`);
    for (const d of w?.dailyWeightSummaries || [])
      for (const m of d.allWeightMetrics || []) if (m.timestampGMT) weights.push(Math.round(m.timestampGMT / 1000));
    const b = await client.connectapi(`/bloodpressure-service/bloodpressure/range/${range}`);
    for (const s of b?.measurementSummaries || [])
      for (const m of s.measurements || []) if (m.measurementTimestampGMT) bps.push(Math.round(Date.parse(m.measurementTimestampGMT + "Z") / 1000));
    start = new Date(stop.getTime() + 864e5);
  }
  return { weights, bps };
}

const near = (list, ts) => list.some(t => Math.abs(t - ts) <= MATCH_WINDOW_S);

/** One FIT file with whichever parts of the reading are missing. */
function fitFile(r, { weight, bp }) {
  const ts = Math.floor(r.ts - 631065600);      // FIT epoch: 1989-12-31 00:00 UTC
  const w = new FitWriter();
  w.writeMessage("file_id", { type: "weight", manufacturer: "development", time_created: ts });
  if (weight) {
    const m = { timestamp: ts, weight: r.weight };
    if (r.fatPct) m.percent_fat = r.fatPct;
    if (r.waterKg) m.percent_hydration = r.waterKg / r.weight * 100;   // Garmin wants a percentage
    if (r.boneKg) m.bone_mass = r.boneKg;
    if (r.muscleKg) m.muscle_mass = r.muscleKg;
    w.writeMessage("weight_scale", m);
  }
  if (bp) {
    const m = { timestamp: ts, systolic_pressure: Math.round(r.sys), diastolic_pressure: Math.round(r.dia) };
    if (r.pulse) m.heart_rate = Math.round(r.pulse);
    w.writeMessage("blood_pressure", m);
  }
  const out = w.finish();
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

async function upload(client, fit) {
  const fd = new FormData();
  fd.append("file", new Blob([fit], { type: "application/octet-stream" }), "withings.fit");
  const j = await client.postForm("/upload-service/upload/.fit", fd);
  const d = j?.detailedImportResult || {};
  if (d.failures?.length && !d.successes?.length)
    throw new Error(`Garmin refused the file: ${JSON.stringify(d.failures).slice(0, 200)}`);
  return d.uploadId ?? null;
}

// ---------- blood pressure for the dashboard ----------
// Garmin's read-only Personal API has no blood pressure, so garmin-dashboard reads
// it from here: every Withings reading, as [unix seconds, systolic, diastolic, pulse].
// The first run fetches the full history; later runs merge in what plan() fetched.
async function saveBloodPressure(readings) {
  let store = readJson(BP_FILE, null);
  if (!store) {
    store = {};
    readings = await withingsReadings(0);
  }
  for (const r of readings)
    if (r.sys && r.dia) store[r.ts] = [r.ts, Math.round(r.sys), Math.round(r.dia), r.pulse ? Math.round(r.pulse) : null];
  writeJson(BP_FILE, store);
  return Object.keys(store).length;
}

// ---------- the plan ----------
function sinceFromArgs() {
  if (args.includes("--all")) return 0;
  const s = opt("--since", null);
  if (s) return Math.floor(Date.parse(s + "T00:00:00Z") / 1000);
  return Math.floor(Date.now() / 1000) - Number(opt("--days", "30")) * 86400;
}

async function plan() {
  const since = sinceFromArgs();
  const readings = await withingsReadings(since);
  const client = await garminClient();
  const first = readings.length ? readings[0].ts - 86400 : since;
  const garmin = await garminTimestamps(client, Math.max(since, first));
  const ledger = readJson(LEDGER, { uploaded: {} });
  const todo = [];
  let haveW = 0, haveBp = 0;
  for (const r of readings) {
    const needW = !!r.weight && !near(garmin.weights, r.ts);
    const needBp = !!(r.sys && r.dia) && !near(garmin.bps, r.ts);
    if (r.weight && !needW) haveW++;
    if (r.sys && r.dia && !needBp) haveBp++;
    // Uploaded by us but not visible on Garmin yet (it processes uploads in the background):
    // don't send it again within a day.
    const recent = key => ledger.uploaded[key] && Date.now() - Date.parse(ledger.uploaded[key].at) < 864e5;
    const weight = needW && !recent(`w:${r.ts}`);
    const bp = needBp && !recent(`bp:${r.ts}`);
    if (weight || bp) todo.push({ r, weight, bp });
  }
  return { since, readings, todo, haveW, haveBp, client, ledger };
}

function describe({ r, weight, bp }) {
  const parts = [];
  if (weight) parts.push(`weight ${kg2lb(r.weight)} lb${r.fatPct ? `, fat ${r.fatPct.toFixed(1)}%` : ""}`);
  if (bp) parts.push(`blood pressure ${Math.round(r.sys)}/${Math.round(r.dia)}${r.pulse ? `, pulse ${Math.round(r.pulse)}` : ""}`);
  return `${fmt(r.ts)}  ${parts.join(" + ")}`;
}

// ---------- commands ----------
async function login() {
  const { id, secret, redirect } = credentials();
  const state = randomBytes(8).toString("hex");
  const url = `${AUTHORIZE_URL}?` + new URLSearchParams({ response_type: "code", client_id: id, scope: "user.metrics", redirect_uri: redirect, state });
  console.log("1. Open this link and approve access:\n\n   " + url + "\n");
  console.log("2. You'll land on a page (it may say it can't open Raycast; that's fine).");
  console.log("   Copy the full address from the address bar and paste it here straight away:");
  console.log("   Withings only accepts it for 30 seconds.\n");
  const pasted = await ask("Address: ");
  let code, back;
  try { const u = new URL(pasted); code = u.searchParams.get("code"); back = u.searchParams.get("state"); }
  catch { code = pasted; }
  if (!code) fail("No code in that address. Run login again.");
  if (back && back !== state) fail("That address is from a different login attempt. Run login again.");
  try {
    await tokenRequest({ grant_type: "authorization_code", client_id: id, client_secret: secret, code, redirect_uri: redirect });
  } catch (e) {
    fail(`${e.message}. The code may have expired; run login again and paste faster.`);
  }
  console.log("Signed in to Withings. The sign-in renews itself.");
}

async function check() {
  const r = await withingsReadings(Math.floor(Date.now() / 1000) - 30 * 86400);
  console.log(`Withings: connected, ${r.length} readings in the last 30 days.`);
  const c = await garminClient();
  const me = await c.connectapi("/userprofile-service/socialProfile");
  console.log(`Garmin: signed in as ${me?.fullName || me?.displayName || "?"}.`);
}

async function preview() {
  const p = await plan();
  const w = p.todo.filter(t => t.weight).length, b = p.todo.filter(t => t.bp).length;
  console.log(`${p.readings.length} Withings readings since ${p.since ? fmt(p.since) : "the start"}. ` +
              `Already on Garmin: ${p.haveW} weigh-ins, ${p.haveBp} blood pressure readings.\n`);
  for (const t of p.todo) console.log("  + " + describe(t));
  console.log(`\nMissing from Garmin: ${w} weigh-ins, ${b} blood pressure readings. Nothing was changed.`);
}

async function sync() {
  // Not set up yet (no app credentials and no sign-in): skip quietly, so the
  // dashboard's refresh carries on and shows no warning.
  if (!existsSync(TOKENS) && !(ENV.WITHINGS_CLIENT_ID && ENV.WITHINGS_CLIENT_SECRET)) {
    console.log("Withings → Garmin: not set up yet");
    return;
  }
  const p = await plan();
  let w = 0, b = 0, failed = 0;
  for (const t of p.todo) {
    try {
      const uploadId = await upload(p.client, fitFile(t.r, t));
      const at = new Date().toISOString();
      if (t.weight) { p.ledger.uploaded[`w:${t.r.ts}`] = { at, uploadId }; w++; }
      if (t.bp) { p.ledger.uploaded[`bp:${t.r.ts}`] = { at, uploadId }; b++; }
      writeJson(LEDGER, p.ledger);
      console.log("✓ " + describe(t));
    } catch (e) {
      failed++;
      console.log(`✗ ${describe(t)}: ${e.message}`);
      if (/401|auth|sign.?in/i.test(e.message)) break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  const parts = [];
  if (w) parts.push(`${w} weigh-in${w > 1 ? "s" : ""}`);
  if (b) parts.push(`${b} blood pressure`);
  if (failed) parts.push(`${failed} failed`);
  try { await saveBloodPressure(p.readings); }
  catch (e) { console.log(`Couldn't save blood pressure for the dashboard: ${e.message}`); }
  writeStatus({ ok: !failed, needsLogin: false, weight: w, bp: b, failed,
                message: failed ? `${failed} reading(s) failed to upload; see withings-sync/data/sync.log` : null });
  console.log(`Withings → Garmin: ${parts.length ? parts.join(", ") : "nothing new"}`);
  if (failed) process.exitCode = 1;
}

function status() {
  const l = readJson(LEDGER, { uploaded: {} });
  const keys = Object.keys(l.uploaded);
  console.log(`Uploaded so far: ${keys.filter(k => k.startsWith("w:")).length} weigh-ins, ${keys.filter(k => k.startsWith("bp:")).length} blood pressure readings.`);
  const s = readJson(STATUS, null);
  console.log(s ? `Last run: ${new Date(s.at).toLocaleString(undefined, { hourCycle: "h23" })}: ${s.ok ? "ok" : "problem"}${s.message ? ` (${s.message})` : ""}` : "No runs yet.");
  console.log(`Withings sign-in: ${existsSync(TOKENS) ? "saved" : "not set up (run: node sync.mjs login)"}`);
}

const commands = { login, check, preview, sync, status };
if (!commands[cmd]) fail(`Unknown command "${cmd}". Use: login, check, preview, sync, status`);
try {
  await commands[cmd]();
} catch (e) {
  const c = e.cause;
  if (c) e.message += ` (${c.code || c.message || c}${c.hostname ? ` ${c.hostname}` : ""})`;
  fail(`${cmd} failed: ${e.message}`, /401|auth|sign.?in/i.test(e.message) ? 2 : 1);
}
