const supabaseClient = window.supabase.createClient(
  "https://feqncmpoofgxyldxobzu.supabase.co",
  "sb_publishable_kL81VA7D6E08K4ObwB4Xrg_9Y_RAEcG"
);

// --- 1. INITIALIZATION & STATE ---
window.onload = () => {
  generateResume(); // Build initial view
  
  // Fade out intro animation
  setTimeout(() => {
    const introScreen = document.getElementById("intro-screen");
    if (introScreen) introScreen.style.display = "none";
  }, 3000);
};

// Check login status globally
supabaseClient.auth.onAuthStateChange((event, session) => {
  const loginScreen = document.getElementById('login-screen');
  const appContainer = document.getElementById('app-container');

  if (session) {
    loginScreen.style.display = 'none';
    appContainer.style.display = 'flex';
    generateResume(); 
  } else {
    loginScreen.style.display = 'flex';
    appContainer.style.display = 'none';
  }
});

// --- 2. AUTHENTICATION ---
async function signInWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) alert("Error with Google Sign-In: " + error.message);
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) alert("Error logging out: " + error.message);
}

// --- 3. LIVE DOM UPDATES ---
function generateResume() {
  const name = document.getElementById("name").value;
  const template = document.getElementById("template").value;
  const skills = document.getElementById("skills").value;
  const education = document.getElementById("education").value; 
  const projects = document.getElementById("projects").value;

  const preview = document.getElementById("preview");

  // Format text arrays
  const formattedSkills = skills.split(",").filter(s => s.trim() !== "").map(skill => `<li>${skill.trim()}</li>`).join("");
  const formattedEducation = education.split("\n").filter(e => e.trim() !== "").map(edu => `<li>${edu.trim()}</li>`).join("");
  const formattedProjects = projects.split("\n").filter(p => p.trim() !== "").map(project => `<li>${project.trim()}</li>`).join("");

  // Inject with selected template class applied
  preview.innerHTML = `
    <div id="resumeContent" class="${template}">
      <h2>${name || "Your Name"}</h2>
      <hr>

      <h3>Education</h3>
      <ul>${formattedEducation}</ul>

      <h3>Skills</h3>
      <ul>${formattedSkills}</ul>

      <h3>Projects</h3>
      <ul>${formattedProjects}</ul> 
    </div>
  `;
}

// --- 4. THE DATA PIPELINE (SAVE THEN DOWNLOAD) ---
async function saveAndDownload() {
  const downloadBtn = document.getElementById("downloadBtn");
  const originalText = downloadBtn.innerHTML;

  // 1. Check Auth Status First
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    alert("Session expired. Please sign in to download.");
    return;
  }

  // 2. Lock Button State UI
  downloadBtn.innerHTML = "⏳ Saving & Generating...";
  downloadBtn.disabled = true;

  // 3. Gather Form Data
  const resumeData = {
    email: user.email,
    name: document.getElementById("name").value,
    skills: document.getElementById("skills").value,
    education: document.getElementById("education").value,
    projects: document.getElementById("projects").value
  };

  // 4. Force Save to Database
  const { error } = await supabaseClient
    .from("resumes")
    .insert([resumeData]);

  // 5. Conditional PDF Generation
  if (error) {
    console.error(error);
    alert("Error securing your data in the database. Download blocked.");
  } else {
    // Save successful -> Allow user to have the PDF
    triggerPDF();
  }

  // 6. Reset UI
  downloadBtn.innerHTML = originalText;
  downloadBtn.disabled = false;
}

// The core html2pdf logic
function triggerPDF() {
  const element = document.getElementById("resumeContent");
  const options = {
    margin:       15,
    filename:     'My_Resume.pdf',
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2 },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };
  html2pdf().set(options).from(element).save();
}