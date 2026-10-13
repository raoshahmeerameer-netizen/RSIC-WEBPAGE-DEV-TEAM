// Give styles.css and script.js a version in their URL.
//
// Hostinger's CDN strips Cache-Control and ETag from both files and sends only
// Last-Modified, so browsers fall back to heuristic caching and can hold a
// stale copy long after a deploy. A visitor then gets new HTML with old CSS and
// JS, which is how the footer tags failed to appear. Nothing the app sets at
// the origin survives the CDN, but a changed URL cannot be served from cache at
// all, so the version goes in the query string, derived from the file's bytes.
//
// It runs from "prestart", so every deploy stamps itself. It is idempotent and
// never fails the boot: if anything goes wrong the pages still work, they just
// keep the URLs they already had.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SITE_DIR = path.join(__dirname, "..", "public");

const shortHash = (file) =>
  crypto
    .createHash("sha1")
    .update(fs.readFileSync(path.join(SITE_DIR, file)))
    .digest("hex")
    .slice(0, 10);

const htmlFilesIn = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFilesIn(full);
    return entry.isFile() && entry.name.endsWith(".html") ? [full] : [];
  });

// Plain string scanning rather than a regex: the asset paths contain dots and
// the stamped ones a question mark, and escaping those by hand is how this
// kind of helper usually breaks.
const stampOne = (html, asset, hash) => {
  const needle = '="' + asset;
  const out = [];
  let i = 0;
  for (;;) {
    const at = html.indexOf(needle, i);
    if (at < 0) {
      out.push(html.slice(i));
      return out.join("");
    }
    const close = html.indexOf('"', at + 2);
    if (close < 0) {
      out.push(html.slice(i));
      return out.join("");
    }
    const current = html.slice(at + 2, close);
    out.push(html.slice(i, at));
    // only the asset itself, with or without a version already on it
    out.push(
      current.split("?")[0] === asset
        ? '="' + asset + "?v=" + hash + '"'
        : '="' + current + '"',
    );
    i = close + 1;
  }
};

try {
  const versions = {
    "/styles.css": shortHash("styles.css"),
    "/script.js": shortHash("script.js"),
  };

  let changed = 0;
  for (const file of htmlFilesIn(SITE_DIR)) {
    const before = fs.readFileSync(file, "utf8");
    let after = before;
    for (const [asset, hash] of Object.entries(versions))
      after = stampOne(after, asset, hash);
    if (after !== before) {
      fs.writeFileSync(file, after);
      changed += 1;
    }
  }

  console.log(
    "stamp-assets: styles.css@" +
      versions["/styles.css"] +
      " script.js@" +
      versions["/script.js"] +
      ", " +
      changed +
      " page(s) updated",
  );
} catch (err) {
  console.warn("stamp-assets: skipped (" + err.message + ")");
}
