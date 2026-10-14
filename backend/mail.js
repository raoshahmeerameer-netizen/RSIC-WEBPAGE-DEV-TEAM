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
  // Gmail by default, but any SMTP provider works by setting these. The sender
  // is MAIL_FROM when it is given, so a mailbox on cityrsic.com or a sending
  // service needs no code change at all.
  MAIL_HOST = "smtp.gmail.com",
  // Some hosts block outbound 465. If that turns out to be the case, setting
  // MAIL_PORT to 587 switches to STARTTLS.
  MAIL_PORT = "465",
  MAIL_FROM,
  // Where replies should go, when that is not the address sending.
  MAIL_REPLY_TO,
} = process.env;

const fromAddress = () => MAIL_FROM || MAIL_USER;

const mailConfigured = () =>
  Boolean(nodemailer && MAIL_USER && MAIL_APP_PASSWORD);

let transport = null;
const getTransport = () => {
  if (!transport)
    transport = nodemailer.createTransport({
      host: MAIL_HOST,
      port: Number(MAIL_PORT) || 465,
      secure: Number(MAIL_PORT) !== 587,
      auth: {
        user: MAIL_USER,
        // Google shows an App Password as four groups of four and it gets
        // pasted that way more often than not, where the spaces are not part
        // of it. Only Gmail, though: any other mailbox has an ordinary
        // password, and a space in one is a real character to send as typed.
        pass: /(^|\.)gmail\.com$/i.test(MAIL_HOST)
          ? String(MAIL_APP_PASSWORD || "").replace(/\s+/g, "")
          : String(MAIL_APP_PASSWORD || ""),
      },
    });
  return transport;
};

// ------------------------------------------------------------------ wording
// Only the prose is editable from the dashboard. The tables of the
// delegation's own details are built here, because a school's realms and
// delegates have to be laid out rather than typed into a template.
const DEFAULT_SUBJECT =
  "RSIC 2026 registration confirmed: {school} ({reg_no})";

const DEFAULT_INTRO = [
  "We have received your payment, and your delegation's place at RSIC 2026 is now confirmed.",
  "Your registration number is {reg_no}. Please quote it in any correspondence with us, and keep it with you on the day.",
  "The details we hold for your delegation are set out below. Please check them.",
].join("\n\n");

const DEFAULT_NOTES = [
  "Please bring the signed waiver of liability and the head delegate form with you on the first day. Both can be downloaded from https://cityrsic.com/register.",
  "If any of the details above are incorrect, reply to this email and we will correct them.",
].join("\n\n");

const DEFAULT_SIGNOFF = "The RSIC team";

const FALLBACK = {
  dates: "Friday 13 to Sunday 15 November 2026",
  venue: "The City School, Ravi Campus, Johar Town, Lahore",
  contact: "raviscienceandinnovation@gmail.com",
  map: "https://maps.app.goo.gl/rr4QBxRrdJW5JUn19",
};

// ------------------------------------------------------ what goes in the email
// Which details the email carries is the owner's choice, made on the Email page
// in the dashboard and stored as a comma separated list in
// email.confirm.fields. This list is the one source of truth: the page builds
// its checkboxes from it, and the renderer reads the same ids, so the two
// cannot drift apart.
const FIELD_GROUPS = [
  {
    id: "top",
    title: "Top of the email",
    fields: [["regno_box", "The big registration number box"]],
  },
  {
    id: "delegation",
    title: "Delegation",
    fields: [
      ["school", "School"],
      ["team", "Team name"],
      ["delegate_count", "Number of delegates"],
    ],
  },
  {
    id: "realms",
    title: "Realms",
    fields: [["realms", "The realms they entered"]],
  },
  {
    id: "supervisor",
    title: "Supervisor",
    fields: [
      ["supervisor_name", "Name"],
      ["supervisor_email", "Email"],
      ["supervisor_phone", "Phone"],
    ],
  },
  {
    id: "head",
    title: "Head delegate",
    fields: [
      ["head_name", "Name"],
      ["head_email", "Email"],
      ["head_phone", "Phone"],
    ],
  },
  {
    id: "delegates",
    title: "Delegates",
    fields: [["delegates", "Their names"]],
  },
  {
    id: "event",
    title: "The event",
    fields: [
      ["dates", "Dates"],
      ["venue", "Venue"],
      ["map", "Google Maps link"],
    ],
  },
  {
    id: "contact",
    title: "Contact",
    fields: [["contact", "Contact email address"]],
  },
];

const ALL_FIELDS = FIELD_GROUPS.reduce(
  (all, g) => all.concat(g.fields.map((f) => f[0])),
  [],
);

// No stored value means everything is included, so the email is complete before
// anyone visits the page. An empty stored value genuinely means none, which is
// why the two cases are told apart rather than both falling back.
const visibleFields = (content) => {
  const raw = content && content["email.confirm.fields"];
  if (raw == null) return new Set(ALL_FIELDS);
  return new Set(
    String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter((s) => ALL_FIELDS.indexOf(s) !== -1),
  );
};

// ------------------------------------------------------------------ helpers
const escapeHtml = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// A carriage return or line feed in a value that lands in the subject is how a
// header gets injected, and the school name and every person's name are typed
// into the public form. They are flattened here rather than trusting the mail
// library to do it.
const oneLine = (s) =>
  String(s == null ? "" : s)
    .replace(/[\r\n\t\f\v\u0000-\u0008\u000b-\u001f\u007f]+/g, " ")
    .trim();

// A typo in a placeholder is left standing rather than quietly dropped, so it
// shows up the first time the owner sends themselves a test instead of going
// out to a school as a silent gap.
const fill = (template, values) =>
  String(template).replace(/\{([a-z_]+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : whole,
  );

// Only http and https ever reach an href, so a dashboard field cannot put a
// javascript: or data: URL into an email. Same rule the public pages use.
const safeUrl = (u) => {
  const s = oneLine(u);
  return /^https?:\/\/[^\s"<>]+$/i.test(s) ? s : "";
};

const setting = (content, key, fallback) =>
  oneLine((content && content[key]) || "") || fallback;

// ------------------------------------------------------------------ the data
const detailsOf = (row, content) => {
  const realmName = (k) =>
    oneLine((content && content["realm." + k + ".name"]) || k);
  const head = row.head_delegate || {};
  const realms = Array.isArray(row.realms) ? row.realms : [];
  const list = Array.isArray(row.delegate_list) ? row.delegate_list : [];
  const total = row.delegates != null ? Number(row.delegates) : null;

  return {
    regNo:
      row.reg_no != null ? String(row.reg_no).padStart(3, "0") : "#" + row.id,
    school: oneLine(row.school),
    team: oneLine(row.team_name),
    total: total,
    // The head delegate counts toward the total, and delegate_list holds the
    // others, so the two together are the whole delegation.
    others: list.map((d) => oneLine(d && d.name)).filter(Boolean),
    realms: realms.map(realmName),
    supervisor: {
      name: oneLine(row.supervisor_name),
      email: oneLine(row.supervisor_email),
      phone: oneLine(row.supervisor_phone),
    },
    head: {
      name: oneLine(head.name),
      email: oneLine(head.email),
      phone: oneLine(head.phone),
    },
    dates: setting(content, "event.dates", FALLBACK.dates),
    venue: setting(content, "event.venue", FALLBACK.venue),
    contact: setting(content, "contact.email", FALLBACK.contact),
    map: safeUrl(setting(content, "event.map_url", FALLBACK.map)),
  };
};

// ------------------------------------------------------------- plain text
const textVersion = (d, intro, notes, signoff, show) => {
  const out = [];
  const rule = "------------------------------------------------------------";
  // A section only appears when something is left in it, so switching every
  // field off removes the heading too rather than leaving an empty one.
  const block = (title, lines) => {
    const kept = lines.filter(Boolean);
    if (!kept.length) return;
    out.push("", rule, title.toUpperCase(), rule);
    kept.forEach((l) => out.push(l));
  };
  const pair = (on, label, value) =>
    on && value ? "  " + (label + ":").padEnd(22) + value : "";

  out.push("RSIC 2026");
  out.push("Different minds. One universe.");
  out.push("");
  out.push("REGISTRATION CONFIRMED");
  if (show("regno_box")) out.push("Registration number: " + d.regNo);
  out.push("");
  out.push("Dear " + (d.head.name || "delegate") + ",");
  out.push("");
  out.push(intro);

  block("Delegation", [
    pair(show("school"), "School", d.school),
    pair(show("team"), "Team name", d.team),
    pair(
      show("delegate_count"),
      "Delegates",
      d.total != null ? String(d.total) : "",
    ),
  ]);

  if (show("realms") && d.realms.length)
    block(
      "Realms entered (" + d.realms.length + ")",
      d.realms.map((r, i) => "  " + (i + 1) + ". " + r),
    );

  block("Supervisor", [
    pair(show("supervisor_name"), "Name", d.supervisor.name),
    pair(show("supervisor_email"), "Email", d.supervisor.email),
    pair(show("supervisor_phone"), "Phone", d.supervisor.phone),
  ]);

  block("Head delegate", [
    pair(show("head_name"), "Name", d.head.name),
    pair(show("head_email"), "Email", d.head.email),
    pair(show("head_phone"), "Phone", d.head.phone),
  ]);

  if (show("delegates") && d.others.length)
    block(
      "Delegates (" + d.others.length + ")",
      d.others
        .map((n, i) => "  " + (i + 1) + ". " + n)
        .concat(["", "  The head delegate is listed separately above."]),
    );

  block("The event", [
    pair(show("dates"), "Dates", d.dates),
    pair(show("venue"), "Venue", d.venue),
    pair(show("map"), "Map", d.map),
  ]);

  block("Contact", [pair(show("contact"), "Email", d.contact)]);

  out.push("", rule, "");
  out.push(notes);
  out.push("");
  out.push(signoff);
  out.push("");
  out.push("https://cityrsic.com");
  return out.join("\n");
};

// ------------------------------------------------------------------- html
// Email clients are the one place where tables and inline styles still win, so
// this is deliberately plain: the site's navy and pink, a serif heading, and
// nothing that depends on a stylesheet surviving the trip.
const C = {
  page: "#040b1a",
  card: "#0b1d3b",
  raised: "#10264a",
  text: "#f3eee8",
  soft: "#a8b5c8",
  pink: "#D0768F",
  line: "rgba(243,238,232,.14)",
};
const SANS = "Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

const paras = (text) =>
  String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        '<p style="margin:0 0 14px;font-family:' +
        SANS +
        ";font-size:15px;line-height:1.7;color:" +
        C.text +
        '">' +
        escapeHtml(p).replace(/\n/g, "<br />") +
        "</p>",
    )
    .join("");

const heading = (title) =>
  '<tr><td style="padding:26px 0 10px"><div style="font-family:' +
  SANS +
  ";font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:" +
  C.pink +
  ';font-weight:700">' +
  escapeHtml(title) +
  '</div><div style="height:1px;background:' +
  C.line +
  ';margin-top:9px"></div></td></tr>';

// A label and value on one row. Tables are how a formal email stays aligned in
// Outlook as well as Gmail.
const rows = (pairsList) => {
  const body = pairsList
    .filter((p) => p[1])
    .map(
      (p) =>
        '<tr><td style="padding:5px 14px 5px 0;font-family:' +
        SANS +
        ";font-size:13px;color:" +
        C.soft +
        ';white-space:nowrap;vertical-align:top;width:1%">' +
        escapeHtml(p[0]) +
        '</td><td style="padding:5px 0;font-family:' +
        SANS +
        ";font-size:14px;color:" +
        C.text +
        ';vertical-align:top">' +
        (p[2] ? p[2] : escapeHtml(p[1])) +
        "</td></tr>",
    )
    .join("");
  return body
    ? '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
        body +
        "</table></td></tr>"
    : "";
};

const numbered = (items, note) => {
  if (!items.length) return "";
  const li = items
    .map(
      (t, i) =>
        '<tr><td style="padding:4px 10px 4px 0;font-family:' +
        SANS +
        ";font-size:13px;color:" +
        C.pink +
        ';vertical-align:top;width:1%">' +
        String(i + 1).padStart(2, "0") +
        '</td><td style="padding:4px 0;font-family:' +
        SANS +
        ";font-size:14px;color:" +
        C.text +
        '">' +
        escapeHtml(t) +
        "</td></tr>",
    )
    .join("");
  const tail = note
    ? '<p style="margin:10px 0 0;font-family:' +
      SANS +
      ";font-size:12px;color:" +
      C.soft +
      '">' +
      escapeHtml(note) +
      "</p>"
    : "";
  return (
    '<tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
    li +
    "</table>" +
    tail +
    "</td></tr>"
  );
};

const htmlVersion = (d, intro, notes, signoff, show) => {
  // A heading is only emitted when its table has rows, so switching every field
  // in a section off takes the heading with it rather than leaving an empty one.
  const section = (title, pairsList) => {
    const body = rows(pairsList);
    return body ? heading(title) + body : "";
  };
  const mapLink =
    d.map && show("map")
      ? '<a href="' +
        escapeHtml(d.map) +
        '" style="color:' +
        C.pink +
        ';text-decoration:none;font-weight:700">Open in Google Maps</a>'
      : "";

  const parts = [
    '<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>RSIC 2026 registration confirmed</title></head>',
    '<body style="margin:0;padding:0;background:' +
      C.page +
      ';-webkit-text-size-adjust:100%">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' +
      C.page +
      ';padding:28px 12px">',
    '<tr><td align="center">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:' +
      C.card +
      ';border-radius:18px;padding:34px 30px">',

    // masthead
    '<tr><td style="font-family:' +
      SERIF +
      ";font-size:27px;color:" +
      C.text +
      '">RSIC<span style="color:' +
      C.pink +
      '">.</span></td></tr>',
    '<tr><td style="font-family:' +
      SERIF +
      ";font-style:italic;font-size:14px;color:" +
      C.pink +
      ';padding-top:2px">Different minds. One universe.</td></tr>',
    '<tr><td style="padding-top:20px"><div style="height:1px;background:' +
      C.line +
      '"></div></td></tr>',

    // title and the number, which is the thing they will look for
    '<tr><td style="padding-top:24px;font-family:' +
      SERIF +
      ";font-size:22px;color:" +
      C.text +
      '">Registration confirmed</td></tr>',
    !show("regno_box")
      ? ""
      : '<tr><td style="padding-top:14px"><table role="presentation" cellpadding="0" cellspacing="0" style="background:' +
      C.raised +
      ';border-radius:12px"><tr><td style="padding:12px 18px;font-family:' +
      SANS +
      ";font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:" +
      C.soft +
      '">Registration number<div style="font-family:' +
      SERIF +
      ";font-size:28px;color:" +
      C.pink +
      ';margin-top:4px">' +
      escapeHtml(d.regNo) +
      "</div></td></tr></table></td></tr>",

    // salutation and the editable opening
    '<tr><td style="padding-top:24px;font-family:' +
      SANS +
      ";font-size:15px;color:" +
      C.text +
      ';font-weight:700">Dear ' +
      escapeHtml(d.head.name || "delegate") +
      ",</td></tr>",
    '<tr><td style="padding-top:12px">' + paras(intro) + "</td></tr>",

    // The registration number is not repeated here: it has its own box above
    // and the footer carries it again.
    section("Delegation", [
      ["School", show("school") ? d.school : ""],
      ["Team name", show("team") ? d.team : ""],
      [
        "Delegates",
        show("delegate_count") && d.total != null ? String(d.total) : "",
      ],
    ]),
  ];

  if (show("realms") && d.realms.length) {
    parts.push(heading("Realms entered (" + d.realms.length + ")"));
    parts.push(numbered(d.realms, ""));
  }

  parts.push(
    section("Supervisor", [
      ["Name", show("supervisor_name") ? d.supervisor.name : ""],
      ["Email", show("supervisor_email") ? d.supervisor.email : ""],
      ["Phone", show("supervisor_phone") ? d.supervisor.phone : ""],
    ]),
  );

  parts.push(
    section("Head delegate", [
      ["Name", show("head_name") ? d.head.name : ""],
      ["Email", show("head_email") ? d.head.email : ""],
      ["Phone", show("head_phone") ? d.head.phone : ""],
    ]),
  );

  if (show("delegates") && d.others.length) {
    parts.push(heading("Delegates (" + d.others.length + ")"));
    parts.push(
      numbered(d.others, "The head delegate is listed separately above."),
    );
  }

  parts.push(
    section("The event", [
      ["Dates", show("dates") ? d.dates : ""],
      ["Venue", show("venue") ? d.venue : ""],
      ["Map", mapLink ? "link" : "", mapLink],
    ]),
  );

  parts.push(
    section("Contact", [
      [
        "Email",
        show("contact") ? d.contact : "",
        '<a href="mailto:' +
          escapeHtml(d.contact) +
          '" style="color:' +
          C.pink +
          ';text-decoration:none">' +
          escapeHtml(d.contact) +
          "</a>",
      ],
    ]),
  );

  parts.push(
    '<tr><td style="padding-top:26px"><div style="height:1px;background:' +
      C.line +
      '"></div></td></tr>',
    '<tr><td style="padding-top:22px">' + paras(notes) + "</td></tr>",
    '<tr><td style="padding-top:14px;font-family:' +
      SERIF +
      ";font-style:italic;font-size:17px;color:" +
      C.pink +
      '">' +
      escapeHtml(signoff) +
      "</td></tr>",
    '<tr><td style="padding-top:26px"><div style="height:1px;background:' +
      C.line +
      '"></div></td></tr>',
    '<tr><td style="padding-top:16px;font-family:' +
      SANS +
      ";font-size:12px;color:" +
      C.soft +
      '">Registration ' +
      escapeHtml(d.regNo) +
      ' &middot; <a href="https://cityrsic.com" style="color:' +
      C.pink +
      ';text-decoration:none">cityrsic.com</a></td></tr>',
    "</table></td></tr></table></body></html>",
  );

  return parts.join("");
};

// ------------------------------------------------------------- recipients
// These two addresses are typed into the public registration form, so they are
// held to a deliberately narrow shape here as well as at registration. The
// parentheses, commas, semicolons and angle brackets are the characters the
// address-parser advisories turn on, and no real address needs them.
const PLAIN_ADDRESS =
  /^[^\s@(),;:<>\\"]+@[^\s@(),;:<>\\".]+(\.[^\s@(),;:<>\\".]+)+$/;

// Who hears about an approval: the head delegate and the supervisor, as the
// owner asked. Either address can be missing on an older row, so whoever is
// there is written to and the result says exactly who was reached.
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

// ----------------------------------------------------------------- render
// Building the mail is separate from sending it, so the dashboard's Email page
// can show exactly what will go out without a mail server being involved.
const renderConfirmation = (row, content) => {
  const c = content || {};
  const d = detailsOf(row, c);
  const fields = visibleFields(c);
  const show = (id) => fields.has(id);

  // The placeholders the editable prose can use.
  const values = {
    reg_no: d.regNo,
    school: d.school || "your school",
    team: d.team,
    head_delegate: d.head.name || "delegate",
    supervisor: d.supervisor.name,
    delegates: d.total != null ? String(d.total) : "",
    realms: d.realms.join(", "),
    venue: d.venue,
    dates: d.dates,
    contact: d.contact,
  };

  // Flattened again after filling, which also covers a line break pasted into
  // the subject field in the dashboard.
  const subject = oneLine(
    fill(c["email.confirm.subject"] || DEFAULT_SUBJECT, values),
  );
  const intro = fill(c["email.confirm.intro"] || DEFAULT_INTRO, values);
  const notes = fill(c["email.confirm.notes"] || DEFAULT_NOTES, values);
  const signoff = fill(c["email.confirm.signoff"] || DEFAULT_SIGNOFF, values);

  return {
    subject,
    text: textVersion(d, intro, notes, signoff, show),
    html: htmlVersion(d, intro, notes, signoff, show),
  };
};

// ------------------------------------------------------------------- send
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

  const { subject, text, html } = renderConfirmation(row, c);

  try {
    const info = await getTransport().sendMail({
      from: '"' + MAIL_FROM_NAME + '" <' + fromAddress() + ">",
      ...(MAIL_REPLY_TO ? { replyTo: MAIL_REPLY_TO } : {}),
      to,
      subject,
      text,
      html,
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

module.exports = {
  sendConfirmation,
  renderConfirmation,
  mailConfigured,
  FIELD_GROUPS,
  ALL_FIELDS,
  MAIL_USER,
  MAIL_REPLY_TO,
};
