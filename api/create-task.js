/* =========================================================
   /api/create-task  —  "describe it and I'll make the task"

   THIS FILE RUNS ON VERCEL'S SERVERS, NOT IN THE BROWSER.
   That is the whole point. The Groq key lives in an environment
   variable here, where a visitor can never read it. The browser
   only ever talks to this function.

   Never move the key into a .js file the browser downloads —
   anyone could open developer tools and spend your Groq credit.
   ========================================================= */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

/* Your Supabase project. These two are public by design — the same
   pair already ships in supabase-config.js. */
const SUPABASE_URL = process.env.SUPABASE_URL || "https://iwlfpjrvdhrwbxlhlhgm.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "sb_publishable_vjUkD1Kbo_YOMARhvkbLUA_-XKeCtH0";

const MAX_INPUT = 400;
const MAX_TASKS = 5;
const MAX_TASK_TEXT = 90;

/* Only signed-in people may use this. Without the check, anyone who
   found the URL could run up the Groq bill. */
async function signedIn(authHeader) {
  if (!authHeader || !/^Bearer\s+\S+/i.test(authHeader)) return false;
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_KEY, Authorization: authHeader },
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

function systemPrompt(today, weekday) {
  return [
    "You turn a person's plain description into to-do list items.",
    `Today is ${today} (${weekday}).`,
    "",
    "Reply with JSON only, in exactly this shape:",
    '{"tasks":[{"text":"...","due":"YYYY-MM-DD"|null,"priority":0|1|2,"list":"word"|null}]}',
    "",
    "Rules:",
    `- Between 1 and ${MAX_TASKS} tasks. Give exactly 1 unless the person clearly describes`,
    "  several separate things, or asks to break something down into steps.",
    `- "text" is a short imperative task, under ${MAX_TASK_TEXT} characters. Do not put the`,
    '  due date or words like "urgent" inside the text — those belong in the other fields.',
    '- "due" only when timing is implied. Resolve relative wording against today\'s date.',
    "  No timing mentioned means null.",
    "- priority: 2 when the person signals urgency or importance, 1 when mild, otherwise 0.",
    '- "list" is one lowercase word grouping the task, such as home, work, school, health,',
    "  errands or money. Use null when nothing fits.",
    "- Write the task in the same language the person used.",
  ].join("\n");
}

/* The model is told what shape to return, but never trusted to obey.
   Anything malformed is repaired or dropped here. */
function cleanTasks(raw) {
  const list = raw && Array.isArray(raw.tasks) ? raw.tasks : [];
  const out = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;

    let text = typeof item.text === "string" ? item.text.trim() : "";
    if (!text) continue;
    if (text.length > MAX_TASK_TEXT) text = text.slice(0, MAX_TASK_TEXT).trim();

    let due = null;
    if (typeof item.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.due)) {
      const d = new Date(item.due + "T00:00:00");
      if (!isNaN(d.getTime())) due = item.due;
    }

    let priority = Number(item.priority);
    if (!Number.isFinite(priority)) priority = 0;
    priority = Math.max(0, Math.min(2, Math.round(priority)));

    let listName = null;
    if (typeof item.list === "string") {
      const m = item.list.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
      if (m) listName = m.slice(0, 20);
    }

    out.push({ text, due, priority, list: listName });
    if (out.length >= MAX_TASKS) break;
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    res.status(503).json({ error: "The assistant is not set up yet. Add GROQ_API_KEY in Vercel." });
    return;
  }

  if (!(await signedIn(req.headers.authorization))) {
    res.status(401).json({ error: "Sign in first." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "Describe what you need to do." });
    return;
  }
  if (text.length > MAX_INPUT) {
    res.status(400).json({ error: `Keep it under ${MAX_INPUT} characters.` });
    return;
  }

  /* The browser sends its own date, so "tomorrow" means tomorrow where
     the person is, not wherever the server happens to be. */
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today)
    ? body.today
    : new Date().toISOString().slice(0, 10);
  const weekday = new Date(today + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });

  let groqRes;
  try {
    groqRes = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.2,
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(today, weekday) },
          { role: "user", content: text },
        ],
      }),
    });
  } catch (e) {
    res.status(502).json({ error: "Could not reach the assistant. Try again." });
    return;
  }

  if (!groqRes.ok) {
    /* Log the detail for yourself; never return it — upstream errors can
       echo back request details. */
    let detail = "";
    try { detail = (await groqRes.text()).slice(0, 500); } catch (e) {}
    console.error("Groq error", groqRes.status, detail);

    if (groqRes.status === 401) {
      res.status(503).json({ error: "The assistant's key was rejected. Check GROQ_API_KEY in Vercel." });
    } else if (groqRes.status === 429) {
      res.status(429).json({ error: "The assistant is busy right now. Try again in a moment." });
    } else {
      res.status(502).json({ error: "The assistant could not answer. Try again." });
    }
    return;
  }

  let tasks;
  try {
    const data = await groqRes.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message.content;
    tasks = cleanTasks(JSON.parse(content));
  } catch (e) {
    res.status(502).json({ error: "The assistant replied in a form we could not read. Try rewording it." });
    return;
  }

  if (!tasks.length) {
    res.status(422).json({ error: "Could not turn that into a task. Try describing it differently." });
    return;
  }

  res.status(200).json({ tasks });
};
