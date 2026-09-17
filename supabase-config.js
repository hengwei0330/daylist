/* =========================================================
   Your Supabase project's two public values.

   Find them at: supabase.com → your project → Settings → API
     * "Project URL"  (looks like https://abcdefgh.supabase.co)
     * the public API key — older dashboards label it "anon public",
       newer ones "Publishable key" (starts with sb_publishable_)

   Replace the two placeholders below and save.

   IS IT SAFE TO PUT THIS KEY IN PUBLIC CODE?  Yes — this one is
   designed to ship in the browser, and it is not a password. What
   actually protects your data is Row Level Security: the rules in
   supabase-setup.sql tell Postgres that a signed-in person may only
   touch rows where user_id matches their own account.

   NEVER put the "service_role" / "secret" key here. That one bypasses
   every rule, and this file is downloaded by every visitor.
   ========================================================= */

window.SUPABASE_CONFIG = {
  url:     "https://iwlfpjrvdhrwbxlhlhgm.supabase.co",
  anonKey: "sb_publishable_vjUkD1Kbo_YOMARhvkbLUA_-XKeCtH0"
};
