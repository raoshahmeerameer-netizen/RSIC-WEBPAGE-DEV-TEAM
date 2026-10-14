// The patched nodemailer (every 6.x and 10.0.x release carries reachable
// advisories) asks for Node 20 or newer. This one module must never be able to
// stop the server booting, because that server is also the whole website, so a
// load failure costs the confirmation emails and nothing else.
let nodemailer = null;
let loadError = null;
try {
  nodemailer = require("nodemailer");
} catch (err) {
  loadError = err.message;
  console.error(
    "nodemailer did not load, so confirmation emails are off: " + loadError,
  );
}

// Confirmations go out through the organisers' own Gmail with an App Password,
// so the mail genuinely comes from raviscienceandinnovation@gmail.com: a reply
// lands in that inbox and every confirmation shows up in its Sent folder.
//
// That password is a live credential for a real mailbox, so it only ever comes
// from the environment. The repo is public and it must never be committed.
const {
  MAIL_USER,
  MAIL_APP_PASSWORD,
  MAIL_FROM_NAME = "R.S.I.C",
  // Some hosts block outbound 465. If that turns out to be the case, setting
  // MAIL_PORT to 587 switches to STARTTLS with no code change.
  MAIL_PORT = "465",
} = process.env;

const mailConfigured = () =>
  Boolean(nodemailer && MAIL_USER && MAIL_APP_PASSWORD);

let transport = null;
const getTransport = () => {
  if (!transport)
    transport = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: Number(MAIL_PORT) || 465,
      secure: Number(MAIL_PORT) !== 587,
      auth: {
        user: MAIL_USER,
        // Google shows an App Password as four groups of four, and it gets
        // pasted that way more often than not. The spaces are not part of it.
        pass: String(MAIL_APP_PASSWORD || "").replace(/\s+/g, ""),
      },
    });
  return transport;
};

// The wording lives in site_content so it can be changed from the dashboard.
// These are only the fallbacks, used before the rows are seeded or if the
// database cannot be reached, so a confirmation still goes out either way.
const DEFAULT_SUBJECT = "RSIC 2026: {school} is confirmed ({reg_no})";

const DEFAULT_BODY = [
  "Hello {head_delegate},",
  "{school} is confirmed for RSIC 2026. Your registration number is {reg_no}. Keep it somewhere safe, we will use it for everything from here.",
  "Your realms:\n{realms}",
  "Delegates: {delegates}\nSupervisor: {supervisor}",
  "When: Friday 13 to Sunday 15 November 2026\nWhere: TCS Ravi",
  "Bring the signed waiver of liability and the head delegate form with you. Both can be downloaded from https://cityrsic.com/register.",
  "If anything above is wrong, reply to this email and we will fix it.",
].join("\n\n");

const DEFAULT_SIGNOFF = "The RSIC team";

const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// A carriage return or line feed in a value that lands in the subject is how a
// header gets injected, and the school name and both people's names are typed
// into the public form. They are flattened here rather than trusting the mail
// library to do it. The realm list is built from our own keys, so it keeps the
// line breaks that make it a list.
const oneLine = (s) =>
  String(s == null ? "" : s)
    .replace(/[\r\n\t\f\v\u0000-\u0008\u000b-\u001f\u007f]+/g, " ")
    .trim();

// The values that go into the template. The school name, the head delegate's
// name and the supervisor's all come straight off the public form, so every
// one of them is escaped before it reaches the HTML version.
const valuesFor = (row, content) => {
  const realmName = (k) => (content && content["realm." + k + ".name"]) || k;
  const head = row.head_delegate || {};
  const realms = Array.isArray(row.realms) ? row.realms : [];
  return {
    reg_no:
      row.reg_no != null ? String(row.reg_no).padStart(3, "0") : "#" + row.id,
    school: oneLine(row.school) || "Your school",
    team: oneLine(row.team_name),
    head_delegate: oneLine(head.name) || "there",
    supervisor: oneLine(row.supervisor_name),
    delegates: row.delegates != null ? String(row.delegates) : "",
    realms: realms.map((k) => "- " + oneLine(realmName(k))).join("\n"),
    venue: "TCS Ravi",
    dates: "Friday 13 to Sunday 15 November 2026",
    contact: MAIL_USER || "raviscienceandinnovation@gmail.com",
  };
};

// A typo in a placeholder is left standing rather than quietly dropped, so it
// shows up the first time the owner sends themselves a test instead of going
// out to a school as a silent gap.
const fill = (template, values) =>
  String(template).replace(/\{([a-z_]+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole,
  );

// Email clients are the one place where inline styles and tables still win, so
// this is deliberately plain: the site's navy and pink, a serif heading, and
// nothing that depends on a stylesheet surviving the trip.
const htmlFor = (body, signoff, values) => {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        '<p style="margin:0 0 18px;line-height:1.65;color:#f3eee8">' +
        escapeHtml(p).replace(/\n/g, "<br />") +
        "</p>",
    )
    .join("");

  return [
    '<!doctype html><html><body style="margin:0;padding:0;background:#040b1a">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#040b1a;padding:28px 12px">',
    '<tr><td align="center">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#0b1d3b;border-radius:18px;padding:32px">',
    "<tr><td style=\"font-family:Georgia,'Times New Roman',serif;font-size:26px;color:#f3eee8;padding-bottom:4px\">",
    'RSIC<span style="color:#D0768F">.</span>',
    "</td></tr>",
    '<tr><td style="font-family:Georgia,serif;font-style:italic;font-size:15px;color:#D0768F;padding-bottom:22px">',
    "Different minds. One universe.",
    "</td></tr>",
    '<tr><td style="font-family:Helvetica,Arial,sans-serif;font-size:15px">',
    paragraphs,
    '<p style="margin:26px 0 0;font-family:Georgia,serif;font-style:italic;font-size:16px;color:#D0768F">',
    escapeHtml(signoff),
    "</p>",
    "</td></tr>",
    '<tr><td style="padding-top:26px;border-top:1px solid rgba(243,238,232,.14);font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#a8b5c8">',
    "Registration " +
      escapeHtml(values.reg_no) +
      ' &middot; <a href="https://cityrsic.com" style="color:#D0768F;text-decoration:none">cityrsic.com</a>',
    "</td></tr>",
    "</table></td></tr></table></body></html>",
  ].join("");
};

// Who hears about an approval: the head delegate and the supervisor, as the
// owner asked. Either address can be missing on an older row, so whoever is
// there is written to and the result says exactly who was reached.
//
// These two addresses are typed into the public registration form, so they are
// held to a deliberately narrow shape here as well as at registration. The
// parentheses, commas, semicolons and angle brackets are the characters the
// address-parser advisories turn on, and no real address needs them.
const PLAIN_ADDRESS = /^[^\s@(),;:<>\\"]+@[^\s@(),;:<>\\".]+(\.[^\s@(),;:<>\\".]+)+$/;

const recipientsFor = (row) => {
  const head = row.head_delegate || {};
  const seen = new Set();
  return [head.email, row.supervisor_email]
    .map((e) => String(e || "").trim())
    .filter((e) => {
      const low = e.toLowerCase();
      if (e.length > 160 || !PLAIN_ADDRESS.test(e) || seen.has(low))
        return false;
      seen.add(low);
      return true;
    });
};

const sendConfirmation = async (row, content) => {
  const to = recipientsFor(row);
  if (!to.length)
    return {
      ok: false,
      to: [],
      error:
        "This delegation has no head delegate or supervisor email on file.",
    };
  if (loadError)
    return {
      ok: false,
      to,
      error:
        "The mail library could not start on this server (" +
        loadError +
        "). It needs Node 20 or newer.",
    };
  if (!mailConfigured())
    return {
      ok: false,
      to,
      error:
        "Email is not set up yet: MAIL_USER and MAIL_APP_PASSWORD are missing on the server.",
    };

  const c = content || {};
  if (String(c["email.confirm.enabled"] || "on").toLowerCase() !== "on")
    return {
      ok: false,
      to,
      skipped: true,
      error: "Confirmation emails are switched off in the dashboard.",
    };

  const values = valuesFor(row, c);
  // Flattened again after filling, which also covers a line break pasted into
  // the subject field in the dashboard.
  const subject = oneLine(
    fill(c["email.confirm.subject"] || DEFAULT_SUBJECT, values),
  );
  const body = fill(c["email.confirm.body"] || DEFAULT_BODY, values);
  const signoff = fill(c["email.confirm.signoff"] || DEFAULT_SIGNOFF, values);

  try {
    const info = await getTransport().sendMail({
      from: '"' + MAIL_FROM_NAME + '" <' + MAIL_USER + ">",
      to,
      subject,
      text: body + "\n\n" + signoff + "\n\nhttps://cityrsic.com",
      html: htmlFor(body, signoff, values),
    });
    return { ok: true, to, id: info.messageId };
  } catch (err) {
    // An approval must never fail because a mail server was having a moment,
    // so the reason is handed back for the dashboard to show instead.
    return {
      ok: false,
      to,
      error: err.message || "The mail server refused it.",
    };
  }
};

module.exports = { sendConfirmation, mailConfigured };
