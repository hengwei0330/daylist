/* =========================================================
   Daylist — accounts, backed by Supabase Auth
   ---------------------------------------------------------
   This is real authentication. Signing up creates a row in
   Supabase's auth.users table on their servers; signing in sends
   the password to Supabase, which checks it against a hash we
   never see and hands back a time-limited access token.

   The important difference from a browser-only fake: the check
   happens somewhere the visitor cannot edit. Deleting JavaScript
   in developer tools no longer gets anyone in, because the
   database itself refuses to return rows without a valid token.
   ========================================================= */

window.Auth = (function () {
  "use strict";

  var client = null;
  var clientTried = false;

  /* ---------------- the Supabase client ---------------- */

  function placeholder(value){
    return !value || String(value).indexOf("PASTE_") === 0;
  }

  /* True once supabase-config.js has real values in it. */
  function configured(){
    var cfg = window.SUPABASE_CONFIG;
    return !!(cfg && !placeholder(cfg.url) && !placeholder(cfg.anonKey));
  }

  function getClient(){
    if (clientTried) return client;
    clientTried = true;
    if (!configured() || !window.supabase || !window.supabase.createClient) return null;
    try {
      client = window.supabase.createClient(
        window.SUPABASE_CONFIG.url,
        window.SUPABASE_CONFIG.anonKey
      );
    } catch (e) {
      client = null;
    }
    return client;
  }

  /* Why the app cannot run, in words worth showing on screen.
     Returns null when everything it needs is present. */
  function setupProblem(){
    if (!window.supabase || !window.supabase.createClient){
      return "The Supabase library did not load. Check your internet connection, then reload.";
    }
    if (!configured()){
      return "Supabase is not configured yet. Open supabase-config.js and paste in your Project URL and public API key.";
    }
    if (!getClient()){
      return "Could not start the Supabase client. Check that the values in supabase-config.js are correct.";
    }
    return null;
  }

  /* ---------------- error wording ----------------
     Supabase's messages are accurate but terse. These say the same
     thing in words that tell someone what to do next. */
  function friendly(error){
    if (!error) return "Something went wrong. Please try again.";
    var m = String(error.message || "");

    if (/invalid login credentials/i.test(m))
      return "That email and password do not match an account.";
    if (/email not confirmed/i.test(m))
      return "This account still needs confirming — check your inbox for the confirmation link.";
    if (/user already registered|already been registered/i.test(m))
      return "There is already an account with that email. Try signing in instead.";
    if (/password should be at least/i.test(m))
      return "That password is too short. Use at least 6 characters.";
    if (/unable to validate email|invalid email/i.test(m))
      return "That does not look like a valid email address.";
    if (/rate limit|too many requests/i.test(m))
      return "Too many attempts just now. Wait a minute and try again.";
    // Supabase throttles repeat signup/reset emails to the same address.
    if (/only request this after (\d+) seconds?/i.test(m))
      return "That was just sent. Wait " + m.match(/after (\d+) seconds?/i)[1] +
             " seconds before trying again — and check your inbox meanwhile.";
    if (/failed to fetch|network/i.test(m))
      return "Could not reach Supabase. Check your internet connection and the Project URL.";

    return m || "Something went wrong. Please try again.";
  }

  /* ---------------- sign up / in / out ---------------- */

  /* Depending on the project's settings, a new signup either returns a
     session straight away, or returns none and Supabase emails a
     confirmation link. Both are normal, so say which one happened. */
  function signUp(email, password){
    var problem = setupProblem();
    if (problem) return Promise.resolve({ ok: false, error: problem });

    return getClient().auth.signUp({
      email: String(email || "").trim(),
      password: password || ""
    }).then(function (res){
      if (res.error) return { ok: false, error: friendly(res.error) };
      if (res.data && res.data.session) return { ok: true, signedIn: true };
      return { ok: true, signedIn: false };   // confirmation email sent
    }, function (e){
      return { ok: false, error: friendly(e) };
    });
  }

  function signIn(email, password){
    var problem = setupProblem();
    if (problem) return Promise.resolve({ ok: false, error: problem });

    return getClient().auth.signInWithPassword({
      email: String(email || "").trim(),
      password: password || ""
    }).then(function (res){
      if (res.error) return { ok: false, error: friendly(res.error) };
      return { ok: true, signedIn: true };
    }, function (e){
      return { ok: false, error: friendly(e) };
    });
  }

  function signOut(){
    var c = getClient();
    if (!c) return Promise.resolve();
    return c.auth.signOut().catch(function (){ /* leaving anyway */ });
  }

  /* ---------------- reading the session ---------------- */

  /* The Supabase client keeps the session in this browser and refreshes
     it in the background, so this is a local read, not a round trip. */
  function session(){
    var c = getClient();
    if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(function (res){
      return (res && res.data && res.data.session) || null;
    }, function (){ return null; });
  }

  /* Send anyone without a session to the login page.
     Resolves with the session, or null when a redirect is under way. */
  function requireSession(){
    return session().then(function (s){
      if (!s) { window.location.replace("login.html"); return null; }
      return s;
    });
  }

  function emailOf(session){
    return (session && session.user && session.user.email) || "";
  }

  return {
    configured: configured,
    setupProblem: setupProblem,
    client: getClient,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    session: session,
    requireSession: requireSession,
    emailOf: emailOf,
    friendly: friendly
  };
})();
