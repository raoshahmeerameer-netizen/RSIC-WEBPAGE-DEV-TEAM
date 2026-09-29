const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: __dirname + "/.env" });

// ---------------------------------------------------------------- config
const {
  SUPABASE_URL,
  SUPABASE_KEY,
  ADMIN_PASSWORD,
  ALLOWED_ORIGINS,
  PORT = 5000,
} = process.env;

const missing = ["SUPABASE_URL", "SUPABASE_KEY", "ADMIN_PASSWORD"].filter(
  (k) => !process.env[k],
);
if (missing.length) {
  console.error(
    "\nMissing in backend/.env: " +
      missing.join(", ") +
      "\nCopy .env.example to .env and fill it in. SUPABASE_KEY must be the" +
      "\nservice_role key, because Row Level Security blocks the anon key.\n",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = express();

app.use(
  cors({
    origin: ALLOWED_ORIGINS
      ? ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : true,
  }),
);
app.use(express.json({ limit: "64kb" }));

// ---------------------------------------------------------------- admin sessions
// Tokens live in memory, so restarting the server signs every admin out.
const SESSION_HOURS = 12;
const sessions = new Map();

const newSession = () => {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, Date.now() + SESSION_HOURS * 3600 * 1000);
  return token;
};

const sameString = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

const requireAdmin = (req, res, next) => {
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  const expires = sessions.get(token);
  if (!expires || expires < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: "Not signed in." });
  }
  next();
};

// Slow down password guessing: 10 tries per address per 15 minutes.
const loginTries = new Map();
const tooManyTries = (ip) => {
  const now = Date.now();
  const entry = loginTries.get(ip) || { count: 0, until: now + 9e5 };
  if (entry.until < now) {
    entry.count = 0;
    entry.until = now + 9e5;
  }
  entry.count += 1;
  loginTries.set(ip, entry);
  return entry.count > 10;
};

app.post("/api/admin/login", (req, res) => {
  if (tooManyTries(req.ip))
    return res
      .status(429)
      .json({ error: "Too many attempts. Wait 15 minutes." });
  if (!sameString((req.body && req.body.password) || "", ADMIN_PASSWORD))
    return res.status(401).json({ error: "Wrong password." });
  res.json({ token: newSession(), hours: SESSION_HOURS });
});

app.post("/api/admin/logout", requireAdmin, (req, res) => {
  sessions.delete((req.headers.authorization || "").replace(/^Bearer /, ""));
  res.json({ ok: true });
});

app.get("/api/admin/check", requireAdmin, (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------- site content
let contentCache = { at: 0, map: {} };

const loadContent = async (force) => {
  if (!force && Date.now() - contentCache.at < 15000) return contentCache.map;
  const { data, error } = await supabase
    .from("site_content")
    .select("key,value");
  if (error) throw error;
  contentCache = {
    at: Date.now(),
    map: Object.fromEntries(data.map((r) => [r.key, r.value])),
  };
  return contentCache.map;
};

// Public: every editable string, so the pages can fill themselves in.
app.get("/api/content", async (_req, res) => {
  try {
    res.json({ content: await loadContent() });
  } catch (err) {
    console.error("content:", err.message);
    res.status(500).json({ error: "Could not load site content." });
  }
});

// Admin: the same rows with their labels, for the editor.
app.get("/api/content/all", requireAdmin, async (_req, res) => {
  const { data, error } = await supabase
    .from("site_content")
    .select("*")
    .order("category")
    .order("position");
  if (error) return res.status(500).json({ error: error.message });
  res.json({ content: data });
});

app.patch("/api/content", requireAdmin, async (req, res) => {
  const updates = req.body && req.body.updates;
  if (!updates || typeof updates !== "object")
    return res.status(400).json({ error: "Nothing to update." });

  const entries = Object.entries(updates).slice(0, 200);
  for (const [key, value] of entries) {
    const { error } = await supabase
      .from("site_content")
      .update({ value: String(value) })
      .eq("key", key);
    if (error) return res.status(500).json({ error: error.message });
  }
  await loadContent(true);
  res.json({ ok: true, updated: entries.length });
});

// ---------------------------------------------------------------- registration
const emailLooksReal = (e) =>
  /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(String(e || ""));

// One registration per address per 20 seconds, to catch double submits and bots.
const lastPost = new Map();

const REALM_KEYS = [
  "math","pure","bio","chem","physics","cs",
  "psych","business","film","law","robotics",
];

app.post("/api/register", async (req, res) => {
  try {
    const content = await loadContent();
    if ((content["registration.open"] || "off").toLowerCase() !== "on") {
      return res.status(403).json({
        error:
          content["registration.closed_note"] ||
          "Registration is not open yet.",
      });
    }

    const now = Date.now();
    if (now - (lastPost.get(req.ip) || 0) < 20000)
      return res
        .status(429)
        .json({ error: "Just a moment, that was sent twice." });

    // The same limits the form uses, read from the admin's settings so the two
    // can never drift apart.
    const num = (key, fallback) => {
      const n = parseInt(content[key], 10);
      return Number.isFinite(n) ? n : fallback;
    };
    const realmsMin = num("registration.realms_min", 5);
    const realmsMax = num("registration.realms_max", 8);
    const delegatesMin = num("registration.delegates_min", 5);
    const delegatesMax = num("registration.delegates_max", 7);
    const compulsory = String(content["registration.compulsory"] || "pure,business")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const { school, contactName, contactEmail, phone, delegates } =
      req.body || {};

    if (!school || !contactEmail)
      return res
        .status(400)
        .json({ error: "School name and contact email are required." });
    if (!emailLooksReal(contactEmail))
      return res.status(400).json({ error: "That email doesn't look right." });

    const headcount = parseInt(delegates, 10);
    if (
      !Number.isFinite(headcount) ||
      headcount < delegatesMin ||
      headcount > delegatesMax
    )
      return res.status(400).json({
        error:
          "A delegation is " + delegatesMin + " to " + delegatesMax + " delegates.",
      });

    // one entry per delegate: name, age and class, checked here as well as in
    // the browser, because a form can be bypassed
    const people = Array.isArray(req.body.people) ? req.body.people : [];
    if (people.length !== headcount)
      return res.status(400).json({
        error: "Give a name, age and class for each of the " + headcount + " delegates.",
      });

    const delegateList = [];
    for (const person of people) {
      const name = String((person && person.name) || "").trim().slice(0, 120);
      const klass = String((person && person.class) || "").trim().slice(0, 60);
      const age = parseInt(person && person.age, 10);
      if (!name || !klass || !Number.isFinite(age))
        return res
          .status(400)
          .json({ error: "Every delegate needs a name, an age and a class." });
      if (age < 5 || age > 30)
        return res
          .status(400)
          .json({ error: "That age doesn't look right: " + age + "." });
      delegateList.push({ name, age, class: klass });
    }

    // unknown keys are dropped, duplicates collapsed, compulsory ones always added
    const picked = Array.isArray(req.body.realms) ? req.body.realms : [];
    const realms = [
      ...new Set([
        ...compulsory,
        ...picked.filter((k) => REALM_KEYS.includes(k)),
      ]),
    ];

    if (realms.length < realmsMin || realms.length > realmsMax)
      return res.status(400).json({
        error:
          "Choose between " + realmsMin + " and " + realmsMax + " realms.",
      });

    const clip = (v, n) => (v == null ? null : String(v).trim().slice(0, n));
    const payload = {
      route: "school",
      school: clip(school, 160),
      contact_name: clip(contactName, 120),
      contact_email: clip(contactEmail, 160),
      phone: clip(phone, 40),
      delegates: headcount,
      delegate_list: delegateList,
      realms,
      realm: null,
      name: null,
      email: null,
      status: "Pending",
    };

    const { error } = await supabase.from("registrations").insert([payload]);
    if (error) {
      console.error("insert:", error.message);
      return res
        .status(500)
        .json({ error: "Could not save your registration." });
    }

    lastPost.set(req.ip, now);
    res.json({
      message: content["registration.thanks"] || "Registration received.",
    });
  } catch (err) {
    console.error("register:", err.message);
    res.status(500).json({ error: "Something went wrong. Try again." });
  }
});

// ---------------------------------------------------------------- admin data
app.get("/api/registrations", requireAdmin, async (_req, res) => {
  const { data, error } = await supabase
    .from("registrations")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, data });
});

app.patch("/api/registrations/:id", requireAdmin, async (req, res) => {
  const status = req.body && req.body.status;
  if (!["Pending", "Confirmed"].includes(status))
    return res
      .status(400)
      .json({ error: "Status must be Pending or Confirmed." });
  const { error } = await supabase
    .from("registrations")
    .update({ status })
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.delete("/api/registrations/:id", requireAdmin, async (req, res) => {
  const { error } = await supabase
    .from("registrations")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------- the website
// The site and the API share one origin, so the pages call /api/... with no
// base URL and there is no CORS to configure. Only public/ is ever served:
// the backend source and node_modules sit outside it and cannot be requested.
const SITE_DIR = path.join(__dirname, "..", "public");
const sendPage = (res, file) => res.sendFile(path.join(SITE_DIR, file));

// The dashboard answers at /admindashboard and nowhere else. Nothing on the
// site links to it; you reach it by typing the address.
app.get("/admindashboard", (_req, res) => sendPage(res, "admin.html"));
app.get(["/admin", "/admin.html", "/admindashboard.html"], (_req, res) =>
  res.redirect(301, "/admindashboard"),
);

// realms.html and the realms/ folder share a name, so serve the page directly
// before express.static looks for a directory index that does not exist.
app.get(["/realms", "/realms/"], (_req, res) => sendPage(res, "realms.html"));
app.get(["/team", "/team/"], (_req, res) => sendPage(res, "team.html"));

// One address per page: /about, never /about.html.
app.get(/^\/(.+)\.html$/, (req, res) => {
  const clean = "/" + req.params[0];
  res.redirect(301, clean === "/index" ? "/" : clean);
});

app.use(
  express.static(SITE_DIR, {
    extensions: ["html"],
    index: "index.html",
    dotfiles: "ignore",
  }),
);

app.use((req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "Not found" });
  res.status(404).sendFile(path.join(SITE_DIR, "404.html"), (err) => {
    if (err) res.status(404).type("text/plain").send("Page not found");
  });
});

app.listen(PORT, () => console.log("RSIC backend running on port " + PORT));
