import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import {
  getDatabase, ref, get, set, push, onValue, remove, off
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-database.js";

/* ── FIREBASE ── */
const firebaseConfig = {
  apiKey: "AIzaSyB1jn36w9rpzskOHZujUIWdFyHAJdNYBMQ",
  authDomain: "chatroom-37278.firebaseapp.com",
  databaseURL: "https://chatroom-37278-default-rtdb.firebaseio.com",
  projectId: "chatroom-37278",
  storageBucket: "chatroom-37278.firebasestorage.app",
  messagingSenderId: "738726516362",
  appId: "1:738726516362:web:0dc5ea006158c1d3c9bf73"
};
const app = initializeApp(firebaseConfig);
const db  = getDatabase(app);

/* ── CRYPTO ── */
const buf2hex = b => [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
const rand16  = () => buf2hex(crypto.getRandomValues(new Uint8Array(16)));

async function pbkdf2Hash(plain, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(plain), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name:"PBKDF2", salt:enc.encode(salt), iterations:200_000, hash:"SHA-256" }, key, 256
  );
  return buf2hex(bits);
}
async function hashPassword(plain) {
  const salt = rand16();
  return "v1:" + salt + ":" + await pbkdf2Hash(plain, salt);
}
async function verifyPassword(plain, stored) {
  if (!stored?.startsWith("v1:")) return false;
  const [,salt,expected] = stored.split(":");
  const attempt = await pbkdf2Hash(plain, salt);
  if (attempt.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < attempt.length; i++) diff |= attempt.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
function makeUID(username) {
  return buf2hex(new TextEncoder().encode(username + "_cr_v1")).substring(0, 28);
}
function deriveChatKey(a, b) {
  return CryptoJS.SHA256([a,b].sort().join("||chatroom||")).toString();
}
function encMsg(t, k)  { return CryptoJS.AES.encrypt(t, k).toString(); }
function decMsg(c, k)  {
  try { const b = CryptoJS.AES.decrypt(c, k); return b.toString(CryptoJS.enc.Utf8) || "[encrypted]"; }
  catch { return "[encrypted]"; }
}

/* ── SCREENS ── */
const SCREENS = ["login","home","search","requests","chat","call"];
function showScreen(name) {
  SCREENS.forEach(n => {
    const el = document.getElementById("screen-" + n);
    if (el) el.classList.toggle("active", n === name);
  });
}

/* ── DOM ── */
const $ = id => document.getElementById(id);
// login
const tabLoginBtn     = $("tab-login");
const tabRegBtn       = $("tab-register");
const loginFormEl     = $("login-form");
const regFormEl       = $("register-form");
const loginUser       = $("login-username");
const loginPass       = $("login-password");
const loginBtn        = $("login-btn");
const loginErr        = $("login-error");
const regUser         = $("reg-username");
const regPass         = $("reg-password");
const regPass2        = $("reg-password2");
const regBtn          = $("register-btn");
const regErr          = $("reg-error");
// home
const friendsList     = $("friends-list");
const logoutBtn       = $("btn-logout");
const reqBadge        = $("req-badge");
const btnSearchNav    = $("btn-search");
const btnReqNav       = $("btn-requests");
// search
const searchInput     = $("search-input");
const searchResults   = $("search-results");
const btnBackSearch   = $("btn-back-search");
// requests
const requestList     = $("request-list");
const btnBackReq      = $("btn-back-requests");
// chat
const chatUsernameEl  = $("chat-username");
const chatMessages    = $("chat-messages");
const chatForm        = $("chat-form");
const chatInput       = $("chat-input");
const btnBackChat     = $("btn-back-chat");
const btnStartCall    = $("btn-start-call");
const chatNormal      = $("chat-normal-actions");
const chatSelectBar   = $("chat-select-actions");
const selectCountEl   = $("select-count");
const btnCopySel      = $("btn-copy-selected");
const btnDeleteMe     = $("btn-delete-me");
const btnDeleteAll    = $("btn-delete-all");
const btnCancelSel    = $("btn-cancel-select");
const incomingBanner  = $("incoming-banner");
const bannerLabel     = $("incoming-banner-label");
const btnBannerAns    = $("btn-banner-answer");
const btnBannerDec    = $("btn-banner-decline");
// call screen
const localVideoEl    = $("localVideo");
const remoteVideoEl   = $("remoteVideo");
const callPeerNameEl  = $("call-peer-name");
const callStatusDot   = $("call-status-dot");
const callTimerEl     = $("call-timer");
const callInOverlay   = $("call-incoming-overlay");
const incomingRingNm  = $("incoming-ring-name");
const btnAnswer       = $("btn-answer");
const btnDecline      = $("btn-decline");
const btnHangup       = $("btn-hangup");
const btnToggleMic    = $("btn-toggle-mic");
const btnToggleCam    = $("btn-toggle-cam");
const btnToggleSpk    = $("btn-toggle-speaker");
const btnFlipCam      = $("btn-flip-cam");
const btnCallChat     = $("btn-call-chat");
// context menu
const ctxMenu         = $("msg-context-menu");
const ctxCopyBtn      = $("ctx-copy");
const ctxSelectBtn    = $("ctx-select");
const ctxDelMeBtn     = $("ctx-delete-me");
const ctxDelAllBtn    = $("ctx-delete-all");

/* ── STATE ── */
let me = null;             // { uid, username, badge }
let friendsRef  = null, reqRef = null, badgeRef = null, chatRef = null;
let callDetach  = null;
let chatUID     = null, chatId = null, chatKey = null;
let activeCallId = null, pendingCall = null;
// call media
let micOn = true, camOn = true, spkOn = true, facing = "user";
let timerIv = null, timerStart = null;
// chat render
const localDeleted = new Set();   // keys hidden locally ("delete for me")
// select mode
let selMode = false;
const selMap = new Map();         // key -> { el, snapRef, fromUid, text }
// context menu
let ctxTarget = null;             // { el, snapRef, fromUid, text }

/* ── TABS ── */
tabLoginBtn.onclick = () => {
  tabLoginBtn.classList.add("active"); tabRegBtn.classList.remove("active");
  loginFormEl.style.display = ""; regFormEl.style.display = "none"; loginErr.textContent = "";
};
tabRegBtn.onclick = () => {
  tabRegBtn.classList.add("active"); tabLoginBtn.classList.remove("active");
  regFormEl.style.display = ""; loginFormEl.style.display = "none"; regErr.textContent = "";
};

/* ── REGISTER ── */
regBtn.onclick = async () => {
  const username = regUser.value.trim().toLowerCase();
  const pass = regPass.value, pass2 = regPass2.value;
  regErr.textContent = "";
  if (!/^[a-z0-9_]{3,20}$/.test(username)) { regErr.textContent = "3-20 chars: a-z 0-9 _"; return; }
  if (pass.length < 8)  { regErr.textContent = "Password must be 8+ chars"; return; }
  if (pass !== pass2)   { regErr.textContent = "Passwords do not match";    return; }
  regBtn.disabled = true;
  regBtn.innerHTML = '<span class="loading-spinner"></span>Creating…';
  try {
    const uid = makeUID(username);
    const existing = await get(ref(db, "users/" + uid));
    if (existing.exists()) { regErr.textContent = "Username taken"; return; }
    await set(ref(db, "users/" + uid), { username, passwordHash: await hashPassword(pass) });
    regErr.style.color = "var(--accent)";
    regErr.textContent = "Account created! Logging in…";
    await doLogin(uid, username, null);
  } catch(e) { regErr.textContent = "Error: " + e.message; }
  finally { regBtn.disabled = false; regBtn.textContent = "Create Account"; regErr.style.color = ""; }
};

/* ── LOGIN ── */
loginBtn.onclick = async () => {
  const username = loginUser.value.trim().toLowerCase();
  const pass = loginPass.value;
  loginErr.textContent = "";
  if (!username || !pass) { loginErr.textContent = "Fill in both fields"; return; }
  loginBtn.disabled = true;
  loginBtn.innerHTML = '<span class="loading-spinner"></span>Logging in…';
  try {
    const uid = makeUID(username);
    const snap = await get(ref(db, "users/" + uid));
    if (!snap.exists()) { loginErr.textContent = "User not found"; return; }
    const data = snap.val();
    if (!await verifyPassword(pass, data.passwordHash)) { loginErr.textContent = "Wrong password"; return; }
    await doLogin(uid, username, data.badge || null);
  } catch(e) { loginErr.textContent = "Error: " + e.message; }
  finally { loginBtn.disabled = false; loginBtn.textContent = "Login"; }
};

async function doLogin(uid, username, badge) {
  me = { uid, username, badge };
  showScreen("home");
  loadFriends();
  watchBadge();
  watchRequests();
}

/* ── LOGOUT ── */
logoutBtn.onclick = () => {
  [friendsRef, reqRef, badgeRef, chatRef].forEach(r => { if (r) try { off(r); } catch(e){} });
  if (callDetach) { callDetach(); callDetach = null; }
  me = null; chatUID = chatId = chatKey = null;
  friendsList.innerHTML = "";
  localDeleted.clear();
  showScreen("login");
};

/* ── WATCH BADGE ── */
function watchBadge() {
  badgeRef = ref(db, "users/" + me.uid + "/badge");
  onValue(badgeRef, s => { if (me) me.badge = s.val() || null; });
}

/* ── FRIENDS ── */
function loadFriends() {
  if (friendsRef) off(friendsRef);
  friendsRef = ref(db, "users/" + me.uid + "/friends");
  onValue(friendsRef, async snap => {
    friendsList.innerHTML = "";
    const uids = Object.keys(snap.val() || {});
    if (!uids.length) {
      friendsList.innerHTML = '<div class="empty-text">No friends yet. Search to add!</div>'; return;
    }
    for (const uid of uids) {
      const item = document.createElement("div"); item.className = "list-item";
      const node = await makeUsernameNode(uid); node.style.flex = "1";
      item.appendChild(node);
      const username = node.querySelector(".username-text")?.textContent || uid;
      item.onclick = () => openChat(uid, username);
      friendsList.appendChild(item);
    }
  });
}

/* ── SEARCH ── */
// Fix: load ALL users then filter by username substring — not makeUID exact lookup
btnSearchNav.onclick = () => { searchInput.value = ""; searchResults.innerHTML = ""; showScreen("search"); };
btnBackSearch.onclick = () => showScreen("home");
searchInput.oninput = async () => {
  const q = searchInput.value.trim().toLowerCase();
  searchResults.innerHTML = "";
  if (q.length < 1) return;
  try {
    const snap = await get(ref(db, "users"));
    if (!snap.exists()) { searchResults.innerHTML = '<div class="empty-text">No users found</div>'; return; }
    let found = 0;
    for (const [uid, data] of Object.entries(snap.val())) {
      if (!data.username) continue;
      if (!data.username.toLowerCase().includes(q)) continue;
      if (uid === me.uid) continue;
      found++;
      const item = document.createElement("div"); item.className = "list-item";
      const node = await makeUsernameNode(uid); node.style.flex = "1";
      item.appendChild(node);

      // check existing friendship / request
      const [frSnap, rqSnap] = await Promise.all([
        get(ref(db, "users/" + uid + "/friends/" + me.uid)),
        get(ref(db, "users/" + uid + "/requests/" + me.uid))
      ]);
      const btn = document.createElement("button");
      btn.className = "primary-btn";
      if (frSnap.exists()) {
        btn.textContent = "Friends ✓"; btn.disabled = true;
      } else if (rqSnap.exists()) {
        btn.textContent = "Sent ✓"; btn.disabled = true;
      } else {
        btn.textContent = "Add";
        btn.onclick = async e => {
          e.stopPropagation(); btn.disabled = true;
          await set(ref(db, "users/" + uid + "/requests/" + me.uid), { from: me.uid, time: Date.now() });
          btn.textContent = "Sent ✓";
        };
      }
      item.appendChild(btn);
      searchResults.appendChild(item);
    }
    if (!found) searchResults.innerHTML = '<div class="empty-text">No users match "' + q + '"</div>';
  } catch(e) { searchResults.innerHTML = '<div class="empty-text">Error: ' + e.message + '</div>'; }
};

/* ── REQUESTS ── */
function watchRequests() {
  if (reqRef) off(reqRef);
  reqRef = ref(db, "users/" + me.uid + "/requests");
  onValue(reqRef, snap => {
    const cnt = Object.keys(snap.val() || {}).length;
    reqBadge.textContent = cnt;
    reqBadge.classList.toggle("hidden", cnt === 0);
  });
}
btnReqNav.onclick = () => { loadRequestList(); showScreen("requests"); };
btnBackReq.onclick = () => showScreen("home");
function loadRequestList() {
  requestList.innerHTML = "";
  get(ref(db, "users/" + me.uid + "/requests")).then(async snap => {
    const entries = Object.entries(snap.val() || {});
    if (!entries.length) { requestList.innerHTML = '<div class="empty-text">No pending requests</div>'; return; }
    for (const [fromUID] of entries) {
      const item   = document.createElement("div"); item.className = "list-item";
      const node   = await makeUsernameNode(fromUID); node.style.flex = "1"; item.appendChild(node);
      const accept = document.createElement("button"); accept.className = "primary-btn"; accept.textContent = "Accept";
      const reject = document.createElement("button"); reject.className = "danger-btn";  reject.textContent = "Reject";
      accept.onclick = async e => {
        e.stopPropagation(); accept.disabled = reject.disabled = true;
        await set(ref(db, "users/" + me.uid  + "/friends/" + fromUID), true);
        await set(ref(db, "users/" + fromUID + "/friends/" + me.uid),  true);
        await remove(ref(db, "users/" + me.uid + "/requests/" + fromUID));
        item.remove();
      };
      reject.onclick = async e => {
        e.stopPropagation(); accept.disabled = reject.disabled = true;
        await remove(ref(db, "users/" + me.uid + "/requests/" + fromUID));
        item.remove();
      };
      item.appendChild(accept); item.appendChild(reject);
      requestList.appendChild(item);
    }
  });
}

/* ── USERNAME NODE ── */
async function makeUsernameNode(uid) {
  const wrap = document.createElement("div"); wrap.className = "username-node";
  const span = document.createElement("span"); span.className = "username-text"; span.textContent = uid;
  wrap.appendChild(span);
  try {
    const snap = await get(ref(db, "users/" + uid));
    if (snap.exists()) {
      const d = snap.val();
      span.textContent = d.username || uid;
      if (d.badge) {
        const b = document.createElement("span");
        b.className = "badge " + d.badge;
        b.textContent = { verified:"✓", vip:"VIP", god:"GOD" }[d.badge] || d.badge.toUpperCase();
        wrap.appendChild(b);
      }
    }
  } catch(e) {}
  return wrap;
}

/* ── OPEN CHAT ── */
function openChat(uid, displayName) {
  exitSelMode(); hideCtx();
  chatUID  = uid;
  chatId   = [me.uid, uid].sort().join("_");
  chatKey  = deriveChatKey(me.uid, uid);
  chatUsernameEl.textContent = "@" + displayName;
  chatMessages.innerHTML = "";
  localDeleted.clear();     // clear per-chat local deletes when opening new chat
  showScreen("chat");
  if (chatRef)    { off(chatRef); chatRef = null; }
  if (callDetach) { callDetach(); callDetach = null; }
  // listen for messages — re-render full list on each change (simple & correct)
  chatRef = ref(db, "chats/" + chatId + "/messages");
  onValue(chatRef, snap => renderChat(snap));
  // listen for incoming calls
  listenIncomingCall();
}

function renderChat(snap) {
  chatMessages.innerHTML = "";
  if (!snap.exists()) return;
  const msgs = [];
  snap.forEach(child => { if (!localDeleted.has(child.key)) msgs.push(child); });
  msgs.sort((a,b) => (a.val().time||0) - (b.val().time||0));
  msgs.forEach(child => chatMessages.appendChild(buildMsgEl(child)));
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function buildMsgEl(childSnap) {
  const data    = childSnap.val() || {};
  const fromUid = data.from || null;
  const time    = data.time || null;
  const text    = chatKey ? decMsg(data.text || "", chatKey) : "[encrypted]";
  const key     = childSnap.key;
  const snapRef = childSnap.ref;

  const wrapper = document.createElement("div");
  wrapper.className = "chat-message " + (fromUid === me?.uid ? "me" : "other");
  wrapper.dataset.key = key;

  const chk = document.createElement("div"); chk.className = "msg-checkbox"; chk.textContent = "✓";
  wrapper.appendChild(chk);

  const authorEl = document.createElement("div"); authorEl.className = "message-author";
  // Show only own messages as "You", others show their uid briefly then update async
  get(ref(db, "users/" + fromUid)).then(s => {
    authorEl.textContent = "@" + (s.val()?.username || fromUid);
  }).catch(() => { authorEl.textContent = "@" + fromUid; });
  wrapper.appendChild(authorEl);

  const contentEl = document.createElement("div"); contentEl.className = "message-content";
  contentEl.textContent = text;
  wrapper.appendChild(contentEl);

  const footerEl = document.createElement("div"); footerEl.className = "message-footer";
  const timeEl   = document.createElement("div"); timeEl.className = "message-time";
  timeEl.textContent = time ? new Date(time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : "";
  footerEl.appendChild(timeEl);
  wrapper.appendChild(footerEl);

  // Long press → context menu (mobile)
  let pressT = null;
  wrapper.addEventListener("pointerdown", e => {
    pressT = setTimeout(() => showCtx(wrapper, snapRef, fromUid, text, e.clientX, e.clientY), 500);
  });
  wrapper.addEventListener("pointerup",    () => clearTimeout(pressT));
  wrapper.addEventListener("pointerleave", () => clearTimeout(pressT));
  // Right click (desktop)
  wrapper.addEventListener("contextmenu", e => {
    e.preventDefault();
    if (!selMode) showCtx(wrapper, snapRef, fromUid, text, e.clientX, e.clientY);
  });
  // Tap in select mode
  wrapper.addEventListener("click", e => {
    if (selMode) { e.stopPropagation(); toggleSel(wrapper, key, snapRef, fromUid, text); }
  });
  // If already in select mode apply class
  if (selMode) wrapper.classList.add("select-mode-item");
  if (selMap.has(key)) wrapper.classList.add("selected");
  return wrapper;
}

/* ── SEND ── */
chatForm.onsubmit = async e => {
  e.preventDefault();
  if (!chatInput.value.trim() || !chatUID || !chatKey) return;
  const txt = chatInput.value.trim();
  chatInput.value = "";
  await push(ref(db, "chats/" + chatId + "/messages"), {
    from: me.uid,
    text: encMsg(txt, chatKey),
    time: Date.now()
  });
};

btnBackChat.onclick = () => { exitSelMode(); hideCtx(); showScreen("home"); };

/* ── CONTEXT MENU ── */
function showCtx(el, snapRef, fromUid, text, x, y) {
  ctxTarget = { el, snapRef, fromUid, text };
  const canAll = fromUid === me?.uid || me?.badge === "god";
  ctxDelAllBtn.classList.toggle("hidden", !canAll);
  ctxMenu.classList.remove("hidden");
  const vw = window.innerWidth, vh = window.innerHeight;
  ctxMenu.style.left = Math.min(x, vw - 200) + "px";
  ctxMenu.style.top  = Math.min(y, vh - 180) + "px";
}
function hideCtx() { ctxMenu.classList.add("hidden"); ctxTarget = null; }

document.addEventListener("click", e => {
  if (!ctxMenu.classList.contains("hidden") && !ctxMenu.contains(e.target)) hideCtx();
});
ctxCopyBtn.onclick = () => {
  if (!ctxTarget) return;
  navigator.clipboard.writeText(ctxTarget.text).catch(()=>{});
  hideCtx();
};
ctxSelectBtn.onclick = () => {
  if (!ctxTarget) return;
  enterSelMode();
  toggleSel(ctxTarget.el, ctxTarget.el.dataset.key, ctxTarget.snapRef, ctxTarget.fromUid, ctxTarget.text);
  hideCtx();
};
ctxDelMeBtn.onclick = () => {
  if (!ctxTarget) return;
  localDeleted.add(ctxTarget.el.dataset.key);
  ctxTarget.el?.remove();
  hideCtx();
};
ctxDelAllBtn.onclick = async () => {
  if (!ctxTarget) return;
  const { el, snapRef, fromUid } = ctxTarget;
  if (fromUid !== me?.uid && me?.badge !== "god") { hideCtx(); return; }
  hideCtx();
  try { await remove(snapRef); } catch(e){}
};

/* ── SELECT MODE ── */
function enterSelMode() {
  if (selMode) return;
  selMode = true;
  chatMessages.classList.add("select-mode");
  chatNormal.classList.add("hidden");
  chatSelectBar.classList.remove("hidden");
  updateSelCount();
}
function exitSelMode() {
  selMode = false; selMap.clear();
  chatMessages.classList.remove("select-mode");
  chatNormal.classList.remove("hidden");
  chatSelectBar.classList.add("hidden");
  chatMessages.querySelectorAll(".chat-message.selected").forEach(el => el.classList.remove("selected"));
}
function toggleSel(el, key, snapRef, fromUid, text) {
  if (selMap.has(key)) { selMap.delete(key); el.classList.remove("selected"); }
  else                 { selMap.set(key, { el, snapRef, fromUid, text }); el.classList.add("selected"); }
  if (selMap.size === 0) exitSelMode(); else updateSelCount();
}
function updateSelCount() { selectCountEl.textContent = selMap.size + " selected"; }

btnCancelSel.onclick = () => exitSelMode();
btnCopySel.onclick = () => {
  const text = [...selMap.values()].map(m => m.text).join("\n");
  navigator.clipboard.writeText(text).catch(()=>{});
  exitSelMode();
};
btnDeleteMe.onclick = () => {
  selMap.forEach(({ el, snapRef }, key) => { localDeleted.add(key); el?.remove(); });
  exitSelMode();
};
btnDeleteAll.onclick = async () => {
  const items = [...selMap.values()].filter(({ fromUid }) => fromUid === me?.uid || me?.badge === "god");
  exitSelMode();
  await Promise.all(items.map(({ snapRef }) => remove(snapRef).catch(()=>{})));
};

/* ── WebRTC helpers ── */
const ICE = { iceServers:[
  { urls:"stun:stun.l.google.com:19302" },
  { urls:"turn:openrelay.metered.ca:443", username:"openrelayproject", credential:"openrelayproject" }
]};
const pcs = new Map(), streams = new Map(), dbl = new Map();
const callsRef  = cid => ref(db, `chats/${cid}/calls`);
const callRef   = (cid,id) => ref(db, `chats/${cid}/calls/${id}`);
const offerRef  = (cid,id) => ref(db, `chats/${cid}/calls/${id}/offer`);
const answerRef = (cid,id) => ref(db, `chats/${cid}/calls/${id}/answer`);
const candRef   = (cid,id,side) => ref(db, `chats/${cid}/calls/${id}/candidates/${side}`);

function listenIncomingCall() {
  if (callDetach) { callDetach(); callDetach = null; }
  if (!chatId || !me) return;
  const root = callsRef(chatId);
  const seen = new Set();
  const fn = snap => {
    snap.forEach(child => {
      const id = child.key, call = child.val();
      if (call?.offer && !call?.answer && call.offer.uid !== me.uid && !seen.has(id)) {
        seen.add(id);
        pendingCall = { callId: id };
        // show banner in chat
        bannerLabel.textContent = "📞 Incoming call from @" + (chatUsernameEl.textContent || "...");
        incomingBanner.classList.remove("hidden");
        // prepare call screen (but don't navigate yet)
        callPeerNameEl.textContent = chatUsernameEl.textContent;
        callStatusDot.className    = "call-status-dot ringing";
        incomingRingNm.textContent = "📞 Incoming call from " + chatUsernameEl.textContent;
        callInOverlay.classList.remove("hidden");
      }
    });
  };
  onValue(root, fn);
  callDetach = () => off(root, "value", fn);
}

async function startCallRTC(cid, callerId, calleeId, callId) {
  const ls = await navigator.mediaDevices.getUserMedia({ audio:true, video:{ facingMode: facing } });
  localVideoEl.srcObject = ls; localVideoEl.muted = true; localVideoEl.play().catch(()=>{});
  const pc = new RTCPeerConnection(ICE);
  pcs.set(callId, pc); streams.set(callId, ls); dbl.set(callId, []);
  ls.getTracks().forEach(t => pc.addTrack(t, ls));
  const rs = new MediaStream();
  remoteVideoEl.srcObject = rs; remoteVideoEl.play().catch(()=>{});
  pc.ontrack = e => e.streams.forEach(s => s.getTracks().forEach(t => rs.addTrack(t)));
  pc.onicecandidate = e => {
    if (!e.candidate) return;
    push(candRef(cid, callId, "caller")).then(p => set(p, e.candidate.toJSON())).catch(console.error);
  };
  const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
  await set(offerRef(cid, callId), { sdp:offer.sdp, type:offer.type, uid:callerId, calleeUid:calleeId, timestamp:Date.now() });
  // listen for answer
  const aRef = answerRef(cid, callId);
  const aFn  = async snap => {
    if (!snap.exists()) return;
    const a = snap.val();
    if (a?.sdp && pc.signalingState !== "stable") {
      await pc.setRemoteDescription(new RTCSessionDescription({ type:a.type||"answer", sdp:a.sdp }));
      callStatusDot.className = "call-status-dot connected"; startTimer();
    }
  };
  onValue(aRef, aFn); dbl.get(callId).push({ ref:aRef, fn:aFn });
  // listen for callee ice
  const ccRef = candRef(cid, callId, "callee");
  const ccFn  = snap => { if (!snap.exists()) return; snap.forEach(c => { const d=c.val(); if(d) pc.addIceCandidate(new RTCIceCandidate(d)).catch(console.error); }); };
  onValue(ccRef, ccFn); dbl.get(callId).push({ ref:ccRef, fn:ccFn });
}

async function answerCallRTC(cid, callId, calleeId) {
  const ls = await navigator.mediaDevices.getUserMedia({ audio:true, video:{ facingMode: facing } });
  localVideoEl.srcObject = ls; localVideoEl.muted = true; localVideoEl.play().catch(()=>{});
  const pc = new RTCPeerConnection(ICE);
  pcs.set(callId, pc); streams.set(callId, ls); dbl.set(callId, []);
  ls.getTracks().forEach(t => pc.addTrack(t, ls));
  const rs = new MediaStream();
  remoteVideoEl.srcObject = rs; remoteVideoEl.play().catch(()=>{});
  pc.ontrack = e => e.streams.forEach(s => s.getTracks().forEach(t => rs.addTrack(t)));
  pc.onicecandidate = e => {
    if (!e.candidate) return;
    push(candRef(cid, callId, "callee")).then(p => set(p, e.candidate.toJSON())).catch(console.error);
  };
  const offerSnap = await get(offerRef(cid, callId));
  if (!offerSnap.exists()) throw new Error("Offer missing");
  const o = offerSnap.val();
  await pc.setRemoteDescription(new RTCSessionDescription({ type:o.type||"offer", sdp:o.sdp }));
  const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
  await set(answerRef(cid, callId), { sdp:ans.sdp, type:ans.type, uid:calleeId, timestamp:Date.now() });
  // listen for caller ice
  const crRef = candRef(cid, callId, "caller");
  const crFn  = snap => { if (!snap.exists()) return; snap.forEach(c => { const d=c.val(); if(d) pc.addIceCandidate(new RTCIceCandidate(d)).catch(console.error); }); };
  onValue(crRef, crFn); dbl.get(callId).push({ ref:crRef, fn:crFn });
  callStatusDot.className = "call-status-dot connected"; startTimer();
}

async function doHangup() {
  stopTimer();
  const id = activeCallId || pendingCall?.callId;
  if (id) {
    const pc = pcs.get(id); if (pc) { try { pc.close(); } catch(e){} pcs.delete(id); }
    const s  = streams.get(id); if (s) { s.getTracks().forEach(t => t.stop()); streams.delete(id); }
    (dbl.get(id)||[]).forEach(({ref:r, fn:f}) => { try { off(r,"value",f); } catch(e){} });
    dbl.delete(id);
    if (chatId) try { await remove(callRef(chatId, id)); } catch(e){}
  }
  activeCallId = null; pendingCall = null;
  incomingBanner.classList.add("hidden");
  callInOverlay.classList.add("hidden");
  callStatusDot.className = "call-status-dot";
  try { if (localVideoEl.srcObject)  { localVideoEl.srcObject.getTracks().forEach(t=>t.stop());  localVideoEl.srcObject = null; } } catch(e){}
  try { if (remoteVideoEl.srcObject) { remoteVideoEl.srcObject.getTracks().forEach(t=>t.stop()); remoteVideoEl.srcObject = null; } } catch(e){}
}

/* ── CALL TIMER ── */
function startTimer() {
  stopTimer(); timerStart = Date.now();
  timerIv = setInterval(() => {
    const s = Math.floor((Date.now()-timerStart)/1000);
    callTimerEl.textContent = String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");
  }, 1000);
}
function stopTimer() { clearInterval(timerIv); timerIv = null; callTimerEl.textContent = "00:00"; }

/* ── CALL UI WIRING ── */

// Start call (from chat)
btnStartCall.addEventListener("click", async () => {
  if (!me || !chatUID || !chatId) return;
  btnStartCall.disabled = true;
  callPeerNameEl.textContent = chatUsernameEl.textContent;
  callStatusDot.className = "call-status-dot ringing";
  callInOverlay.classList.add("hidden");
  incomingBanner.classList.add("hidden");
  resetCallControls();
  showScreen("call");
  try {
    const id = push(callsRef(chatId)).key;
    await startCallRTC(chatId, me.uid, chatUID, id);
    activeCallId = id;
  } catch(err) {
    console.error(err); btnStartCall.disabled = false;
    await doHangup(); showScreen("chat"); alert("Could not start call: " + err.message);
  }
});

// Answer from chat banner
btnBannerAns.addEventListener("click", async () => {
  if (!pendingCall || !chatId || !me) return;
  incomingBanner.classList.add("hidden");
  callPeerNameEl.textContent = chatUsernameEl.textContent;
  callStatusDot.className = "call-status-dot ringing";
  callInOverlay.classList.add("hidden");
  resetCallControls();
  showScreen("call");
  try {
    await answerCallRTC(chatId, pendingCall.callId, me.uid);
    activeCallId = pendingCall.callId; pendingCall = null;
  } catch(err) {
    console.error(err); await doHangup(); showScreen("chat"); alert("Could not answer: " + err.message);
  }
});

// Decline from chat banner
btnBannerDec.addEventListener("click", async () => {
  incomingBanner.classList.add("hidden");
  if (pendingCall && chatId) try { await remove(callRef(chatId, pendingCall.callId)); } catch(e){}
  pendingCall = null;
});

// Answer from call-screen overlay
btnAnswer.addEventListener("click", async () => {
  if (!pendingCall || !chatId || !me) return;
  callInOverlay.classList.add("hidden");
  callStatusDot.className = "call-status-dot ringing";
  resetCallControls();
  try {
    await answerCallRTC(chatId, pendingCall.callId, me.uid);
    activeCallId = pendingCall.callId; pendingCall = null;
  } catch(err) {
    console.error(err); await doHangup(); showScreen("chat"); alert("Could not answer: " + err.message);
  }
});

// Decline from call-screen overlay
btnDecline.addEventListener("click", async () => {
  if (pendingCall && chatId) try { await remove(callRef(chatId, pendingCall.callId)); } catch(e){}
  pendingCall = null;
  await doHangup(); showScreen("chat");
});

// Hang up
btnHangup.addEventListener("click", async () => {
  await doHangup();
  btnStartCall.disabled = false;
  showScreen("chat");
});

// Back to chat during call (keep call alive)
btnCallChat.addEventListener("click", () => showScreen("chat"));

/* ── MIC TOGGLE ── */
btnToggleMic.addEventListener("click", () => {
  micOn = !micOn;
  const s = activeCallId ? streams.get(activeCallId) : null;
  if (s) s.getAudioTracks().forEach(t => { t.enabled = micOn; });
  btnToggleMic.querySelector(".ctrl-icon").textContent  = micOn ? "🎤" : "🔇";
  btnToggleMic.querySelector(".ctrl-label").textContent = micOn ? "Mute" : "Unmute";
  btnToggleMic.classList.toggle("muted", !micOn);
});

/* ── CAMERA TOGGLE ── */
btnToggleCam.addEventListener("click", () => {
  camOn = !camOn;
  const s = activeCallId ? streams.get(activeCallId) : null;
  if (s) s.getVideoTracks().forEach(t => { t.enabled = camOn; });
  localVideoEl.style.visibility = camOn ? "visible" : "hidden";
  btnToggleCam.querySelector(".ctrl-icon").textContent  = camOn ? "📷" : "📷";
  btnToggleCam.querySelector(".ctrl-label").textContent = camOn ? "Camera" : "Cam Off";
  btnToggleCam.classList.toggle("cam-off", !camOn);
});

/* ── SPEAKER TOGGLE ── */
btnToggleSpk.addEventListener("click", () => {
  spkOn = !spkOn;
  remoteVideoEl.muted = !spkOn;
  btnToggleSpk.querySelector(".ctrl-icon").textContent  = spkOn ? "🔊" : "🔈";
  btnToggleSpk.querySelector(".ctrl-label").textContent = spkOn ? "Speaker" : "Spkr Off";
  btnToggleSpk.classList.toggle("speaker-off", !spkOn);
});

/* ── FLIP CAMERA ── */
btnFlipCam.addEventListener("click", async () => {
  if (!activeCallId) return;
  btnFlipCam.disabled = true;
  const newFacing = facing === "user" ? "environment" : "user";
  try {
    // Get new video-only stream
    const newStream   = await navigator.mediaDevices.getUserMedia({ audio:false, video:{ facingMode:newFacing } });
    const newVidTrack = newStream.getVideoTracks()[0];
    // Replace track in peer connection
    const pc     = pcs.get(activeCallId);
    const sender = pc?.getSenders().find(s => s.track?.kind === "video");
    if (sender) await sender.replaceTrack(newVidTrack);
    // Stop old video tracks (not audio)
    const oldStream = streams.get(activeCallId);
    oldStream?.getVideoTracks().forEach(t => t.stop());
    // Build new combined stream
    const audioTracks = oldStream?.getAudioTracks() || [];
    const combined    = new MediaStream([...audioTracks, newVidTrack]);
    streams.set(activeCallId, combined);
    localVideoEl.srcObject = combined;
    localVideoEl.muted     = true;
    localVideoEl.play().catch(()=>{});
    // Preserve camera/mic enabled state
    combined.getAudioTracks().forEach(t => { t.enabled = micOn; });
    combined.getVideoTracks().forEach(t => { t.enabled = camOn; });
    facing = newFacing;
    // Mirror local preview for front cam only
    localVideoEl.style.transform = facing === "user" ? "scaleX(-1)" : "scaleX(1)";
  } catch(err) { console.warn("Camera flip failed:", err.message); }
  btnFlipCam.disabled = false;
});

function resetCallControls() {
  micOn = camOn = spkOn = true;
  btnToggleMic.querySelector(".ctrl-icon").textContent  = "🎤";
  btnToggleMic.querySelector(".ctrl-label").textContent = "Mute";
  btnToggleMic.className = "call-ctrl-btn active";
  btnToggleCam.querySelector(".ctrl-icon").textContent  = "📷";
  btnToggleCam.querySelector(".ctrl-label").textContent = "Camera";
  btnToggleCam.className = "call-ctrl-btn active";
  localVideoEl.style.visibility = "visible";
  btnToggleSpk.querySelector(".ctrl-icon").textContent  = "🔊";
  btnToggleSpk.querySelector(".ctrl-label").textContent = "Speaker";
  btnToggleSpk.className = "call-ctrl-btn active";
  remoteVideoEl.muted = false;
  stopTimer();
}

/* ── DRAGGABLE PiP ── */
(function() {
  const pip = $("local-pip");
  if (!pip) return;
  let ox=0, oy=0, rect;
  pip.addEventListener("pointerdown", e => {
    if (e.target.closest(".pip-flip-btn")) return;
    e.preventDefault();
    rect = pip.getBoundingClientRect();
    ox = e.clientX - rect.left; oy = e.clientY - rect.top;
    pip.setPointerCapture(e.pointerId);
    pip.style.cursor = "grabbing";
  });
  pip.addEventListener("pointermove", e => {
    if (!pip.hasPointerCapture(e.pointerId)) return;
    const vw=window.innerWidth, vh=window.innerHeight;
    const w=pip.offsetWidth, h=pip.offsetHeight;
    const nx = Math.max(0, Math.min(vw-w, e.clientX-ox));
    const ny = Math.max(0, Math.min(vh-h, e.clientY-oy));
    pip.style.position = "absolute";
    pip.style.right    = "auto";
    pip.style.left     = nx + "px";
    pip.style.top      = ny + "px";
  });
  pip.addEventListener("pointerup", () => { pip.style.cursor = "grab"; });
})();
