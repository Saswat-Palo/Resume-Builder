const supabaseClient = window.supabase.createClient(
  "https://oduavcbqowmdisuaaltr.supabase.co",
  "sb_publishable_bLjLEGcoiSBLLnPqzmjU7A_ElpgfOx_"
);

function generateResume() {
  let name = document.getElementById("name").value;
  let skills = document.getElementById("skills").value;
  let education = document.getElementById("education").value; // New!
  let projects = document.getElementById("projects").value;

  let preview = document.getElementById("preview");

  let skillList = skills.split(",").filter(s => s.trim() !== "");
  let formattedSkills = skillList
    .map(skill => `<li>${skill.trim()}</li>`)
    .join("");


  let eduList = education.split("\n").filter(e => e.trim() !== "");
  let formattedEducation = eduList
    .map(edu => `<li>${edu.trim()}</li>`)
    .join("");


  let projectList = projects.split("\n").filter(p => p.trim() !== "");
  let formattedProjects = projectList
    .map(project => `<li>${project.trim()}</li>`)
    .join("");

  preview.innerHTML = `
    <div id="resumeContent">
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

function downloadPDF() {
  let element = document.getElementById("resumeContent");

  let options = {
    margin:       15,
    filename:     'My_Resume.pdf',
    image:        { type: 'jpeg', quality: 0.98 },
    html2canvas:  { scale: 2 },
    jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' }
  };

  html2pdf().set(options).from(element).save();
}

async function saveResume() {
  let name = document.getElementById("name").value;
  let skills = document.getElementById("skills").value;
  let education = document.getElementById("education").value; 
  let projects = document.getElementById("projects").value;

  const { error } = await supabaseClient
    .from("resumes")
    .insert([{ name, skills, education, projects }]);

  if (error) {
    alert("Error saving");
    console.log(error);
  } else {
    alert("Saved successfully!");
  }
}

window.onload = generateResume;

setTimeout(() => {
  const introScreen = document.getElementById("intro-screen");
  if (introScreen) {
    introScreen.style.display = "none";
  }
}, 3000); 