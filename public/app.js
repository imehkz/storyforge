
const $ = id => document.getElementById(id);

let mode = "writer";
let creatingProject = false;
let backupBusy = false;
let nextAutoBackupAt = null;
let autoBackupTimer = null;

const keys = [
  "title",
  "genre",
  "context",
  "chapterTitle",
  "manuscriptBody",
  "projectMemory",
  "globalMemory"
];

const cloud = {
  authenticated: false,
  ready: false,
  csrfToken: "",
  userId: "",
  projects: [],
  activeProjectId: "",
  chapters: [],
  activeChapterId: "",
  revision: 0,
  saveTimer: null,
  saving: false,
  savePromise: null,
  noteId: "",
  modules: { characters: [], relationships: [], "plot-threads": [], "world-lore": [], timeline: [], notes: [] },
  editingCharacterId: ""
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const storageKeyFor = key => key === "manuscriptBody" ? "sf_manuscript" : "sf_" + key;
const localMigrationKey = () => "sf_cloud_migrated_" + (cloud.userId || "owner");
const migrationMapKey = () => "sf_cloud_migration_map_" + (cloud.userId || "owner");
const localChapterDraftKey = chapterId => "sf_cloud_draft_" + chapterId;

function storeLocalChapterDraft(chapterId, draft, revision = 0) {
  if (!chapterId) return;
  localStorage.setItem(localChapterDraftKey(chapterId), JSON.stringify({
    ...draft, revision, updatedAt: new Date().toISOString()
  }));
}

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
  const importableKeys = ["title", "genre", "context", "chapterTitle", "manuscriptBody", "projectMemory"];
  return (Array.isArray(projects) && projects.length > 0) ||
    importableKeys.some(key => Boolean(localStorage.getItem(storageKeyFor(key))));
}

function localProjectsForImport() {
  let projects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
  if (!Array.isArray(projects)) projects = [];
  const localTitle = localStorage.getItem("sf_title") || "";
  const localManuscript = localStorage.getItem("sf_manuscript") || "";
  const localChapterTitle = localStorage.getItem("sf_chapterTitle") || "";
  if (!projects.length && (localTitle || localManuscript || localChapterTitle || localStorage.getItem("sf_projectMemory"))) {
    projects = [{
      id: crypto.randomUUID(),
      title: localTitle || "นิยายที่นำเข้าจากอุปกรณ์",
      genre: localStorage.getItem("sf_genre") || "",
      context: localStorage.getItem("sf_context") || ""
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

    const value = localStorage.getItem(storageKeyFor(key));

    if (value !== null && $(key)) {
      $(key).value = value;
    }
  });

  renderProjects();
  renderDashboard();
}

function countWords(text) {
  const value = String(text || "");
  if (!value.trim()) return 0;
  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    return Array.from(new Intl.Segmenter("th", { granularity: "word" }).segment(value))
      .filter(part => part.isWordLike).length;
  }
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function updateWordGoal(knownWordCount) {
  const goal = Math.max(1, Math.min(100000, Number.parseInt($("wordGoal")?.value || "1000", 10) || 1000));
  if ($("wordGoal")) $("wordGoal").value = String(goal);
  localStorage.setItem("sf_chapter_word_goal", String(goal));
  const words = Number.isInteger(knownWordCount) ? knownWordCount : countWords($("manuscriptBody")?.value || "");
  if ($("wordGoalStatus")) $("wordGoalStatus").textContent =
    words.toLocaleString("th-TH") + " / " + goal.toLocaleString("th-TH") + " คำ";
  if ($("wordGoalProgress")) $("wordGoalProgress").style.width = Math.min(100, (words / goal) * 100) + "%";
}

function save(changedKey = "") {
  keys.forEach(key => localStorage.setItem(storageKeyFor(key), $(key).value));
  $("saveState").innerHTML = '<span class="status-dot"></span>บันทึกฉบับกู้คืนในอุปกรณ์นี้แล้ว';
  renderDashboard();
  if (cloud.authenticated && cloud.ready && cloud.activeProjectId && cloud.activeChapterId &&
      ["chapterTitle", "manuscriptBody"].includes(changedKey)) {
    storeLocalChapterDraft(cloud.activeChapterId, {
      title: $("chapterTitle").value, body: $("manuscriptBody").value
    }, cloud.revision);
    scheduleCloudSave();
  }
}

// ==========================================
// PROJECT NAVIGATION
// ==========================================

function renderDashboard() {
  const projects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
  const list = Array.isArray(projects) ? projects : [];
  const activeId = localStorage.getItem("sf_active_project_id");
  const active = cloud.ready
    ? cloud.projects.find(item => item.id === cloud.activeProjectId) || null
    : list.find(item => item.id && item.id === activeId) || list[0] || null;
  const title = active && active.title ? active.title : $("title").value;
  const chapter = $("chapterTitle").value;
  const manuscript = $("manuscriptBody").value;
  const chapterWords = countWords(manuscript);
  const savedNovelWords = cloud.ready
    ? cloud.chapters.reduce((total, item) => total + (Number(item.word_count) || 0), 0)
    : chapterWords;
  const activeSavedWords = cloud.chapters.find(item => item.id === cloud.activeChapterId)?.word_count || 0;
  const count = cloud.ready && cloud.activeChapterId
    ? Math.max(0, savedNovelWords - activeSavedWords + chapterWords)
    : chapterWords;
  const novelGoal = Math.max(1, Number.parseInt(localStorage.getItem("sf_novel_word_goal") || "60000", 10) || 60000);
  if ($("sidebarProjectName")) $("sidebarProjectName").textContent = title || "ยังไม่ได้เลือกนิยาย";
  if ($("sidebarProjectMeta")) $("sidebarProjectMeta").textContent = active ? (active.genre || "นิยายของฉัน") + (cloud.ready ? " · Private Beta Cloud" : " · บันทึกในอุปกรณ์นี้") : "เริ่มต้นสร้างเรื่องราวของคุณ";
  if ($("dashboardProjectTitle")) $("dashboardProjectTitle").textContent = title || "ยังไม่มีนิยายในห้องสมุด";
  if ($("dashboardChapterLine")) $("dashboardChapterLine").textContent = chapter ? "บทล่าสุด · " + chapter : (title ? "เพิ่มชื่อบทและเริ่มเขียนต้นฉบับของคุณ" : "เริ่มต้นสร้างโลกและตัวละครของคุณได้เลย");
  if ($("dashboardLastEdited")) $("dashboardLastEdited").textContent = active ? (cloud.ready ? "โครงการนี้เชื่อมต่อกับบัญชี Private Beta" : "โครงการนี้บันทึกไว้ในเบราว์เซอร์เครื่องนี้") : "พื้นที่เขียนนิยายส่วนตัว · บันทึกในอุปกรณ์นี้";
  if ($("dashboardWordCount")) $("dashboardWordCount").textContent = count.toLocaleString("th-TH");
  if ($("dashboardWordGoal")) $("dashboardWordGoal").textContent = "/ " + novelGoal.toLocaleString("th-TH") + " คำ";
  if ($("dashboardProgress")) $("dashboardProgress").style.width = Math.min(100, (count / novelGoal) * 100) + "%";
  if ($("recentChapterTitle")) $("recentChapterTitle").textContent = chapter || "ยังไม่มีบทที่บันทึก";
  if ($("recentWordCount")) $("recentWordCount").textContent = chapterWords.toLocaleString("th-TH") + " คำ";
  if ($("manuscriptCount")) $("manuscriptCount").textContent = chapterWords.toLocaleString("th-TH") + " คำ";
  updateWordGoal(chapterWords);
}

function renderProjects() {
  const list = $("projectList");
  if (!list) return;
  if (cloud.ready) {
    $("projectListCaption").textContent = "โครงการที่จัดเก็บในบัญชี Private Beta";
    list.innerHTML = cloud.projects.length
      ? cloud.projects.map(item =>
          `<div class="project-pick-row"><button type="button" class="project-pick ${item.id === cloud.activeProjectId ? "active" : ""}" data-cloud-project="${escapeHtml(item.id)}"><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.genre || "ไม่ระบุแนว")} · ${item.status === "archived" ? "เก็บเข้าคลัง" : "กำลังเขียน"}</small></button><div class="project-actions"><button type="button" class="outline-button compact" data-archive-project="${escapeHtml(item.id)}">${item.status === "archived" ? "นำกลับ" : "เก็บเข้าคลัง"}</button><button type="button" class="outline-button compact" data-delete-project="${escapeHtml(item.id)}">ลบ</button></div></div>`
        ).join("")
      : '<p class="muted-note">ยังไม่มีโครงการบน Cloud · สร้างนิยายใหม่หรือย้ายข้อมูลจากอุปกรณ์นี้</p>';
    list.querySelectorAll("[data-cloud-project]").forEach(button => {
      button.addEventListener("click", () => selectCloudProject(button.dataset.cloudProject));
    });
    list.querySelectorAll("[data-archive-project]").forEach(button => {
      button.addEventListener("click", () => toggleCloudProjectArchive(button.dataset.archiveProject));
    });
    list.querySelectorAll("[data-delete-project]").forEach(button => {
      button.addEventListener("click", () => deleteCloudProject(button.dataset.deleteProject));
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
    $(key).addEventListener("input", () => save(key));
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
    if (cloud.ready && cloud.activeChapterId) {
      if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
      const savedDraft = await saveCloudChapter();
      if (!savedDraft && !confirm("บทปัจจุบันยังบันทึก Cloud ไม่สำเร็จ ต้องการบันทึกเฉพาะข้อมูลโครงการต่อหรือไม่? ฉบับในเครื่องยังคงอยู่")) return;
    }
    let projects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
    if (!Array.isArray(projects)) projects = [];
    const activeLocalId = localStorage.getItem("sf_active_project_id");
    const existing = creatingProject ? null : (projects.find(x => x.id === activeLocalId) ||
      projects.find(x => x.title === ($("title").value || "โครงการไม่มีชื่อ")));
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
    creatingProject = false;

    if (cloud.ready) {
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

  $("newProject")?.addEventListener("click", async () => {
    if (cloud.activeChapterId) {
      if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
      const saved = await saveCloudChapter();
      if (!saved && !confirm("ต้นฉบับปัจจุบันยังบันทึก Cloud ไม่สำเร็จ ต้องการสร้างโครงการใหม่หรือไม่? ฉบับในเครื่องยังคงอยู่")) return;
    }
    creatingProject = true;
    cloud.activeProjectId = "";
    cloud.activeChapterId = "";
    cloud.revision = 0;
    localStorage.removeItem("sf_active_project_id");
    localStorage.removeItem("sf_cloud_active_project_id");
    $("title").value = "";
    $("genre").selectedIndex = 0;
    $("context").value = "";
    $("projectMemory").value = "";
    cloud.noteId = "";
    $("chapterTitle").value = "";
    $("manuscriptBody").value = "";
    if ($("chapterSelect")) $("chapterSelect").innerHTML = '<option value="">ยังไม่มีบท</option>';
    if ($("chapterSaveHint")) $("chapterSaveHint").textContent = "บันทึกโครงการใหม่ก่อน แล้วจึงเพิ่มบทได้";
    renderProjects();
    showTab("projects");
    $("title").focus();
  });

  // Save memory
  $("saveMemory").onclick = async () => {
    save();
    if (cloud.ready && cloud.activeProjectId) {
      localStorage.setItem("sf_cloud_memory_" + cloud.activeProjectId, $("projectMemory").value);
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
          cloud.noteId = localStorage.getItem("sf_cloud_memory_note_id_" + cloud.activeProjectId) || crypto.randomUUID();
          localStorage.setItem("sf_cloud_memory_note_id_" + cloud.activeProjectId, cloud.noteId);
          const created = await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId) + "/notes", {
            method: "POST",
            body: JSON.stringify({ ...payload, clientId: cloud.noteId })
          });
          cloud.noteId = created.item.id;
          localStorage.setItem("sf_cloud_memory_note_id_" + cloud.activeProjectId, cloud.noteId);
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
    download(exportBaseName() + ".txt", [
      $("title").value, $("chapterTitle").value, "", $("manuscriptBody").value
    ].join("\n"));
  };
  $("exportDocx").onclick = exportManuscriptDocx;
  $("exportEpub").onclick = exportManuscriptEpub;
  $("exportPdf").onclick = exportManuscriptPdf;
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
    const remembered = localStorage.getItem("sf_cloud_active_project_id") || "";
    cloud.activeProjectId = cloud.projects.some(item => item.id === remembered) ? remembered : (cloud.projects[0]?.id || "");
  }
  renderProjects();
  if (cloud.activeProjectId) await loadCloudProject(cloud.activeProjectId);
  else {
    cloud.chapters = [];
    cloud.activeChapterId = "";
    cloud.noteId = "";
    cloud.modules = { characters: [], relationships: [], "plot-threads": [], "world-lore": [], timeline: [], notes: [] };
    if ($("chapterSelect")) $("chapterSelect").innerHTML = '<option value="">ยังไม่มีบท</option>';
    if ($("chapterSaveHint")) $("chapterSaveHint").textContent = "เลือกหรือสร้างโครงการก่อน จึงจะบันทึกบทบน Cloud ได้";
    if ($("projectMemory")) $("projectMemory").value = "";
    renderModuleLists();
  }
}

async function toggleCloudProjectArchive(projectId) {
  const project = cloud.projects.find(item => item.id === projectId);
  if (!project) return;
  const status = project.status === "archived" ? "active" : "archived";
  try {
    const result = await cloudApi("/api/projects/" + encodeURIComponent(projectId), {
      method: "PATCH", body: JSON.stringify({ status })
    });
    cloud.projects = cloud.projects.map(item => item.id === projectId ? result.project : item);
    renderProjects();
  } catch (error) { alert("เปลี่ยนสถานะโครงการไม่สำเร็จ: " + error.message); }
}

async function deleteCloudProject(projectId) {
  const project = cloud.projects.find(item => item.id === projectId);
  if (!project || !confirm("ลบโครงการ “" + project.title + "” พร้อมบทและข้อมูลทั้งหมดบน Cloud หรือไม่? ฉบับสำรองในอุปกรณ์จะไม่ถูกลบ")) return;
  try {
    await cloudApi("/api/projects/" + encodeURIComponent(projectId), { method: "DELETE" });
    cloud.projects = cloud.projects.filter(item => item.id !== projectId);
    // Keep the device copy and allow the owner to re-import it if the deletion was accidental.
    localStorage.removeItem(localMigrationKey());
    if (cloud.activeProjectId === projectId) {
      cloud.activeProjectId = cloud.projects[0]?.id || "";
      cloud.activeChapterId = "";
      if (cloud.activeProjectId) await loadCloudProject(cloud.activeProjectId);
      else {
        $("title").value = "";
        $("context").value = "";
        $("chapterTitle").value = "";
        $("manuscriptBody").value = "";
        $("projectMemory").value = "";
        cloud.chapters = [];
        cloud.modules = { characters: [], relationships: [], "plot-threads": [], "world-lore": [], timeline: [], notes: [] };
        resetCharacterForm();
        localStorage.removeItem("sf_cloud_active_project_id");
        renderChapterSelect();
        renderModuleLists();
      }
    }
    renderProjects();
    renderDashboard();
  } catch (error) { alert("ลบโครงการไม่สำเร็จ: " + error.message); }
}

async function selectCloudProject(projectId) {
  if (!cloud.ready || !projectId || projectId === cloud.activeProjectId) return;
  if (cloud.saveTimer) {
    clearTimeout(cloud.saveTimer);
    cloud.saveTimer = null;
  }
  if (cloud.activeChapterId) {
    const saved = await saveCloudChapter();
    if (!saved && !confirm("ฉบับปัจจุบันยังบันทึกขึ้น Cloud ไม่สำเร็จ ต้องการเปลี่ยนโครงการหรือไม่? ฉบับในเครื่องยังคงอยู่")) return;
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
  localStorage.setItem("sf_cloud_active_project_id", project.id);
  $("title").value = project.title || "";
  $("genre").value = project.genre || $("genre").options[0]?.value || "";
  $("context").value = project.synopsis || "";
  const migrationMap = safeJSON(localStorage.getItem(migrationMapKey()) || "{}", {});
  const localProjectMatch = Object.entries(migrationMap).find(([, value]) => value.projectId === project.id);
  if (localProjectMatch) localStorage.setItem("sf_active_project_id", localProjectMatch[0]);
  else localStorage.removeItem("sf_active_project_id");
  const [chapterResult, noteResult] = await Promise.all([
    cloudApi("/api/projects/" + encodeURIComponent(projectId) + "/chapters"),
    cloudApi("/api/projects/" + encodeURIComponent(projectId) + "/notes")
  ]);
  await loadProjectModules(projectId);
  cloud.chapters = chapterResult.chapters || [];
  const rememberedChapter = localStorage.getItem("sf_cloud_active_chapter_" + projectId) || "";
  const memoryNote = (noteResult.items || []).find(note => note.note_type === "project_memory");
  cloud.noteId = memoryNote?.id || localStorage.getItem("sf_cloud_memory_note_id_" + project.id) || "";
  if (cloud.noteId) localStorage.setItem("sf_cloud_memory_note_id_" + project.id, cloud.noteId);
  if ($("projectMemory")) $("projectMemory").value =
    memoryNote?.content || localStorage.getItem("sf_cloud_memory_" + project.id) || "";
  renderChapterSelect();
  const preferred = cloud.chapters.find(item => item.id === cloud.activeChapterId) ||
    cloud.chapters.find(item => item.id === rememberedChapter) || cloud.chapters[0];
  if (preferred) await selectCloudChapter(preferred.id);
  else {
    cloud.activeChapterId = "";
    cloud.revision = 0;
    $("chapterTitle").value = "";
    $("manuscriptBody").value = "";
    if ($("chapterSaveHint")) $("chapterSaveHint").textContent = "โครงการนี้ยังไม่มีบท · กด “เพิ่มบท” เพื่อเริ่มเขียน";
    renderDashboard();
  }
  renderProjects();
  renderDashboard();
}

async function loadProjectModules(projectId) {
  const names = ["characters", "relationships", "plot-threads", "world-lore", "timeline", "notes"];
  const results = await Promise.all(names.map(name =>
    cloudApi("/api/projects/" + encodeURIComponent(projectId) + "/" + name)
  ));
  names.forEach((name, index) => { cloud.modules[name] = results[index].items || []; });
  renderModuleLists();
}

function renderRelationshipOptions() {
  const options = cloud.modules.characters.map(item =>
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`
  ).join("");
  ["relationshipSource", "relationshipTarget"].forEach(id => {
    const select = $(id);
    if (select) select.innerHTML = options || '<option value="">ยังไม่มีตัวละคร</option>';
  });
}

function renderRelationshipGraph() {
  const target = $("relationshipGraph");
  if (!target) return;
  const characters = cloud.modules.characters.slice(0, 12);
  const relationships = cloud.modules.relationships || [];
  if (!cloud.ready) {
    target.textContent = "เข้าสู่ระบบและเลือกโครงการเพื่อดูแผนผังความสัมพันธ์";
    return;
  }
  if (!characters.length || !relationships.length) {
    target.textContent = "เพิ่มตัวละครและกำหนดความสัมพันธ์เพื่อสร้างแผนผัง";
    return;
  }
  const columns = 4;
  const nodeWidth = 148;
  const nodeHeight = 48;
  const gapX = 28;
  const gapY = 72;
  const rows = Math.ceil(characters.length / columns);
  const width = columns * nodeWidth + (columns - 1) * gapX + 40;
  const height = rows * (nodeHeight + gapY) + 24;
  const positions = new Map();
  characters.forEach((item, index) => {
    positions.set(item.id, {
      x: 20 + (index % columns) * (nodeWidth + gapX),
      y: 12 + Math.floor(index / columns) * (nodeHeight + gapY)
    });
  });
  const edges = relationships.map(rel => {
    const from = positions.get(rel.source_character_id);
    const to = positions.get(rel.target_character_id);
    if (!from || !to) return "";
    const cx1 = from.x + nodeWidth / 2, cy1 = from.y + nodeHeight / 2;
    const cx2 = to.x + nodeWidth / 2, cy2 = to.y + nodeHeight / 2;
    const dx = cx2 - cx1, dy = cy2 - cy1;
    const scale = Math.min((nodeWidth / 2) / Math.max(1, Math.abs(dx)), (nodeHeight / 2) / Math.max(1, Math.abs(dy)));
    const x1 = cx1 + dx * scale, y1 = cy1 + dy * scale;
    const x2 = cx2 - dx * scale, y2 = cy2 - dy * scale;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 8;
    return `<g><path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="#8b744e" stroke-width="1.6" fill="none" marker-end="url(#relationArrow)"/><text x="${mx}" y="${my}" fill="#d9c79f" font-size="10" text-anchor="middle">${escapeHtml(rel.relationship_type || "เกี่ยวข้อง")}</text></g>`;
  }).join("");
  const nodes = characters.map(item => {
    const p = positions.get(item.id);
    return `<g><rect x="${p.x}" y="${p.y}" width="${nodeWidth}" height="${nodeHeight}" rx="5" fill="#18263a" stroke="#b18d4d" stroke-width="1.2"/><text x="${p.x + nodeWidth / 2}" y="${p.y + 20}" fill="#eadbb9" font-size="12" text-anchor="middle">${escapeHtml(item.name.slice(0, 20))}</text><text x="${p.x + nodeWidth / 2}" y="${p.y + 36}" fill="#a99b7e" font-size="9" text-anchor="middle">${escapeHtml(item.role || "ตัวละคร")}</text></g>`;
  }).join("");
  target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="แผนผังตัวละครและความสัมพันธ์"><defs><marker id="relationArrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="none" stroke="#8b744e"/></marker></defs>${edges}${nodes}</svg>`;
}

function renderPlotBoard(items) {
  const target = $("plotBoard");
  if (!target) return;
  if (!cloud.ready && !items.length) {
    target.innerHTML = '<p class="muted-note">เข้าสู่ระบบและเลือกโครงการเพื่อดูบอร์ดพล็อต</p>';
    return;
  }
  const columns = [
    { key: "planned", title: "วางแผน" },
    { key: "in_progress", title: "กำลังดำเนิน" },
    { key: "completed", title: "เสร็จแล้ว" },
    { key: "paused", title: "พักไว้" }
  ];
  target.innerHTML = columns.map(column => {
    const cards = items.filter(item => item.status === column.key).map(item =>
      `<article class="plot-board-card">
        <b>${escapeHtml(item.title)}</b>
        <p>${escapeHtml(item.summary || "ยังไม่มีคำอธิบาย")}</p>
        <select data-plot-status="${escapeHtml(item.id)}" aria-label="เปลี่ยนสถานะเส้นเรื่อง">
          ${columns.map(option => `<option value="${option.key}" ${option.key === item.status ? "selected" : ""}>${option.title}</option>`).join("")}
        </select>
        <div class="module-actions"><button type="button" class="outline-button compact" data-module-edit="plot-threads" data-module-id="${escapeHtml(item.id)}">แก้ไข</button><button type="button" class="outline-button compact" data-module-delete="plot-threads" data-module-id="${escapeHtml(item.id)}">ลบ</button></div>
      </article>`
    ).join("");
    return `<section class="plot-board-column"><header><b>${column.title}</b><span>${items.filter(item => item.status === column.key).length}</span></header>${cards || '<p class="muted-note">ยังไม่มีเส้นเรื่อง</p>'}</section>`;
  }).join("");
  target.querySelectorAll("[data-plot-status]").forEach(select => {
    select.addEventListener("change", async () => {
      try {
        await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId) + "/plot-threads/" + encodeURIComponent(select.dataset.plotStatus), {
          method: "PATCH", body: JSON.stringify({ status: select.value })
        });
        await loadProjectModules(cloud.activeProjectId);
      } catch (error) { alert("เปลี่ยนสถานะเส้นเรื่องไม่สำเร็จ: " + error.message); }
    });
  });
  target.querySelectorAll("[data-module-delete]").forEach(button =>
    button.addEventListener("click", () => deleteModuleItem("plot-threads", button.dataset.moduleId))
  );
  target.querySelectorAll("[data-module-edit]").forEach(button =>
    button.addEventListener("click", () => editModuleItem("plot-threads", button.dataset.moduleId))
  );
}

function renderTimelineView(items) {
  const target = $("timelineView");
  if (!target) return;
  if (!items.length) {
    target.innerHTML = cloud.ready
      ? '<p class="muted-note">เพิ่มเหตุการณ์เพื่อสร้างเส้นเวลาของนิยาย</p>'
      : '<p class="muted-note">เข้าสู่ระบบและเลือกโครงการเพื่อดูเส้นเวลา</p>';
    return;
  }
  target.innerHTML = `<div class="timeline-track">${items.map((item, index) =>
    `<article class="timeline-event"><span class="timeline-index">${String(index + 1).padStart(2, "0")}</span><div class="timeline-event-content"><time>${escapeHtml(item.story_time || "ไม่ระบุเวลา")}</time><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.description || "")}</p><div class="module-actions"><button type="button" class="outline-button compact" data-module-edit="timeline" data-module-id="${escapeHtml(item.id)}">แก้ไข</button><button type="button" class="outline-button compact" data-module-delete="timeline" data-module-id="${escapeHtml(item.id)}">ลบ</button></div></div></article>`
  ).join("")}</div>`;
  target.querySelectorAll("[data-module-delete]").forEach(button =>
    button.addEventListener("click", () => deleteModuleItem("timeline", button.dataset.moduleId))
  );
  target.querySelectorAll("[data-module-edit]").forEach(button =>
    button.addEventListener("click", () => editModuleItem("timeline", button.dataset.moduleId))
  );
}

function renderModuleLists() {
  const characters = cloud.modules.characters || [];
  const relationships = cloud.modules.relationships || [];
  const plots = cloud.modules["plot-threads"] || [];
  const worlds = cloud.modules["world-lore"] || [];
  const timeline = cloud.modules.timeline || [];
  const notes = cloud.modules.notes || [];
  const empty = cloud.ready ? "ยังไม่มีรายการในโครงการนี้" : "เข้าสู่ระบบและเลือกโครงการเพื่อดูข้อมูล";
  const render = (id, items, collection, titleOf, detailOf) => {
    const target = $(id);
    if (!target) return;
    target.innerHTML = items.length ? items.map(item =>
      `<article class="module-item"><div><b>${escapeHtml(titleOf(item))}</b><small>${escapeHtml(detailOf(item) || "")}</small></div><div class="module-actions"><button type="button" class="outline-button compact" data-module-edit="${collection}" data-module-id="${escapeHtml(item.id)}">แก้ไข</button><button type="button" class="outline-button compact" data-module-delete="${collection}" data-module-id="${escapeHtml(item.id)}">ลบ</button></div></article>`
    ).join("") : `<p class="muted-note">${empty}</p>`;
  };
  render("characterList", characters, "characters", item => item.name, item => {
    let profile = {};
    try { profile = JSON.parse(item.profile_json || "{}"); } catch {}
    return [item.role, profile.age, profile.personality, profile.motivation].filter(Boolean).join(" · ");
  });
  render("relationshipList", relationships, "relationships", item => {
    const source = characters.find(x => x.id === item.source_character_id)?.name || "ตัวละคร";
    const target = characters.find(x => x.id === item.target_character_id)?.name || "ตัวละคร";
    return source + " ↔ " + target;
  }, item => [item.relationship_type, item.description].filter(Boolean).join(" · "));
  render("plotList", plots, "plot-threads", item => item.title, item => {
    const labels = { planned: "วางแผน", in_progress: "กำลังดำเนิน", completed: "เสร็จแล้ว", paused: "พักไว้" };
    return (labels[item.status] || item.status) + (item.summary ? " · " + item.summary : "");
  });
  render("worldList", worlds, "world-lore", item => item.title, item => [item.category, item.content].filter(Boolean).join(" · "));
  render("timelineList", timeline, "timeline", item => item.title, item => [item.story_time, item.description].filter(Boolean).join(" · "));
  renderPlotBoard(plots);
  renderTimelineView(timeline);
  render("storyNoteList", notes.filter(item => item.note_type !== "project_memory"), "notes", item => item.title || "บันทึกไม่มีชื่อ", item => item.content);
  renderRelationshipOptions();
  renderRelationshipGraph();
  document.querySelectorAll("[data-module-delete]").forEach(button => button.addEventListener("click", () => deleteModuleItem(button.dataset.moduleDelete, button.dataset.moduleId)));
  document.querySelectorAll("[data-module-edit]").forEach(button => button.addEventListener("click", () => editModuleItem(button.dataset.moduleEdit, button.dataset.moduleId)));
  if ($("characterCount")) $("characterCount").textContent = characters.length.toLocaleString("th-TH");
  if ($("plotCount")) $("plotCount").textContent = plots.length.toLocaleString("th-TH");
  if ($("worldCount")) $("worldCount").textContent = worlds.length.toLocaleString("th-TH");
}

const CHARACTER_PROFILE_FIELDS = [
  "characterAge", "characterPronouns", "characterSpecies", "characterHeight",
  "characterAppearance", "characterPersonality", "characterMotivation",
  "characterBackstory", "characterStrengths", "characterWeaknesses",
  "characterSecret", "characterProfile"
];

function characterProfileFromForm() {
  return {
    age: $("characterAge").value,
    pronouns: $("characterPronouns").value,
    species: $("characterSpecies").value,
    height: $("characterHeight").value,
    appearance: $("characterAppearance").value,
    personality: $("characterPersonality").value,
    motivation: $("characterMotivation").value,
    backstory: $("characterBackstory").value,
    strengths: $("characterStrengths").value,
    weaknesses: $("characterWeaknesses").value,
    secret: $("characterSecret").value,
    description: $("characterProfile").value
  };
}

function resetCharacterForm() {
  cloud.editingCharacterId = "";
  $("characterName").value = "";
  $("characterRole").value = "";
  CHARACTER_PROFILE_FIELDS.forEach(id => { if ($(id)) $(id).value = ""; });
  $("addCharacter").textContent = "บันทึกตัวละคร";
  $("cancelCharacterEdit").hidden = true;
}

function startEditCharacter(item) {
  let profile = {};
  try { profile = JSON.parse(item.profile_json || "{}"); } catch {}
  cloud.editingCharacterId = item.id;
  $("characterName").value = item.name || "";
  $("characterRole").value = item.role || "";
  const values = {
    characterAge: profile.age, characterPronouns: profile.pronouns,
    characterSpecies: profile.species, characterHeight: profile.height,
    characterAppearance: profile.appearance, characterPersonality: profile.personality,
    characterMotivation: profile.motivation, characterBackstory: profile.backstory,
    characterStrengths: profile.strengths, characterWeaknesses: profile.weaknesses,
    characterSecret: profile.secret, characterProfile: profile.description
  };
  for (const [id, value] of Object.entries(values)) $(id).value = value || "";
  $("addCharacter").textContent = "บันทึกการแก้ไข";
  $("cancelCharacterEdit").hidden = false;
  $("characterName").focus();
}

async function saveCharacter() {
  const name = $("characterName").value.trim();
  if (!name) return alert("กรุณาระบุชื่อตัวละคร");
  const payload = {
    name,
    role: $("characterRole").value,
    profile_json: characterProfileFromForm(),
    sort_order: cloud.editingCharacterId
      ? (cloud.modules.characters.find(item => item.id === cloud.editingCharacterId)?.sort_order || 0)
      : cloud.modules.characters.length
  };
  if (cloud.editingCharacterId) {
    try {
      await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId) + "/characters/" + encodeURIComponent(cloud.editingCharacterId), {
        method: "PATCH", body: JSON.stringify(payload)
      });
      await loadProjectModules(cloud.activeProjectId);
      resetCharacterForm();
    } catch (error) { alert("แก้ไขตัวละครไม่สำเร็จ: " + error.message); }
  } else {
    const ok = await createModuleItem("characters", payload);
    if (ok) resetCharacterForm();
  }
}

async function createModuleItem(collection, payload) {
  if (!cloud.ready || !cloud.activeProjectId) {
    alert("กรุณาเข้าสู่ระบบและเลือกโครงการที่เชื่อมต่อ Cloud ก่อนบันทึกข้อมูลส่วนนี้ครับ");
    return;
  }
  try {
    await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId) + "/" + collection, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await loadProjectModules(cloud.activeProjectId);
    $("saveState").innerHTML = '<span class="status-dot"></span>บันทึกข้อมูลโครงการบน Cloud แล้ว';
    return true;
  } catch (error) {
    alert("บันทึกข้อมูลไม่สำเร็จ: " + error.message);
    return false;
  }
}

async function deleteModuleItem(collection, itemId) {
  if (!confirm("ต้องการลบรายการนี้หรือไม่?")) return;
  if (collection === "characters" && cloud.editingCharacterId === itemId) resetCharacterForm();
  try {
    await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId) + "/" + collection + "/" + encodeURIComponent(itemId), { method: "DELETE" });
    await loadProjectModules(cloud.activeProjectId);
  } catch (error) { alert("ลบรายการไม่สำเร็จ: " + error.message); }
}

async function editModuleItem(collection, itemId) {
  const items = cloud.modules[collection] || [];
  const item = items.find(row => row.id === itemId);
  if (!item) return;
  let payload = {};
  if (collection === "characters") {
    startEditCharacter(item);
    return;
  } else if (collection === "plot-threads") {
    const title = prompt("ชื่อเส้นเรื่อง", item.title);
    if (title === null) return;
    const summary = prompt("เรื่องย่อ", item.summary || "");
    if (summary === null) return;
    payload = { title, summary };
  } else if (collection === "world-lore") {
    const title = prompt("หัวข้อ", item.title);
    if (title === null) return;
    const content = prompt("รายละเอียด", item.content || "");
    if (content === null) return;
    payload = { title, content };
  } else if (collection === "timeline") {
    const title = prompt("ชื่อเหตุการณ์", item.title);
    if (title === null) return;
    const story_time = prompt("เวลาในเรื่อง", item.story_time || "");
    if (story_time === null) return;
    const description = prompt("รายละเอียด", item.description || "");
    if (description === null) return;
    payload = { title, story_time, description };
  } else if (collection === "notes") {
    const title = prompt("หัวข้อ", item.title || "");
    if (title === null) return;
    const content = prompt("รายละเอียด", item.content || "");
    if (content === null) return;
    payload = { title, content };
  } else if (collection === "relationships") {
    const relationship_type = prompt("ประเภทความสัมพันธ์", item.relationship_type || "");
    if (relationship_type === null) return;
    const description = prompt("รายละเอียด", item.description || "");
    if (description === null) return;
    payload = { relationship_type, description };
  }
  try {
    await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId) + "/" + collection + "/" + encodeURIComponent(itemId), {
      method: "PATCH",
      body: JSON.stringify(payload)
    });
    await loadProjectModules(cloud.activeProjectId);
  } catch (error) { alert("แก้ไขรายการไม่สำเร็จ: " + error.message); }
}

function setupModuleEvents() {
  $("addCharacter")?.addEventListener("click", saveCharacter);
  $("cancelCharacterEdit")?.addEventListener("click", resetCharacterForm);
  $("addRelationship")?.addEventListener("click", () => {
    const source_character_id = $("relationshipSource").value;
    const target_character_id = $("relationshipTarget").value;
    if (!source_character_id || !target_character_id) return alert("ต้องมีตัวละครอย่างน้อยสองตัวก่อน");
    createModuleItem("relationships", {
      source_character_id, target_character_id,
      relationship_type: $("relationshipType").value,
      description: $("relationshipDescription").value
    });
  });
  $("addPlot")?.addEventListener("click", () => {
    const title = $("plotTitle").value.trim();
    if (!title) return alert("กรุณาระบุชื่อเส้นเรื่อง");
    createModuleItem("plot-threads", { title, summary: $("plotSummary").value, status: $("plotStatus").value, sort_order: cloud.modules["plot-threads"].length })
      .then(ok => { if (ok) { $("plotTitle").value = ""; $("plotSummary").value = ""; } });
  });
  $("addWorld")?.addEventListener("click", () => {
    const title = $("worldTitle").value.trim();
    if (!title) return alert("กรุณาระบุชื่อข้อมูลโลก");
    createModuleItem("world-lore", { category: $("worldCategory").value, title, content: $("worldContent").value, sort_order: cloud.modules["world-lore"].length })
      .then(ok => { if (ok) { $("worldTitle").value = ""; $("worldContent").value = ""; } });
  });
  $("addTimeline")?.addEventListener("click", () => {
    const title = $("timelineTitle").value.trim();
    if (!title) return alert("กรุณาระบุชื่อเหตุการณ์");
    createModuleItem("timeline", { title, story_time: $("timelineTime").value, description: $("timelineDescription").value, sort_order: cloud.modules.timeline.length })
      .then(ok => { if (ok) { $("timelineTitle").value = ""; $("timelineTime").value = ""; $("timelineDescription").value = ""; } });
  });
  $("addStoryNote")?.addEventListener("click", () => {
    const title = $("storyNoteTitle").value.trim();
    if (!title) return alert("กรุณาระบุหัวข้อบันทึก");
    createModuleItem("notes", { title, content: $("storyNoteContent").value, note_type: "idea", pinned: false })
      .then(ok => { if (ok) { $("storyNoteTitle").value = ""; $("storyNoteContent").value = ""; } });
  });
}

function renderChapterSelect() {
  const canManageChapters = cloud.ready && Boolean(cloud.activeProjectId);
  ["chapterSelect", "chapterSelectLabel", "newChapter"].forEach(id => {
    if ($(id)) $(id).hidden = !canManageChapters;
  });
  ["moveChapterUp", "moveChapterDown", "deleteChapter", "chapterHistoryButton", "chapterHistoryInline"].forEach(id => {
    if ($(id)) $(id).hidden = !canManageChapters || !cloud.activeChapterId;
  });
  const select = $("chapterSelect");
  if (select) {
    select.innerHTML = cloud.chapters.length
      ? cloud.chapters.map((item, index) =>
          `<option value="${escapeHtml(item.id)}" ${item.id === cloud.activeChapterId ? "selected" : ""}>${index + 1}. ${escapeHtml(item.title || "บทไม่มีชื่อ")}</option>`
        ).join("")
      : '<option value="">ยังไม่มีบท</option>';
  }
  const list = $("chapterList");
  if (list) {
    if (!cloud.ready) {
      const localTitle = $("chapterTitle")?.value || "บทปัจจุบัน";
      list.innerHTML = `<div class="chapter-list-item active"><span>01</span><div><b>${escapeHtml(localTitle)}</b><small>ฉบับในอุปกรณ์นี้</small></div></div>`;
    } else if (!cloud.activeProjectId) {
      list.innerHTML = '<p class="muted-note">เลือกโครงการเพื่อดูรายการบท</p>';
    } else if (!cloud.chapters.length) {
      list.innerHTML = '<p class="muted-note">ยังไม่มีบท · กด “เพิ่มบทใหม่” เพื่อเริ่มเขียน</p>';
    } else {
      list.innerHTML = cloud.chapters.map((item, index) =>
        `<button type="button" class="chapter-list-item ${item.id === cloud.activeChapterId ? "active" : ""}" data-chapter-item="${escapeHtml(item.id)}"><span>${String(index + 1).padStart(2, "0")}</span><div><b>${escapeHtml(item.title || "บทไม่มีชื่อ")}</b><small>Revision ${Number(item.revision) || 1} · ${(Number(item.word_count) || 0).toLocaleString("th-TH")} คำ</small></div></button>`
      ).join("");
      list.querySelectorAll("[data-chapter-item]").forEach(button =>
        button.addEventListener("click", () => selectCloudChapter(button.dataset.chapterItem))
      );
    }
  }
  if ($("chapterTotal")) $("chapterTotal").textContent = cloud.ready
    ? cloud.chapters.length.toLocaleString("th-TH") + " บท"
    : "ฉบับในเครื่อง";
}

async function selectCloudChapter(chapterId) {
  const item = cloud.chapters.find(chapter => chapter.id === chapterId);
  if (!item) return;
  if (cloud.activeChapterId && cloud.activeChapterId !== chapterId) {
    if (cloud.saveTimer) {
      clearTimeout(cloud.saveTimer);
      cloud.saveTimer = null;
    }
    const saved = await saveCloudChapter();
    if (!saved && !confirm("บทปัจจุบันยังบันทึกขึ้น Cloud ไม่สำเร็จ ต้องการเปลี่ยนบทหรือไม่? ฉบับในเครื่องยังคงอยู่")) {
      renderChapterSelect();
      return;
    }
  }
  let fullChapter;
  try {
    const loaded = await cloudApi("/api/chapters/" + encodeURIComponent(item.id));
    fullChapter = loaded.chapter;
  } catch (error) {
    alert("โหลดต้นฉบับบทนี้ไม่สำเร็จ: " + error.message);
    renderChapterSelect();
    return;
  }
  cloud.activeChapterId = fullChapter.id;
  localStorage.setItem("sf_cloud_active_chapter_" + cloud.activeProjectId, fullChapter.id);
  cloud.revision = fullChapter.revision || 1;
  cloud.chapters = cloud.chapters.map(chapter => chapter.id === fullChapter.id ? fullChapter : chapter);
  $("chapterTitle").value = fullChapter.title || "";
  $("manuscriptBody").value = fullChapter.body || "";
  const localDraft = safeJSON(localStorage.getItem(localChapterDraftKey(item.id)) || "null", null);
  const hasRecoverableDraft = Boolean(localDraft &&
    (localDraft.title !== (fullChapter.title || "") || localDraft.body !== (fullChapter.body || "")));
  if ($("recoverLocalDraft")) {
    $("recoverLocalDraft").hidden = !hasRecoverableDraft;
    $("recoverLocalDraft").dataset.chapterId = fullChapter.id;
  }
  renderChapterSelect();
  if ($("chapterSaveHint")) $("chapterSaveHint").textContent =
    "บันทึกบทบน Cloud · Revision " + cloud.revision + " · มีฉบับกู้คืนในอุปกรณ์นี้";
  if ($("reloadChapter")) $("reloadChapter").hidden = true;
  $("saveState").innerHTML = '<span class="status-dot"></span>โหลดบทจาก Cloud แล้ว';
  renderDashboard();
}

function scheduleCloudSave() {
  if (!cloud.ready || !cloud.activeProjectId || !cloud.activeChapterId) return;
  clearTimeout(cloud.saveTimer);
  $("saveState").innerHTML = '<span class="status-dot"></span>มีการแก้ไข · กำลังรอบันทึก Cloud';
  cloud.saveTimer = setTimeout(saveCloudChapter, 900);
}

async function saveCloudChapter() {
  if (!cloud.activeChapterId) return false;
  if (cloud.saving) return cloud.savePromise || false;
  const chapterId = cloud.activeChapterId;
  const expectedRevision = cloud.revision;
  const draft = { title: $("chapterTitle").value, body: $("manuscriptBody").value };
  const lastSaved = cloud.chapters.find(item => item.id === chapterId);
  if (lastSaved && lastSaved.title === draft.title && lastSaved.body === draft.body) return true;
  cloud.saving = true;
  cloud.savePromise = (async () => {
    try {
      const result = await cloudApi("/api/chapters/" + encodeURIComponent(chapterId), {
        method: "PATCH",
        body: JSON.stringify({ ...draft, expectedRevision, wordCount: countWords(draft.body) })
      });
      if (cloud.activeChapterId !== chapterId) return true;
      cloud.revision = result.chapter.revision;
      cloud.chapters = cloud.chapters.map(item => item.id === chapterId ? result.chapter : item);
      storeLocalChapterDraft(chapterId, { title: result.chapter.title, body: result.chapter.body }, result.chapter.revision);
      if ($("recoverLocalDraft")) $("recoverLocalDraft").hidden = true;
      renderChapterSelect();
      $("saveState").innerHTML = '<span class="status-dot"></span>บันทึกต้นฉบับบน Cloud แล้ว';
      if ($("chapterSaveHint")) $("chapterSaveHint").textContent =
        "บันทึกบน Cloud แล้ว · Revision " + cloud.revision + " · ฉบับกู้คืนในอุปกรณ์ยังคงอยู่";
      return true;
    } catch (error) {
      if (error.status === 409) {
        $("saveState").textContent = "พบฉบับใหม่กว่าใน Cloud · ฉบับนี้ยังเก็บไว้ในอุปกรณ์";
        if ($("chapterSaveHint")) $("chapterSaveHint").textContent =
          "มีการแก้ไขจากอีกหน้าต่างหรืออุปกรณ์ ฉบับปัจจุบันยังอยู่ในเครื่อง กด “โหลดฉบับล่าสุด” เมื่อต้องการเปลี่ยนมาใช้ฉบับ Cloud";
        if ($("reloadChapter")) $("reloadChapter").hidden = false;
      } else {
        $("saveState").textContent = "บันทึก Cloud ไม่สำเร็จ · ฉบับในเครื่องยังอยู่";
      }
      console.error("Cloud chapter save failed:", error);
      return false;
    } finally {
      cloud.saving = false;
      cloud.savePromise = null;
      if (cloud.activeChapterId === chapterId &&
          ($("chapterTitle").value !== draft.title || $("manuscriptBody").value !== draft.body)) {
        scheduleCloudSave();
      }
    }
  })();
  return cloud.savePromise;
}

async function createCloudChapter() {
  if (!cloud.ready || !cloud.activeProjectId) {
    alert("กรุณาเข้าสู่ระบบและเลือกโครงการที่เชื่อมต่อ Cloud ก่อนครับ");
    return;
  }
  if (cloud.activeChapterId) {
    if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
    const saved = await saveCloudChapter();
    if (!saved && !confirm("บทปัจจุบันยังบันทึก Cloud ไม่สำเร็จ ต้องการสร้างบทใหม่หรือไม่? ฉบับในเครื่องยังคงอยู่")) return;
  }
  try {
    const result = await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId) + "/chapters", {
      method: "POST",
      body: JSON.stringify({
        title: "บทใหม่",
        body: "",
        wordCount: 0,
        sortOrder: cloud.chapters.reduce((max, item) => Math.max(max, item.sort_order || 0), -1) + 1
      })
    });
    cloud.chapters.push(result.chapter);
    await selectCloudChapter(result.chapter.id);
    $("chapterTitle").focus();
  } catch (error) {
    alert("สร้างบทไม่สำเร็จ: " + error.message);
  }
}

async function recoverLocalChapterDraft() {
  const chapterId = cloud.activeChapterId;
  if (!chapterId) return;
  const draft = safeJSON(localStorage.getItem(localChapterDraftKey(chapterId)) || "null", null);
  if (!draft) return;
  try {
    const latest = await cloudApi("/api/chapters/" + encodeURIComponent(chapterId));
    cloud.chapters = cloud.chapters.map(item => item.id === chapterId ? latest.chapter : item);
    cloud.revision = latest.chapter.revision;
    $("chapterTitle").value = draft.title || "";
    $("manuscriptBody").value = draft.body || "";
    if ($("recoverLocalDraft")) $("recoverLocalDraft").hidden = true;
    scheduleCloudSave();
    $("saveState").textContent = "กู้คืนฉบับในเครื่องแล้ว · กำลังบันทึกเทียบกับ Revision ล่าสุด";
  } catch (error) {
    alert("กู้คืนฉบับในเครื่องไม่สำเร็จ: " + error.message);
  }
}

async function moveActiveChapter(direction) {
  if (!cloud.ready || !cloud.activeChapterId) return;
  if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
  const saved = await saveCloudChapter();
  if (!saved) {
    if (!confirm("บทปัจจุบันยังบันทึก Cloud ไม่สำเร็จ ต้องการเปลี่ยนลำดับต่อหรือไม่? ฉบับในเครื่องยังคงอยู่")) return;
  }
  try {
    await cloudApi("/api/chapters/" + encodeURIComponent(cloud.activeChapterId) + "/move", {
      method: "POST", body: JSON.stringify({ direction })
    });
    const result = await cloudApi("/api/projects/" + encodeURIComponent(cloud.activeProjectId) + "/chapters");
    const activeBody = cloud.chapters.find(item => item.id === cloud.activeChapterId);
    cloud.chapters = (result.chapters || []).map(item =>
      item.id === cloud.activeChapterId ? { ...item, body: activeBody?.body ?? $("manuscriptBody").value } : item
    );
    renderChapterSelect();
    $("saveState").innerHTML = '<span class="status-dot"></span>ปรับลำดับบทแล้ว';
  } catch (error) { alert("ปรับลำดับบทไม่สำเร็จ: " + error.message); }
}

async function deleteActiveChapter() {
  if (!cloud.authenticated || !cloud.activeChapterId) return;
  if (!confirm("ต้องการลบบทนี้ออกจากโครงการหรือไม่? ฉบับกู้คืนในอุปกรณ์จะยังอยู่ แต่การลบ Cloud ไม่สามารถย้อนกลับได้")) return;
  if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
  const deletedId = cloud.activeChapterId;
  try {
    await cloudApi("/api/chapters/" + encodeURIComponent(deletedId), { method: "DELETE" });
    cloud.chapters = cloud.chapters.filter(item => item.id !== deletedId);
    cloud.activeChapterId = "";
    if (cloud.chapters.length) {
      await selectCloudChapter(cloud.chapters[0].id);
    } else {
      cloud.revision = 0;
      $("chapterTitle").value = "";
      $("manuscriptBody").value = "";
      renderChapterSelect();
      renderDashboard();
      $("saveState").textContent = "ลบบทแล้ว · โครงการยังไม่มีบท";
    }
  } catch (error) { alert("ลบบทไม่สำเร็จ: " + error.message); }
}

async function showChapterHistory() {
  const panel = $("chapterHistory");
  if (!cloud.ready || !cloud.activeChapterId) {
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
          const title = item.title || "ฉบับก่อนหน้า";
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
  if (!cloud.ready) return;
  const localProjects = localProjectsForImport();
  if (!localProjects.length) {
    alert("ไม่พบข้อมูลนิยายในอุปกรณ์นี้ครับ");
    return;
  }
  if (!confirm("นำเข้า " + localProjects.length + " โครงการไปยังบัญชี Private Beta? ข้อมูลเดิมในอุปกรณ์จะไม่ถูกลบ และการนำเข้าซ้ำจะใช้รหัสเดิมเพื่อลดโอกาสสร้างรายการซ้ำ")) return;
  const button = $("importLocalData");
  button.disabled = true;
  const map = safeJSON(localStorage.getItem(migrationMapKey()) || "{}", {});
  const activeLocalProject = localProjects.find(item => item.id === localStorage.getItem("sf_active_project_id")) || localProjects[0];
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
      if (localProject === activeLocalProject && (localStorage.getItem("sf_chapterTitle") || localStorage.getItem("sf_manuscript"))) {
        await cloudApi("/api/projects/" + encodeURIComponent(projectResult.project.id) + "/chapters", {
          method: "POST",
          body: JSON.stringify({
            clientId: map[localId].chapterId,
            title: localStorage.getItem("sf_chapterTitle") || "ต้นฉบับที่นำเข้า",
            body: localStorage.getItem("sf_manuscript") || "",
            wordCount: countWords(localStorage.getItem("sf_manuscript") || ""),
            sortOrder: 0
          })
        });
      }
      if (localProject === activeLocalProject && localStorage.getItem("sf_projectMemory")) {
        localStorage.setItem("sf_cloud_memory_" + projectResult.project.id, localStorage.getItem("sf_projectMemory"));
        map[localId].memoryNoteId = map[localId].memoryNoteId || crypto.randomUUID();
        await cloudApi("/api/projects/" + encodeURIComponent(projectResult.project.id) + "/notes", {
          method: "POST",
          body: JSON.stringify({
            clientId: map[localId].memoryNoteId,
            title: "ความจำโครงการ",
            content: localStorage.getItem("sf_projectMemory") || "",
            note_type: "project_memory"
          })
        });
      }
      localStorage.setItem(migrationMapKey(), JSON.stringify(map));
      $("migrationStatus").textContent = "นำเข้าแล้ว: " + (localProject.title || "นิยายที่นำเข้า");
    }
    localStorage.setItem(localMigrationKey(), new Date().toISOString());
    cloud.activeProjectId = map[activeLocalProject.id]?.projectId || "";
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
      cloud.ready = false;
      renderChapterSelect();
      return;
    }
    if (response.status === 401) {
      cloud.authenticated = false;
      cloud.ready = false;
      cloud.csrfToken = "";
      cloud.userId = "";
      cloud.projects = [];
      cloud.activeProjectId = "";
      cloud.chapters = [];
      cloud.activeChapterId = "";
      cloud.noteId = "";
      cloud.modules = { characters: [], relationships: [], "plot-threads": [], "world-lore": [], timeline: [], notes: [] };
      resetCharacterForm();
      state.textContent = "เซสชันหมดอายุหรือโทเคนตรวจสอบไม่ตรงกัน · กรุณาเข้าสู่ระบบใหม่";
      login.hidden = false;
      logout.hidden = true;
      keys.forEach(key => {
        const value = localStorage.getItem(storageKeyFor(key));
        if (value !== null && $(key)) $(key).value = value;
      });
      renderProjects();
      renderModuleLists();
      renderChapterSelect();
      if ($("chapterHistory")) $("chapterHistory").hidden = true;
      if ($("reloadChapter")) $("reloadChapter").hidden = true;
      if ($("recoverLocalDraft")) $("recoverLocalDraft").hidden = true;
      renderDashboard();
      const disclosure = document.querySelector(".local-disclosure");
      if (disclosure) disclosure.textContent = "เซสชันหมดอายุ · ข้อมูลฉบับกู้คืนยังอยู่ในอุปกรณ์นี้";
      return;
    }
    if (!response.ok) throw new Error("ตรวจสอบบัญชีไม่สำเร็จ");
    const result = await response.json();
    if (result.authenticated) {
      cloud.authenticated = true;
      cloud.ready = false;
      cloud.csrfToken = result.csrfToken;
      cloud.userId = result.userId || result.user.githubLogin;
      state.textContent = "GitHub: " + result.user.githubLogin + " · Private Beta";
      login.hidden = true;
      logout.hidden = false;
      logout.dataset.csrf = result.csrfToken;
      try {
        await loadCloudProjects();
        cloud.ready = true;
        renderChapterSelect();
      } catch (error) {
        cloud.ready = false;
        state.textContent = "เข้าสู่ระบบแล้ว แต่โหลดโครงการไม่สำเร็จ · " + error.message;
        console.error("Cloud project loading failed:", error);
      }
    } else {
      cloud.authenticated = false;
      cloud.ready = false;
      cloud.csrfToken = "";
      cloud.userId = "";
      cloud.projects = [];
      cloud.activeProjectId = "";
      cloud.chapters = [];
      cloud.activeChapterId = "";
      cloud.noteId = "";
      cloud.modules = { characters: [], relationships: [], "plot-threads": [], "world-lore": [], timeline: [], notes: [] };
      localStorage.removeItem("sf_cloud_active_project_id");
      state.textContent = "ยังไม่ได้เข้าสู่ระบบ · ข้อมูลนิยายยังอยู่ในอุปกรณ์นี้";
      login.hidden = false;
      logout.hidden = true;
      keys.forEach(key => {
        const value = localStorage.getItem(storageKeyFor(key));
        if (value !== null && $(key)) $(key).value = value;
      });
      renderProjects();
      renderModuleLists();
      if ($("chapterHistory")) $("chapterHistory").hidden = true;
      if ($("reloadChapter")) $("reloadChapter").hidden = true;
      if ($("recoverLocalDraft")) $("recoverLocalDraft").hidden = true;
      renderDashboard();
    }
    if (callbackState) history.replaceState(null, "", location.pathname);
    const disclosure = document.querySelector(".local-disclosure");
    if (disclosure) disclosure.textContent = cloud.ready
      ? "เชื่อมต่อบัญชี Private Beta แล้ว · ต้นฉบับและโครงการที่เลือกจะบันทึกขึ้น Cloud พร้อมเก็บฉบับกู้คืนไว้ในอุปกรณ์นี้"
      : cloud.authenticated
        ? "เข้าสู่ระบบแล้ว แต่บริการ Cloud ยังไม่พร้อม · ฉบับกู้คืนยังอยู่ในอุปกรณ์นี้"
        : "ต้นแบบพื้นที่ทำงานส่วนตัว · ข้อมูลในรุ่นนี้เก็บไว้ในเบราว์เซอร์เครื่องนี้ ยังไม่ซิงก์ขึ้นเซิร์ฟเวอร์";
  } catch (error) {
    state.textContent = "ตรวจสอบสถานะบัญชีไม่ได้ · " + error.message;
    login.hidden = true;
    logout.hidden = true;
  }
}

function setupCloudEvents() {
  $("importLocalData")?.addEventListener("click", importLocalNovelData);
  $("newChapter")?.addEventListener("click", createCloudChapter);
  $("moveChapterUp")?.addEventListener("click", () => moveActiveChapter("up"));
  $("moveChapterDown")?.addEventListener("click", () => moveActiveChapter("down"));
  $("deleteChapter")?.addEventListener("click", deleteActiveChapter);
  $("chapterSelect")?.addEventListener("change", event => selectCloudChapter(event.target.value));
  $("chapterHistoryButton")?.addEventListener("click", showChapterHistory);
  $("chapterHistoryInline")?.addEventListener("click", showChapterHistory);
  $("replaceAll")?.addEventListener("click", () => {
    const search = $("findText").value;
    if (!search) return alert("กรุณาระบุคำที่ต้องการค้นหา");
    const body = $("manuscriptBody").value;
    const count = body.split(search).length - 1;
    if (!count) { $("replaceStatus").textContent = "ไม่พบข้อความที่ค้นหา"; return; }
    $("manuscriptBody").value = body.split(search).join($("replaceText").value);
    save("manuscriptBody");
    $("replaceStatus").textContent = "แทนที่แล้ว " + count.toLocaleString("th-TH") + " จุด";
  });
  $("wordGoal")?.addEventListener("input", updateWordGoal);
  $("recoverLocalDraft")?.addEventListener("click", recoverLocalChapterDraft);
  $("reloadChapter")?.addEventListener("click", async () => {
    if (!cloud.activeChapterId || !confirm("โหลดฉบับล่าสุดจาก Cloud และแทนที่ข้อความที่กำลังแสดงหรือไม่? ฉบับในเครื่องยังอยู่ใน local backup")) return;
    try {
      await selectCloudChapter(cloud.activeChapterId);
    } catch (error) { alert("โหลดฉบับล่าสุดไม่สำเร็จ: " + error.message); }
  });
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
// OFFICE / EPUB EXPORT HELPERS (offline, no third-party service)
// ==========================================

function xmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
  })[char]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries) {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) |
    ((now.getMonth() + 1) << 5) | now.getDate();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(entry.data);
    const checksum = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, checksum, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, checksum, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);
  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportBaseName() {
  const source = [ $("title").value, $("chapterTitle").value || "manuscript" ].filter(Boolean).join("-");
  return source.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, "-").slice(0, 100) || "storyforge-manuscript";
}

function wordParagraph(text, style = "") {
  if (!text) return "<w:p/>";
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function exportManuscriptDocx() {
  const title = $("title").value || "StoryForge Manuscript";
  const chapter = $("chapterTitle").value || "ต้นฉบับ";
  const paragraphs = $("manuscriptBody").value.split(/\r?\n/).map(line => wordParagraph(line)).join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${wordParagraph(title, "Title")}${wordParagraph(chapter, "Heading1")}${paragraphs}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>` },
    { name: "word/document.xml", data: documentXml },
    { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { name: "word/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="TH Sarabun New" w:cs="TH Sarabun New"/><w:sz w:val="28"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
</w:styles>` },
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xmlEscape(title)} - ${xmlEscape(chapter)}</dc:title><dc:creator>StoryForge</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>` },
    { name: "docProps/app.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>StoryForge</Application></Properties>` }
  ];
  downloadBlob(exportBaseName() + ".docx", createStoredZip(files));
}

function exportManuscriptEpub() {
  const title = $("title").value || "StoryForge Manuscript";
  const chapter = $("chapterTitle").value || "ต้นฉบับ";
  const identifier = "urn:uuid:" + crypto.randomUUID();
  const paragraphs = $("manuscriptBody").value.split(/\r?\n/).map(line =>
    line ? `<p>${xmlEscape(line)}</p>` : '<p class="blank">&#160;</p>'
  ).join("");
  const files = [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: "OEBPS/content.opf", data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="th">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${identifier}</dc:identifier><dc:title>${xmlEscape(title)} - ${xmlEscape(chapter)}</dc:title><dc:language>th</dc:language><dc:creator>StoryForge</dc:creator><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/></manifest>
<spine><itemref idref="chapter"/></spine></package>` },
    { name: "OEBPS/nav.xhtml", data: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="th"><head><title>สารบัญ</title></head><body><nav epub:type="toc" id="toc"><h1>สารบัญ</h1><ol><li><a href="chapter.xhtml">${xmlEscape(chapter)}</a></li></ol></nav></body></html>` },
    { name: "OEBPS/chapter.xhtml", data: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="th"><head><title>${xmlEscape(chapter)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>${xmlEscape(title)}</h1><h2>${xmlEscape(chapter)}</h2>${paragraphs}</body></html>` },
    { name: "OEBPS/style.css", data: "body{font-family:serif;line-height:1.65;margin:5%;}h1,h2{line-height:1.3;}p{margin:0 0 0.8em;text-indent:1.2em}.blank{height:0.8em}" }
  ];
  downloadBlob(exportBaseName() + ".epub", createStoredZip(files));
}

function exportManuscriptPdf() {
  const printNode = $("printManuscriptText");
  printNode.textContent = [
    $("title").value,
    $("chapterTitle").value,
    "",
    $("manuscriptBody").value
  ].filter((value, index) => value !== "" || index === 2).join("\n");
  document.body.classList.add("print-manuscript");
  const cleanup = () => {
    document.body.classList.remove("print-manuscript");
    printNode.hidden = true;
    window.removeEventListener("afterprint", cleanup);
  };
  printNode.hidden = false;
  window.addEventListener("afterprint", cleanup, { once: true });
  window.print();
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
  if ($("wordGoal")) $("wordGoal").value = localStorage.getItem("sf_chapter_word_goal") || "1000";
  updateWordGoal();
  setupCloudEvents();
  setupModuleEvents();
  refreshAuthStatus();

  console.log("STORYFORGE initialized successfully");
}

init();
