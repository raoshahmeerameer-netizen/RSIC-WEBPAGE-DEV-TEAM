const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
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

// Hostinger's CDN (Server: hcdn) sits in front, so without this every request
// looks like it comes from the same address: the login throttle would be
// global and eleven bad guesses from anyone would lock the owner out.
app.set("trust proxy", 1);

// Headers the CDN does not set for us.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=()",
  );
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  next();
});

// The pages call /api/... on their own origin, so nothing needs CORS. Left
// open it reflected whatever Origin was sent, which let any site on the web
// post to /api/register and hammer /api/admin/login from someone's browser.
app.use(
  cors({
    origin: ALLOWED_ORIGINS
      ? ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : false,
  }),
);
app.use(express.json({ limit: "64kb" }));

// ---------------------------------------------------------------- uploads
// Files never touch the disk. They are held in memory just long enough to be
// checked and pushed into Supabase Storage.
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const DOC_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_FILE = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE, files: 24, fields: 40, parts: 80 },
});

const EXT = {
  "image/jpeg": "jpg", "image/png": "png",
  "image/webp": "webp", "application/pdf": "pdf",
};

// Supabase also enforces the bucket's own mime allow-list, so a forged
// Content-Type still cannot land something unexpected in the bucket.
// A browser sets Content-Type itself, so an executable renamed to .jpg and
// sent as image/jpeg would pass a type check. These are the first bytes each
// format actually starts with.
const looksLike = (buf, mime) => {
  if (!buf || buf.length < 12) return false;
  if (mime === "image/jpeg") return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === "image/png")
    return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
      (b, i) => buf[i] === b,
    );
  if (mime === "application/pdf")
    return buf.subarray(0, 4).toString("latin1") === "%PDF";
  if (mime === "image/webp")
    return (
      buf.subarray(0, 4).toString("latin1") === "RIFF" &&
      buf.subarray(8, 12).toString("latin1") === "WEBP"
    );
  return false;
};

const userError = (msg) => Object.assign(new Error(msg), { userFacing: true });

const assertRealFile = (file, label) => {
  if (!looksLike(file.buffer, file.mimetype))
    throw userError(
      (label || "That file") + " is not the kind of file it claims to be.",
    );
};

const putFile = async (bucket, path, file) => {
  assertRealFile(file);
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) throw new Error("upload failed: " + error.message);
  return path;
};

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

// Text the advanced editor picked off a page. These pieces have no data-cms of
// their own, so the key carries the page and the element's position path and the
// row has to be created the first time it is edited.
const AUTO_KEY = /^auto:(\*|\/[a-z0-9\-\/]*)::[a-z0-9>:()\-]{3,300}$/;

app.put("/api/content/auto", requireAdmin, async (req, res) => {
  const body = req.body || {};
  const key = String(body.key || "");
  const value = String(body.value == null ? "" : body.value);
  const label = String(body.label || "").slice(0, 120);
  if (key.length > 400 || !AUTO_KEY.test(key))
    return res.status(400).json({ error: "That is not a piece of text I can save." });
  if (value.length > 4000)
    return res.status(400).json({ error: "That text is too long." });

  const { error } = await supabase.from("site_content").upsert(
    {
      key,
      value,
      label: label || "Extra text",
      category: "Extra text",
      input: "textarea",
      position: 1,
    },
    { onConflict: "key" },
  );
  if (error) return res.status(500).json({ error: error.message });
  await loadContent(true);
  res.json({ ok: true });
});

// Putting a piece back means dropping the row, so the page shows whatever is
// written in the HTML again.
app.delete("/api/content/auto", requireAdmin, async (req, res) => {
  const key = String(req.query.key || "");
  if (key.length > 400 || !AUTO_KEY.test(key))
    return res.status(400).json({ error: "That is not a piece of text I can reset." });
  const { error } = await supabase.from("site_content").delete().eq("key", key);
  if (error) return res.status(500).json({ error: error.message });
  await loadContent(true);
  res.json({ ok: true });
});

app.patch("/api/content", requireAdmin, async (req, res) => {
  const updates = req.body && req.body.updates;
  if (!updates || typeof updates !== "object")
    return res.status(400).json({ error: "Nothing to update." });

  const entries = Object.entries(updates).slice(0, 200);
  for (const [key, value] of entries) {
    const { error } = await supabase
      .from("site_content")
      // the longest real value on the site is under 500 characters
      .update({ value: String(value).slice(0, 8000) })
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

// Five registrations per address per hour.
const postTries = new Map();
const tooManyPosts = (ip) => {
  const now = Date.now();
  const entry = postTries.get(ip) || { count: 0, until: now + 36e5 };
  if (entry.until < now) {
    entry.count = 0;
    entry.until = now + 36e5;
  }
  entry.count += 1;
  postTries.set(ip, entry);
  return entry.count > 5;
};

// These maps held one entry per address for the life of the process. Sweep
// the expired ones so a long-running server does not creep upwards.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginTries) if (v.until < now) loginTries.delete(k);
  for (const [k, v] of postTries) if (v.until < now) postTries.delete(k);
  for (const [t, expires] of sessions) if (expires < now) sessions.delete(t);
}, 6e5).unref();

app.post("/api/register", upload.any(), async (req, res) => {
  try {
    // the form sends everything else as one JSON field alongside the files
    if (typeof req.body.payload === "string") {
      try {
        req.body = { ...req.body, ...JSON.parse(req.body.payload) };
      } catch (e) {
        return res.status(400).json({ error: "Could not read the form." });
      }
    }
    const byField = new Map((req.files || []).map((f) => [f.fieldname, f]));
    const needFile = (field, label, types) => {
      const f = byField.get(field);
      if (!f) throw new Error(label + " is required.");
      if (!types.includes(f.mimetype))
        throw new Error(
          label + " must be " + (types === PHOTO_TYPES ? "a JPG, PNG or WebP image" : "a PDF or image") + ".",
        );
      return f;
    };
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
    // A delegation registers once. Without a ceiling, one script could fill
    // the table and push tens of megabytes of photos into storage.
    if (tooManyPosts(req.ip))
      return res.status(429).json({
        error: "That is a lot of registrations from one place. Try again later.",
      });

    // The same limits the form uses, read from the admin's settings so the two
    // can never drift apart.
    const num = (key, fallback) => {
      const n = parseInt(content[key], 10);
      return Number.isFinite(n) ? n : fallback;
    };
    const realmsMin = num("registration.realms_min", 4);
    const realmsMax = num("registration.realms_max", 7);
    const delegatesMin = num("registration.delegates_min", 5);
    const delegatesMax = num("registration.delegates_max", 7);
    const compulsory = String(content["registration.compulsory"] || "pure,business")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    const { school, contactName, contactEmail, phone, delegates } =
      req.body || {};

    // the supervisor's email replaced the old "contact email" field
    const primaryEmail = contactEmail || (req.body && req.body.supervisorEmail);
    if (!school || !primaryEmail)
      return res
        .status(400)
        .json({ error: "School name and supervisor email are required." });
    if (!emailLooksReal(primaryEmail))
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
    // the head delegate is one of the headcount and is collected separately,
    // so the list covers the others
    const others = headcount - 1;
    const people = Array.isArray(req.body.people) ? req.body.people : [];
    if (people.length !== others)
      return res.status(400).json({
        error:
          "Give details for the other " + others + " delegates, besides the head delegate.",
      });

    const delegateList = [];
    for (const person of people) {
      const name = String((person && person.name) || "").trim().slice(0, 120);
      if (!name)
        return res.status(400).json({ error: "Every delegate needs a name." });
      const pEmail = String((person && person.email) || "").trim().slice(0, 160);
      const pPhone = String((person && person.phone) || "").trim().slice(0, 40);
      if (!pEmail || !emailLooksReal(pEmail))
        return res
          .status(400)
          .json({ error: "Every delegate needs a real email address." });
      if (!pPhone)
        return res
          .status(400)
          .json({ error: "Every delegate needs a phone number." });
      const pCnic = String((person && person.cnic) || "").trim().slice(0, 30);
      if (!pCnic)
        return res.status(400).json({
          error: "Every delegate needs a CNIC, their own or a parent's.",
        });
      const pParent = String((person && person.parentCnic) || "").trim().slice(0, 30);
      if (!pParent)
        return res.status(400).json({
          error: "Every delegate needs a parent CNIC as well as their own.",
        });
      delegateList.push({
        name, email: pEmail, phone: pPhone, cnic: pCnic, parentCnic: pParent,
      });
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

    // supervisor, team name and head delegate
    const b = req.body || {};
    const head = b.headDelegate || {};
    for (const [v, label] of [
      [b.schoolEmail, "The school email"],
      [b.supervisorName, "The supervisor's name"],
      [b.supervisorPhone, "The supervisor's number"],
      [b.supervisorEmail, "The supervisor's email"],
      [b.teamName, "The team name"],
      [head.name, "The head delegate's name"],
      [head.email, "The head delegate's email"],
      [head.phone, "The head delegate's number"],
      [head.cnic, "The head delegate's student CNIC"],
      [head.parentCnic, "The head delegate's parent CNIC"],
    ])
      if (!String(v || "").trim())
        return res.status(400).json({ error: label + " is required." });

    for (const [v, label] of [
      [b.schoolEmail, "school email"],
      [b.supervisorEmail, "supervisor email"],
      [head.email, "head delegate email"],
    ])
      if (!emailLooksReal(v))
        return res.status(400).json({ error: "That " + label + " doesn't look right." });

    // files: the two documents, the head delegate's photo and one per delegate
    let folder, headPhoto;
    try {
      folder = crypto.randomUUID();
      const hPhoto = needFile("photoHead", "The head delegate's photo", PHOTO_TYPES);
      for (let i = 0; i < others; i++)
        needFile("photo" + i, "A photo for delegate " + (i + 2), PHOTO_TYPES);

      headPhoto = await putFile("registration-files", folder + "/head-photo." + EXT[hPhoto.mimetype], hPhoto);
      for (let i = 0; i < others; i++) {
        const f = byField.get("photo" + i);
        delegateList[i].photo = await putFile(
          "registration-files", folder + "/delegate-" + (i + 2) + "." + EXT[f.mimetype], f,
        );
      }
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const payload = {
      route: "school",
      school: clip(school, 160),
      school_email: clip(b.schoolEmail, 160),
      team_name: clip(b.teamName, 120),
      supervisor_name: clip(b.supervisorName, 120),
      supervisor_phone: clip(b.supervisorPhone, 40),
      supervisor_email: clip(b.supervisorEmail, 160),
      head_delegate: {
        name: clip(head.name, 120),
        email: clip(head.email, 160),
        phone: clip(head.phone, 40),
        cnic: clip(head.cnic, 30),
        parentCnic: clip(head.parentCnic, 30),
        photo: headPhoto,
      },
      files_folder: folder,
      contact_name: clip(contactName || b.supervisorName, 120),
      contact_email: clip(contactEmail || b.supervisorEmail, 160),
      phone: clip(phone || b.supervisorPhone, 40),
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
    // things the person can actually fix say so; anything else stays vague
    if (err.userFacing) return res.status(400).json({ error: err.message });
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
  // Take the delegation's photos with it. These are students' pictures, so
  // leaving them in the bucket after the row is gone keeps personal data
  // around with nothing pointing at it.
  const { data: row } = await supabase
    .from("registrations")
    .select("files_folder")
    .eq("id", req.params.id)
    .maybeSingle();

  const { error } = await supabase
    .from("registrations")
    .delete()
    .eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });

  const folder = row && row.files_folder;
  if (folder && /^[0-9a-f-]{36}$/.test(folder)) {
    const { data: files } = await supabase.storage
      .from("registration-files")
      .list(folder);
    if (files && files.length)
      await supabase.storage
        .from("registration-files")
        .remove(files.map((f) => folder + "/" + f.name));
  }

  res.json({ ok: true });
});

// ---------------------------------------------------------------- files
// Registration files are in a PRIVATE bucket. There is no public URL for
// them. An admin gets a link that works for 60 seconds and nobody else can
// reach them at all.
app.get("/api/admin/file", requireAdmin, async (req, res) => {
  const path = String(req.query.path || "");
  // only ever inside the bucket, never a traversal or an absolute path
  if (!/^[0-9a-f-]{36}\/[a-z0-9-]+\.(jpg|png|webp|pdf)$/i.test(path))
    return res.status(400).json({ error: "Bad path." });
  const { data, error } = await supabase.storage
    .from("registration-files")
    .createSignedUrl(path, 60);
  if (error || !data)
    return res.status(404).json({ error: "File not found." });
  res.redirect(data.signedUrl);
});

// Study guides are meant to be downloaded by delegates, so they sit in a
// public bucket. The admin uploads one per realm and the realm page shows a
// download button once the key has a value.
app.post("/api/admin/guide", requireAdmin, upload.single("guide"), async (req, res) => {
  const realm = String(req.body.realm || "");
  if (!REALM_KEYS.includes(realm))
    return res.status(400).json({ error: "Unknown realm." });
  if (!req.file) return res.status(400).json({ error: "No file." });
  if (req.file.mimetype !== "application/pdf")
    return res.status(400).json({ error: "The study guide must be a PDF." });
  if (!looksLike(req.file.buffer, req.file.mimetype))
    return res.status(400).json({ error: "That file is not really a PDF." });

  const path = realm + ".pdf";
  const { error } = await supabase.storage
    .from("study-guides")
    .upload(path, req.file.buffer, { contentType: "application/pdf", upsert: true });
  if (error) return res.status(500).json({ error: error.message });

  const { data } = supabase.storage.from("study-guides").getPublicUrl(path);
  const url = data.publicUrl + "?v=" + Date.now();
  const { error: e2 } = await supabase
    .from("site_content")
    .upsert(
      {
        key: "realm." + realm + ".guide",
        value: url,
        label: "Study guide (PDF)",
        category: "Study guides",
        input: "text",
        position: 1,
      },
      { onConflict: "key" },
    );
  if (e2) return res.status(500).json({ error: e2.message });
  await loadContent(true);
  res.json({ ok: true, url });
});

// A realm's logo. Public, and it replaces the drawn glyph everywhere.
app.post("/api/admin/logo", requireAdmin, upload.single("logo"), async (req, res) => {
  const realm = String(req.body.realm || "");
  if (!REALM_KEYS.includes(realm))
    return res.status(400).json({ error: "Unknown realm." });
  if (!req.file) return res.status(400).json({ error: "No file." });
  if (
    !["image/png", "image/webp"].includes(req.file.mimetype) ||
    !looksLike(req.file.buffer, req.file.mimetype)
  )
    return res.status(400).json({ error: "The logo must be a PNG or WebP." });

  const path = "logos/" + realm + "." + EXT[req.file.mimetype];
  const { error } = await supabase.storage
    .from("realm-logos")
    .upload(path, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
  if (error) return res.status(500).json({ error: error.message });

  const { data } = supabase.storage.from("realm-logos").getPublicUrl(path);
  const { error: e2 } = await supabase.from("site_content").upsert(
    {
      key: "realm." + realm + ".logo",
      value: data.publicUrl + "?v=" + Date.now(),
      label: "Realm logo",
      category: "Realm logos",
      input: "text",
      position: 1,
    },
    { onConflict: "key" },
  );
  if (e2) return res.status(500).json({ error: e2.message });
  await loadContent(true);
  res.json({ ok: true });
});

app.delete("/api/admin/logo", requireAdmin, async (req, res) => {
  const realm = String(req.query.realm || "");
  if (!REALM_KEYS.includes(realm))
    return res.status(400).json({ error: "Unknown realm." });
  await supabase.storage
    .from("realm-logos")
    .remove(["logos/" + realm + ".png", "logos/" + realm + ".webp"]);
  await supabase
    .from("site_content")
    .update({ value: "" })
    .eq("key", "realm." + realm + ".logo");
  await loadContent(true);
  res.json({ ok: true });
});

// The three blank forms schools download. Public, like the study guides.
const FORM_KEYS = {
  waiver: "docs.waiver",
  head_form: "docs.head_form",
  delegate_form: "docs.delegate_form",
};

app.post("/api/admin/document", requireAdmin, upload.single("doc"), async (req, res) => {
  const which = String(req.body.which || "");
  if (!FORM_KEYS[which])
    return res.status(400).json({ error: "Unknown form." });
  if (!req.file) return res.status(400).json({ error: "No file." });
  if (req.file.mimetype !== "application/pdf")
    return res.status(400).json({ error: "The form must be a PDF." });
  if (!looksLike(req.file.buffer, req.file.mimetype))
    return res.status(400).json({ error: "That file is not really a PDF." });

  const path = which + ".pdf";
  const { error } = await supabase.storage
    .from("event-forms")
    .upload(path, req.file.buffer, { contentType: "application/pdf", upsert: true });
  if (error) return res.status(500).json({ error: error.message });

  const { data } = supabase.storage.from("event-forms").getPublicUrl(path);
  const url = data.publicUrl + "?v=" + Date.now();
  const { error: e2 } = await supabase
    .from("site_content")
    .update({ value: url })
    .eq("key", FORM_KEYS[which]);
  if (e2) return res.status(500).json({ error: e2.message });
  await loadContent(true);
  res.json({ ok: true, url });
});

app.delete("/api/admin/document", requireAdmin, async (req, res) => {
  const which = String(req.query.which || "");
  if (!FORM_KEYS[which]) return res.status(400).json({ error: "Unknown form." });
  await supabase.storage.from("event-forms").remove([which + ".pdf"]);
  await supabase.from("site_content").update({ value: "" }).eq("key", FORM_KEYS[which]);
  await loadContent(true);
  res.json({ ok: true });
});

app.delete("/api/admin/guide", requireAdmin, async (req, res) => {
  const realm = String(req.query.realm || "");
  if (!REALM_KEYS.includes(realm))
    return res.status(400).json({ error: "Unknown realm." });
  await supabase.storage.from("study-guides").remove([realm + ".pdf"]);
  await supabase
    .from("site_content")
    .update({ value: "" })
    .eq("key", "realm." + realm + ".guide");
  await loadContent(true);
  res.json({ ok: true });
});

// multer's own errors are not friendly, so translate the ones people hit
app.use((err, _req, res, next) => {
  if (err && err.name === "MulterError") {
    const msg =
      err.code === "LIMIT_FILE_SIZE"
        ? "That file is too big. Each file must be 5 MB or less."
        : "There was a problem with the files you attached.";
    return res.status(400).json({ error: msg });
  }
  return next(err);
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ---------------------------------------------------------------- the website
// The site and the API share one origin, so the pages call /api/... with no
// base URL and there is no CORS to configure. Only public/ is ever served:
// the backend source and node_modules sit outside it and cannot be requested.
const SITE_DIR = path.join(__dirname, "..", "public");
const sendPage = (res, file) => {
  // the dashboard is never worth caching; the public pages revalidate
  res.setHeader(
    "Cache-Control",
    /^(admin|advanced)\.html$/.test(file)
      ? "no-store"
      : "public, max-age=0, must-revalidate",
  );
  res.sendFile(path.join(SITE_DIR, file));
};

// The dashboard answers at /admindashboard and nowhere else. Nothing on the
// site links to it; you reach it by typing the address.
app.get("/admindashboard", (_req, res) => sendPage(res, "admin.html"));
app.get("/admindashboard/advanced", (_req, res) =>
  sendPage(res, "advanced.html"),
);
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
  // "//evil.example/x.html" would otherwise redirect off the site entirely,
  // because a browser reads a leading // as "any host". Same for /\\.
  if (/^[/\\]{2}/.test(clean)) return res.redirect(301, "/");
  res.redirect(301, clean === "/index" ? "/" : clean);
});

app.use(
  express.static(SITE_DIR, {
    extensions: ["html"],
    index: "index.html",
    dotfiles: "ignore",
    setHeaders: (res, filePath) => {
      // Pictures and icons do not change without changing their name.
      const web = filePath.split(path.sep).join("/");
      if (web.includes("/assets/"))
        return res.setHeader(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );
      // The stylesheet and the script were being fetched again on every one
      // of the 29 pages. Five minutes saves that without making a deploy take
      // long to reach anyone.
      if (/\.(css|js)$/.test(filePath))
        return res.setHeader("Cache-Control", "public, max-age=300");
      // Pages always get checked, so dashboard edits show up straight away.
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    },
  }),
);

app.use((req, res) => {
  if (req.path.startsWith("/api/"))
    return res.status(404).json({ error: "Not found" });
  res.status(404).sendFile(path.join(SITE_DIR, "404.html"), (err) => {
    if (err) res.status(404).type("text/plain").send("Page not found");
  });
});

// Last resort. NODE_ENV is not set on the host, so Express's own handler
// would put a stack trace in front of a visitor. This one never does.
app.use((err, req, res, _next) => {
  console.error("unhandled:", (err && err.stack) || err);
  if (res.headersSent) return;
  if (req.path.startsWith("/api/"))
    return res.status(500).json({ error: "Something went wrong." });
  res.status(500).sendFile(path.join(SITE_DIR, "500.html"), (e) => {
    if (e) res.status(500).type("text/plain").send("Something went wrong.");
  });
});

app.listen(PORT, () => console.log("RSIC backend running on port " + PORT));
