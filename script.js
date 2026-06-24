const supabaseClient = window.supabase.createClient(
  "https://feqncmpoofgxyldxobzu.supabase.co",
  "sb_publishable_kL81VA7D6E08K4ObwB4Xrg_9Y_RAEcG"
);

// --- STATE ---
let expEntries = [];
let eduEntries = [];
let projEntries = [];

// ============================================================
// 1. INITIALIZATION
// ============================================================
window.onload = () => {
  generateResume();
  renderExpList();
  renderEduList();
  renderProjList();

  setTimeout(() => {
    const intro = document.getElementById("intro-screen");
    if (intro) intro.style.display = "none";
  }, 3000);
};

supabaseClient.auth.onAuthStateChange((event, session) => {
  const loginScreen = document.getElementById("login-screen");
  const appContainer = document.getElementById("app-container");
  if (session) {
    loginScreen.style.display = "none";
    appContainer.style.display = "flex";
    generateResume();
  } else {
    loginScreen.style.display = "flex";
    appContainer.style.display = "none";
  }
});

// ============================================================
// 2. AUTHENTICATION
// ============================================================
async function signInWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) alert("Error with Google Sign-In: " + error.message);
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) alert("Error logging out: " + error.message);
}

// ============================================================
// 3. TABS
// ============================================================
function switchTab(name, clickedBtn) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
  clickedBtn.classList.add("active");
  document.getElementById("tab-" + name).classList.add("active");
}

// ============================================================
// 4. DYNAMIC ENTRY BLOCKS — EXPERIENCE
// ============================================================
function addExp() {
  const id = Date.now();
  expEntries.push({ id, company: "", role: "", start: "", end: "", bullets: "" });
  renderExpList();
}

function removeExp(id) {
  expEntries = expEntries.filter((e) => e.id !== id);
  renderExpList();
  generateResume();
}

function renderExpList() {
  const container = document.getElementById("exp-list");
  if (!container) return;
  container.innerHTML = expEntries
    .map(
      (e) => `
    <div class="entry-block">
      <button class="remove-btn" onclick="removeExp(${e.id})" title="Remove">
        <i class="ti ti-x"></i>
      </button>
      <div class="input-row">
        <div class="input-group">
          <label>Company</label>
          <input placeholder="Acme Corp" value="${escHtml(e.company)}"
            oninput="expEntries.find(x=>x.id===${e.id}).company=this.value; generateResume()">
        </div>
        <div class="input-group">
          <label>Your Role</label>
          <input placeholder="Product Designer" value="${escHtml(e.role)}"
            oninput="expEntries.find(x=>x.id===${e.id}).role=this.value; generateResume()">
        </div>
      </div>
      <div class="input-row">
        <div class="input-group">
          <label>Start Date</label>
          <input placeholder="Jan 2022" value="${escHtml(e.start)}"
            oninput="expEntries.find(x=>x.id===${e.id}).start=this.value; generateResume()">
        </div>
        <div class="input-group">
          <label>End Date</label>
          <input placeholder="Present" value="${escHtml(e.end)}"
            oninput="expEntries.find(x=>x.id===${e.id}).end=this.value; generateResume()">
        </div>
      </div>
      <div class="input-group">
        <label>Key Achievements (one per line)</label>
        <textarea placeholder="Led redesign that increased conversion by 25%&#10;Managed a team of 4 designers&#10;Reduced load time by 40% via code splitting"
          oninput="expEntries.find(x=>x.id===${e.id}).bullets=this.value; generateResume()">${escHtml(e.bullets)}</textarea>
      </div>
    </div>`
    )
    .join("");
}

// ============================================================
// 5. DYNAMIC ENTRY BLOCKS — EDUCATION
// ============================================================
function addEdu() {
  const id = Date.now();
  eduEntries.push({ id, degree: "", school: "", year: "", gpa: "" });
  renderEduList();
}

function removeEdu(id) {
  eduEntries = eduEntries.filter((e) => e.id !== id);
  renderEduList();
  generateResume();
}

function renderEduList() {
  const container = document.getElementById("edu-list");
  if (!container) return;
  container.innerHTML = eduEntries
    .map(
      (e) => `
    <div class="entry-block">
      <button class="remove-btn" onclick="removeEdu(${e.id})" title="Remove">
        <i class="ti ti-x"></i>
      </button>
      <div class="input-group">
        <label>Degree & Field of Study</label>
        <input placeholder="B.Sc. Computer Science" value="${escHtml(e.degree)}"
          oninput="eduEntries.find(x=>x.id===${e.id}).degree=this.value; generateResume()">
      </div>
      <div class="input-group">
        <label>Institution</label>
        <input placeholder="MIT" value="${escHtml(e.school)}"
          oninput="eduEntries.find(x=>x.id===${e.id}).school=this.value; generateResume()">
      </div>
      <div class="input-row">
        <div class="input-group">
          <label>Graduation Year</label>
          <input placeholder="2020" value="${escHtml(e.year)}"
            oninput="eduEntries.find(x=>x.id===${e.id}).year=this.value; generateResume()">
        </div>
        <div class="input-group">
          <label>GPA (optional)</label>
          <input placeholder="3.8 / 4.0" value="${escHtml(e.gpa)}"
            oninput="eduEntries.find(x=>x.id===${e.id}).gpa=this.value; generateResume()">
        </div>
      </div>
    </div>`
    )
    .join("");
}

// ============================================================
// 6. DYNAMIC ENTRY BLOCKS — PROJECTS
// ============================================================
function addProj() {
  const id = Date.now();
  projEntries.push({ id, name: "", tech: "", desc: "", link: "" });
  renderProjList();
}

function removeProj(id) {
  projEntries = projEntries.filter((p) => p.id !== id);
  renderProjList();
  generateResume();
}

function renderProjList() {
  const container = document.getElementById("proj-list");
  if (!container) return;
  container.innerHTML = projEntries
    .map(
      (p) => `
    <div class="entry-block">
      <button class="remove-btn" onclick="removeProj(${p.id})" title="Remove">
        <i class="ti ti-x"></i>
      </button>
      <div class="input-group">
        <label>Project Name</label>
        <input placeholder="E-commerce Platform" value="${escHtml(p.name)}"
          oninput="projEntries.find(x=>x.id===${p.id}).name=this.value; generateResume()">
      </div>
      <div class="input-group">
        <label>Tech / Tools Used</label>
        <input placeholder="React, Node.js, PostgreSQL" value="${escHtml(p.tech)}"
          oninput="projEntries.find(x=>x.id===${p.id}).tech=this.value; generateResume()">
      </div>
      <div class="input-group">
        <label>Project Link (optional)</label>
        <input placeholder="github.com/jane/project" value="${escHtml(p.link)}"
          oninput="projEntries.find(x=>x.id===${p.id}).link=this.value; generateResume()">
      </div>
      <div class="input-group">
        <label>Description</label>
        <textarea placeholder="Built a full-stack platform handling 10k daily users. Implemented CI/CD pipeline reducing deploy time by 60%."
          oninput="projEntries.find(x=>x.id===${p.id}).desc=this.value; generateResume()">${escHtml(p.desc)}</textarea>
      </div>
    </div>`
    )
    .join("");
}

// ============================================================
// 7. PROGRESS & CHECKLIST
// ============================================================
function updateProgress() {
  const checks = {
    Name: !!gv("f-name"),
    Title: !!gv("f-title"),
    Contact: !!(gv("f-email") || gv("f-phone")),
    Summary: !!gv("f-summary"),
    Experience: expEntries.length > 0,
    Education: eduEntries.length > 0,
    Skills: !!gv("f-skills"),
  };

  const done = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;
  const pct = Math.round((done / total) * 100);

  const fill = document.getElementById("progressFill");
  const label = document.getElementById("progressLabel");
  const hint = document.getElementById("progressHint");
  if (fill) fill.style.width = pct + "%";
  if (label) label.textContent = pct + "% complete";
  if (hint) hint.textContent = done + " of " + total + " sections filled";

  const chips = document.getElementById("scoreChips");
  if (chips) {
    chips.innerHTML = Object.entries(checks)
      .map(
        ([k, v]) =>
          `<span class="chip ${v ? "chip-done" : "chip-miss"}">
            <i class="ti ti-${v ? "check" : "x"}"></i>${k}
          </span>`
      )
      .join("");
  }
}

// ============================================================
// 8. LIVE RESUME GENERATION                                   
// ============================================================
function generateResume() {
  updateProgress();

  const name     = gv("f-name");
  const title    = gv("f-title");
  const email    = gv("f-email");
  const phone    = gv("f-phone");
  const location = gv("f-location");
  const linkedin = gv("f-linkedin");
  const website  = gv("f-website");
  const summary  = gv("f-summary");
  const skills   = gv("f-skills");
  const certs    = gv("f-certs");
  const langs    = gv("f-langs");
  const hobbies  = gv("f-hobbies");
  const template = gv("f-template") || "template-classic";

  const preview = document.getElementById("preview");
  if (!preview) return;

  const hasContent = name || email || expEntries.length > 0 || eduEntries.length > 0;
  if (!hasContent) {
    preview.innerHTML = `
      <div class="preview-empty">
        <i class="ti ti-file-text" style="font-size:48px;color:#cbd5e1;"></i>
        <p>Start filling in your details<br>to see your resume appear here</p>
      </div>`;
    return;
  }

  // Contact row
  const contactItems = [
    email    ? `<span class="r-contact"><i class="ti ti-mail"></i>${email}</span>` : "",
    phone    ? `<span class="r-contact"><i class="ti ti-phone"></i>${phone}</span>` : "",
    location ? `<span class="r-contact"><i class="ti ti-map-pin"></i>${location}</span>` : "",
    linkedin ? `<span class="r-contact"><i class="ti ti-brand-linkedin"></i>${linkedin}</span>` : "",
    website  ? `<span class="r-contact"><i class="ti ti-world"></i>${website}</span>` : "",
  ].filter(Boolean).join("");

  // Summary
  const summaryHTML = summary
    ? `<div class="r-section">
        <div class="r-section-title">Summary</div>
        <p class="r-summary">${summary}</p>
      </div>`
    : "";

  // Experience
  const expHTML =
    expEntries.length > 0
      ? `<div class="r-section">
          <div class="r-section-title">Experience</div>
          ${expEntries
            .map(
              (e) => `
            <div class="r-exp-item">
              <div class="r-exp-header">
                <div>
                  <div class="r-exp-company">${e.company || "Company"}</div>
                  <div class="r-exp-role">${e.role || "Role"}</div>
                </div>
                <div class="r-exp-dates">${e.start || ""}${e.end ? " – " + e.end : ""}</div>
              </div>
              ${
                e.bullets
                  ? `<ul class="r-bullets">${e.bullets
                      .split("\n")
                      .filter((b) => b.trim())
                      .map((b) => `<li>${b.trim()}</li>`)
                      .join("")}</ul>`
                  : ""
              }
            </div>`
            )
            .join("")}
        </div>`
      : "";

  // Education
  const eduHTML =
    eduEntries.length > 0
      ? `<div class="r-section">
          <div class="r-section-title">Education</div>
          ${eduEntries
            .map(
              (e) => `
            <div class="r-edu-item">
              <div class="r-edu-degree">${e.degree || "Degree"}</div>
              <div class="r-edu-school">${e.school || ""}${e.gpa ? " &middot; GPA: " + e.gpa : ""}</div>
              <div class="r-edu-year">${e.year || ""}</div>
            </div>`
            )
            .join("")}
        </div>`
      : "";

  // Skills
  const skillsHTML = skills
    ? `<div class="r-section">
        <div class="r-section-title">Skills</div>
        <div class="r-skills-grid">
          ${skills.split(",").filter((s) => s.trim()).map((s) => `<span class="r-skill-tag">${s.trim()}</span>`).join("")}
        </div>
      </div>`
    : "";

  // Projects
  const projHTML =
    projEntries.length > 0
      ? `<div class="r-section">
          <div class="r-section-title">Projects</div>
          ${projEntries
            .map(
              (p) => `
            <div class="r-proj-item">
              <div class="r-proj-name">
                ${p.name || "Project"}
                ${p.tech ? `<span class="r-proj-tech"> &middot; ${p.tech}</span>` : ""}
                ${p.link ? `<a class="r-proj-link" href="https://${p.link.replace(/^https?:\/\//,"")}" target="_blank"><i class="ti ti-external-link"></i></a>` : ""}
              </div>
              <div class="r-proj-desc">${p.desc || ""}</div>
            </div>`
            )
            .join("")}
        </div>`
      : "";

  // Certifications
  const certsHTML = certs
    ? `<div class="r-section">
        <div class="r-section-title">Certifications</div>
        <ul class="r-bullets">
          ${certs.split("\n").filter((c) => c.trim()).map((c) => `<li>${c.trim()}</li>`).join("")}
        </ul>
      </div>`
    : "";

  // Languages
  const langsHTML = langs
    ? `<div class="r-section">
        <div class="r-section-title">Languages</div>
        <div class="r-skills-grid">
          ${langs.split(",").filter((l) => l.trim()).map((l) => `<span class="r-skill-tag r-lang-tag">${l.trim()}</span>`).join("")}
        </div>
      </div>`
    : "";

  // Hobbies
  const hobbiesHTML = hobbies
    ? `<div class="r-section">
        <div class="r-section-title">Interests</div>
        <p class="r-summary">${hobbies}</p>
      </div>`
    : "";

  preview.innerHTML = `
    <div id="resumeContent" class="${template}">
      <div class="r-header">
        <div class="r-name">${name || "Your Name"}</div>
        ${title ? `<div class="r-title">${title}</div>` : ""}
        ${contactItems ? `<div class="r-contacts">${contactItems}</div>` : ""}
      </div>
      <hr class="r-divider">
      ${summaryHTML}
      ${expHTML}
      ${eduHTML}
      ${skillsHTML}
      ${projHTML}
      ${certsHTML}
      ${langsHTML}
      ${hobbiesHTML}
    </div>
  `;
}

// ============================================================
// 9. SAVE & DOWNLOAD
// ============================================================
async function saveAndDownload() {
  const downloadBtn = document.getElementById("downloadBtn");
  const originalText = downloadBtn.innerHTML;

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    alert("Session expired. Please sign in again.");
    return;
  }

  downloadBtn.innerHTML = '<i class="ti ti-loader"></i> Saving & Generating...';
  downloadBtn.disabled = true;

  const resumeData = {
    user_id:    user.id,
    email:      user.email,
    name:       gv("f-name"),
    job_title:  gv("f-title"),
    contact_email: gv("f-email"),
    phone:      gv("f-phone"),
    location:   gv("f-location"),
    linkedin:   gv("f-linkedin"),
    website:    gv("f-website"),
    summary:    gv("f-summary"),
    skills:     gv("f-skills"),
    certifications: gv("f-certs"),
    languages:  gv("f-langs"),
    hobbies:    gv("f-hobbies"),
    experience: JSON.stringify(expEntries),
    education:  JSON.stringify(eduEntries),
    projects:   JSON.stringify(projEntries),
    template:   gv("f-template"),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseClient.from("resumes").insert([resumeData]);

  if (error) {
    console.error(error);
    alert("Error saving your data. Download blocked.\n\n" + error.message);
  } else {
    triggerPDF();
  }

  downloadBtn.innerHTML = originalText;
  downloadBtn.disabled = false;
}

function triggerPDF() {
  const element = document.getElementById("resumeContent");
  if (!element) { alert("Nothing to export yet!"); return; }

  const name = gv("f-name") || "Resume";
  const options = {
    margin:      12,
    filename:    name.replace(/\s+/g, "_") + "_Resume.pdf",
    image:       { type: "jpeg", quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF:       { unit: "mm", format: "a4", orientation: "portrait" },
  };
  html2pdf().set(options).from(element).save();
}

// ============================================================
// UTILITIES
// ============================================================
function gv(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : "";
}

function escHtml(str) {
  return (str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}