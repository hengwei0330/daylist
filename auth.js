/* =========================================================
   Daylist — demo accounts
   ---------------------------------------------------------
   READ THIS BEFORE REUSING ANY OF IT.

   This file fakes a login system entirely inside the visitor's
   own browser. There is no server, so:

     * Anyone can open the browser's developer tools and read
       every stored account.
     * Anyone can edit those accounts, or just delete the check
       that sends them to the login page.
     * An account does not exist on any other browser, device,
       or for any other visitor.

   It is a classroom demonstration of what a login FLOW looks
   like, not a way to protect anything. Real authentication has
   to happen on a server the visitor cannot edit.

   Passwords are salted and hashed with SHA-256 before being
   stored, so the raw text is not sitting in plain sight. That
   is good hygiene, not security: without a server, the check
   itself can simply be bypassed.
   ========================================================= */

window.Auth = (function () {
  "use strict";

  var ACCOUNTS_KEY = "daylist.accounts.v1";
  var SESSION_KEY  = "daylist.session.v1";
  var TASKS_PREFIX = "daylist.tasks.v1";   // per account: "<prefix>::<username>"
  var LEGACY_TASKS = "daylist.tasks.v1";   // tasks saved before accounts existed

  /* ---------------- storage helpers ---------------- */
  function readJSON(store, key){
    try {
      var raw = store.getItem(key);
      return raw === null ? null : JSON.parse(raw);
    } catch (e) { return null; }
  }
  function writeJSON(store, key, value){
    try { store.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }
  function drop(store, key){
    try { store.removeItem(key); } catch (e) {}
  }

  function allAccounts(){ return readJSON(localStorage, ACCOUNTS_KEY) || {}; }
  function saveAccounts(a){ return writeJSON(localStorage, ACCOUNTS_KEY, a); }

  /* ---------------- password hashing ---------------- */
  function toHex(bytes){
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }

  function makeSalt(){
    var bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return toHex(bytes);
  }

  /* Fallback for the rare browser with no Web Crypto. Clearly weaker —
     labelled so a stored hash always says which method produced it. */
  function weakHash(str){
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return "weak:" + (h >>> 0).toString(16);
  }

  function hashPassword(password, salt){
    var input = salt + ":" + password;
    if (window.crypto && window.crypto.subtle && window.TextEncoder){
      return window.crypto.subtle
        .digest("SHA-256", new TextEncoder().encode(input))
        .then(function (buf){ return "sha256:" + toHex(new Uint8Array(buf)); })
        .catch(function (){ return weakHash(input); });
    }
    return Promise.resolve(weakHash(input));
  }

  /* ---------------- validation ---------------- */
  var NAME_RE = /^[A-Za-z0-9._-]{3,20}$/;

  function checkName(name){
    if (!name) return "Enter a username.";
    if (!NAME_RE.test(name)) return "Usernames are 3–20 characters: letters, numbers, dot, dash or underscore.";
    return null;
  }
  function checkPassword(pw){
    if (!pw) return "Enter a password.";
    if (pw.length < 8) return "Passwords need at least 8 characters.";
    return null;
  }

  /* ---------------- accounts ---------------- */
  function register(name, password, confirm){
    name = (name || "").trim();

    var problem = checkName(name) || checkPassword(password);
    if (problem) return Promise.resolve({ ok: false, error: problem });
    if (password !== confirm) return Promise.resolve({ ok: false, error: "The two passwords do not match." });

    var accounts = allAccounts();
    var key = name.toLowerCase();
    if (accounts[key]) return Promise.resolve({ ok: false, error: "That username is already taken." });

    var firstEver = Object.keys(accounts).length === 0;
    var salt = makeSalt();

    return hashPassword(password, salt).then(function (hash){
      accounts[key] = { display: name, salt: salt, hash: hash, createdAt: Date.now() };
      if (!saveAccounts(accounts)){
        return { ok: false, error: "This browser is blocking storage, so the account could not be saved." };
      }
      // The very first account adopts any tasks saved before logins existed,
      // so nobody's earlier list disappears behind the new login screen.
      if (firstEver) adoptLegacyTasks(key);
      return { ok: true, user: name };
    });
  }

  function login(name, password, remember){
    name = (name || "").trim();
    if (!name || !password) return Promise.resolve({ ok: false, error: "Enter your username and password." });

    var account = allAccounts()[name.toLowerCase()];
    if (!account) return Promise.resolve({ ok: false, error: "No account with that username. Create one instead?" });

    return hashPassword(password, account.salt).then(function (hash){
      if (hash !== account.hash) return { ok: false, error: "That password does not match." };
      startSession(account.display, remember);
      return { ok: true, user: account.display };
    });
  }

  function adoptLegacyTasks(accountKey){
    var legacy = readJSON(localStorage, LEGACY_TASKS);
    if (!legacy || !Array.isArray(legacy)) return;
    if (writeJSON(localStorage, TASKS_PREFIX + "::" + accountKey, legacy)) drop(localStorage, LEGACY_TASKS);
  }

  /* ---------------- session ---------------- */
  function startSession(display, remember){
    var session = { user: display, at: Date.now() };
    drop(localStorage, SESSION_KEY);
    drop(sessionStorage, SESSION_KEY);
    writeJSON(remember ? localStorage : sessionStorage, SESSION_KEY, session);
  }

  function currentUser(){
    var s = readJSON(sessionStorage, SESSION_KEY) || readJSON(localStorage, SESSION_KEY);
    if (!s || !s.user) return null;
    // An account deleted out from under a stale session should not stay signed in.
    return allAccounts()[s.user.toLowerCase()] ? s.user : null;
  }

  function logout(){
    drop(localStorage, SESSION_KEY);
    drop(sessionStorage, SESSION_KEY);
  }

  /* Send anyone without a session to the login page.
     Returns the username, or null when a redirect is under way. */
  function requireUser(){
    var user = currentUser();
    if (!user) { window.location.replace("login.html"); return null; }
    return user;
  }

  function tasksKey(user){
    return TASKS_PREFIX + "::" + String(user).toLowerCase();
  }

  function accountCount(){ return Object.keys(allAccounts()).length; }

  return {
    register: register,
    login: login,
    logout: logout,
    currentUser: currentUser,
    requireUser: requireUser,
    tasksKey: tasksKey,
    accountCount: accountCount
  };
})();
