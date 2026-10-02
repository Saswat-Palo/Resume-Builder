/* ==========================================================================
   Resume Astra — vanilla JS frontend
   Talks to the FastAPI backend at /api/ai/* for all AI features.
   ========================================================================== */

/* ---------------- State ---------------- */

let form = {
  name: "", title: "", email: "", phone: "", location: "", linkedin: "", website: "",
  summary: "", skills: "", template: "template-classic",
};
let expEntries = [];
let eduEntries = [];
let projEntries = [];
let certs = "", langs = "", hobbies = "";
let photo = null;
let showPhoto = true;

// AI-build state (additive)
let guidedExtra = { level: "", background: "" };   // extra inputs from the AI Build tab
let aiBuilt = false;                                // true once AI has generated the resume -> unlocks ATS check
let lastAts = null;                                 // last ATS result (for score-change badge)
let atsWasUnlocked = false;

const build = {
  running: false, mode: "build", queue: [], streamDone: false, skip: false,
  liveSection: null, stepIndex: 0, applied: 0, frames: 0, idCounter: 0,
  snapshot: null, lastActivity: 0, failed: null, matched: new Set(),
};

/* ---------------- Supabase (auth + saving resumes) ---------------- */

const SUPABASE_URL = "https://feqncmpoofgxyldxobzu.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_kL81VA7D6E08K4ObwB4Xrg_9Y_RAEcG";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function signInWithGoogle() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) showToast("Error with Google Sign-In: " + error.message, "error");
}

async function signOut() {
  const { error } = await sb.auth.signOut();
  if (error) showToast("Error logging out: " + error.message, "error");
}

function renderAuthState(session) {
  const loginScreen = document.getElementById("login-screen");
  const appContainer = document.getElementById("app-container");
  const headerActions = document.getElementById("headerActions");
  document.body.classList.toggle("is-authed", !!session);
  if (session) {
    loginScreen.style.display = "none";
    appContainer.style.display = "";
    headerActions.style.display = "";
  } else {
    loginScreen.style.display = "";
    appContainer.style.display = "none";
    headerActions.style.display = "none";
  }
}

/* ---------------- Init ---------------- */

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("atsOverlay").style.display === "flex" && document.getElementById("confirmOverlay").style.display !== "flex") closeATS();
  });
  loadDraft();
  populateFieldsFromState();
  renderExpList();
  renderEduList();
  renderProjList();
  applyPhotoToForm();
  generateResume();
  setupPhotoDropZone();

  setTimeout(() => {
    const intro = document.getElementById("intro-screen");
    if (intro) intro.style.display = "none";
  }, 3000);

  sb.auth.getSession().then(({ data }) => renderAuthState(data.session));
  sb.auth.onAuthStateChange((_event, session) => renderAuthState(session));
});

/* ---------------- Small helpers ---------------- */

function esc(str) {
  return (str == null ? "" : String(str))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function gv(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatMonthYear(value) {
  if (!value) return "";
  if (value === "Present") return "Present";
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return value;
  const idx = parseInt(m[2], 10) - 1;
  return MONTH_NAMES[idx] ? `${MONTH_NAMES[idx]} ${m[1]}` : value;
}
function splitList(value) { return (value || "").split(",").map((s) => s.trim()).filter(Boolean); }
function splitLines(value) { return (value || "").split("\n").map((s) => s.trim()).filter(Boolean); }
function normalizeUrl(value) { return (value || "").replace(/^https?:\/\//, ""); }

async function readAIError(res) {
  try {
    const data = await res.json();
    return data.detail || data.error || "AI request failed.";
  } catch {
    return "AI request failed.";
  }
}

/* ---------------- Tabs ---------------- */

function syncFormInputs() {
  // The AI Build tab and the Basics/Edu tabs edit the same state; refresh whichever one is about to be shown.
  populateFieldsFromState();
  renderEduList();
}

function switchTabByName(name) {
  const btn = Array.from(document.querySelectorAll(".tab")).find((t) => (t.getAttribute("onclick") || "").includes(`'${name}'`));
  if (btn) switchTab(name, btn);
}

function switchTab(name, btn) {
  syncFormInputs();
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("tab-" + name).classList.add("active");
}

/* ---------------- Toasts ---------------- */

function showToast(message, type = "info", duration = 4000) {
  const container = document.getElementById("toastContainer");
  const icons = { success: "circle-check", error: "alert-circle", info: "info-circle" };
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="ti ti-${icons[type] || "info-circle"}"></i><span></span>`;
  toast.querySelector("span").textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

/* ---------------- Top-level field binding ---------------- */

function onFieldInput(key, value) {
  if (key === "certs") certs = value;
  else if (key === "langs") langs = value;
  else if (key === "hobbies") hobbies = value;
  else form[key] = value;
  if (!build.running) setPreviewStatus("idle");
  generateResume();
  saveDraft();
}

function populateFieldsFromState() {
  document.getElementById("f-name").value = form.name || "";
  document.getElementById("f-title").value = form.title || "";
  document.getElementById("f-email").value = form.email || "";
  document.getElementById("f-phone").value = form.phone || "";
  document.getElementById("f-location").value = form.location || "";
  document.getElementById("f-linkedin").value = form.linkedin || "";
  document.getElementById("f-website").value = form.website || "";
  document.getElementById("f-summary").value = form.summary || "";
  document.getElementById("f-skills").value = form.skills || "";
  document.getElementById("f-template").value = form.template || "template-classic";
  document.getElementById("f-certs").value = certs || "";
  document.getElementById("f-langs").value = langs || "";
  document.getElementById("f-hobbies").value = hobbies || "";

  // AI Build tab mirrors the same state
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
  set("g-name", form.name); set("g-email", form.email); set("g-phone", form.phone);
  set("g-location", form.location); set("g-linkedin", form.linkedin); set("g-role", form.title);
  set("g-skills", form.skills); set("g-level", guidedExtra.level); set("g-background", guidedExtra.background);
}

/* ---------------- Photo upload ---------------- */

const VALID_PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function setupPhotoDropZone() {
  const dropZone = document.getElementById("photoDrop");
  if (!dropZone) return;
  ["dragenter", "dragover"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => { e.preventDefault(); dropZone.classList.remove("drag-over"); })
  );
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) processPhotoFile(file);
  });
  dropZone.addEventListener("click", () => document.getElementById("photoInput").click());
  dropZone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.getElementById("photoInput").click(); }
  });
}

function handlePhotoUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (file) processPhotoFile(file);
  event.target.value = "";
}

function processPhotoFile(file) {
  if (!VALID_PHOTO_TYPES.includes(file.type)) { showToast("Please upload a JPG, PNG or WEBP image.", "error"); return; }
  if (file.size > MAX_PHOTO_BYTES) { showToast("Photo is too large. Please choose an image under 5MB.", "error"); return; }
  const reader = new FileReader();
  reader.onload = (e) => compressPhoto(e.target.result);
  reader.onerror = () => showToast("Couldn't read that image. Please try another file.", "error");
  reader.readAsDataURL(file);
}

function compressPhoto(dataUrl) {
  const img = new Image();
  img.onload = () => {
    const maxSize = 400;
    let { width, height } = img;
    if (width > height && width > maxSize) { height = Math.round((height * maxSize) / width); width = maxSize; }
    else if (height > maxSize) { width = Math.round((width * maxSize) / height); height = maxSize; }
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    photo = canvas.toDataURL("image/jpeg", 0.88);
    applyPhotoToForm();
    generateResume();
    saveDraft();
    showToast("Photo added.", "success", 2500);
  };
  img.onerror = () => showToast("That file doesn't look like a valid image.", "error");
  img.src = dataUrl;
}

function applyPhotoToForm() {
  const imgEl = document.getElementById("photoImg");
  const placeholder = document.getElementById("photoPlaceholder");
  const removeBtn = document.getElementById("removePhotoBtn");
  const toggleWrap = document.getElementById("photoToggleWrap");
  if (photo) {
    imgEl.src = photo; imgEl.style.display = "block";
    placeholder.style.display = "none";
    removeBtn.style.display = "inline-flex";
    toggleWrap.style.display = "flex";
    document.getElementById("f-show-photo").checked = showPhoto;
  } else {
    imgEl.style.display = "none"; imgEl.removeAttribute("src");
    placeholder.style.display = "flex";
    removeBtn.style.display = "none";
    toggleWrap.style.display = "none";
  }
}

function removePhoto() {
  photo = null;
  applyPhotoToForm();
  generateResume();
  saveDraft();
  showToast("Photo removed.", "info", 2500);
}

function onShowPhotoChange(checked) {
  showPhoto = checked;
  generateResume();
  saveDraft();
}

/* ---------------- Experience ---------------- */

function renderExpList() {
  document.getElementById("exp-list").innerHTML = expEntries.map(expEntryHTML).join("");
}

function expEntryHTML(entry) {
  const isPresent = entry.end === "Present";
  return `
    <div class="entry-block" data-id="${entry.id}">
      <button class="remove-btn" onclick="removeExp(${entry.id})" title="Remove"><i class="ti ti-x"></i></button>
      <div class="input-row">
        <div class="input-group">
          <label>Company</label>
          <input placeholder="Acme Corp" value="${esc(entry.company)}" oninput="onExpField(${entry.id}, 'company', this.value)">
        </div>
        <div class="input-group">
          <label>Your Role</label>
          <input placeholder="Product Designer" value="${esc(entry.role)}" oninput="onExpField(${entry.id}, 'role', this.value)">
        </div>
      </div>
      <div class="input-row">
        <div class="input-group">
          <label>Start Date</label>
          <input type="month" value="${esc(entry.start)}" oninput="onExpField(${entry.id}, 'start', this.value)">
        </div>
        <div class="input-group">
          <label>End Date</label>
          <input type="month" value="${isPresent ? "" : esc(entry.end)}" ${isPresent ? "disabled" : ""} oninput="onExpField(${entry.id}, 'end', this.value)">
          <label class="present-check">
            <input type="checkbox" ${isPresent ? "checked" : ""} onchange="toggleCurrentJob(${entry.id}, this.checked)">
            <span>Currently working here</span>
          </label>
        </div>
      </div>
      <div class="input-group">
        <div class="ai-field-row">
          <label style="margin:0;">Key Achievements (one per line)</label>
          <button type="button" class="ai-btn" id="expAIBtn-${entry.id}" onclick="generateBulletsAI(${entry.id})">
            <i class="ti ti-sparkles"></i> <span>Write with AI</span>
          </button>
        </div>
        <textarea placeholder="Led redesign that increased conversion by 25%&#10;Managed a team of 4 designers" oninput="onExpField(${entry.id}, 'bullets', this.value)">${esc(entry.bullets)}</textarea>
        <p class="ai-error-note" id="expAIError-${entry.id}" style="display:none;"><i class="ti ti-alert-triangle"></i> <span></span></p>
        <div id="expSuggestion-${entry.id}"></div>
      </div>
    </div>`;
}

function addExp() {
  expEntries.push({ id: Date.now(), company: "", role: "", start: "", end: "", bullets: "" });
  renderExpList();
  updateProgress();
  saveDraft();
}
function removeExp(id) {
  expEntries = expEntries.filter((e) => e.id !== id);
  renderExpList();
  generateResume();
  saveDraft();
}
function onExpField(id, field, value) {
  const entry = expEntries.find((e) => e.id === id);
  if (!entry) return;
  entry[field] = value;
  generateResume();
  saveDraft();
}
function toggleCurrentJob(id, checked) {
  const entry = expEntries.find((e) => e.id === id);
  if (!entry) return;
  entry.end = checked ? "Present" : "";
  renderExpList();
  generateResume();
  saveDraft();
}

async function generateBulletsAI(id) {
  const entry = expEntries.find((e) => e.id === id);
  if (!entry) return;
  const btn = document.getElementById(`expAIBtn-${id}`);
  const errEl = document.getElementById(`expAIError-${id}`);
  errEl.style.display = "none";
  document.getElementById(`expSuggestion-${id}`).innerHTML = "";
  btn.disabled = true;
  btn.querySelector("i").className = "ti ti-loader-2 spin-icon";
  btn.querySelector("span").textContent = "Writing...";

  try {
    const res = await fetch("/api/ai/role-objective", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: entry.company, role: entry.role, start: entry.start, end: entry.end,
        existingBullets: entry.bullets, targetTitle: form.title,
      }),
    });
    if (!res.ok) throw new Error(await readAIError(res));
    const data = await res.json();
    renderBulletSuggestion(id, data.bullets);
  } catch (err) {
    errEl.style.display = "flex";
    errEl.querySelector("span").textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.querySelector("i").className = "ti ti-sparkles";
    btn.querySelector("span").textContent = "Write with AI";
  }
}

function renderBulletSuggestion(id, bullets) {
  const el = document.getElementById(`expSuggestion-${id}`);
  el.dataset.bullets = JSON.stringify(bullets);
  el.innerHTML = `
    <div class="ai-bullets-preview">
      <strong style="font-size:12px;">AI suggestions</strong>
      <ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      <div class="ai-bullets-actions">
        <button class="ai-accept" onclick="acceptBulletSuggestion(${id})"><i class="ti ti-check"></i> Add to bullets</button>
        <button class="ai-discard" onclick="discardBulletSuggestion(${id})">Discard</button>
      </div>
    </div>`;
}

function acceptBulletSuggestion(id) {
  const el = document.getElementById(`expSuggestion-${id}`);
  const bullets = JSON.parse(el.dataset.bullets || "[]");
  const entry = expEntries.find((e) => e.id === id);
  if (!entry) return;
  const merged = bullets.map((b) => `- ${b}`).join("\n");
  entry.bullets = entry.bullets ? `${entry.bullets}\n${merged}` : merged;
  renderExpList();
  generateResume();
  saveDraft();
  showToast("Bullets added.", "success", 2500);
}

function discardBulletSuggestion(id) {
  const el = document.getElementById(`expSuggestion-${id}`);
  if (el) el.innerHTML = "";
}

/* ---------------- Education ---------------- */

function renderEduList() {
  document.getElementById("edu-list").innerHTML = eduEntries.map(eduEntryHTML).join("");
  renderGuidedEdu();
}
function eduEntryHTML(entry) {
  return `
    <div class="entry-block" data-id="${entry.id}">
      <button class="remove-btn" onclick="removeEdu(${entry.id})" title="Remove"><i class="ti ti-x"></i></button>
      <div class="input-group">
        <label>Degree &amp; Field of Study</label>
        <input placeholder="B.Sc. Computer Science" value="${esc(entry.degree)}" oninput="onEduField(${entry.id}, 'degree', this.value)">
      </div>
      <div class="input-group">
        <label>Institution</label>
        <input placeholder="MIT" value="${esc(entry.school)}" oninput="onEduField(${entry.id}, 'school', this.value)">
      </div>
      <div class="input-row">
        <div class="input-group">
          <label>Graduation Year</label>
          <input type="number" placeholder="2024" min="1950" max="2100" value="${esc(entry.year)}" oninput="onEduField(${entry.id}, 'year', this.value)">
        </div>
        <div class="input-group">
          <label>GPA (optional)</label>
          <input placeholder="3.8 / 4.0" value="${esc(entry.gpa)}" oninput="onEduField(${entry.id}, 'gpa', this.value)">
        </div>
      </div>
    </div>`;
}
function addEdu() { eduEntries.push({ id: Date.now(), degree: "", school: "", year: "", gpa: "" }); renderEduList(); updateProgress(); saveDraft(); }
function removeEdu(id) { eduEntries = eduEntries.filter((e) => e.id !== id); renderEduList(); generateResume(); saveDraft(); }
function onEduField(id, field, value) {
  const entry = eduEntries.find((e) => e.id === id);
  if (!entry) return;
  entry[field] = value;
  generateResume();
  saveDraft();
}

/* ---------------- Projects ---------------- */

function renderProjList() {
  document.getElementById("proj-list").innerHTML = projEntries.map(projEntryHTML).join("");
}
function projEntryHTML(entry) {
  return `
    <div class="entry-block" data-id="${entry.id}">
      <button class="remove-btn" onclick="removeProj(${entry.id})" title="Remove"><i class="ti ti-x"></i></button>
      <div class="input-group">
        <label>Project Name</label>
        <input placeholder="E-commerce Platform" value="${esc(entry.name)}" oninput="onProjField(${entry.id}, 'name', this.value)">
      </div>
      <div class="input-group">
        <label>Tech / Tools Used</label>
        <input placeholder="React, Node.js, PostgreSQL" value="${esc(entry.tech)}" oninput="onProjField(${entry.id}, 'tech', this.value)">
      </div>
      <div class="input-group">
        <label>Project Link (optional)</label>
        <input placeholder="github.com/jane/project" value="${esc(entry.link)}" oninput="onProjField(${entry.id}, 'link', this.value)">
      </div>
      <div class="input-group">
        <label>Description</label>
        <textarea placeholder="Built a full-stack platform handling 10k daily users..." oninput="onProjField(${entry.id}, 'desc', this.value)">${esc(entry.desc)}</textarea>
      </div>
    </div>`;
}
function addProj() { projEntries.push({ id: Date.now(), name: "", tech: "", desc: "", link: "" }); renderProjList(); saveDraft(); }
function removeProj(id) { projEntries = projEntries.filter((e) => e.id !== id); renderProjList(); generateResume(); saveDraft(); }
function onProjField(id, field, value) {
  const entry = projEntries.find((e) => e.id === id);
  if (!entry) return;
  entry[field] = value;
  generateResume();
  saveDraft();
}

/* ---------------- Progress ---------------- */

function progressChecks() {
  return {
    Name: !!form.name, Title: !!form.title, Contact: !!(form.email || form.phone),
    Summary: !!form.summary, Experience: expEntries.length > 0, Education: eduEntries.length > 0, Skills: !!form.skills,
  };
}

function updateProgress() {
  const checks = progressChecks();
  const done = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const pct = Math.round((done / total) * 100);
  document.getElementById("progressLabel").textContent = `${pct}% complete`;
  document.getElementById("progressHint").textContent = `${done} of ${total} sections filled`;
  document.getElementById("progressFill").style.width = `${pct}%`;
  document.getElementById("scoreChips").innerHTML = Object.entries(checks)
    .map(([k, v]) => `<span class="chip ${v ? "chip-done" : "chip-miss"}"><i class="ti ti-${v ? "check" : "x"}"></i>${k}</span>`)
    .join("");
}

/* ---------------- Live preview ---------------- */

function liveCls(key) { return build.running && build.liveSection === key ? " r-live" : ""; }

function generateResume() {
  updateProgress();
  updateAtsGate();
  syncTemplateChips();
  const preview = document.getElementById("preview");
  const hasContent = form.name || form.email || expEntries.length > 0 || eduEntries.length > 0;
  preview.classList.toggle("is-empty", !hasContent);

  if (!hasContent) {
    preview.innerHTML = `
      <div class="preview-empty">
        <div class="preview-empty-icon"><i class="ti ti-file-text"></i></div>
        <p>Fill in the AI Build form and press <strong>Generate</strong><br>to watch your resume write itself here</p>
      </div>`;
    return;
  }

  const photoVisible = !!(photo && showPhoto);
  const photoHTML = photoVisible ? `<img class="r-photo" src="${photo}" alt="${esc(form.name || "Profile")} photo">` : "";
  const titleHTML = form.title ? `<div class="r-title">${esc(form.title)}</div>` : "";

  const contactParts = [];
  if (form.email) contactParts.push(`<a class="r-contact" href="https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(form.email)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-mail"></i>${esc(form.email)}</a>`);
  if (form.phone) contactParts.push(`<span class="r-contact"><i class="ti ti-phone"></i>${esc(form.phone)}</span>`);
  if (form.location) contactParts.push(`<span class="r-contact"><i class="ti ti-map-pin"></i>${esc(form.location)}</span>`);
  if (form.linkedin) contactParts.push(`<a class="r-contact" href="https://${normalizeUrl(form.linkedin)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-brand-linkedin"></i>${esc(form.linkedin)}</a>`);
  if (form.website) contactParts.push(`<a class="r-contact" href="https://${normalizeUrl(form.website)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-world"></i>${esc(form.website)}</a>`);
  const contactsHTML = contactParts.length ? `<div class="r-contacts">${contactParts.join("")}</div>` : "";

  const nameHTML = `<div class="r-name">${esc(form.name) || "Your Name"}</div>`;
  const headerInner = photoVisible
    ? photoHTML + `<div class="r-header-text">${nameHTML}${titleHTML}${contactsHTML}</div>`
    : nameHTML + titleHTML + contactsHTML;

  let html = `<div id="resumeContent" class="${form.template}">
    <div class="r-header${photoVisible ? " has-photo" : ""}">${headerInner}</div>
    <hr class="r-divider">`;

  if (form.summary) {
    html += `<div class="r-section${liveCls("summary")}"><div class="r-section-title">Summary</div><p class="r-summary">${esc(form.summary)}</p></div>`;
  }

  if (expEntries.length) {
    html += `<div class="r-section${liveCls("experience")}"><div class="r-section-title">Experience</div>`;
    expEntries.forEach((e) => {
      html += `<div class="r-exp-item">
        <div class="r-exp-header">
          <div><div class="r-exp-company">${esc(e.company) || "Company"}</div><div class="r-exp-role">${esc(e.role) || "Role"}</div></div>
          <div class="r-exp-dates">${formatMonthYear(e.start)}${e.end ? " – " + formatMonthYear(e.end) : ""}</div>
        </div>`;
      const bullets = splitLines(e.bullets);
      if (bullets.length) {
        html += `<ul class="r-bullets">${bullets.map((b) => `<li>${esc(b.replace(/^-+\s*/, ""))}</li>`).join("")}</ul>`;
      }
      html += `</div>`;
    });
    html += `</div>`;
  }

  if (eduEntries.length) {
    html += `<div class="r-section"><div class="r-section-title">Education</div>`;
    eduEntries.forEach((e) => {
      html += `<div class="r-edu-item">
        <div class="r-edu-degree">${esc(e.degree) || "Degree"}</div>
        <div class="r-edu-school">${esc(e.school) || ""}${e.gpa ? " · GPA: " + esc(e.gpa) : ""}</div>
        <div class="r-edu-year">${esc(e.year) || ""}</div>
      </div>`;
    });
    html += `</div>`;
  }

  if (form.skills) {
    html += `<div class="r-section${liveCls("skills")}"><div class="r-section-title">Skills</div><div class="r-skills-grid">${splitList(form.skills).map((s) => `<span class="r-skill-tag">${esc(s)}</span>`).join("")}</div></div>`;
  }

  if (projEntries.length) {
    html += `<div class="r-section${liveCls("projects")}"><div class="r-section-title">Projects</div>`;
    projEntries.forEach((p) => {
      html += `<div class="r-proj-item">
        <div class="r-proj-name">${esc(p.name) || "Project"}${p.tech ? `<span class="r-proj-tech"> · ${esc(p.tech)}</span>` : ""}${p.link ? `<a class="r-proj-link" href="https://${normalizeUrl(p.link)}" target="_blank" rel="noopener noreferrer"><i class="ti ti-external-link"></i></a>` : ""}</div>
        <div class="r-proj-desc">${esc(p.desc) || ""}</div>
      </div>`;
    });
    html += `</div>`;
  }

  if (certs) {
    html += `<div class="r-section${liveCls("certs")}"><div class="r-section-title">Certifications</div><ul class="r-bullets">${splitLines(certs).map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>`;
  }

  if (langs) {
    html += `<div class="r-section${liveCls("langs")}"><div class="r-section-title">Languages</div><div class="r-skills-grid">${splitList(langs).map((l) => `<span class="r-skill-tag r-lang-tag">${esc(l)}</span>`).join("")}</div></div>`;
  }

  if (hobbies) {
    html += `<div class="r-section"><div class="r-section-title">Interests</div><p class="r-summary">${esc(hobbies)}</p></div>`;
  }

  html += `</div>`;
  preview.innerHTML = html;
}

/* ---------------- AI: Quick Start autofill (the headline feature) ---------------- */

async function runAutofill() {
  const rawText = gv("ai-raw-text");
  const btn = document.getElementById("aiIntakeBtn");
  const btnText = document.getElementById("aiIntakeBtnText");
  const btnIcon = btn.querySelector("i");
  const errEl = document.getElementById("aiIntakeError");
  const successEl = document.getElementById("aiIntakeSuccess");
  errEl.style.display = "none";
  successEl.style.display = "none";

  if (rawText.trim().length < 20) {
    errEl.style.display = "flex";
    errEl.querySelector("span").textContent = "Paste a bit more about your background first — a few sentences is enough.";
    return;
  }

  btn.disabled = true;
  btnIcon.className = "ti ti-loader-2 spin-icon";
  btnText.textContent = "Writing your resume...";

  try {
    const res = await fetch("/api/ai/autofill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawText, name: form.name, targetTitle: form.title }),
    });
    if (!res.ok) throw new Error(await readAIError(res));
    const data = await res.json();
    applyAutofill(data);
    successEl.style.display = "flex";
    showToast("Resume drafted. Review the tabs below and adjust anything you like.", "success", 5000);
  } catch (err) {
    errEl.style.display = "flex";
    errEl.querySelector("span").textContent = err.message;
  } finally {
    btn.disabled = false;
    btnIcon.className = "ti ti-wand";
    btnText.textContent = "Generate my resume";
  }
}

function applyAutofill(data) {
  aiBuilt = true;
  if (data.title) form.title = data.title;
  if (data.summary) form.summary = data.summary;
  if (data.skills) form.skills = data.skills;
  if (Array.isArray(data.experience) && data.experience.length) expEntries = data.experience;
  if (Array.isArray(data.education) && data.education.length) eduEntries = data.education;
  if (Array.isArray(data.projects) && data.projects.length) projEntries = data.projects;
  if (data.certs) certs = data.certs;
  if (data.langs) langs = data.langs;

  populateFieldsFromState();
  renderExpList();
  renderEduList();
  renderProjList();
  generateResume();
  saveDraft();
}

/* ---------------- AI: summary regenerate ---------------- */

async function generateSummaryAI() {
  const btn = document.getElementById("summaryAIBtn");
  const btnIcon = btn.querySelector("i");
  const btnLabel = btn.querySelector("span");
  const errEl = document.getElementById("summaryAIError");
  errEl.style.display = "none";
  btn.disabled = true;
  btnIcon.className = "ti ti-loader-2 spin-icon";
  btnLabel.textContent = "Writing...";

  try {
    const res = await fetch("/api/ai/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, title: form.title, location: form.location, skills: form.skills, experience: expEntries }),
    });
    if (!res.ok) throw new Error(await readAIError(res));
    const data = await res.json();
    form.summary = data.summary;
    document.getElementById("f-summary").value = data.summary;
    generateResume();
    saveDraft();
    showToast("Summary generated.", "success", 2500);
  } catch (err) {
    errEl.style.display = "flex";
    errEl.querySelector("span").textContent = err.message;
  } finally {
    btn.disabled = false;
    btnIcon.className = "ti ti-refresh";
    btnLabel.textContent = "Regenerate";
  }
}

/* ---------------- AI: ATS checker ---------------- */

let atsCheckedKey = "";
function atsFingerprint() { return JSON.stringify([{ ...form, template: "" }, expEntries, eduEntries, projEntries, certs, langs, hobbies]); }

// Opening the checker scores the resume that is on screen. If nothing changed since the last check, show that result.
function openATS() {
  document.getElementById("atsOverlay").style.display = "flex";
  syncBodyLock();
  if (build.running) return;
  if (lastAts && atsFingerprint() === atsCheckedKey) return;
  runATSCheck();
}
function closeATS() { document.getElementById("atsOverlay").style.display = "none"; syncBodyLock(); }
function closeATSOnOverlay(event) { if (event.target.id === "atsOverlay") closeATS(); }

function scoreColor(score) {
  if (score >= 80) return "#0f9d6b";
  if (score >= 60) return "#d98a0b";
  return "#e0345a";
}

async function runATSCheck() {
  const jd = "";
  const fingerprint = atsFingerprint();
  const btn = document.getElementById("atsRunBtn");
  const btnText = document.getElementById("atsRunBtnText");
  const btnIcon = btn.querySelector("i");
  const errEl = document.getElementById("atsError");
  const loadingEl = document.getElementById("atsLoading");
  const emptyEl = document.getElementById("atsEmpty");
  const resultEl = document.getElementById("atsResult");

  const prevScore = lastAts ? lastAts.score : null;
  errEl.style.display = "none";
  emptyEl.style.display = "none";
  resultEl.style.display = "none";
  loadingEl.style.display = "flex";
  btn.disabled = true;
  btnIcon.className = "ti ti-loader-2 spin-icon";
  btnText.textContent = "Checking...";

  try {
    const res = await fetch("/api/ai/ats-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name, title: form.title, location: form.location, summary: form.summary,
        skills: form.skills, certs, experience: expEntries, education: eduEntries, jobDescription: jd,
        email: form.email, phone: form.phone, linkedin: form.linkedin, website: form.website,
        langs, projects: projEntries,
      }),
    });
    if (!res.ok) throw new Error(await readAIError(res));
    const data = await res.json();
    atsCheckedKey = fingerprint;
    renderATSResult(data, false, prevScore);
  } catch (err) {
    errEl.style.display = "flex";
    errEl.querySelector("span").textContent = err.message;
    emptyEl.style.display = "block";
  } finally {
    loadingEl.style.display = "none";
    btn.disabled = false;
    btnIcon.className = "ti ti-radar-2";
    btnText.textContent = "Re-run check";
  }
}

function animateNumber(el, to, ms = 800) {
  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / ms);
    el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
  };
  el.textContent = "0";
  requestAnimationFrame(tick);
}

function renderATSResult(result, hasJD, prevScore) {
  lastAts = result;
  document.getElementById("atsResult").style.display = "block";

  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (result.score / 100) * circumference;
  const color = scoreColor(result.score);

  const ring = document.getElementById("atsRingFill");
  ring.style.transition = "none";
  ring.setAttribute("stroke", color);
  ring.setAttribute("stroke-dasharray", `${circumference} ${circumference}`);
  ring.setAttribute("stroke-dashoffset", circumference);
  void ring.getBoundingClientRect();
  ring.style.transition = "";
  requestAnimationFrame(() => ring.setAttribute("stroke-dashoffset", offset));

  const numEl = document.getElementById("atsScoreNum");
  numEl.dataset.score = result.score;
  numEl.style.color = color;
  animateNumber(numEl, result.score);

  document.getElementById("atsVerdict").textContent = result.verdict || "";
  document.getElementById("atsVerdictSub").textContent = hasJD ? "Based on the job description you pasted" : "Based on general ATS best practices";

  const deltaEl = document.getElementById("atsDelta");
  if (typeof prevScore === "number") {
    const d = result.score - prevScore;
    deltaEl.className = "ats-delta " + (d > 0 ? "up" : d < 0 ? "down" : "same");
    deltaEl.innerHTML = `<i class="ti ti-${d > 0 ? "trending-up" : d < 0 ? "trending-down" : "minus"}"></i> ${d > 0 ? "+" : ""}${d} vs last check (${prevScore})`;
    deltaEl.style.display = "inline-flex";
  } else {
    deltaEl.style.display = "none";
  }

  // Follow-up questions: facts the AI can't invent and the candidate needs to supply
  const moreSection = document.getElementById("atsMoreSection");
  const questions = Array.isArray(result.needsMoreInfo) ? result.needsMoreInfo : [];
  if (questions.length) {
    moreSection.style.display = "block";
    document.getElementById("atsQuestions").innerHTML = questions.map((q, i) => `
      <div class="ats-q" data-id="${esc(q.id)}" data-q="${esc(q.question)}">
        <label for="atsQ-${i}">${esc(q.question)}</label>
        <textarea id="atsQ-${i}" placeholder="${esc(q.hint || "")}"></textarea>
      </div>`).join("");
  } else {
    moreSection.style.display = "none";
    document.getElementById("atsQuestions").innerHTML = "";
  }

  const strengthsSection = document.getElementById("atsStrengthsSection");
  if (result.strengths && result.strengths.length) {
    strengthsSection.style.display = "block";
    document.getElementById("atsStrengthsList").innerHTML = result.strengths.map((s) => `<li><i class="ti ti-circle-check"></i>${esc(s)}</li>`).join("");
  } else strengthsSection.style.display = "none";

  const improvementsSection = document.getElementById("atsImprovementsSection");
  if (result.improvements && result.improvements.length) {
    improvementsSection.style.display = "block";
    document.getElementById("atsImprovementsList").innerHTML = result.improvements.map((s) => `<li><i class="ti ti-arrow-right"></i>${esc(s)}</li>`).join("");
  } else improvementsSection.style.display = "none";

  const keywordsSection = document.getElementById("atsKeywordsSection");
  if (result.missingKeywords && result.missingKeywords.length) {
    keywordsSection.style.display = "block";
    document.getElementById("atsKeywordChips").innerHTML = result.missingKeywords.map((k) => `<span class="ats-keyword-chip">${esc(k)}</span>`).join("");
  } else keywordsSection.style.display = "none";
}

/* ---------------- Save + PDF download ---------------- */

async function saveAndDownload() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) { showToast("Session expired. Please sign in again.", "error"); return; }

  const btn = document.getElementById("downloadBtn");
  const btnText = document.getElementById("downloadBtnText");
  const btnIcon = btn.querySelector("i");
  btn.disabled = true;
  btnIcon.className = "ti ti-loader-2 spin-icon";
  btnText.textContent = "Working...";

  try {
    const resumeData = {
      user_id: user.id, email: user.email,
      name: form.name, job_title: form.title, contact_email: form.email, phone: form.phone,
      location: form.location, linkedin: form.linkedin, website: form.website,
      summary: form.summary, skills: form.skills, certifications: certs, languages: langs, hobbies,
      experience: JSON.stringify(expEntries), education: JSON.stringify(eduEntries), projects: JSON.stringify(projEntries),
      template: form.template, photo_url: photo || null, updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from("resumes").insert([resumeData]);
    if (error) {
      console.error(error);
      showToast("Error saving your data. Download blocked: " + error.message, "error", 6000);
      return;
    }
    showToast("Saved! Generating your PDF...", "success", 2500);
    await triggerPDF();
  } finally {
    btn.disabled = false;
    btnIcon.className = "ti ti-download";
    btnText.textContent = "Save & Download PDF";
  }
}

async function triggerPDF() {
  const element = document.getElementById("resumeContent");
  if (!element) { showToast("Nothing to export yet! Fill in your details first.", "error"); return; }
  const filename = (form.name || "Resume").replace(/\s+/g, "_") + "_Resume.pdf";
  await html2pdf().set({
    margin: 12, filename,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
  }).from(element).save();
}

/* ---------------- Local draft autosave ---------------- */

const DRAFT_KEY = "resumeAstraDraft";
let draftSaveTimer = null;

function collectDraft() {
  return { form, expEntries, eduEntries, projEntries, certs, langs, hobbies, photo, showPhoto, guidedExtra, aiBuilt };
}

function saveDraft() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(collectDraft()));
      const statusEl = document.getElementById("autosaveStatus");
      const textEl = document.getElementById("autosaveText");
      statusEl.classList.add("saved");
      textEl.textContent = "Draft saved locally";
      setTimeout(() => { statusEl.classList.remove("saved"); textEl.textContent = "Draft auto-saves locally"; }, 1500);
    } catch (err) {
      console.warn("Couldn't save draft locally:", err);
    }
  }, 400);
}

function applyDraftObject(draft) {
  if (draft.form) form = Object.assign(form, draft.form);
  if (Array.isArray(draft.expEntries)) expEntries = draft.expEntries;
  if (Array.isArray(draft.eduEntries)) eduEntries = draft.eduEntries;
  if (Array.isArray(draft.projEntries)) projEntries = draft.projEntries;
  if (typeof draft.certs === "string") certs = draft.certs;
  if (typeof draft.langs === "string") langs = draft.langs;
  if (typeof draft.hobbies === "string") hobbies = draft.hobbies;
  if (draft.photo) photo = draft.photo;
  if (typeof draft.showPhoto === "boolean") showPhoto = draft.showPhoto;
  if (draft.guidedExtra && typeof draft.guidedExtra === "object") guidedExtra = Object.assign({ level: "", background: "" }, draft.guidedExtra);
  if (typeof draft.aiBuilt === "boolean") aiBuilt = draft.aiBuilt;
}

function loadDraft() {
  let raw;
  try { raw = localStorage.getItem(DRAFT_KEY); } catch { return; }
  if (!raw) return;
  try {
    applyDraftObject(JSON.parse(raw));
  } catch (err) {
    console.warn("Couldn't restore saved draft:", err);
  }
}


/* ==========================================================================
   AI Guided Build — personal details + education + target role  ->  live resume
   The backend streams the resume section by section (Server-Sent Events); the
   browser plays each section into the live preview with a typing effect.
   ========================================================================== */

const BUILD_STEPS = [
  { key: "personal",   label: "Personal details",      icon: "user" },
  { key: "education",  label: "Education",             icon: "school" },
  { key: "summary",    label: "Professional summary",  icon: "file-text" },
  { key: "experience", label: "Experience & projects", icon: "briefcase" },
  { key: "skills",     label: "Skills & extras",       icon: "code" },
  { key: "finish",     label: "Final touches",         icon: "sparkles" },
];
const STEP_FOR_SECTION = { summary: "summary", experience: "experience", projects: "experience", skills: "skills", certs: "skills", langs: "skills" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const keyOf = (s) => (s == null ? "" : String(s)).trim().toLowerCase();
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function joinNice(list) {
  if (list.length <= 1) return list.join("");
  return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
}
function newEntryId() { return Date.now() + (build.idCounter++); }

/* ---------------- AI Build tab: small bits ---------------- */

function onGuidedExtra(key, value) {
  guidedExtra[key] = value;
  saveDraft();
}

function renderGuidedEdu() {
  const el = document.getElementById("guided-edu-list");
  if (!el) return;
  el.innerHTML = eduEntries.length
    ? eduEntries.map(guidedEduHTML).join("")
    : `<p class="guided-empty"><i class="ti ti-school"></i> No education added yet - tap "Add education" below.</p>`;
}

function guidedEduHTML(entry) {
  return `
    <div class="guided-edu-card" data-id="${entry.id}">
      <button class="remove-btn" onclick="removeEdu(${entry.id})" title="Remove"><i class="ti ti-x"></i></button>
      <div class="input-group">
        <label>Degree &amp; field of study</label>
        <input type="text" class="g-edu-degree" placeholder="B.Sc. Statistics" value="${esc(entry.degree)}" oninput="onEduField(${entry.id}, 'degree', this.value)">
      </div>
      <div class="input-group">
        <label>Institution</label>
        <input type="text" placeholder="Calcutta University" value="${esc(entry.school)}" oninput="onEduField(${entry.id}, 'school', this.value)">
      </div>
      <div class="input-row">
        <div class="input-group">
          <label>Graduation year</label>
          <input type="number" placeholder="2025" min="1950" max="2100" value="${esc(entry.year)}" oninput="onEduField(${entry.id}, 'year', this.value)">
        </div>
        <div class="input-group">
          <label>GPA (optional)</label>
          <input type="text" placeholder="8.4 / 10" value="${esc(entry.gpa)}" oninput="onEduField(${entry.id}, 'gpa', this.value)">
        </div>
      </div>
    </div>`;
}

function addEduGuided() {
  addEdu();
  const first = document.querySelector("#guided-edu-list .guided-edu-card:last-child input");
  if (first) first.focus();
}

function setTemplate(value) {
  onFieldInput("template", value);
  setVal("f-template", value);
}
function syncTemplateChips() {
  document.querySelectorAll("#templateChips .tpl-chip").forEach((b) => b.classList.toggle("active", b.dataset.tpl === form.template));
}

// clear red "invalid" outlines as soon as the user edits the field
document.addEventListener("input", (e) => {
  if (e.target && e.target.classList && e.target.classList.contains("is-invalid")) e.target.classList.remove("is-invalid");
});

function showGuidedError(msg) {
  const el = document.getElementById("guidedError");
  el.style.display = "flex";
  el.querySelector("span").textContent = msg;
}
function hideGuidedError() { document.getElementById("guidedError").style.display = "none"; }

/* ---------------- Confirm dialog ---------------- */

function askConfirm({ title, message, okLabel = "Continue" }) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("confirmOverlay");
    const ok = document.getElementById("confirmOk");
    const cancel = document.getElementById("confirmCancel");
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMessage").textContent = message;
    ok.textContent = okLabel;

    const onKey = (e) => { if (e.key === "Escape") done(false); };
    function done(value) {
      overlay.style.display = "none";
      syncBodyLock();
      ok.onclick = cancel.onclick = overlay.onclick = null;
      document.removeEventListener("keydown", onKey);
      resolve(value);
    }
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    overlay.onclick = (e) => { if (e.target === overlay) done(false); };
    document.addEventListener("keydown", onKey);
    overlay.style.display = "flex";
    syncBodyLock();
    ok.focus();
  });
}

/* ---------------- ATS gate ---------------- */

function atsUnlocked() {
  if (build.running) return false;
  if (aiBuilt) return true;
  // hand-built resumes keep access once they have real content
  return !!(form.name && form.summary && expEntries.length > 0 && eduEntries.length > 0);
}

function updateAtsGate() {
  const unlocked = atsUnlocked();
  ["atsToolbarBtn", "atsTriggerBtn", "mobileAtsBtn"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = !unlocked;
    if (unlocked && !atsWasUnlocked && aiBuilt) {
      el.classList.remove("ats-reveal");
      void el.offsetWidth;
      el.classList.add("ats-reveal");
    }
  });
  const hint = document.getElementById("atsLockedHint");
  if (hint) hint.hidden = unlocked;
  atsWasUnlocked = unlocked;
}

/* ---------------- Status + step UI ---------------- */

function setPreviewStatus(state, text) {
  const el = document.getElementById("previewStatus");
  if (!el) return;
  el.dataset.state = state;
  el.textContent = text || "Updates as you type";
}

function setBuildStatus(text) {
  const el = document.getElementById("buildStatus");
  if (el) el.textContent = text || "";
}

function paintSteps(finished = false) {
  const ol = document.getElementById("buildSteps");
  if (!ol) return;
  ol.innerHTML = BUILD_STEPS.map((s, i) => {
    const state = finished || i < build.stepIndex ? "is-done" : i === build.stepIndex ? "is-active" : "";
    const icon = state === "is-done" ? "check" : state === "is-active" ? "loader-2 spin-icon" : s.icon;
    return `<li class="build-step ${state}"><span class="bs-dot"><i class="ti ti-${icon}"></i></span><span>${s.label}</span></li>`;
  }).join("");
}

function setStep(key) {
  const idx = BUILD_STEPS.findIndex((s) => s.key === key);
  if (idx > build.stepIndex) build.stepIndex = idx;
  paintSteps();
}

function setLive(section, statusText) {
  build.liveSection = section;
  const step = STEP_FOR_SECTION[section];
  if (step) setStep(step);
  if (statusText) setBuildStatus(statusText);
  renderFrame();
  scrollLiveIntoView();
}

function setBuildingUI(on, success) {
  const card = document.getElementById("buildCard");
  const btn = document.getElementById("generateBtn");
  document.getElementById("mainTabs").classList.toggle("is-locked", on);
  document.getElementById("downloadBtn").disabled = on;
  const mdl = document.getElementById("mobileDownloadBtn");
  if (mdl) mdl.disabled = on;
  const skipChip = document.getElementById("previewSkipBtn");
  if (skipChip) skipChip.hidden = !on;
  btn.disabled = on;
  btn.querySelector("i").className = on ? "ti ti-loader-2 spin-icon" : "ti ti-wand";
  document.getElementById("generateBtnText").textContent = on ? "Building your resume..." : "Generate my resume";

  if (on) {
    card.hidden = false;
    card.classList.remove("is-finished");
    document.getElementById("guidedDone").hidden = true;
    document.getElementById("skipAnimBtn").hidden = false;
    document.getElementById("buildTitle").textContent = build.mode === "refine" ? "Updating your resume" : "Building your resume";
    hideGuidedError();
    setPreviewStatus("building", build.mode === "refine" ? "Updating your resume..." : "Building your resume...");
    return;
  }

  document.getElementById("skipAnimBtn").hidden = true;
  if (success) {
    card.classList.add("is-finished");
    document.getElementById("buildTitle").textContent = build.mode === "refine" ? "Resume updated" : "Resume built";
    paintSteps(true);
    setBuildStatus("All sections are written. Review the preview — you can still edit anything.");
    setPreviewStatus("ready", "Resume ready — check its ATS score");
  } else {
    card.hidden = true;
    setPreviewStatus("idle");
  }
}

function skipBuildAnimation() {
  build.skip = true;
  document.getElementById("skipAnimBtn").hidden = true;
  const chip = document.getElementById("previewSkipBtn");
  if (chip) chip.hidden = true;
}

/* ---------------- Preview frames + typing ---------------- */

function renderFrame() {
  generateResume();
  build.frames++;
  if (build.frames % 5 === 0) scrollLiveIntoView();
}

function scrollLiveIntoView() {
  const live = document.querySelector("#preview .r-live");
  if (!live) return;
  const target = live.querySelector(".r-exp-item:last-child, .r-proj-item:last-child") || live;
  target.scrollIntoView({ block: "nearest" });
}

async function pace(ms) { if (!build.skip) await sleep(ms); }

async function typeText(fullText, apply, { step = 3, delay = 14 } = {}) {
  const text = fullText || "";
  if (build.skip || text.length <= step) { apply(text); return; }
  // if the network is well ahead of the animation, type faster
  const inc = step * (build.queue.length > 2 ? 3 : 1);
  for (let i = inc; i < text.length; i += inc) {
    if (build.skip) break;
    apply(text.slice(0, i));
    await sleep(delay);
  }
  apply(text);
}

/* ---------------- Applying streamed sections ---------------- */

function findExisting(list, item, kind) {
  // Match a streamed item to an entry the user already has, so AI output merges instead of duplicating.
  // Each existing entry can be claimed once per run (build.matched).
  const free = list.filter((e) => !build.matched.has(e.id));
  const pick = (e) => { if (e) build.matched.add(e.id); return e || null; };
  const contains = (a, b) => a && b && (a.includes(b) || b.includes(a));

  if (kind === "project") {
    const n = keyOf(item.name);
    return pick(free.find((e) => keyOf(e.name) === n) || free.find((e) => contains(keyOf(e.name), n)));
  }
  const c = keyOf(item.company), r = keyOf(item.role);
  let hit = free.find((e) => keyOf(e.company) === c && keyOf(e.role) === r);
  if (!hit) hit = free.find((e) => keyOf(e.company) === c && (contains(keyOf(e.role), r) || !keyOf(e.role) || !r));
  if (!hit && c) {
    const sameCompany = free.filter((e) => keyOf(e.company) === c);
    if (sameCompany.length === 1) hit = sameCompany[0];
  }
  if (!hit && !c && r) hit = free.find((e) => keyOf(e.role) === r);
  return pick(hit);
}

async function applySummary(text) {
  setLive("summary", "Writing your professional summary...");
  await typeText(text, (t) => {
    form.summary = t;
    setVal("f-summary", t);
    renderFrame();
  }, { step: 3, delay: 16 });
}

async function applyExperienceItem(item) {
  setLive("experience", `Writing experience — ${item.role || item.company}...`);
  let entry = findExisting(expEntries, item, "experience");
  if (!entry) {
    entry = { id: newEntryId(), company: "", role: "", start: "", end: "", bullets: "" };
    expEntries.push(entry);
  }
  // never lose what the user typed: only overwrite a field when the AI actually returned a value
  const oldBullets = entry.bullets || "";
  entry.company = entry.company || item.company;   // the user's own names always win
  entry.role = entry.role || item.role;
  entry.start = entry.start || item.start;
  entry.end = entry.end || item.end;
  const lines = splitLines(item.bullets).map((l) => l.replace(/^[-\u2022*]+\s*/, ""));
  if (!lines.length) { renderFrame(); return; }   // AI had nothing to add: keep the user's bullets untouched
  entry.bullets = "";
  renderFrame();
  scrollLiveIntoView();
  await pace(200);

  for (let i = 0; i < lines.length; i++) {
    const done = lines.slice(0, i).join("\n");
    await typeText(lines[i], (t) => {
      entry.bullets = done ? done + "\n" + t : t;
      renderFrame();
    }, { step: 4, delay: 12 });
    await pace(90);
  }
  // keep any of the user's own bullets the AI left out (compare by shared words, so rewording doesn't count as "left out")
  const lost = splitLines(oldBullets)
    .map((l) => l.replace(/^[-\u2022*]+\s*/, ""))
    .filter((l) => !lines.some((w) => bulletsSimilar(w, l)));
  if (lost.length && build.mode === "build") {
    entry.bullets = entry.bullets + "\n" + lost.join("\n");
    renderFrame();
  }
}

function bulletWords(text) {
  return new Set(keyOf(text).replace(/[^a-z0-9%\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
}
function bulletsSimilar(a, b) {
  const A = bulletWords(a), B = bulletWords(b);
  if (!A.size || !B.size) return keyOf(a) === keyOf(b);
  let shared = 0;
  A.forEach((w) => { if (B.has(w)) shared++; });
  return shared / Math.min(A.size, B.size) >= 0.5;
}

async function applyProjectItem(item) {
  setLive("projects", `Adding project — ${item.name}...`);
  let entry = findExisting(projEntries, item, "project");
  if (!entry) {
    entry = { id: newEntryId(), name: "", tech: "", desc: "", link: "" };
    projEntries.push(entry);
  }
  entry.name = entry.name || item.name;
  entry.tech = entry.tech || item.tech;
  entry.link = entry.link || item.link || "";
  if (!item.desc) { renderFrame(); return; }      // keep the user's description
  entry.desc = "";
  renderFrame();
  scrollLiveIntoView();
  await pace(160);
  await typeText(item.desc, (t) => { entry.desc = t; renderFrame(); }, { step: 3, delay: 12 });
}

async function applySkills(value) {
  setLive("skills", "Choosing skills for your target role...");
  const shown = splitList(form.skills);
  const seen = new Set(shown.map(keyOf));
  const additions = splitList(value).filter((s) => !seen.has(keyOf(s)) && seen.add(keyOf(s)));
  renderFrame();
  for (const skill of additions) {
    shown.push(skill);
    form.skills = shown.join(", ");
    setVal("f-skills", form.skills);
    setVal("g-skills", form.skills);
    renderFrame();
    await pace(80);
  }
}

async function applyCerts(value) {
  setLive("certs", "Adding certifications...");
  const existing = splitLines(certs).map(keyOf);
  for (const line of splitLines(value)) {
    if (existing.includes(keyOf(line))) continue;
    certs = certs ? certs + "\n" + line : line;
    setVal("f-certs", certs);
    renderFrame();
    await pace(140);
  }
}

async function applyLangs(value) {
  setLive("langs", "Adding languages...");
  const shown = splitList(langs);
  const seen = new Set(shown.map(keyOf));
  for (const lang of splitList(value)) {
    if (seen.has(keyOf(lang))) continue;
    seen.add(keyOf(lang));
    shown.push(lang);
    langs = shown.join(", ");
    setVal("f-langs", langs);
    renderFrame();
    await pace(100);
  }
}

async function applyBuildEvent(evt) {
  build.applied++;
  switch (evt.section) {
    case "summary":    return applySummary(evt.value);
    case "experience": return applyExperienceItem(evt.item);
    case "projects":   return applyProjectItem(evt.item);
    case "skills":     return applySkills(evt.value);
    case "certs":      return applyCerts(evt.value);
    case "langs":      return applyLangs(evt.value);
    default:           build.applied--; return null;
  }
}

/* ---------------- Streaming plumbing ---------------- */

async function streamSSE(url, payload, onEvent) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await readAIError(res));
  if (!res.body) throw new Error("Your browser doesn't support streaming responses.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue;
      try { onEvent(JSON.parse(data)); } catch (err) { console.warn("Skipping malformed stream event", err); }
    }
  }
}

async function introSteps(mode) {
  if (mode === "build") {
    setStep("personal");
    setBuildStatus("Checking your personal details...");
    await pace(450);
    setStep("education");
    setBuildStatus("Adding your education...");
    await pace(450);
  }
  setStep("summary");
  setBuildStatus(mode === "build" ? "Waiting for the AI to start writing..." : "Reading your new details...");
}

function restoreSnapshot() {
  if (!build.snapshot) return;
  try { applyDraftObject(JSON.parse(build.snapshot)); } catch (err) { console.warn("Couldn't restore draft:", err); }
}

/**
 * Runs one streamed generation (fresh build or ATS refinement) and plays it into the live preview.
 * Resolves true on success, false on failure (state is restored or partially kept, see below).
 */
async function runBuild(mode, url, payload, prepare) {
  if (build.running) return false;

  build.running = true;
  build.mode = mode;
  build.queue = [];
  build.streamDone = false;
  build.skip = false;
  build.applied = 0;
  build.frames = 0;
  build.idCounter = 0;
  build.matched = new Set();
  build.liveSection = null;
  build.failed = null;
  build.stepIndex = mode === "refine" ? 2 : 0;
  build.snapshot = JSON.stringify(collectDraft());
  build.lastActivity = Date.now();

  switchTabByName("guided");
  if (prepare) prepare();
  setBuildingUI(true);
  paintSteps();
  if (isMobileLayout()) {
    viewScroll.preview = 0;
    setMobileView("preview");
  }

  let streamError = null;
  let success = false;

  const streaming = streamSSE(url, payload, (evt) => {
    build.lastActivity = Date.now();
    if (evt.type === "error") streamError = new Error(evt.message || "AI request failed.");
    else if (evt.type === "section") build.queue.push(evt);
  }).catch((err) => { streamError = err; }).finally(() => { build.streamDone = true; });

  try {
    await introSteps(mode);
    for (;;) {
      if (build.queue.length) { await applyBuildEvent(build.queue.shift()); continue; }
      if (streamError) throw streamError;
      if (build.streamDone) break;
      if (Date.now() - build.lastActivity > 75000) throw new Error("The AI is taking longer than expected. Please try again.");
      await sleep(30);
    }
    if (build.applied === 0) throw new Error("The AI didn't return any resume content. Please try again.");

    setStep("finish");
    setBuildStatus("Polishing final details...");
    build.liveSection = null;
    renderFrame();
    await pace(500);
    success = true;
  } catch (err) {
    console.error("Resume build failed:", err);
    // A refinement must never leave a half-rewritten resume; a fresh build keeps whatever was written.
    const keepPartial = mode === "build" && build.applied > 0;
    if (!keepPartial) restoreSnapshot();
    build.failed = {
      message: (err && err.message) || "Something went wrong while building your resume.",
      partial: keepPartial,
    };
  } finally {
    build.running = false;
    build.liveSection = null;
    if (success) aiBuilt = true;
    populateFieldsFromState();
    renderExpList();
    renderProjList();
    renderEduList();
    generateResume();
    saveDraft();
    setBuildingUI(false, success);
  }
  await streaming;

  if (!success && build.failed) {
    const { message, partial } = build.failed;
    showGuidedError(partial ? `${message} Everything written so far is in your resume — press Generate to try again.` : message);
    showToast(message, "error", 6000);
    if (mode === "refine") {
      openATS();
      const errEl = document.getElementById("atsError");
      errEl.style.display = "flex";
      errEl.querySelector("span").textContent = message + " Your answers are still here — try again.";
    }
  }
  return success;
}

/* ---------------- Entry point: "Generate my resume" ---------------- */

function validateGuided() {
  const problems = [];
  const flag = (id) => { const el = document.getElementById(id); if (el) el.classList.add("is-invalid"); };
  document.querySelectorAll("#tab-guided .is-invalid").forEach((el) => el.classList.remove("is-invalid"));

  if (!form.name.trim()) { problems.push("your full name"); flag("g-name"); }
  if (!form.email.trim() && !form.phone.trim()) { problems.push("an email or phone number"); flag("g-email"); }
  if (!eduEntries.some((e) => (e.degree || "").trim() || (e.school || "").trim())) {
    problems.push("at least one education entry");
    const first = document.querySelector("#guided-edu-list .g-edu-degree");
    if (first) first.classList.add("is-invalid");
  }
  if (!form.title.trim()) { problems.push("the role you want"); flag("g-role"); }
  return problems;
}

async function startGuidedBuild() {
  if (build.running) return;
  hideGuidedError();
  document.getElementById("guidedDone").hidden = true;

  const problems = validateGuided();
  if (problems.length) {
    showGuidedError("Please add " + joinNice(problems) + " first.");
    return;
  }

  if (aiBuilt) {
    const ok = await askConfirm({
      title: "Generate again?",
      message: "AI will polish your summary and merge everything you have in Work and Projects with your notes. Your existing entries are kept, not deleted.",
      okLabel: "Generate again",
    });
    if (!ok) return;
  }

  const education = eduEntries.filter((e) => (e.degree || "").trim() || (e.school || "").trim());
  const skillsProvided = splitList(form.skills).length > 0;
  const payload = {
    name: form.name, email: form.email, phone: form.phone, location: form.location,
    linkedin: form.linkedin, website: form.website,
    targetRole: form.title, level: guidedExtra.level,
    skills: form.skills, background: guidedExtra.background, education,
    // everything already filled in by hand is sent so the AI merges with it instead of replacing it
    summary: form.summary, certs, langs,
    experience: expEntries.filter((e) => (e.company || "").trim() || (e.role || "").trim()),
    projects: projEntries.filter((p) => (p.name || "").trim()),
  };

  const ok = await runBuild("build", "/api/ai/build-stream", payload, null);

  if (ok) {
    showBuildDone(
      "Your resume is ready",
      skillsProvided
        ? "Review it in the live preview, then check how it scores with applicant tracking systems."
        : "Review it in the live preview. Skills were suggested for your target role — remove any you don't actually have (More tab). Then check how it scores with applicant tracking systems."
    );
    showToast("Your resume is ready. Run the ATS check to see how it scores.", "success", 5000);
  }
}

function showBuildDone(title, text) {
  document.getElementById("guidedDoneTitle").textContent = title;
  document.getElementById("guidedDoneText").textContent = text;
  document.getElementById("guidedDone").hidden = false;
}

/* ---------------- ATS follow-up: "tell us more" -> refine -> re-check ---------------- */

async function submitATSAnswers() {
  const answers = Array.from(document.querySelectorAll("#atsQuestions .ats-q"))
    .map((el) => ({ id: el.dataset.id, question: el.dataset.q, answer: el.querySelector("textarea").value.trim() }))
    .filter((a) => a.answer);

  if (!answers.length) {
    const errEl = document.getElementById("atsError");
    errEl.style.display = "flex";
    errEl.querySelector("span").textContent = "Answer at least one question so the AI has something new to add.";
    return;
  }
  document.getElementById("atsError").style.display = "none";

  closeATS();
  const ok = await runBuild("refine", "/api/ai/refine-stream", {
    name: form.name, title: form.title, location: form.location, level: guidedExtra.level,
    summary: form.summary, skills: form.skills, certs, langs,
    experience: expEntries, education: eduEntries, projects: projEntries,
    answers, jobDescription: "",
  }, null);

  if (ok) {
    showBuildDone("Resume updated", "Your new details are in the resume. Re-checking your ATS score now...");
    showToast("Resume updated — re-checking your ATS score.", "success", 3500);
    openATS();   // resume changed, so this re-scores it automatically
  }
}



/* ==========================================================================
   Theme (light / dark)
   The inline <head> script picks the theme before first paint; this keeps the
   button, the browser colour and the saved choice in sync.
   ========================================================================== */

const THEME_KEY = "raTheme";
const THEME_COLORS = { light: "#f3f5fb", dark: "#0a0f1e" };
let themeAnimTimer = null;

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme, { persist = false, animate = false } = {}) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-anim");
    clearTimeout(themeAnimTimer);
    themeAnimTimer = setTimeout(() => root.classList.remove("theme-anim"), 350);
  }
  root.setAttribute("data-theme", theme);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);

  const btn = document.getElementById("themeToggle");
  if (btn) {
    const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    btn.setAttribute("aria-label", label);
    btn.title = label;
  }
  if (persist) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (err) { /* private mode: the choice just won't persist */ }
  }
}

function toggleTheme() {
  applyTheme(currentTheme() === "dark" ? "light" : "dark", { persist: true, animate: true });
}

function initTheme() {
  applyTheme(currentTheme());
  // Until the user picks a theme themselves, follow the operating system as it changes (e.g. sunset auto-dark).
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  if (mq && mq.addEventListener) {
    mq.addEventListener("change", (e) => {
      let saved = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* ignore */ }
      if (saved !== "light" && saved !== "dark") applyTheme(e.matches ? "dark" : "light", { animate: true });
    });
  }
}

/* ==========================================================================
   Phones & tablets: one panel at a time (Edit / Preview), switched from the bottom bar
   ========================================================================== */

const viewScroll = { edit: 0, preview: 0 };

function isMobileLayout() {
  return !!(window.matchMedia && window.matchMedia("(max-width: 899px)").matches);
}

function setMobileView(view) {
  if (view !== "edit" && view !== "preview") return;
  const prev = document.body.dataset.view === "preview" ? "preview" : "edit";

  if (prev === view) {                      // tapping the active tab jumps back to the top
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  viewScroll[prev] = window.scrollY;        // remember where the user was in each view
  document.body.dataset.view = view;

  [["mnavEdit", "edit"], ["mnavPreview", "preview"]].forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("active", v === view);
    el.setAttribute("aria-selected", v === view ? "true" : "false");
  });
  requestAnimationFrame(() => window.scrollTo(0, viewScroll[view] || 0));
}

async function mobileDownload() {
  const formBtn = document.getElementById("downloadBtn");
  const btn = document.getElementById("mobileDownloadBtn");
  if ((formBtn && formBtn.disabled) || (btn && btn.disabled)) return;
  const icon = btn.querySelector("i");
  btn.disabled = true;
  icon.className = "ti ti-loader-2 spin-icon";
  try {
    await saveAndDownload();
  } finally {
    btn.disabled = build.running;
    icon.className = "ti ti-download";
  }
}

// Locks page scroll behind an open modal / bottom sheet.
function syncBodyLock() {
  const open = ["atsOverlay", "confirmOverlay"].some((id) => {
    const el = document.getElementById(id);
    return el && el.style.display === "flex";
  });
  document.body.classList.toggle("modal-open", open);
}
