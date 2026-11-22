
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

  keys.forEach(key => {
    localStorage.setItem(
      "sf_" + key,
      $(key).value
    );
  });

  $("saveState").innerHTML = '<span class="status-dot"></span>บันทึกในอุปกรณ์นี้แล้ว · ยังไม่ซิงก์ขึ้นเซิร์ฟเวอร์';
  renderDashboard();
  const count = $("manuscript").value.length;
  if ($("manuscriptCount")) $("manuscriptCount").textContent = count.toLocaleString("th-TH") + " อักขระ";
}

// ==========================================
// PROJECT NAVIGATION
// ==========================================

function renderDashboard() {
  const projects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
  const list = Array.isArray(projects) ? projects : [];
  const activeId = localStorage.getItem("sf_active_project_id");
  const active = list.find(item => item.id && item.id === activeId) || list[0] || null;
  const title = active && active.title ? active.title : $("title").value;
  const chapter = $("chapterTitle").value;
  const manuscript = $("manuscript").value;
  const count = manuscript.length;
  if ($("sidebarProjectName")) $("sidebarProjectName").textContent = title || "ยังไม่ได้เลือกนิยาย";
  if ($("sidebarProjectMeta")) $("sidebarProjectMeta").textContent = active ? (active.genre || "นิยายของฉัน") + " · บันทึกในอุปกรณ์นี้" : "เริ่มต้นสร้างเรื่องราวของคุณ";
  if ($("dashboardProjectTitle")) $("dashboardProjectTitle").textContent = title || "ยังไม่มีนิยายในห้องสมุด";
  if ($("dashboardChapterLine")) $("dashboardChapterLine").textContent = chapter ? "บทล่าสุด · " + chapter : (title ? "เพิ่มชื่อบทและเริ่มเขียนต้นฉบับของคุณ" : "เริ่มต้นสร้างโลกและตัวละครของคุณได้เลย");
  if ($("dashboardLastEdited")) $("dashboardLastEdited").textContent = active ? "โครงการนี้บันทึกไว้ในเบราว์เซอร์เครื่องนี้" : "พื้นที่เขียนนิยายส่วนตัว · บันทึกในอุปกรณ์นี้";
  if ($("dashboardWordCount")) $("dashboardWordCount").textContent = count.toLocaleString("th-TH");
  if ($("dashboardWordGoal")) $("dashboardWordGoal").textContent = "อักขระในต้นฉบับ";
  if ($("dashboardProgress")) $("dashboardProgress").style.width = "0%";
  if ($("recentChapterTitle")) $("recentChapterTitle").textContent = chapter || "ยังไม่มีบทที่บันทึก";
  if ($("recentWordCount")) $("recentWordCount").textContent = count.toLocaleString("th-TH") + " อักขระ";
  if ($("manuscriptCount")) $("manuscriptCount").textContent = count.toLocaleString("th-TH") + " อักขระ";
}

function renderProjects() {

  const projects = safeJSON(
    localStorage.getItem("sf_projects") || "[]",
    []
  );

  const validProjects = Array.isArray(projects)
    ? projects
    : [];

  $("projectList").innerHTML = validProjects.length
    ? validProjects.map(item =>
        `<p><b>${escapeHtml(item.title)}</b> ` +
        `<small>— ${escapeHtml(item.genre)}</small></p>`
      ).join("")
    : "ยังไม่มีโครงการที่บันทึกไว้";
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
  $("saveProject").onclick = () => {

    save();

    let projects = safeJSON(
      localStorage.getItem("sf_projects") || "[]",
      []
    );

    if (!Array.isArray(projects)) {
      projects = [];
    }

    const item = {
      id: (projects.find(x => x.title === ($("title").value || "โครงการไม่มีชื่อ")) || {}).id || (crypto.randomUUID ? crypto.randomUUID() : "sf-" + Date.now().toString(36)),
      title: $("title").value || "โครงการไม่มีชื่อ",
      genre: $("genre").value,
      context: $("context").value
    };

    projects = projects.filter(x => x.title !== item.title);
    projects.unshift(item);
    localStorage.setItem("sf_active_project_id", item.id);

    localStorage.setItem(
      "sf_projects",
      JSON.stringify(projects)
    );

    renderProjects();
    renderDashboard();

    alert("บันทึกข้อมูลนิยายไว้ในอุปกรณ์นี้แล้วครับ");
  };

  // Save memory
  $("saveMemory").onclick = () => {
    save();
    alert("บันทึกความจำแล้ว");
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
      state.textContent = "GitHub: " + result.user.githubLogin + " · ข้อมูลนิยายยังอยู่ในอุปกรณ์นี้";
      login.hidden = true;
      logout.hidden = false;
      logout.dataset.csrf = result.csrfToken;
    } else {
      state.textContent = "ยังไม่ได้เข้าสู่ระบบ · ข้อมูลนิยายยังอยู่ในอุปกรณ์นี้";
      login.hidden = false;
      logout.hidden = true;
    }
    if (callbackState) history.replaceState(null, "", location.pathname);
  } catch (error) {
    state.textContent = "ตรวจสอบสถานะบัญชีไม่ได้ · " + error.message;
    login.hidden = true;
    logout.hidden = true;
  }
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
  refreshAuthStatus();

  console.log("STORYFORGE initialized successfully");
}

init();
