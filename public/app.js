
const $ = id => document.getElementById(id);

let mode = "writer";
let backupBusy = false;
let nextAutoBackupAt = null;
let autoBackupTimer = null;

const keys = [
  "title",
  "genre",
  "context",
  "chapterTitle",
  "manuscript",
  "projectMemory",
  "globalMemory"
];

const cloud = {
  authenticated: false,
  csrfToken: "",
  userId: "",
  projects: [],
  activeProjectId: "",
  chapters: [],
  activeChapterId: "",
  revision: 0,
  saveTimer: null,
  saving: false,
  noteId: ""
};

const UUID_RE = /^[a-f0-9-]{36}$/i;
const localMigrationKey = () => "sf_cloud_migrated_" + (cloud.userId || "owner");
const migrationMapKey = () => "sf_cloud_migration_map_" + (cloud.userId || "owner");

async function cloudApi(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method)) headers["X-CSRF-Token"] = cloud.csrfToken;
  const response = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "คำขอไม่สำเร็จ");
    error.status = response.status;
    throw error;
  }
  return payload;
}

function hasLocalNovelData() {
  const projects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
  return (Array.isArray(projects) && projects.length > 0) ||
    keys.some(key => Boolean(localStorage.getItem("sf_" + key)));
}

function localProjectsForImport() {
  let projects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
  if (!Array.isArray(projects)) projects = [];
  if (!projects.length && ( $("title").value || $("manuscript").value || $("chapterTitle").value )) {
    projects = [{
      id: crypto.randomUUID(),
      title: $("title").value || "นิยายที่นำเข้าจากอุปกรณ์",
      genre: $("genre").value || "",
      context: $("context").value || ""
    }];
  }
  return projects;
}

// ==========================================
// BACKUP CENTER
// ==========================================

function addBackupPanel() {
  const content = document.querySelector("#backupContent");

  if (!content) return;

  content.insertAdjacentHTML("afterbegin", `
    <div class="card" id="backupPanel">
      <h3>🛡️ STORYFORGE Backup Center</h3>

      <p class="hint">
        สำรองและกู้คืนข้อมูลโครงการของคุณ
      </p>

      <label>Backup Secret สำหรับ Telegram</label>

      <input
        id="backupSecret"
        type="password"
        autocomplete="off"
        placeholder="กรอกรหัส Backup Secret"
      >

      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">

        <button id="telegramBackup" class="primary" style="width:auto">
          ส่ง Backup ไป Telegram
        </button>

        <button id="downloadBackup" class="secondary">
          ดาวน์โหลด Backup
        </button>

      </div>

      <hr style="border-color:#34415f;margin:20px 0">

      <label>
        <input
          id="autoBackup"
          type="checkbox"
          style="width:auto"
        >
        เปิด Backup อัตโนมัติ (ขณะเปิดหน้าเว็บนี้)
      </label>

      <label>ความถี่ในการสำรองข้อมูล</label>

      <select id="backupInterval">
        <option value="6">ทุก 6 ชั่วโมง</option>
        <option value="12">ทุก 12 ชั่วโมง</option>
        <option value="24">ทุก 24 ชั่วโมง</option>
      </select>

      <p id="backupStatus" class="hint">
        ระบบสำรองข้อมูลยังไม่ได้เริ่มทำงาน
      </p>

      <hr style="border-color:#34415f;margin:20px 0">

      <label>กู้คืนข้อมูลจากไฟล์ Backup</label>

      <input
        id="restoreFile"
        type="file"
        accept=".json,application/json"
      >

      <button id="restoreBackup" class="secondary">
        กู้คืนข้อมูล
      </button>

      <p class="hint">
        ก่อนกู้คืน ระบบจะดาวน์โหลดข้อมูลปัจจุบัน
        เก็บไว้เป็นไฟล์สำรองอีกชุดหนึ่ง
      </p>
    </div>
  `);
}

// ==========================================
// JSON AND BACKUP FUNCTIONS
// ==========================================

function safeJSON(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function collectBackup() {
  const data = {};

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);

    if (key && key.startsWith("sf_")) {
      data[key] = localStorage.getItem(key);
    }
  }

  return {
    app: "STORYFORGE",
    version: 1,
    createdAt: new Date().toISOString(),
    data
  };
}

function makeBackupFile() {
  return JSON.stringify(collectBackup(), null, 2);
}

// ==========================================
// DOWNLOAD FUNCTIONS
// ==========================================

function download(name, text) {
  const isJSON = name.toLowerCase().endsWith(".json");

  const blob = new Blob([text], {
    type: isJSON
      ? "application/json;charset=utf-8"
      : "text/plain;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = name;

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCurrentBackup() {
  const date = new Date().toISOString().replace(/[:.]/g, "-");

  download(
    `STORYFORGE-backup-${date}.json`,
    makeBackupFile()
  );
}

// ==========================================
// TELEGRAM BACKUP
// ==========================================

async function sendTelegramBackup(isAutomatic = false) {
  if (backupBusy) return false;

  const secret = $("backupSecret").value.trim();

  if (!secret) {
    $("backupStatus").textContent =
      "ยังไม่ได้กรอกรหัส Backup Secret";

    if (!isAutomatic) {
      alert("กรุณากรอก Backup Secret ก่อนครับ");
    }

    return false;
  }

  backupBusy = true;

  $("telegramBackup").disabled = true;

  $("backupStatus").textContent =
    isAutomatic
      ? "กำลังสำรองข้อมูลอัตโนมัติ..."
      : "กำลังส่งไฟล์สำรองไป Telegram...";

  try {
    const response = await fetch("/api/telegram-backup", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
        "x-backup-secret": secret
      },

      body: JSON.stringify({
        filename: "STORYFORGE-backup.json",
        content: makeBackupFile()
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(
        result.error || "สำรองข้อมูลไม่สำเร็จ"
      );
    }

    const time = new Date().toLocaleString("th-TH");

    $("backupStatus").textContent =
      `สำรองข้อมูลสำเร็จล่าสุด: ${time}`;

    if (!isAutomatic) {
      alert("สำรองข้อมูลไปยัง Telegram สำเร็จแล้วครับ");
    }

    return true;

  } catch (error) {

    $("backupStatus").textContent =
      "สำรองข้อมูลไม่สำเร็จ: " + error.message;

    if (!isAutomatic) {
      alert("เกิดข้อผิดพลาด: " + error.message);
    }

    return false;

  } finally {

    backupBusy = false;
    $("telegramBackup").disabled = false;
  }
}

// ==========================================
// AUTOMATIC BACKUP
// ==========================================

function setupAutoBackup() {

  $("autoBackup").addEventListener("change", () => {

    if ($("autoBackup").checked) {

      if (!$("backupSecret").value.trim()) {

        $("autoBackup").checked = false;

        alert(
          "กรุณากรอก Backup Secret ก่อนเปิดระบบอัตโนมัติ"
        );

        return;
      }

      const hours = Number($("backupInterval").value);

      nextAutoBackupAt =
        Date.now() + hours * 60 * 60 * 1000;

      $("backupStatus").textContent =
        `เปิด Backup อัตโนมัติแล้ว จะสำรองครั้งถัดไปใน ${hours} ชั่วโมง`;

    } else {

      nextAutoBackupAt = null;

      $("backupStatus").textContent =
        "ปิด Backup อัตโนมัติแล้ว";
    }
  });

  $("backupInterval").addEventListener("change", () => {

    if ($("autoBackup").checked) {

      const hours = Number($("backupInterval").value);

      nextAutoBackupAt =
        Date.now() + hours * 60 * 60 * 1000;

      $("backupStatus").textContent =
        `ปรับเวลา Backup เป็นทุก ${hours} ชั่วโมงแล้ว`;
    }
  });

  autoBackupTimer = setInterval(async () => {

    if (
      !$("autoBackup").checked ||
      !nextAutoBackupAt ||
      Date.now() < nextAutoBackupAt ||
      backupBusy
    ) {
      return;
    }

    const hours = Number($("backupInterval").value);

    await sendTelegramBackup(true);

    nextAutoBackupAt =
      Date.now() + hours * 60 * 60 * 1000;

  }, 60 * 1000);
}

// ==========================================
// RESTORE BACKUP
// ==========================================

function restoreFromFile() {

  const file = $("restoreFile").files[0];

  if (!file) {
    alert("กรุณาเลือกไฟล์ Backup ก่อนครับ");
    return;
  }

  if (file.size > 40 * 1024 * 1024) {
    alert("ไฟล์ Backup มีขนาดใหญ่เกินกำหนด 40 MB");
    return;
  }

  const reader = new FileReader();

  reader.onload = () => {

    try {

      const backup = JSON.parse(reader.result);

      if (
        backup.app !== "STORYFORGE" ||
        backup.version !== 1 ||
        !backup.data ||
        typeof backup.data !== "object" ||
        Array.isArray(backup.data)
      ) {
        throw new Error(
          "ไฟล์นี้ไม่ใช่ Backup ของ STORYFORGE"
        );
      }

      const entries = Object.entries(backup.data);

      if (
        entries.length === 0 ||
        entries.some(([key, value]) =>
          !key.startsWith("sf_") ||
          typeof value !== "string"
        )
      ) {
        throw new Error(
          "ข้อมูลในไฟล์ Backup ไม่ถูกต้อง"
        );
      }

      const confirmed = confirm(
        "ระบบจะดาวน์โหลดข้อมูลปัจจุบันเก็บไว้ก่อน " +
        "จากนั้นจะแทนที่ข้อมูล STORYFORGE ปัจจุบันด้วยข้อมูลในไฟล์นี้\n\n" +
        "ต้องการดำเนินการต่อหรือไม่?"
      );

      if (!confirmed) return;

      // เก็บข้อมูลปัจจุบันไว้สำหรับย้อนกลับ
      const previousData = {};

      for (let i = 0; i < localStorage.length; i++) {

        const key = localStorage.key(i);

        if (key && key.startsWith("sf_")) {
          previousData[key] = localStorage.getItem(key);
        }
      }

      downloadCurrentBackup();

      try {

        // ลบข้อมูล STORYFORGE ชุดเดิม
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith("sf_")) {
            localStorage.removeItem(key);
          }
        }

        // นำข้อมูลจาก Backup กลับมา
        for (const [key, value] of entries) {
          localStorage.setItem(key, value);
        }

      } catch (error) {

        // หากเกิดข้อผิดพลาด พยายามคืนข้อมูลเดิม
        try {

          for (const key of Object.keys(localStorage)) {
            if (key.startsWith("sf_")) {
              localStorage.removeItem(key);
            }
          }

          for (const [key, value] of Object.entries(previousData)) {
            localStorage.setItem(key, value);
          }

        } catch (rollbackError) {
          console.error("Restore rollback failed:", rollbackError);
        }

        throw error;
      }

      alert(
        "กู้คืนข้อมูลสำเร็จแล้วครับ เว็บไซต์จะโหลดใหม่"
      );

      location.reload();

    } catch (error) {

      alert(
        "ไม่สามารถกู้คืนข้อมูลได้: " + error.message
      );
    }
  };

  reader.onerror = () => {
    alert("อ่านไฟล์ Backup ไม่สำเร็จ");
  };

  reader.readAsText(file);
}

// ==========================================
// PROJECT LOADING AND SAVING
// ==========================================

function load() {

  keys.forEach(key => {

    const value = localStorage.getItem("sf_" + key);

    if (value !== null && $(key)) {
      $(key).value = value;
    }
  });

  renderProjects();
  renderDashboard();
}

function save() {
  keys.forEach(key => localStorage.setItem("sf_" + key, $(key).value));
  $("saveState").innerHTML = '<span class="status-dot"></span>บันทึกฉบับกู้คืนในอุปกรณ์นี้แล้ว';
  renderDashboard();
  const count = $("manuscript").value.length;
  if ($("manuscriptCount")) $("manuscriptCount").textContent = count.toLocaleString("th-TH") + " อักขระ";
  if (cloud.authenticated && cloud.activeProjectId && cloud.activeChapterId) scheduleCloudSave();
}

// ==========================================
// PROJECT NAVIGATION
// ==========================================

function renderDashboard() {
  const projects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
  const list = Array.isArray(projects) ? projects : [];
  const activeId = localStorage.getItem("sf_active_project_id");
  const active = cloud.authenticated
    ? cloud.projects.find(item => item.id === cloud.activeProjectId) || null
    : list.find(item => item.id && item.id === activeId) || list[0] || null;
  const title = active && active.title ? active.title : $("title").value;
  const chapter = $("chapterTitle").value;
  const manuscript = $("manuscript").value;
  const count = manuscript.length;
  if ($("sidebarProjectName")) $("sidebarProjectName").textContent = title || "ยังไม่ได้เลือกนิยาย";
  if ($("sidebarProjectMeta")) $("sidebarProjectMeta").textContent = active ? (active.genre || "นิยายของฉัน") + (cloud.authenticated ? " · Private Beta Cloud" : " · บันทึกในอุปกรณ์นี้") : "เริ่มต้นสร้างเรื่องราวของคุณ";
  if ($("dashboardProjectTitle")) $("dashboardProjectTitle").textContent = title || "ยังไม่มีนิยายในห้องสมุด";
  if ($("dashboardChapterLine")) $("dashboardChapterLine").textContent = chapter ? "บทล่าสุด · " + chapter : (title ? "เพิ่มชื่อบทและเริ่มเขียนต้นฉบับของคุณ" : "เริ่มต้นสร้างโลกและตัวละครของคุณได้เลย");
  if ($("dashboardLastEdited")) $("dashboardLastEdited").textContent = active ? (cloud.authenticated ? "โครงการนี้เชื่อมต่อกับบัญชี Private Beta" : "โครงการนี้บันทึกไว้ในเบราว์เซอร์เครื่องนี้") : "พื้นที่เขียนนิยายส่วนตัว · บันทึกในอุปกรณ์นี้";
  if ($("dashboardWordCount")) $("dashboardWordCount").textContent = count.toLocaleString("th-TH");
  if ($("dashboardWordGoal")) $("dashboardWordGoal").textContent = "อักขระในต้นฉบับ";
  if ($("dashboardProgress")) $("dashboardProgress").style.width = "0%";
  if ($("recentChapterTitle")) $("recentChapterTitle").textContent = chapter || "ยังไม่มีบทที่บันทึก";
  if ($("recentWordCount")) $("recentWordCount").textContent = count.toLocaleString("th-TH") + " อักขระ";
  if ($("manuscriptCount")) $("manuscriptCount").textContent = count.toLocaleString("th-TH") + " อักขระ";
}

function renderProjects() {
  const list = $("projectList");
  if (!list) return;
  if (cloud.authenticated) {
    $("projectListCaption").textContent = "โครงการที่จัดเก็บในบัญชี Private Beta";
    list.innerHTML = cloud.projects.length
      ? cloud.projects.map(item =>
          `<button type="button" class="project-pick ${item.id === cloud.activeProjectId ? "active" : ""}" data-cloud-project="${escapeHtml(item.id)}"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.genre || "ไม่ระบุแนว")} · ${item.status === "archived" ? "เก็บเข้าคลัง" : "กำลังเขียน"}</small></button>`
        ).join("")
      : '<p class="muted-note">ยังไม่มีโครงการบน Cloud · สร้างนิยายใหม่หรือย้ายข้อมูลจากอุปกรณ์นี้</p>';
    list.querySelectorAll("[data-cloud-project]").forEach(button => {
      button.addEventListener("click", () => selectCloudProject(button.dataset.cloudProject));
    });
    const panel = $("cloudMigrationPanel");
    if (panel) panel.hidden = !hasLocalNovelData() || Boolean(localStorage.getItem(localMigrationKey()));
    if ($("projectSaveHint")) $("projectSaveHint").textContent = "บันทึกโครงการไปยังบัญชี Private Beta และเก็บฉบับกู้คืนไว้ในอุปกรณ์นี้";
    return;
  }

  $("projectListCaption").textContent = "รายการที่บันทึกไว้ในเบราว์เซอร์นี้";
  const projects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
  const validProjects = Array.isArray(projects) ? projects : [];
  list.innerHTML = validProjects.length
    ? validProjects.map(item =>
        `<p><b>${escapeHtml(item.title)}</b> <small>— ${escapeHtml(item.genre)}</small></p>`
      ).join("")
    : "ยังไม่มีโครงการที่บันทึกไว้";
  if ($("cloudMigrationPanel")) $("cloudMigrationPanel").hidden = true;
}

function escapeHtml(value) {

  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// ==========================================
// EVENT LISTENERS
// ==========================================

function showTab(tab, activeButton = null) {
  const target = $(tab);
  if (!target) return;
  document.querySelectorAll(".nav").forEach(item => item.classList.toggle("active", item === activeButton || item.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach(panel => panel.classList.toggle("hidden", panel.id !== tab));
  const nav = document.querySelector('.nav[data-tab="' + tab + '"]');
  if (nav) nav.classList.add("active");
  const label = nav && nav.querySelector("span:last-child") ? nav.querySelector("span:last-child").textContent : (target.querySelector("h1") ? target.querySelector("h1").textContent : "พื้นที่ทำงาน");
  if ($("breadcrumbTitle")) $("breadcrumbTitle").textContent = label;
  if (tab === "projects") renderProjects();
  if (tab === "dashboard") renderDashboard();
}

function setupEvents() {

  // Auto save
  keys.forEach(key => {
    $(key).addEventListener("input", save);
  });

  // Navigation
  document.querySelectorAll(".nav").forEach(button => {

    button.onclick = () => {

      showTab(button.dataset.tab, button);
    };
  });

  document.querySelectorAll("[data-open-tab]").forEach(button => {
    button.addEventListener("click", () => showTab(button.dataset.openTab));
  });
  document.querySelector("[data-home]")?.addEventListener("click", event => {
    event.preventDefault();
    showTab("dashboard");
  });

  // AI modes
  document.querySelectorAll(".mode").forEach(button => {

    button.onclick = () => {

      document.querySelectorAll(".mode").forEach(item =>
        item.classList.remove("active")
      );

      button.classList.add("active");

      mode = button.dataset.mode;
    };
  });

  // Save project
  $("saveProject").onclick = async () => {
    save();
    let projects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
    if (!Array.isArray(projects)) projects = [];
    const activeLocalId = localStorage.getItem("sf_active_project_id");
    const existing = projects.find(x => x.id === activeLocalId) ||
      projects.find(x => x.title === ($("title").value || "โครงการไม่มีชื่อ"));
    const item = {
      id: existing?.id || crypto.randomUUID(),
      title: $("title").value || "โครงการไม่มีชื่อ",
      genre: $("genre").value,
      context: $("context").value
    };
    projects = projects.filter(x => x.id !== item.id);
    projects.unshift(item);
    localStorage.setItem("sf_active_project_id", item.id);
    localStorage.setItem("sf_projects", JSON.stringify(projects));

    if (cloud.authenticated) {
      try {
        let saved;
        if (cloud.projects.some(project => project.id === cloud.activeProjectId)) {
          saved = await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId), {
            method: "PATCH",
            body: JSON.stringify({ title: item.title, genre: item.genre, synopsis: item.context })
          });
        } else {
          saved = await cloudApi("/api/projects", {
            method: "POST",
            body: JSON.stringify({ title: item.title, genre: item.genre, synopsis: item.context })
          });
        }
        const project = saved.project;
        cloud.activeProjectId = project.id;
        cloud.projects = [project, ...cloud.projects.filter(x => x.id !== project.id)];
        await loadCloudProject(project.id);
        $("saveState").innerHTML = '<span class="status-dot"></span>บันทึกโครงการบน Cloud แล้ว';
        alert("บันทึกโครงการไปยังบัญชี Private Beta แล้วครับ");
      } catch (error) {
        $("saveState").textContent = "บันทึก Cloud ไม่สำเร็จ · ฉบับในเครื่องยังอยู่";
        alert("บันทึกขึ้น Cloud ไม่สำเร็จ: " + error.message + "\nข้อมูลฉบับในเครื่องยังคงอยู่ครับ");
      }
    } else {
      renderProjects();
      renderDashboard();
      alert("บันทึกข้อมูลนิยายไว้ในอุปกรณ์นี้แล้วครับ");
    }
  };

  // Save memory
  $("saveMemory").onclick = async () => {
    save();
    if (cloud.authenticated && cloud.activeProjectId) {
      try {
        const payload = {
          title: "ความจำโครงการ",
          content: $("projectMemory").value,
          note_type: "project_memory"
        };
        if (cloud.noteId) {
          await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId) + "/notes/" + encodeURIComponent(cloud.noteId), {
            method: "PATCH",
            body: JSON.stringify(payload)
          });
        } else {
          const created = await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId) + "/notes", {
            method: "POST",
            body: JSON.stringify(payload)
          });
          cloud.noteId = created.item.id;
        }
        alert("บันทึกความจำโครงการบน Cloud แล้วครับ (ความจำส่วนตัวยังคงอยู่ในอุปกรณ์นี้)");
      } catch (error) {
        alert("บันทึกความจำบน Cloud ไม่สำเร็จ: " + error.message + "\nฉบับในเครื่องยังคงอยู่ครับ");
      }
    } else {
      alert("บันทึกความจำไว้ในอุปกรณ์นี้แล้วครับ");
    }
  };

  // AI Writer — deliberately disabled until per-user Copilot OAuth is implemented.
  $("run").disabled = true;
  $("run").title = "Copilot integration is not enabled in this private beta build";
  $("output").textContent =
    "Copilot ยังไม่เปิดใช้งานในรุ่นทดสอบส่วนตัวนี้\n\n" +
    "ระบบจะไม่เรียก OpenAI API หรือบริการ AI แบบคิดเงินแทนโดยอัตโนมัติ " +
    "จนกว่าจะติดตั้ง GitHub OAuth, Copilot SDK และการแยกสิทธิ์ผู้ใช้ครบถ้วน";

  // Copy AI output
  $("copy").onclick = () => {

    navigator.clipboard.writeText(
      $("output").textContent
    )
    .then(() => alert("คัดลอกแล้ว"))
    .catch(() => alert("ไม่สามารถคัดลอกได้"));
  };

  // Download AI output
  $("download").onclick = () => {

    download(
      "storyforge-ai-output.txt",
      $("output").textContent
    );
  };

  // Export manuscript
  $("export").onclick = () => {

    download(
      ($("chapterTitle").value || "manuscript") + ".txt",
      $("manuscript").value
    );
  };
}

// ==========================================
// BACKUP EVENT LISTENERS
// ==========================================

function setupBackupEvents() {

  $("telegramBackup").onclick = () => {
    sendTelegramBackup(false);
  };

  $("downloadBackup").onclick = () => {

    downloadCurrentBackup();

    $("backupStatus").textContent =
      "ดาวน์โหลดไฟล์ Backup ลงอุปกรณ์แล้ว";
  };

  $("restoreBackup").onclick = restoreFromFile;

  setupAutoBackup();
}

// ==========================================
// PRIVATE BETA ACCOUNT STATUS
// ==========================================

async function loadCloudProjects() {
  const result = await cloudApi("/api/projects");
  cloud.projects = result.projects || [];
  if (!cloud.projects.some(item => item.id === cloud.activeProjectId)) {
    cloud.activeProjectId = cloud.projects[0]?.id || "";
  }
  renderProjects();
  if (cloud.activeProjectId) await loadCloudProject(cloud.activeProjectId);
  else {
    cloud.chapters = [];
    cloud.activeChapterId = "";
    if ($("chapterSelect")) $("chapterSelect").innerHTML = '<option value="">ยังไม่มีบท</option>';
    if ($("chapterSaveHint")) $("chapterSaveHint").textContent = "เลือกหรือสร้างโครงการก่อน จึงจะบันทึกบทบน Cloud ได้";
  }
}

async function selectCloudProject(projectId) {
  if (!projectId || projectId === cloud.activeProjectId) return;
  if (cloud.saveTimer) {
    clearTimeout(cloud.saveTimer);
    cloud.saveTimer = null;
    await saveCloudChapter();
  }
  cloud.activeChapterId = "";
  cloud.revision = 0;
  try {
    await loadCloudProject(projectId);
  } catch (error) {
    alert("เปิดโครงการไม่สำเร็จ: " + error.message);
  }
}

async function loadCloudProject(projectId) {
  const result = await cloudApi("/api/projects/" + encodeURIComponent(projectId));
  const project = result.project;
  cloud.activeProjectId = project.id;
  $("title").value = project.title || "";
  $("genre").value = project.genre || $("genre").options[0]?.value || "";
  $("context").value = project.synopsis || "";
  localStorage.setItem("sf_active_project_id", project.id);
  const [chapterResult, noteResult] = await Promise.all([
    cloudApi("/api/projects/" + encodeURIComponent(projectId) + "/chapters"),
    cloudApi("/api/projects/" + encodeURIComponent(projectId) + "/notes")
  ]);
  cloud.chapters = chapterResult.chapters || [];
  const memoryNote = (noteResult.items || []).find(note => note.note_type === "project_memory");
  cloud.noteId = memoryNote?.id || "";
  if ($("projectMemory")) $("projectMemory").value = memoryNote?.content || localStorage.getItem("sf_projectMemory") || "";
  renderChapterSelect();
  const preferred = cloud.chapters.find(item => item.id === cloud.activeChapterId) || cloud.chapters[0];
  if (preferred) await selectCloudChapter(preferred.id);
  else {
    cloud.activeChapterId = "";
    cloud.revision = 0;
    $("chapterTitle").value = "";
    $("manuscript").value = "";
    if ($("chapterSaveHint")) $("chapterSaveHint").textContent = "โครงการนี้ยังไม่มีบท · กด “เพิ่มบท” เพื่อเริ่มเขียน";
    renderDashboard();
  }
  renderProjects();
  renderDashboard();
}

function renderChapterSelect() {
  const select = $("chapterSelect");
  if (!select) return;
  select.innerHTML = cloud.chapters.length
    ? cloud.chapters.map((item, index) =>
        `<option value="${escapeHtml(item.id)}" ${item.id === cloud.activeChapterId ? "selected" : ""}>${index + 1}. ${escapeHtml(item.title || "บทไม่มีชื่อ")}</option>`
      ).join("")
    : '<option value="">ยังไม่มีบท</option>';
}

async function selectCloudChapter(chapterId) {
  const item = cloud.chapters.find(chapter => chapter.id === chapterId);
  if (!item) return;
  cloud.activeChapterId = item.id;
  cloud.revision = item.revision || 1;
  $("chapterTitle").value = item.title || "";
  $("manuscript").value = item.body || "";
  renderChapterSelect();
  if ($("chapterSaveHint")) $("chapterSaveHint").textContent =
    "บันทึกบทบน Cloud · Revision " + cloud.revision + " · มีฉบับกู้คืนในอุปกรณ์นี้";
  $("saveState").innerHTML = '<span class="status-dot"></span>โหลดบทจาก Cloud แล้ว';
  renderDashboard();
}

function scheduleCloudSave() {
  if (!cloud.authenticated || !cloud.activeProjectId || !cloud.activeChapterId) return;
  clearTimeout(cloud.saveTimer);
  $("saveState").innerHTML = '<span class="status-dot"></span>มีการแก้ไข · กำลังรอบันทึก Cloud';
  cloud.saveTimer = setTimeout(saveCloudChapter, 900);
}

async function saveCloudChapter() {
  if (cloud.saving || !cloud.activeChapterId) return;
  cloud.saving = true;
  const chapterId = cloud.activeChapterId;
  const expectedRevision = cloud.revision;
  const draft = { title: $("chapterTitle").value, body: $("manuscript").value };
  try {
    const result = await cloudApi("/api/chapters/" + encodeURIComponent(chapterId), {
      method: "PATCH",
      body: JSON.stringify({ ...draft, expectedRevision })
    });
    if (cloud.activeChapterId !== chapterId) return;
    cloud.revision = result.chapter.revision;
    cloud.chapters = cloud.chapters.map(item => item.id === chapterId ? result.chapter : item);
    renderChapterSelect();
    $("saveState").innerHTML = '<span class="status-dot"></span>บันทึกต้นฉบับบน Cloud แล้ว';
    if ($("chapterSaveHint")) $("chapterSaveHint").textContent =
      "บันทึกบน Cloud แล้ว · Revision " + cloud.revision + " · ฉบับกู้คืนในอุปกรณ์ยังคงอยู่";
  } catch (error) {
    if (error.status === 409) {
      $("saveState").textContent = "พบฉบับใหม่กว่าใน Cloud · ฉบับนี้ยังเก็บไว้ในอุปกรณ์";
      if ($("chapterSaveHint")) $("chapterSaveHint").textContent =
        "มีการแก้ไขจากอีกหน้าต่างหรืออุปกรณ์ กรุณาโหลดฉบับล่าสุดก่อนบันทึกทับ";
    } else {
      $("saveState").textContent = "บันทึก Cloud ไม่สำเร็จ · ฉบับในเครื่องยังอยู่";
    }
    console.error("Cloud chapter save failed:", error);
  } finally {
    cloud.saving = false;
    if (cloud.activeChapterId === chapterId &&
        ( $("chapterTitle").value !== draft.title || $("manuscript").value !== draft.body )) {
      scheduleCloudSave();
    }
  }
}

async function createCloudChapter() {
  if (!cloud.authenticated || !cloud.activeProjectId) {
    alert("กรุณาเข้าสู่ระบบและเลือกโครงการก่อนครับ");
    return;
  }
  try {
    const result = await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId) + "/chapters", {
      method: "POST",
      body: JSON.stringify({
        title: "บทใหม่",
        body: "",
        sortOrder: cloud.chapters.length
      })
    });
    cloud.chapters.push(result.chapter);
    await selectCloudChapter(result.chapter.id);
    $("chapterTitle").focus();
  } catch (error) {
    alert("สร้างบทไม่สำเร็จ: " + error.message);
  }
}

async function showChapterHistory() {
  const panel = $("chapterHistory");
  if (!cloud.authenticated || !cloud.activeChapterId) {
    panel.hidden = false;
    panel.textContent = "ประวัติเวอร์ชันจะแสดงเมื่อเลือกบทที่บันทึกบน Cloud";
    return;
  }
  try {
    const result = await cloudApi("/api/chapters/" + encodeURIComponent(cloud.activeChapterId) + "/snapshots");
    const snapshots = result.snapshots || [];
    panel.hidden = false;
    panel.innerHTML = snapshots.length
      ? "<strong>ประวัติฉบับก่อนหน้า</strong>" + snapshots.map(item => {
          let title = "ฉบับก่อนหน้า";
          try { title = JSON.parse(item.content_json).title || title; } catch {}
          return `<div class="history-row"><span>${escapeHtml(title)} · ${escapeHtml(new Date(item.created_at).toLocaleString("th-TH"))}</span><button type="button" class="outline-button compact" data-restore-snapshot="${escapeHtml(item.id)}">กู้คืน</button></div>`;
        }).join("")
      : "<strong>ประวัติเวอร์ชัน</strong><p>ยังไม่มี Snapshot ก่อนหน้า</p>";
    panel.querySelectorAll("[data-restore-snapshot]").forEach(button => {
      button.addEventListener("click", async () => {
        if (!confirm("ต้องการกู้คืนฉบับนี้หรือไม่? ระบบจะเก็บฉบับปัจจุบันเป็น Snapshot ก่อน")) return;
        try {
          const restored = await cloudApi("/api/chapters/" + encodeURIComponent(cloud.activeChapterId) + "/restore", {
            method: "POST",
            body: JSON.stringify({ snapshotId: button.dataset.restoreSnapshot })
          });
          cloud.revision = restored.chapter.revision;
          cloud.chapters = cloud.chapters.map(item => item.id === restored.chapter.id ? restored.chapter : item);
          await selectCloudChapter(restored.chapter.id);
          await showChapterHistory();
          $("saveState").innerHTML = '<span class="status-dot"></span>กู้คืนเวอร์ชันจาก Cloud แล้ว';
        } catch (error) { alert("กู้คืนไม่สำเร็จ: " + error.message); }
      });
    });
  } catch (error) {
    panel.hidden = false;
    panel.textContent = "โหลดประวัติเวอร์ชันไม่สำเร็จ: " + error.message;
  }
}

async function importLocalNovelData() {
  if (!cloud.authenticated) return;
  const localProjects = localProjectsForImport();
  if (!localProjects.length) {
    alert("ไม่พบข้อมูลนิยายในอุปกรณ์นี้ครับ");
    return;
  }
  if (!confirm("นำเข้า " + localProjects.length + " โครงการไปยังบัญชี Private Beta? ข้อมูลเดิมในอุปกรณ์จะไม่ถูกลบ และการนำเข้าซ้ำจะใช้รหัสเดิมเพื่อลดโอกาสสร้างรายการซ้ำ")) return;
  const button = $("importLocalData");
  button.disabled = true;
  const map = safeJSON(localStorage.getItem(migrationMapKey()) || "{}", {});
  const activeLocalId = localStorage.getItem("sf_active_project_id") || localProjects[0].id || "";
  try {
    for (const localProject of localProjects) {
      const localId = UUID_RE.test(localProject.id || "") ? localProject.id : crypto.randomUUID();
      if (!localProject.id || localProject.id !== localId) localProject.id = localId;
      localStorage.setItem("sf_projects", JSON.stringify(localProjects));
      map[localId] = map[localId] || { projectId: crypto.randomUUID(), chapterId: crypto.randomUUID() };
      localStorage.setItem(migrationMapKey(), JSON.stringify(map));
      const projectResult = await cloudApi("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          clientId: map[localId].projectId,
          title: localProject.title || "นิยายที่นำเข้า",
          genre: localProject.genre || "",
          synopsis: localProject.context || ""
        })
      });
      map[localId].projectId = projectResult.project.id;
      if (localId === activeLocalId && ($("chapterTitle").value || $("manuscript").value)) {
        await cloudApi("/api/projects/" + encodeURIComponent(projectResult.project.id) + "/chapters", {
          method: "POST",
          body: JSON.stringify({
            clientId: map[localId].chapterId,
            title: $("chapterTitle").value || "ต้นฉบับที่นำเข้า",
            body: $("manuscript").value || "",
            sortOrder: 0
          })
        });
      }
      localStorage.setItem(migrationMapKey(), JSON.stringify(map));
      $("migrationStatus").textContent = "นำเข้าแล้ว: " + (localProject.title || "นิยายที่นำเข้า");
    }
    localStorage.setItem(localMigrationKey(), new Date().toISOString());
    cloud.activeProjectId = map[activeLocalId]?.projectId || "";
    await loadCloudProjects();
    if ($("migrationStatus")) $("migrationStatus").textContent = "นำเข้าข้อมูลแล้ว · ข้อมูลต้นฉบับในอุปกรณ์ยังไม่ถูกลบ";
    renderProjects();
    alert("นำเข้าข้อมูลนิยายสำเร็จแล้วครับ ข้อมูลเดิมในเครื่องยังคงอยู่");
  } catch (error) {
    $("migrationStatus").textContent = "นำเข้าได้บางส่วน · กดนำเข้าอีกครั้งเพื่อดำเนินการต่อ: " + error.message;
    alert("การนำเข้าหยุดก่อนเสร็จ: " + error.message + "\nข้อมูลในเครื่องยังไม่ถูกลบ และสามารถลองนำเข้าอีกครั้งได้ครับ");
  } finally {
    button.disabled = false;
  }
}

async function refreshAuthStatus() {
  const state = $("authState");
  const login = $("loginButton");
  const logout = $("logoutButton");
  if (!state || !login || !logout) return;

  const callbackState = new URLSearchParams(location.search).get("auth");
  if (callbackState === "not-allowed") state.textContent = "บัญชี GitHub นี้ไม่ได้รับอนุญาตให้เข้า Private Beta";
  else if (callbackState === "failed") state.textContent = "เข้าสู่ระบบไม่สำเร็จ";
  else if (callbackState === "success") state.textContent = "เข้าสู่ระบบสำเร็จ กำลังตรวจสอบ…";

  try {
    const response = await fetch("/api/session", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 503) {
      state.textContent = "ระบบบัญชียังไม่พร้อม · ต้องตั้งค่า D1 และ GitHub OAuth";
      login.hidden = true;
      logout.hidden = true;
      return;
    }
    if (!response.ok) throw new Error("ตรวจสอบบัญชีไม่สำเร็จ");
    const result = await response.json();
    if (result.authenticated) {
      cloud.authenticated = true;
      cloud.csrfToken = result.csrfToken;
      cloud.userId = result.userId || result.user.githubLogin;
      state.textContent = "GitHub: " + result.user.githubLogin + " · Private Beta";
      login.hidden = true;
      logout.hidden = false;
      logout.dataset.csrf = result.csrfToken;
      await loadCloudProjects();
    } else {
      cloud.authenticated = false;
      cloud.csrfToken = "";
      cloud.userId = "";
      cloud.projects = [];
      cloud.activeProjectId = "";
      cloud.chapters = [];
      cloud.activeChapterId = "";
      state.textContent = "ยังไม่ได้เข้าสู่ระบบ · ข้อมูลนิยายยังอยู่ในอุปกรณ์นี้";
      login.hidden = false;
      logout.hidden = true;
      renderProjects();
    }
    if (callbackState) history.replaceState(null, "", location.pathname);
  } catch (error) {
    state.textContent = "ตรวจสอบสถานะบัญชีไม่ได้ · " + error.message;
    login.hidden = true;
    logout.hidden = true;
  }
}

function setupCloudEvents() {
  $("importLocalData")?.addEventListener("click", importLocalNovelData);
  $("newChapter")?.addEventListener("click", createCloudChapter);
  $("chapterSelect")?.addEventListener("change", event => selectCloudChapter(event.target.value));
  $("chapterHistoryButton")?.addEventListener("click", showChapterHistory);
}

function setupAuthEvents() {
  $("loginButton")?.addEventListener("click", () => {
    location.href = "/auth/login";
  });
  $("logoutButton")?.addEventListener("click", async () => {
    const button = $("logoutButton");
    button.disabled = true;
    try {
      const response = await fetch("/api/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": button.dataset.csrf || "" }
      });
      if (!response.ok) throw new Error("ออกจากระบบไม่สำเร็จ");
      await refreshAuthStatus();
    } catch (error) {
      alert(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

// ==========================================
// START STORYFORGE
// ==========================================

function init() {

  addBackupPanel();

  load();

  setupEvents();

  setupBackupEvents();

  setupAuthEvents();
  setupCloudEvents();
  refreshAuthStatus();

  console.log("STORYFORGE initialized successfully");
}

init();
