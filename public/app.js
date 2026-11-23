
const $ = id => document.getElementById(id);

let mode = "writer";
let creatingProject = false;
let backupBusy = false;
let nextAutoBackupAt = null;
let autoBackupTimer = null;
const AUTO_BACKUP_RETRY_MS = 15 * 60 * 1000;

const keys = [
  "title",
  "genre",
  "context",
  "chapterTitle",
  "manuscriptBody",
  "projectMemory",
  "globalMemory",
  "penName",
  "copyrightText",
  "foreword",
  "authorBio"
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

function getProjectGenre() {
  const select = $("genre");
  if (!select) return "";
  return select.value === "__custom__"
    ? ($("customGenre")?.value || "").trim()
    : select.value;
}

function setProjectGenre(value = "") {
  const select = $("genre");
  if (!select) return;
  const knownOption = Array.from(select.options).find(option =>
    option.value !== "__custom__" && option.textContent.trim() === String(value).trim()
  );
  if (knownOption) {
    select.value = knownOption.value;
    if ($("customGenre")) $("customGenre").value = "";
  } else if (String(value).trim()) {
    select.value = "__custom__";
    if ($("customGenre")) $("customGenre").value = String(value);
  } else {
    select.selectedIndex = 0;
    if ($("customGenre")) $("customGenre").value = "";
  }
  if ($("customGenreField")) $("customGenreField").hidden = select.value !== "__custom__";
}


let writingSettingsProjectId = "";
function writingSettingsKey(projectId) { return "sf_writing_settings_" + (projectId || writingSettingsProjectId || localStorage.getItem("sf_active_project_id") || "draft"); }
function writingWordGoalKey(projectId) { return "sf_chapter_word_goal_" + (projectId || cloud.activeProjectId || writingSettingsProjectId || localStorage.getItem("sf_active_project_id") || "draft"); }
function readWritingSettings() {
  const genres = {};
  const selectedGenres = [];
  document.querySelectorAll("[data-genre-level]").forEach(input => {
    const key = input.dataset.genreLevel;
    genres[key] = Number(input.value) || 1;
    const toggle = Array.from(document.querySelectorAll("[data-genre-enabled]"))
      .find(item => item.dataset.genreEnabled === key);
    if (toggle?.checked) selectedGenres.push(key);
  });
  return {
    chapterCount: Math.max(1,Math.min(500,Number($("plannedChapterCount")?.value)||20)),
    wordsPerChapter: Math.max(100,Math.min(20000,Number($("plannedWordsPerChapter")?.value)||2000)),
    pov: $("writingPov")?.value || "third",
    style: $("writingStyle")?.value || "literary",
    adultContent: $("adultContentMode")?.value || "off",
    extraNotes: $("writingExtraNotes")?.value || "",
    genres,
    selectedGenres
  };
}
function loadWritingSettings(projectId) {
  writingSettingsProjectId = projectId || localStorage.getItem("sf_active_project_id") || "draft";
  let data={};
  try { data=JSON.parse(localStorage.getItem(writingSettingsKey(projectId))||"{}"); } catch {}
  if ($("plannedChapterCount")) $("plannedChapterCount").value=data.chapterCount||20;
  if ($("plannedWordsPerChapter")) $("plannedWordsPerChapter").value=data.wordsPerChapter||2000;
  if ($("wordGoal")) $("wordGoal").value=localStorage.getItem(writingWordGoalKey(writingSettingsProjectId)) || String(data.wordsPerChapter || 2000);
  if ($("writingPov")) $("writingPov").value=data.pov||"third";
  if ($("writingStyle")) $("writingStyle").value=data.style||"literary";
  if ($("adultContentMode")) $("adultContentMode").value=data.adultContent||"off";
  if ($("writingExtraNotes")) $("writingExtraNotes").value=data.extraNotes||"";
  const savedGenres = Array.isArray(data.selectedGenres)
    ? new Set(data.selectedGenres)
    : new Set(Object.keys(data.genres || {}));
  const hasSavedGenreSelection = Array.isArray(data.selectedGenres) || Object.keys(data.genres || {}).length > 0;
  document.querySelectorAll("[data-genre-level]").forEach(input=>{
    input.value=data.genres?.[input.dataset.genreLevel]||5;
    const toggle = Array.from(document.querySelectorAll("[data-genre-enabled]"))
      .find(item => item.dataset.genreEnabled === input.dataset.genreLevel);
    if (toggle) toggle.checked = hasSavedGenreSelection && savedGenres.has(input.dataset.genreLevel);
    input.disabled = !toggle?.checked;
    const output=document.querySelector('output[for="'+input.id+'"]');
    if(output) output.textContent=input.value+"/10";
  });
}
function setupWritingSettings() {
  document.querySelectorAll("[data-genre-enabled]").forEach(toggle=>{
    toggle.addEventListener("change",()=>{
      const slider = Array.from(document.querySelectorAll("[data-genre-level]"))
        .find(input => input.dataset.genreLevel === toggle.dataset.genreEnabled);
      if (slider) slider.disabled = !toggle.checked;
      localStorage.setItem(writingSettingsKey(),JSON.stringify(readWritingSettings()));
    });
  });
  document.querySelectorAll("[data-genre-level]").forEach(input=>{
    input.addEventListener("input",()=>{
      const output=document.querySelector('output[for="'+input.id+'"]');
      if(output) output.textContent=input.value+"/10";
      localStorage.setItem(writingSettingsKey(),JSON.stringify(readWritingSettings()));
    });
  });
  ["plannedChapterCount","plannedWordsPerChapter","writingPov","writingStyle","adultContentMode","writingExtraNotes"].forEach(id=>{
    $(id)?.addEventListener("input",()=>localStorage.setItem(writingSettingsKey(),JSON.stringify(readWritingSettings())));
    $(id)?.addEventListener("change",()=>localStorage.setItem(writingSettingsKey(),JSON.stringify(readWritingSettings())));
  });
  loadWritingSettings();
}

function setupCustomGenre() {
  const select = $("genre");
  if (!select) return;
  select.addEventListener("change", () => {
    const custom = select.value === "__custom__";
    if ($("customGenreField")) $("customGenreField").hidden = !custom;
    if (custom) $("customGenre")?.focus();
    save("genre");
  });
  $("customGenre")?.addEventListener("input", () => {
    if ($("genre")?.value === "__custom__") save("genre");
  });
}
const localMigrationKey = () => "sf_cloud_migrated_" + (cloud.userId || "owner");
const migrationMapKey = () => "sf_cloud_migration_map_" + (cloud.userId || "owner");
const localChapterDraftKey = chapterId => "sf_cloud_draft_" + chapterId;

function storeLocalChapterDraft(chapterId, draft, revision = 0) {
  if (!chapterId) return false;
  try {
    localStorage.setItem(localChapterDraftKey(chapterId), JSON.stringify({
      ...draft, revision, updatedAt: new Date().toISOString()
    }));
    return true;
  } catch (error) {
    // Storage quota/privacy restrictions must never block the Cloud save path.
    console.warn("Local chapter recovery draft could not be stored:", error);
    const hint = $("chapterSaveHint");
    if (hint) hint.textContent = "พื้นที่จัดเก็บฉบับกู้คืนในอุปกรณ์ไม่พร้อมใช้งาน · ระบบยังพยายามบันทึกบน Cloud";
    return false;
  }
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
        สำรองข้อมูลในอุปกรณ์และทุกโครงการบน Cloud (ประวัติ Snapshot ยังไม่รวม)
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

function collectLocalBackup() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith("sf_")) data[key] = localStorage.getItem(key);
  }
  return data;
}

async function collectCloudBackup() {
  if (!cloud.authenticated || !cloud.ready) return [];
  const projectsResult = await cloudApi("/api/projects");
  if ((projectsResult.projects || []).length >= 200) {
    throw new Error("มีโครงการถึงขีดจำกัดที่ API ส่งกลับ (200 โครงการ) จึงหยุด Backup เพื่อป้องกันไฟล์ไม่ครบ");
  }
  const projects = [];
  const collections = ["characters", "relationships", "plot-threads", "world-lore", "timeline", "notes"];
  for (const project of (projectsResult.projects || [])) {
    const [chapterResult, ...moduleResults] = await Promise.all([
      cloudApi("/api/projects/" + encodeURIComponent(project.id) + "/chapters"),
      ...collections.map(name => cloudApi("/api/projects/" + encodeURIComponent(project.id) + "/" + name))
    ]);
    if ((chapterResult.chapters || []).length >= 500) {
      throw new Error("โครงการ " + (project.title || project.id) + " มีบทถึงขีดจำกัดที่ API ส่งกลับ (500 บท) จึงหยุด Backup เพื่อป้องกันไฟล์ไม่ครบ");
    }
    moduleResults.forEach((result, index) => {
      if ((result.items || []).length >= 100) {
        throw new Error("โครงการ " + (project.title || project.id) + " หมวด " + collections[index] + " มีรายการถึงขีดจำกัดที่ API ส่งกลับ (100 รายการ) จึงหยุด Backup เพื่อป้องกันไฟล์ไม่ครบ");
      }
    });
    const chapters = await Promise.all((chapterResult.chapters || []).map(async chapter => {
      const detail = await cloudApi("/api/chapters/" + encodeURIComponent(chapter.id));
      return detail.chapter;
    }));
    const modules = {};
    collections.forEach((name, index) => { modules[name] = moduleResults[index].items || []; });
    projects.push({ project, chapters, modules });
  }
  return projects;
}

async function collectCharacterVaultBackup(cloudProjects) {
  if (!cloudProjects.length || !("indexedDB" in window)) return [];
  const allowed = new Map();
  cloudProjects.forEach(entry => {
    const projectId = entry.project?.id;
    (entry.modules?.characters || []).forEach(character => {
      if (projectId && character.id) allowed.set(projectId + "::" + character.id, true);
    });
  });
  const db = await openCharacterVault();
  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(CHARACTER_VAULT_STORE, "readonly");
    const request = tx.objectStore(CHARACTER_VAULT_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error("อ่านคลังภาพเพื่อ Backup ไม่สำเร็จ"));
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
  const filtered = records.filter(record => allowed.has(record.projectId + "::" + record.characterId));
  const size = filtered.reduce((sum, record) => sum + String(record.dataUrl || "").length, 0);
  if (size > 34 * 1024 * 1024) throw new Error("คลังภาพอ้างอิงมีขนาดเกิน 34 MB กรุณาลดจำนวนภาพก่อนสำรองข้อมูล");
  return filtered;
}
async function restoreCharacterVaultRecords(records) {
  if (!Array.isArray(records) || !records.length) return;
  const db = await openCharacterVault();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(CHARACTER_VAULT_STORE, "readwrite");
    const store = tx.objectStore(CHARACTER_VAULT_STORE);
    records.forEach(record => store.put(record));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("กู้คืนคลังภาพไม่สำเร็จ")); };
  });
}
function validateCharacterVaultBackup(records, cloudProjects) {
  if (!Array.isArray(records) || records.length > 2000) throw new Error("ข้อมูลคลังภาพอ้างอิงใน Backup ไม่ถูกต้อง");
  const allowed = new Set();
  cloudProjects.forEach(entry => (entry.modules?.characters || []).forEach(character =>
    allowed.add(entry.project.id + "::" + character.id)
  ));
  for (const record of records) {
    if (!record || typeof record !== "object" ||
        !allowed.has(record.projectId + "::" + record.characterId) ||
        typeof record.id !== "string" || record.id.length > 100 ||
        typeof record.dataUrl !== "string" ||
        !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(record.dataUrl) ||
        record.dataUrl.length > 260000 ||
        typeof record.label !== "string" || record.label.length > 100 ||
        typeof record.note !== "string" || record.note.length > 300 ||
        !Number.isInteger(record.version) || record.version < 1 || record.version > 8 ||
        typeof record.canonical !== "boolean" ||
        !Number.isFinite(record.createdAt)) {
      throw new Error("พบภาพอ้างอิงที่ไม่ถูกต้องหรือไม่ได้อยู่ในโครงการเดียวกัน");
    }
  }
}
async function collectBackup() {
  const cloudProjects = await collectCloudBackup();
  const characterVault = await collectCharacterVaultBackup(cloudProjects);
  const data = collectLocalBackup();
  const illustrationLibrary = await collectIllustrationLibraryBackup(cloudProjects, data);
  return {
    app: "STORYFORGE",
    version: 4,
    createdAt: new Date().toISOString(),
    scope: {
      localDeviceData: true,
      cloudProjects: cloud.authenticated && cloud.ready,
      snapshotHistory: false,
      characterReferenceVault: true,
      illustrationLibrary: true
    },
    data,
    cloud: { projects: cloudProjects },
    characterVault,
    illustrationLibrary
  };
}

async function makeBackupFile() {
  const content = JSON.stringify(await collectBackup(), null, 2);
  if (new Blob([content]).size > 39 * 1024 * 1024) {
    throw new Error("ไฟล์ Backup มีขนาดเกินขีดจำกัดที่กู้คืนได้ 40 MB กรุณาลดขนาดหรือจำนวนข้อมูลภาพก่อนสำรองข้อมูล");
  }
  return content;
}

// ==========================================
// DOWNLOAD FUNCTIONS
// ==========================================

function chapterHtmlToPlainText(value) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(value || ""), "text/html");
  doc.body.querySelectorAll("br").forEach(node => node.replaceWith("\n"));
  doc.body.querySelectorAll("p,div,li,blockquote,h1,h2,h3,figure").forEach(node => {
    if (node.nextSibling) node.appendChild(doc.createTextNode("\n"));
  });
  return (doc.body.textContent || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function exportEntireNovelTxt() {
  const projectId = cloud.activeProjectId;
  if (!cloud.authenticated || !cloud.ready || !projectId) {
    alert("การส่งออกทั้งเล่มต้องเลือกนิยายที่เชื่อมต่อ Cloud และเข้าสู่ระบบก่อนครับ");
    return;
  }
  const button = $("exportBookTxt");
  if (button) { button.disabled = true; button.textContent = "กำลังรวบรวมบท..."; }
  try {
    if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
    if (cloud.activeChapterId && !(await saveCloudChapter())) {
      throw new Error("บันทึกบทปัจจุบันไม่สำเร็จ จึงหยุดส่งออกเพื่อป้องกันข้อมูลล่าสุดตกหล่น");
    }
    const project = cloud.projects.find(item => item.id === projectId);
    if (!project) throw new Error("ไม่พบโครงการที่เลือก");
    const list = await cloudApi("/api/projects/" + encodeURIComponent(projectId) + "/chapters");
    const chapters = list.chapters || [];
    if (!chapters.length) throw new Error("นิยายนี้ยังไม่มีบทให้ส่งออก");
    const full = await Promise.all(chapters.map(async item => {
      const result = await cloudApi("/api/chapters/" + encodeURIComponent(item.id));
      if (!result.chapter || result.chapter.project_id !== projectId) {
        throw new Error("พบข้อมูลบทที่ไม่ตรงกับนิยายที่เลือก ระบบยกเลิกการส่งออก");
      }
      return result.chapter;
    }));
    full.sort((left, right) => (left.sort_order - right.sort_order) ||
      String(left.created_at || "").localeCompare(String(right.created_at || "")));
    const sections = [
      project.title || "นิยายไม่มีชื่อ",
      project.pen_name ? "นามปากกา: " + project.pen_name : "",
      project.copyright_text || "",
      "แนวเรื่อง: " + (project.genre || "ไม่ระบุ"),
      "จำนวนบท: " + full.length,
      ""
    ];
    if (project.foreword) sections.push("คำนำ", "", project.foreword, "", "—".repeat(24), "");
    full.forEach((chapter, index) => {
      sections.push("บทที่ " + (index + 1) + " — " + (chapter.title || "บทไม่มีชื่อ"), "");
      sections.push(chapterHtmlToPlainText(chapter.body) || "");
      sections.push("", "—".repeat(24), "");
    });
    if (project.author_bio) sections.push("เกี่ยวกับผู้เขียน", "", project.author_bio, "");
    download(exportBaseName() + "-ทั้งเล่ม.txt", sections.join("\n"));
    const status = $("chapterSaveHint");
    if (status) status.textContent = "ส่งออกนิยายทั้งเล่มแล้ว · " + full.length + " บท";
  } catch (error) {
    alert("ส่งออกทั้งเล่มไม่สำเร็จ: " + error.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = "TXT ทั้งเล่ม"; }
  }
}

async function exportEntireNovelDocx() {
  const projectId = cloud.activeProjectId;
  if (!cloud.authenticated || !cloud.ready || !projectId) {
    alert("การส่งออก DOCX ทั้งเล่มต้องเลือกนิยายที่เชื่อมต่อ Cloud และเข้าสู่ระบบก่อนครับ");
    return;
  }
  const button = $("exportBookDocx");
  if (button) { button.disabled = true; button.textContent = "กำลังรวบรวมบท..."; }
  try {
    if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
    if (cloud.activeChapterId && !(await saveCloudChapter())) {
      throw new Error("บันทึกบทปัจจุบันไม่สำเร็จ จึงหยุดส่งออกเพื่อป้องกันข้อมูลล่าสุดตกหล่น");
    }
    const project = cloud.projects.find(item => item.id === projectId);
    if (!project) throw new Error("ไม่พบโครงการที่เลือก");
    const list = await cloudApi("/api/projects/" + encodeURIComponent(projectId) + "/chapters");
    const rows = list.chapters || [];
    if (!rows.length) throw new Error("นิยายนี้ยังไม่มีบทให้ส่งออก");
    const chapters = await Promise.all(rows.map(async item => {
      const result = await cloudApi("/api/chapters/" + encodeURIComponent(item.id));
      if (!result.chapter || result.chapter.project_id !== projectId) throw new Error("พบข้อมูลบทข้ามนิยาย ระบบยกเลิกการส่งออก");
      return result.chapter;
    }));
    chapters.sort((left, right) => (left.sort_order - right.sort_order) ||
      String(left.created_at || "").localeCompare(String(right.created_at || "")));
    const totalSize = chapters.reduce((sum, item) => sum + String(item.body || "").length, 0);
    if (totalSize > 12 * 1024 * 1024) throw new Error("ต้นฉบับทั้งเล่มมีขนาดเกิน 12 MB กรุณาแบ่งส่งออกเป็นส่วน");
    exportManuscriptDocx(chapters, project.title || "ต้นฉบับนิยาย");
    const status = $("chapterSaveHint");
    if (status) status.textContent = "ส่งออก DOCX ทั้งเล่มแล้ว · " + chapters.length + " บท";
  } catch (error) {
    alert("ส่งออก DOCX ทั้งเล่มไม่สำเร็จ: " + error.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = "DOCX ทั้งเล่ม"; }
  }
}

async function exportEntireNovelPdf() {
  const projectId = cloud.activeProjectId;
  if (!cloud.authenticated || !cloud.ready || !projectId) {
    alert("การสร้าง PDF ทั้งเล่มต้องเลือกนิยายที่เชื่อมต่อ Cloud และเข้าสู่ระบบก่อนครับ");
    return;
  }
  const button = $("exportBookPdf");
  if (button) { button.disabled = true; button.textContent = "กำลังเตรียม PDF..."; }
  try {
    if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
    if (cloud.activeChapterId && !(await saveCloudChapter())) {
      throw new Error("บันทึกบทปัจจุบันไม่สำเร็จ จึงหยุดส่งออกเพื่อป้องกันข้อมูลล่าสุดตกหล่น");
    }
    const project = cloud.projects.find(item => item.id === projectId);
    if (!project) throw new Error("ไม่พบโครงการที่เลือก");
    const list = await cloudApi("/api/projects/" + encodeURIComponent(projectId) + "/chapters");
    const chapters = list.chapters || [];
    if (!chapters.length) throw new Error("นิยายนี้ยังไม่มีบทให้ส่งออก");
    const full = await Promise.all(chapters.map(async item => {
      const result = await cloudApi("/api/chapters/" + encodeURIComponent(item.id));
      if (!result.chapter || result.chapter.project_id !== projectId) {
        throw new Error("พบข้อมูลบทที่ไม่ตรงกับนิยายที่เลือก ระบบยกเลิกการส่งออก");
      }
      return result.chapter;
    }));
    full.sort((left, right) => (left.sort_order - right.sort_order) ||
      String(left.created_at || "").localeCompare(String(right.created_at || "")));
    const totalSize = full.reduce((sum, chapter) => sum + String(chapter.body || "").length, 0);
    if (totalSize > 12 * 1024 * 1024) throw new Error("ต้นฉบับทั้งเล่มมีขนาดใหญ่เกินขีดจำกัดการจัดหน้า 12 MB กรุณาแบ่งส่งออกเป็นส่วน");
    const printNode = $("printManuscriptText");
    if (!printNode) throw new Error("ไม่พบพื้นที่จัดหน้า PDF");
    const toc = '<section class="print-book-toc"><h2>สารบัญ</h2><ol>' + full.map((chapter, index) =>
      '<li>' + escapeHtml("บทที่ " + (index + 1) + " — " + (chapter.title || "บทไม่มีชื่อ")) + '</li>'
    ).join("") + '</ol></section>';
    const sections = full.map((chapter, index) => {
      const body = sanitizeManuscriptHtml(chapter.body || "");
      return '<section class="print-book-chapter"><h2 class="print-chapter-title">' +
        escapeHtml("บทที่ " + (index + 1) + " — " + (chapter.title || "บทไม่มีชื่อ")) +
        '</h2><div class="print-book-body">' + body + '</div></section>';
    }).join("");
    printNode.innerHTML = '<h1 class="print-book-title">' + escapeHtml(project.title || "ต้นฉบับนิยาย") +
      '</h1><p class="print-book-meta">จำนวน ' + full.length + ' บท</p>' + toc + sections;
    document.body.classList.add("print-manuscript");
    const cleanup = () => {
      document.body.classList.remove("print-manuscript");
      printNode.hidden = true;
      window.removeEventListener("afterprint", cleanup);
    };
    printNode.hidden = false;
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    const status = $("chapterSaveHint");
    if (status) status.textContent = "เตรียม PDF ทั้งเล่มแล้ว · " + full.length + " บท · เลือกบันทึกเป็น PDF ในหน้าต่างพิมพ์";
  } catch (error) {
    alert("เตรียม PDF ทั้งเล่มไม่สำเร็จ: " + error.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = "PDF ทั้งเล่ม"; }
  }
}

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

async function downloadCurrentBackup() {
  const date = new Date().toISOString().replace(/[:.]/g, "-");
  const backupText = await makeBackupFile();
  download(`STORYFORGE-backup-${date}.json`, backupText);
  return true;
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
        "x-backup-secret": secret,
        "X-CSRF-Token": cloud.csrfToken
      },

      body: JSON.stringify({
        filename: "STORYFORGE-backup.json",
        content: await makeBackupFile()
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

    const succeeded = await sendTelegramBackup(true);

    // A failed backup must retry soon instead of silently waiting another full interval.
    nextAutoBackupAt = succeeded
      ? Date.now() + hours * 60 * 60 * 1000
      : Date.now() + AUTO_BACKUP_RETRY_MS;

    if (!succeeded) {
      $("backupStatus").textContent =
        "Backup อัตโนมัติไม่สำเร็จ ระบบจะลองใหม่ใน 15 นาที";
    }

  }, 60 * 1000);
}

// ==========================================
// RESTORE BACKUP
// ==========================================

function validateCloudBackupData(backupProjects) {
  if (!Array.isArray(backupProjects)) throw new Error("ข้อมูล Cloud Backup ไม่ถูกต้อง");
  const collections = ["characters", "relationships", "plot-threads", "world-lore", "timeline", "notes"];
  const seenProjects = new Set();
  for (const entry of backupProjects) {
    const project = entry?.project;
    if (!project || !UUID_RE.test(project.id || "") || seenProjects.has(project.id) ||
        !Array.isArray(entry.chapters) || !entry.modules || typeof entry.modules !== "object" || Array.isArray(entry.modules) ||
        !collections.every(collection => Object.prototype.hasOwnProperty.call(entry.modules, collection))) {
      throw new Error("โครงสร้างโครงการใน Backup ไม่ถูกต้อง หรือมีรหัสโครงการซ้ำ");
    }
    seenProjects.add(project.id);
    if (typeof project.title !== "string" || !project.title.trim() || project.title.length > 160 ||
        (project.genre != null && (typeof project.genre !== "string" || project.genre.length > 100)) ||
        (project.synopsis != null && (typeof project.synopsis !== "string" || project.synopsis.length > 10000)) ||
        (project.pen_name != null && (typeof project.pen_name !== "string" || project.pen_name.length > 120)) ||
        (project.copyright_text != null && (typeof project.copyright_text !== "string" || project.copyright_text.length > 300)) ||
        (project.foreword != null && (typeof project.foreword !== "string" || project.foreword.length > 10000)) ||
        (project.author_bio != null && (typeof project.author_bio !== "string" || project.author_bio.length > 3000)) ||
        (project.cover_brief_json != null && (() => {
          try {
            const brief = typeof project.cover_brief_json === "string" ? JSON.parse(project.cover_brief_json) : project.cover_brief_json;
            return !brief || typeof brief !== "object" || Array.isArray(brief) || JSON.stringify(brief).length > 25000 || (brief.projectId != null && brief.projectId !== project.id);
          } catch { return true; }
        })()) ||
        (project.status != null && !["active", "archived"].includes(project.status))) {
      throw new Error("ข้อมูลชื่อหรือรายละเอียดโครงการไม่ถูกต้อง");
    }
    const chapterIds = new Set();
    for (const chapter of entry.chapters) {
      if (!chapter || !UUID_RE.test(chapter.id || "") || chapterIds.has(chapter.id) ||
          typeof chapter.title !== "string" || chapter.title.length > 240 ||
          typeof chapter.body !== "string" || chapter.body.length > 500000 ||
          (chapter.synopsis != null && (typeof chapter.synopsis !== "string" || chapter.synopsis.length > 3000)) ||
          (chapter.writing_status != null && !["planned", "draft", "revised", "final"].includes(chapter.writing_status)) ||
          (chapter.sort_order != null && (!Number.isInteger(chapter.sort_order) || chapter.sort_order < 0 || chapter.sort_order > 1000000)) ||
          (chapter.word_count != null && (!Number.isInteger(chapter.word_count) || chapter.word_count < 0 || chapter.word_count > 10000000 ||
            chapter.word_count !== countWords(chapter.body)))) {
        throw new Error("ข้อมูลบทนิยายใน Backup ไม่ถูกต้อง หรือมีรหัสบทซ้ำ");
      }
      chapterIds.add(chapter.id);
    }
    const characterIds = new Set();
    for (const collection of collections) {
      const rows = entry.modules[collection] ?? [];
      if (!Array.isArray(rows)) throw new Error("ข้อมูลหมวด " + collection + " ใน Backup ไม่ถูกต้อง");
      const ids = new Set();
      for (const item of rows) {
        if (!item || !UUID_RE.test(item.id || "") || ids.has(item.id)) {
          throw new Error("ข้อมูลหมวด " + collection + " มีรหัสรายการไม่ถูกต้องหรือซ้ำ");
        }
        ids.add(item.id);
        const checkString = (field, max, required = false) => {
          const value = item[field];
          if ((required && (typeof value !== "string" || !value.trim())) ||
              (value != null && (typeof value !== "string" || value.length > max))) {
            throw new Error("ข้อมูล " + collection + "." + field + " ไม่ถูกต้อง");
          }
        };
        const checkOrder = () => {
          if (item.sort_order != null && (!Number.isInteger(item.sort_order) || item.sort_order < 0 || item.sort_order > 1000000)) {
            throw new Error("ลำดับรายการในหมวด " + collection + " ไม่ถูกต้อง");
          }
        };
        if (collection === "characters") {
          checkString("name", 160, true); checkString("role", 80); checkOrder();
          if (item.profile_json != null) {
            try { JSON.parse(typeof item.profile_json === "string" ? item.profile_json : JSON.stringify(item.profile_json)); }
            catch { throw new Error("ข้อมูลโปรไฟล์ตัวละครไม่ใช่ JSON ที่ถูกต้อง"); }
            if ((typeof item.profile_json === "string" ? item.profile_json : JSON.stringify(item.profile_json)).length > 20000) throw new Error("ข้อมูลโปรไฟล์ตัวละครยาวเกินกำหนด");
          }
          characterIds.add(item.id);
        } else if (collection === "relationships") {
          checkString("source_character_id", 80, true); checkString("target_character_id", 80, true);
          if (!UUID_RE.test(item.source_character_id) || !UUID_RE.test(item.target_character_id)) throw new Error("รหัสตัวละครในความสัมพันธ์ไม่ถูกต้อง");
          checkString("relationship_type", 100); checkString("description", 5000);
          if (item.source_character_id === item.target_character_id) throw new Error("ความสัมพันธ์ตัวละครอ้างถึงตัวละครเดียวกัน");
        } else if (collection === "plot-threads") {
          checkString("title", 200, true); checkString("summary", 10000); checkOrder();
          if (item.status != null && !["planned", "in_progress", "completed", "paused"].includes(item.status)) throw new Error("สถานะปมเรื่องไม่ถูกต้อง");
          let chapterReferences;
          try { chapterReferences = item.chapter_ids_json == null ? [] : JSON.parse(typeof item.chapter_ids_json === "string" ? item.chapter_ids_json : JSON.stringify(item.chapter_ids_json)); }
          catch { throw new Error("เส้นเรื่องมีรายการบทที่อ้างอิงไม่ถูกต้อง"); }
          if (!Array.isArray(chapterReferences) || chapterReferences.length > 100 ||
              chapterReferences.some(id => typeof id !== "string" || !UUID_RE.test(id) || !chapterIds.has(id)) ||
              new Set(chapterReferences).size !== chapterReferences.length) {
            throw new Error("เส้นเรื่องอ้างถึงบทที่ไม่มีอยู่ในโครงการเดียวกัน");
          }
        } else if (collection === "world-lore") {
          checkString("category", 80); checkString("title", 200, true); checkString("content", 30000); checkOrder();
          let refs; try { refs = item.chapter_ids_json == null ? [] : JSON.parse(typeof item.chapter_ids_json === "string" ? item.chapter_ids_json : JSON.stringify(item.chapter_ids_json)); } catch { throw new Error("ข้อมูลโลกมีบทที่อ้างอิงไม่ถูกต้อง"); }
          if (!Array.isArray(refs) || refs.length > 100 || refs.some(id => typeof id !== "string" || !UUID_RE.test(id) || !chapterIds.has(id)) || new Set(refs).size !== refs.length) throw new Error("ข้อมูลโลกอ้างถึงบทที่ไม่มีอยู่ในโครงการเดียวกัน");
        } else if (collection === "timeline") {
          checkString("title", 200, true); checkString("description", 10000); checkString("story_time", 120); checkOrder();
          let refs; try { refs = item.chapter_ids_json == null ? [] : JSON.parse(typeof item.chapter_ids_json === "string" ? item.chapter_ids_json : JSON.stringify(item.chapter_ids_json)); } catch { throw new Error("Timeline มีบทที่อ้างอิงไม่ถูกต้อง"); }
          if (!Array.isArray(refs) || refs.length > 100 || refs.some(id => typeof id !== "string" || !UUID_RE.test(id) || !chapterIds.has(id)) || new Set(refs).size !== refs.length) throw new Error("Timeline อ้างถึงบทที่ไม่มีอยู่ในโครงการเดียวกัน");
        } else if (collection === "notes") {
          checkString("title", 200); checkString("content", 30000); checkString("note_type", 60);
          checkString("scene_type", 40); checkString("scene_status", 40);
          if (item.pinned != null && ![true, false, 0, 1].includes(item.pinned)) throw new Error("สถานะปักหมุดในบันทึกไม่ถูกต้อง");
          let sceneChapterRefs;
          try { sceneChapterRefs = item.chapter_ids_json == null ? [] : JSON.parse(typeof item.chapter_ids_json === "string" ? item.chapter_ids_json : JSON.stringify(item.chapter_ids_json)); }
          catch { throw new Error("ฉากมีรายการบทที่อ้างอิงไม่ถูกต้อง"); }
          if (!Array.isArray(sceneChapterRefs) || sceneChapterRefs.length > 100 ||
              sceneChapterRefs.some(id => typeof id !== "string" || !UUID_RE.test(id) || !chapterIds.has(id)) ||
              new Set(sceneChapterRefs).size !== sceneChapterRefs.length) {
            throw new Error("ฉากอ้างถึงบทที่ไม่มีอยู่ในโครงการเดียวกัน");
          }
          if (item.note_type === "scene" && (!["setup", "conflict", "turning_point", "climax", "resolution", "other"].includes(item.scene_type || "other") ||
              !["planned", "drafting", "written", "revised"].includes(item.scene_status || "planned"))) {
            throw new Error("ประเภทหรือสถานะฉากใน Backup ไม่ถูกต้อง");
          }
        }
      }
    }
    for (const chapter of entry.chapters) {
      let references;
      try { references = chapter.character_ids_json == null ? [] : JSON.parse(typeof chapter.character_ids_json === "string" ? chapter.character_ids_json : JSON.stringify(chapter.character_ids_json)); }
      catch { throw new Error("บทนิยายมีรายการตัวละครที่อ้างอิงไม่ถูกต้อง"); }
      if (!Array.isArray(references) || references.length > 50 ||
          references.some(id => typeof id !== "string" || !UUID_RE.test(id) || !characterIds.has(id)) ||
          new Set(references).size !== references.length) {
        throw new Error("บทนิยายอ้างถึงตัวละครที่ไม่มีอยู่ในโครงการเดียวกัน");
      }
    }
    for (const collection of ["plot-threads", "world-lore", "timeline", "notes"]) {
      for (const item of (entry.modules[collection] || [])) {
        let references;
        try { references = item.character_ids_json == null ? [] : JSON.parse(typeof item.character_ids_json === "string" ? item.character_ids_json : JSON.stringify(item.character_ids_json)); }
        catch { throw new Error("รายการ " + collection + " มีรายการตัวละครที่อ้างอิงไม่ถูกต้อง"); }
        if (!Array.isArray(references) || references.length > 50 ||
            references.some(id => typeof id !== "string" || !UUID_RE.test(id) || !characterIds.has(id)) ||
            new Set(references).size !== references.length) {
          throw new Error("รายการ " + collection + " อ้างถึงตัวละครที่ไม่มีอยู่ในโครงการเดียวกัน");
        }
      }
    }
    for (const relation of (entry.modules.relationships || [])) {
      if (!characterIds.has(relation.source_character_id) || !characterIds.has(relation.target_character_id)) {
        throw new Error("ความสัมพันธ์ใน Backup อ้างถึงตัวละครที่ไม่มีอยู่ในโครงการเดียวกัน");
      }
    }
  }
  return true;
}

async function restoreCloudBackup(backupProjects) {
  validateCloudBackupData(backupProjects);
  if (!Array.isArray(backupProjects)) throw new Error("ข้อมูล Cloud Backup ไม่ถูกต้อง");
  if (backupProjects.length && (!cloud.authenticated || !cloud.ready)) {
    throw new Error("ไฟล์นี้มีข้อมูล Cloud กรุณาเข้าสู่ระบบ StoryForge ก่อนกู้คืน");
  }
  const collections = ["characters", "plot-threads", "world-lore", "timeline", "notes", "relationships"];
  const createdProjects = new Set();
  const createdItems = [];
  const changedProjectStatuses = [];
  try {
    for (const entry of backupProjects) {
      const createdPlotChapterLinks = [];
      const createdSceneChapterLinks = [];
      const createdCanonChapterLinks = [];
      if (!entry?.project?.id || !Array.isArray(entry.chapters) || !entry.modules || typeof entry.modules !== "object") {
        throw new Error("โครงสร้างข้อมูลโครงการใน Backup ไม่ถูกต้อง");
      }
      const project = entry.project;
      const projectResult = await cloudApi("/api/projects", {
        method: "POST",
        body: JSON.stringify({ clientId: project.id, title: project.title || "นิยายที่กู้คืน", genre: project.genre || "", synopsis: project.synopsis || "", pen_name: project.pen_name || "", copyright_text: project.copyright_text || "", foreword: project.foreword || "", author_bio: project.author_bio || "", cover_brief_json: project.cover_brief_json || "{}" })
      });
      if (projectResult.created) createdProjects.add(project.id);
      if (project.status === "archived" && projectResult.project?.status !== "archived") {
        changedProjectStatuses.push({ id: project.id, status: projectResult.project?.status || "active" });
        await cloudApi("/api/projects/" + encodeURIComponent(project.id), {
          method: "PATCH", body: JSON.stringify({ status: "archived" })
        });
      }

      // Characters and other canon records are restored before chapters so chapter references validate.
      for (const collection of collections) {
        const rows = entry.modules[collection] || [];
        if (!Array.isArray(rows)) throw new Error("ข้อมูล " + collection + " ใน Backup ไม่ถูกต้อง");
        for (const item of rows) {
          const payload = { clientId: item.id };
          const allowed = {
            characters: ["name", "role", "profile_json", "sort_order"],
            relationships: ["source_character_id", "target_character_id", "relationship_type", "description"],
            "plot-threads": ["title", "summary", "status", "sort_order", "character_ids_json"],
            "world-lore": ["category", "title", "content", "sort_order", "character_ids_json", "chapter_ids_json"],
            timeline: ["title", "description", "story_time", "sort_order", "character_ids_json", "chapter_ids_json"],
            notes: ["title", "content", "note_type", "pinned", "character_ids_json", "chapter_ids_json", "scene_type", "scene_status"]
          }[collection];
          for (const field of allowed) {
            if (field === "chapter_ids_json" && ((collection === "notes" && item.note_type === "scene") || collection === "world-lore" || collection === "timeline")) continue;
            if (item[field] !== undefined) payload[field] = field === "pinned" ? Boolean(item[field]) : item[field];
          }
          const result = await cloudApi("/api/projects/" + encodeURIComponent(project.id) + "/" + collection, {
            method: "POST", body: JSON.stringify(payload)
          });
          if (result.created) {
            createdItems.push({
              projectId: project.id,
              path: "/api/projects/" + encodeURIComponent(project.id) + "/" + collection + "/" + encodeURIComponent(item.id)
            });
            if (collection === "plot-threads" && Array.isArray(item.chapter_ids_json)) {
              createdPlotChapterLinks.push({ id: item.id, chapterIds: item.chapter_ids_json });
            } else if (collection === "plot-threads" && typeof item.chapter_ids_json === "string") {
              createdPlotChapterLinks.push({ id: item.id, chapterIds: JSON.parse(item.chapter_ids_json) });
            }
            if (collection === "notes" && item.note_type === "scene") {
              let chapterIds = [];
              try { chapterIds = Array.isArray(item.chapter_ids_json) ? item.chapter_ids_json : JSON.parse(item.chapter_ids_json || "[]"); } catch {}
              if (Array.isArray(chapterIds) && chapterIds.length) createdSceneChapterLinks.push({ id: item.id, chapterIds });
            }
            if (["world-lore", "timeline"].includes(collection)) {
              let chapterIds = [];
              try { chapterIds = Array.isArray(item.chapter_ids_json) ? item.chapter_ids_json : JSON.parse(item.chapter_ids_json || "[]"); } catch {}
              if (Array.isArray(chapterIds) && chapterIds.length) createdCanonChapterLinks.push({ collection, id: item.id, chapterIds });
            }
          }
        }
      }

      for (const chapter of entry.chapters) {
        const result = await cloudApi("/api/projects/" + encodeURIComponent(project.id) + "/chapters", {
          method: "POST",
          body: JSON.stringify({
            clientId: chapter.id,
            title: chapter.title || "",
            body: chapter.body || "",
            synopsis: chapter.synopsis || "",
            writing_status: chapter.writing_status || "draft",
            sortOrder: Number.isInteger(chapter.sort_order) ? chapter.sort_order : 0,
            wordCount: Number.isInteger(chapter.word_count) ? chapter.word_count : countWords(chapter.body || ""),
            character_ids_json: chapter.character_ids_json || "[]"
          })
        });
        if (result.created) createdItems.push({ projectId: project.id, path: "/api/chapters/" + encodeURIComponent(chapter.id) });
      }
      for (const plot of createdPlotChapterLinks) {
        await cloudApi("/api/projects/" + encodeURIComponent(project.id) + "/plot-threads/" + encodeURIComponent(plot.id), {
          method: "PATCH",
          body: JSON.stringify({ chapter_ids_json: plot.chapterIds })
        });
      }
      for (const scene of createdSceneChapterLinks) {
        await cloudApi("/api/projects/" + encodeURIComponent(project.id) + "/notes/" + encodeURIComponent(scene.id), {
          method: "PATCH",
          body: JSON.stringify({ chapter_ids_json: scene.chapterIds })
        });
      }
      for (const canon of createdCanonChapterLinks) {
        await cloudApi("/api/projects/" + encodeURIComponent(project.id) + "/" + canon.collection + "/" + encodeURIComponent(canon.id), {
          method: "PATCH",
          body: JSON.stringify({ chapter_ids_json: canon.chapterIds })
        });
      }
    }
  } catch (restoreError) {
    // Roll back only records created by this restore. Existing Cloud records are never deleted.
    const rollbackErrors = [];
    for (const item of createdItems.reverse()) {
      if (createdProjects.has(item.projectId)) continue;
      try { await cloudApi(item.path, { method: "DELETE" }); }
      catch (error) { rollbackErrors.push(error.message); }
    }
    for (const project of changedProjectStatuses.reverse()) {
      if (createdProjects.has(project.id)) continue;
      try {
        await cloudApi("/api/projects/" + encodeURIComponent(project.id), {
          method: "PATCH", body: JSON.stringify({ status: project.status })
        });
      } catch (error) { rollbackErrors.push(error.message); }
    }
    for (const projectId of Array.from(createdProjects).reverse()) {
      try { await cloudApi("/api/projects/" + encodeURIComponent(projectId), { method: "DELETE" }); }
      catch (error) { rollbackErrors.push(error.message); }
    }
    if (rollbackErrors.length) {
      throw new Error(restoreError.message + " · การย้อนคืนบางรายการไม่สำเร็จ กรุณาตรวจสอบโครงการบน Cloud (" + rollbackErrors.length + " รายการ)");
    }
    throw restoreError;
  }
}

function restoreFromFile() {
  const file = $("restoreFile").files[0];
  if (!file) { alert("กรุณาเลือกไฟล์ Backup ก่อนครับ"); return; }
  if (file.size > 40 * 1024 * 1024) { alert("ไฟล์ Backup มีขนาดใหญ่เกินกำหนด 40 MB"); return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const backup = JSON.parse(reader.result);
      if (backup.app !== "STORYFORGE" || ![1, 2, 3, 4].includes(backup.version) ||
          !backup.data || typeof backup.data !== "object" || Array.isArray(backup.data)) {
        throw new Error("ไฟล์นี้ไม่ใช่ Backup ของ STORYFORGE");
      }
      const entries = Object.entries(backup.data);
      if (entries.some(([key, value]) => !key.startsWith("sf_") || typeof value !== "string")) {
        throw new Error("ข้อมูลในไฟล์ Backup ไม่ถูกต้อง");
      }
      const cloudProjects = backup.version >= 2 ? (backup.cloud?.projects || []) : [];
      if (backup.version >= 2 && !Array.isArray(cloudProjects)) throw new Error("ข้อมูล Cloud Backup ไม่ถูกต้อง");
      if (cloudProjects.length) validateCloudBackupData(cloudProjects);
      const characterVault = backup.version >= 3 ? (backup.characterVault || []) : [];
      if (backup.version >= 3) validateCharacterVaultBackup(characterVault, cloudProjects);
      const illustrationLibrary = backup.version >= 4 ? (backup.illustrationLibrary || []) : [];
      if (backup.version >= 4) validateIllustrationLibraryBackup(illustrationLibrary, cloudProjects, backup.data);
      if (!entries.length && !cloudProjects.length && !characterVault.length && !illustrationLibrary.length) throw new Error("ไม่พบข้อมูลสำหรับกู้คืน");
      const confirmed = confirm(
        "ระบบจะดาวน์โหลดข้อมูลปัจจุบันเก็บไว้ก่อน แล้วนำข้อมูลจาก Backup เข้ามาเพิ่ม\n\n" +
        "ข้อมูล Cloud จะถูกรวมด้วยรหัสเดิมโดยไม่ลบโครงการปัจจุบัน และข้อมูลในอุปกรณ์จะถูกแทนที่\n" +
        "ประวัติ Snapshot ไม่รวมอยู่ใน Backup รุ่นนี้\n\nต้องการดำเนินการต่อหรือไม่?"
      );
      if (!confirmed) return;
      await downloadCurrentBackup();
      if (cloudProjects.length) {
        $("backupStatus").textContent = "กำลังกู้คืนโครงการและข้อมูล Cloud...";
        await restoreCloudBackup(cloudProjects);
      }
      if (characterVault.length) { $("backupStatus").textContent = "กำลังกู้คืนคลังภาพอ้างอิง..."; await restoreCharacterVaultRecords(characterVault); }
      if (illustrationLibrary.length) { $("backupStatus").textContent = "กำลังกู้คืนคลังภาพประกอบ..."; await restoreIllustrationLibraryRecords(illustrationLibrary); }
      const previousData = collectLocalBackup();
      try {
        for (const key of Object.keys(localStorage)) if (key.startsWith("sf_")) localStorage.removeItem(key);
        for (const [key, value] of entries) localStorage.setItem(key, value);
      } catch (error) {
        try {
          for (const key of Object.keys(localStorage)) if (key.startsWith("sf_")) localStorage.removeItem(key);
          for (const [key, value] of Object.entries(previousData)) localStorage.setItem(key, value);
        } catch (rollbackError) { console.error("Restore rollback failed:", rollbackError); }
        throw error;
      }
      alert("กู้คืนข้อมูลสำเร็จแล้วครับ เว็บไซต์จะโหลดใหม่");
      location.reload();
    } catch (error) {
      alert("ไม่สามารถกู้คืนข้อมูลได้: " + error.message);
    }
  };
  reader.onerror = () => alert("อ่านไฟล์ Backup ไม่สำเร็จ");
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
  const value = String(text || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ");
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
  localStorage.setItem(writingWordGoalKey(), String(goal));
  const words = Number.isInteger(knownWordCount) ? knownWordCount : countWords($("manuscriptBody")?.value || "");
  if ($("wordGoalStatus")) $("wordGoalStatus").textContent =
    words.toLocaleString("th-TH") + " / " + goal.toLocaleString("th-TH") + " คำ";
  if ($("wordGoalProgress")) $("wordGoalProgress").style.width = Math.min(100, (words / goal) * 100) + "%";
}

function activeChapterDraft() {
  return {
    title: $("chapterTitle")?.value || "",
    body: $("manuscriptBody")?.value || "",
    synopsis: $("chapterSynopsis")?.value || "",
    writing_status: $("chapterStatus")?.value || "draft",
    character_ids_json: JSON.stringify(Array.from($("chapterCharacters")?.selectedOptions || []).map(option => option.value).filter(Boolean))
  };
}
function save(changedKey = "", deferCloud = false) {
  let localStorageReady = true;
  keys.forEach(key => {
    try {
      localStorage.setItem(storageKeyFor(key), key === "genre" ? getProjectGenre() : $(key).value);
    } catch (error) {
      localStorageReady = false;
      console.warn("Local StoryForge recovery storage failed:", error);
    }
  });
  $("saveState").innerHTML = localStorageReady
    ? '<span class="status-dot"></span>บันทึกฉบับกู้คืนในอุปกรณ์นี้แล้ว'
    : '<span class="status-dot"></span>พื้นที่จัดเก็บในอุปกรณ์ไม่พร้อมใช้งาน · กำลังพยายามบันทึก Cloud';
  renderDashboard();
  if (!deferCloud && cloud.authenticated && cloud.ready && cloud.activeProjectId && cloud.activeChapterId &&
      ["chapterTitle", "manuscriptBody"].includes(changedKey)) {
    storeLocalChapterDraft(cloud.activeChapterId, activeChapterDraft(), cloud.revision);
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
  let projectWritingSettings = {};
  try { projectWritingSettings = JSON.parse(localStorage.getItem(writingSettingsKey(active?.id)) || "{}"); } catch {}
  const configuredNovelGoal = Number(projectWritingSettings.chapterCount) * Number(projectWritingSettings.wordsPerChapter);
  const novelGoal = Math.max(1, Number.isFinite(configuredNovelGoal) && configuredNovelGoal > 0
    ? configuredNovelGoal
    : (Number.parseInt(localStorage.getItem("sf_novel_word_goal") || "60000", 10) || 60000));
  if ($("sidebarProjectName")) $("sidebarProjectName").textContent = title || "ยังไม่ได้เลือกนิยาย";
  if ($("sidebarProjectMeta")) $("sidebarProjectMeta").textContent = active
    ? (active.genre || "นิยายของฉัน") + (cloud.ready ? " · Private Beta Cloud" : " · บันทึกในอุปกรณ์นี้") + (active.id ? " · ID: " + active.id : "")
    : "เริ่มต้นสร้างเรื่องราวของคุณ";
  if ($("dashboardProjectTitle")) $("dashboardProjectTitle").textContent = title || "ยังไม่มีนิยายในห้องสมุด";
  if ($("dashboardChapterLine")) $("dashboardChapterLine").textContent = chapter ? "บทล่าสุด · " + chapter : (title ? "เพิ่มชื่อบทและเริ่มเขียนต้นฉบับของคุณ" : "เริ่มต้นสร้างโลกและตัวละครของคุณได้เลย");
  if ($("dashboardLastEdited")) $("dashboardLastEdited").textContent = active
    ? (cloud.ready ? "โครงการนี้เชื่อมต่อกับบัญชี Private Beta" : "โครงการนี้บันทึกไว้ในเบราว์เซอร์เครื่องนี้") + (active.id ? " · Project ID: " + active.id : "")
    : "พื้นที่เขียนนิยายส่วนตัว · บันทึกในอุปกรณ์นี้";
  if ($("dashboardWordCount")) $("dashboardWordCount").textContent = count.toLocaleString("th-TH");
  if ($("dashboardWordGoal")) $("dashboardWordGoal").textContent = "/ " + novelGoal.toLocaleString("th-TH") + " คำ";
  if ($("dashboardProgress")) $("dashboardProgress").style.width = Math.min(100, (count / novelGoal) * 100) + "%";
  if ($("recentChapterTitle")) $("recentChapterTitle").textContent = chapter || "ยังไม่มีบทที่บันทึก";
  if ($("recentWordCount")) $("recentWordCount").textContent = chapterWords.toLocaleString("th-TH") + " คำ";
  const recentList = $("dashboardRecentChapters");
  if (recentList) {
    const recentChapters = cloud.ready ? cloud.chapters.slice(0, 3) : [];
    if (recentChapters.length) {
      recentList.innerHTML = recentChapters.map((item, index) =>
        `<button type="button" class="recent-row dashboard-recent-row" data-dashboard-chapter="${escapeHtml(item.id)}"><span class="chapter-number">${String(index + 1).padStart(2, "0")}</span><span class="recent-title">${escapeHtml(item.title || "บทไม่มีชื่อ")}</span><span class="recent-detail">${(Number(item.word_count) || 0).toLocaleString("th-TH")} คำ</span><span class="recent-arrow">→</span></button>`
      ).join("");
      recentList.querySelectorAll("[data-dashboard-chapter]").forEach(button =>
        button.addEventListener("click", async () => {
          await selectCloudChapter(button.dataset.dashboardChapter);
          showTab("manuscript");
        })
      );
      if ($("dashboardRecentHint")) $("dashboardRecentHint").textContent = "แตะชื่อบทเพื่อกลับไปเขียนต่อ · แสดง 3 บทล่าสุด";
    } else {
      recentList.innerHTML = `<div class="recent-row"><span class="chapter-number">01</span><span class="recent-title">${escapeHtml(chapter || "ยังไม่มีบทที่บันทึก")}</span><span class="recent-detail">${chapterWords.toLocaleString("th-TH")} คำ</span></div>`;
      if ($("dashboardRecentHint")) $("dashboardRecentHint").textContent = active ? "บทปัจจุบันในอุปกรณ์นี้ · เชื่อม Cloud เพื่อจัดการหลายบท" : "สร้างนิยายและเพิ่มบทแรกเพื่อเริ่มต้น";
    }
  }
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
  if (tab === "cover") loadCoverBrief();
  if (tab === "illustrations") { loadIllustrationSettings(); renderIllustrationLibrary(); }
}


// ==========================================
// BOOK COVER STUDIO — project-scoped local brief
// ==========================================
function activeCoverProject() {
  if (cloud.ready && cloud.activeProjectId) {
    return cloud.projects.find(project => project.id === cloud.activeProjectId) || null;
  }
  const projects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
  const activeId = localStorage.getItem("sf_active_project_id");
  return Array.isArray(projects) ? projects.find(project => project.id === activeId) || projects[0] || null : null;
}
function coverBriefKey(projectId) { return "sf_cover_brief_" + projectId; }
function selectedCoverCharacterNames() {
  const select = $("coverCharacters");
  return select ? Array.from(select.selectedOptions).map(option => option.textContent) : [];
}
function refreshCoverCharacterOptions(selectedIds = []) {
  const select = $("coverCharacters");
  if (!select) return;
  const project = activeCoverProject();
  const characters = project && cloud.ready && project.id === cloud.activeProjectId
    ? (cloud.modules.characters || [])
    : [];
  select.replaceChildren();
  characters.forEach(character => {
    const option = document.createElement("option");
    option.value = character.id;
    option.textContent = character.name || "ตัวละครไม่มีชื่อ";
    option.selected = selectedIds.includes(character.id);
    select.appendChild(option);
  });
  if (!characters.length) {
    const option = document.createElement("option");
    option.disabled = true;
    option.textContent = "ยังไม่มีตัวละครในนิยายที่เชื่อม Cloud";
    select.appendChild(option);
  }
}
function readCoverBrief() {
  return {
    projectId: activeCoverProject()?.id || "",
    title: $("coverTitle")?.value.trim() || "",
    penName: $("coverPenName")?.value.trim() || "",
    style: $("coverStyle")?.value || "Classic Storybook",
    characterIds: Array.from($("coverCharacters")?.selectedOptions || []).map(option => option.value).filter(Boolean),
    blurb: $("coverBlurb")?.value.trim() || "",
    direction: $("coverDirection")?.value.trim() || "",
    prompt: $("coverPrompt")?.value || ""
  };
}
function renderCoverPreview() {
  if ($("coverPreviewTitle")) $("coverPreviewTitle").textContent = $("coverTitle")?.value.trim() || "ชื่อเรื่องของคุณ";
  if ($("coverPreviewAuthor")) $("coverPreviewAuthor").textContent = $("coverPenName")?.value.trim() || "นามปากกา";
  if ($("coverPreviewStyle")) $("coverPreviewStyle").textContent = ($("coverStyle")?.value || "Classic Storybook").toUpperCase();
}
function loadCoverBrief() {
  const project = activeCoverProject();
  const cloudBrief = project?.cover_brief_json
    ? safeJSON(typeof project.cover_brief_json === "string" ? project.cover_brief_json : JSON.stringify(project.cover_brief_json), {})
    : null;
  const brief = cloudBrief && Object.keys(cloudBrief).length
    ? cloudBrief
    : (project ? safeJSON(localStorage.getItem(coverBriefKey(project.id)) || "{}", {}) : {});
  $("coverTitle").value = brief.title || project?.title || "";
  $("coverPenName").value = brief.penName || "";
  $("coverStyle").value = brief.style || "Classic Storybook";
  $("coverBlurb").value = brief.blurb || "";
  $("coverDirection").value = brief.direction || "";
  $("coverPrompt").value = brief.prompt || "";
  refreshCoverCharacterOptions(Array.isArray(brief.characterIds) ? brief.characterIds : []);
  renderCoverPreview();
  $("coverSaveStatus").textContent = project
    ? "กำลังแก้ไขปกของ “" + (project.title || "นิยายนี้") + "” · Project ID: " + project.id
    : "กรุณาสร้างหรือเลือกนิยายก่อนบันทึกแนวทางปก";
}
function buildCoverPromptText() {
  const brief = readCoverBrief();
  const project = activeCoverProject();
  if (!project) throw new Error("กรุณาสร้างหรือเลือกนิยายก่อน");
  const characters = cloud.ready && cloud.activeProjectId === project.id ? (cloud.modules.characters || []) : [];
  const selectedIds = new Set(brief.characterIds);
  const characterDetails = characters.filter(character => selectedIds.has(character.id)).map(character => {
    let profile = {};
    try { profile = typeof character.profile_json === "string" ? JSON.parse(character.profile_json || "{}") : (character.profile_json || {}); } catch {}
    const details = [
      profile.age && "age " + profile.age,
      profile.species && "species " + profile.species,
      profile.face && "face " + profile.face,
      profile.skin && "skin " + profile.skin,
      profile.eyes && "eyes " + profile.eyes,
      profile.hair && "hair " + profile.hair,
      profile.build && "build " + profile.build,
      profile.clothing && "clothing " + profile.clothing,
      profile.accessories && "accessories " + profile.accessories,
      profile.appearance && "appearance " + profile.appearance
    ].filter(Boolean);
    return character.name + (details.length ? ": " + details.join("; ") : "");
  });
  return [
    "Book cover illustration for a Thai novel.",
    "Book title: " + (brief.title || project.title || "Untitled"),
    "Author pen name: " + (brief.penName || "Not specified"),
    "Visual style: " + brief.style,
    "Selected characters from this project only: " + (characterDetails.join(" | ") || "No named character selected"),
    "Character consistency: preserve the canonical appearance and do not merge or alter character traits.",
    "Back-cover blurb / story premise: " + (brief.blurb || "Not provided"),
    "Art direction and composition: " + (brief.direction || "Create a balanced, polished literary cover composition."),
    "Design requirements: professional publishing quality, strong focal point, legible title area, coherent lighting and palette, no random lettering, no watermark."
  ].join("\n");
}
function setupCoverStudio() {
  ["coverTitle","coverPenName","coverStyle"].forEach(id => $(id)?.addEventListener("input", renderCoverPreview));
  $("coverStyle")?.addEventListener("change", renderCoverPreview);
  $("saveCoverBrief")?.addEventListener("click", async () => {
    const brief = readCoverBrief();
    if (!brief.projectId) { $("coverSaveStatus").textContent = "ยังไม่มีนิยายที่เลือก กรุณาไปที่คลังนิยายก่อน"; return; }
    const serialized = JSON.stringify(brief);
    localStorage.setItem(coverBriefKey(brief.projectId), serialized);
    if (cloud.ready && cloud.activeProjectId === brief.projectId) {
      try {
        const result = await cloudApi("/api/projects/" + encodeURIComponent(brief.projectId), {
          method: "PATCH", body: JSON.stringify({ cover_brief_json: serialized })
        });
        cloud.projects = cloud.projects.map(project => project.id === brief.projectId ? result.project : project);
        $("coverSaveStatus").textContent = "บันทึกแนวทางปกลง Cloud และอุปกรณ์นี้แล้ว";
      } catch (error) {
        $("coverSaveStatus").textContent = "บันทึก Cloud ไม่สำเร็จ · เก็บสำเนาไว้ในอุปกรณ์แล้ว: " + error.message;
      }
    } else {
      const projects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
      if (Array.isArray(projects)) {
        const updated = projects.map(project => project.id === brief.projectId ? { ...project, cover_brief_json: serialized } : project);
        localStorage.setItem("sf_projects", JSON.stringify(updated));
      }
      $("coverSaveStatus").textContent = "บันทึกแนวทางปกของนิยายนี้ในอุปกรณ์แล้ว";
    }
  });
  $("resetCoverBrief")?.addEventListener("click", loadCoverBrief);
  $("buildCoverPrompt")?.addEventListener("click", () => {
    try { $("coverPrompt").value = buildCoverPromptText(); }
    catch (error) { $("coverSaveStatus").textContent = error.message; }
  });
  $("copyCoverPrompt")?.addEventListener("click", async () => {
    try {
      if (!$("coverPrompt").value.trim()) $("coverPrompt").value = buildCoverPromptText();
      await copyStoryText($("coverPrompt").value);
      $("coverSaveStatus").textContent = "คัดลอก Prompt แล้ว — ยังไม่มีการส่งข้อมูลไปบริการภายนอก";
    } catch (error) { $("coverSaveStatus").textContent = error.message; }
  });
  document.querySelectorAll("#cover input,#cover textarea,#cover select").forEach(field => {
    field.addEventListener("input", renderCoverPreview);
  });
  loadCoverBrief();
}

// ==========================================
// ILLUSTRATION STUDIO — project-scoped manuscript images
// ==========================================
let pendingIllustrationData = "";
let illustrationSavedRange = null;
function illustrationProject() { return activeCoverProject(); }
function illustrationSettingsKey(projectId) { return "sf_illustration_settings_" + projectId; }
function loadIllustrationSettings() {
  const project = illustrationProject();
  const saved = project ? safeJSON(localStorage.getItem(illustrationSettingsKey(project.id)) || "{}", {}) : {};
  if ($("illustrationStyle")) $("illustrationStyle").value = saved.style || "Pencil Sketch";
  if ($("illustrationDirection")) $("illustrationDirection").value = saved.direction || "";
  const characterSelect = $("illustrationCharacters");
  if (characterSelect) {
    const selectedIds = new Set(Array.isArray(saved.characterIds) ? saved.characterIds : []);
    const characters = cloud.ready && cloud.activeProjectId === project?.id ? (cloud.modules.characters || []) : [];
    characterSelect.innerHTML = characters.map(character =>
      '<option value="' + escapeHtml(character.id) + '">' + escapeHtml(character.name) + '</option>'
    ).join("");
    Array.from(characterSelect.options).forEach(option => { option.selected = selectedIds.has(option.value); });
    characterSelect.disabled = !characters.length;
  }
  $("illustrationStatus").textContent = project
    ? "กำลังทำงานกับนิยาย “" + (project.title || "นิยายนี้") + "” · Project ID: " + project.id
    : "กรุณาสร้างหรือเลือกนิยายก่อน";
}
function buildIllustrationPromptText() {
  const project = illustrationProject();
  if (!project) throw new Error("กรุณาสร้างหรือเลือกนิยายก่อน");
  const characters = cloud.ready && cloud.activeProjectId === project.id ? (cloud.modules.characters || []) : [];
  const selectedIds = new Set(Array.from($("illustrationCharacters")?.selectedOptions || []).map(option => option.value));
  const selectedCharacters = characters.filter(item => selectedIds.has(item.id));
  const lore = cloud.ready && cloud.activeProjectId === project.id ? (cloud.modules["world-lore"] || []) : [];
  const excerpt = getManuscriptText().slice(0, 1800);
  const characterDetails = selectedCharacters.map(character => {
    let profile = {};
    try { profile = typeof character.profile_json === "string" ? JSON.parse(character.profile_json || "{}") : (character.profile_json || {}); } catch {}
    const details = [
      profile.age && "age " + profile.age,
      profile.species && "species " + profile.species,
      profile.height && "height/build " + profile.height,
      profile.face && "face " + profile.face,
      profile.skin && "skin " + profile.skin,
      profile.eyes && "eyes " + profile.eyes,
      profile.hair && "hair " + profile.hair,
      profile.build && "build " + profile.build,
      profile.clothing && "clothing " + profile.clothing,
      profile.accessories && "accessories " + profile.accessories,
      profile.appearance && "appearance " + profile.appearance,
      profile.personality && "personality " + profile.personality
    ].filter(Boolean);
    return character.name + (details.length ? ": " + details.join("; ") : "");
  });
  return [
    "Create an editorial illustration for a Thai novel.",
    "Novel: " + (project.title || $("title")?.value || ""),
    "Genre: " + ($("genre")?.value || "Not specified"),
    "Visual style: " + ($("illustrationStyle")?.value || "Pencil Sketch"),
    "Selected characters from this project only: " + (characterDetails.join(" | ") || "Use only characters described in the supplied scene"),
    "Character consistency: preserve each selected character's described face, eyes, hair, build, clothing and accessories; do not merge traits between characters.",
    "World details: " + (lore.slice(0, 8).map(item => [item.title, item.content].filter(Boolean).join(": ")).join(" | ") || "Follow the manuscript context"),
    "Scene to illustrate: " + ($("illustrationMoment")?.value.trim() || excerpt || "Scene not specified"),
    "Additional art direction: " + ($("illustrationDirection")?.value.trim() || "Readable composition, expressive poses, consistent character design"),
    "Avoid: lettering, watermark, logos, extra characters, anachronistic objects."
  ].join("\n");
}
function compressIllustration(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error("รองรับเฉพาะ PNG, JPG และ WEBP"));
    if (file.size > 12 * 1024 * 1024) return reject(new Error("ไฟล์ต้นฉบับใหญ่เกิน 12 MB"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์ภาพไม่สำเร็จ"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("เปิดไฟล์ภาพไม่สำเร็จ"));
      image.onload = () => {
        const scale = Math.min(1, 1800 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("ไม่สามารถประมวลผลภาพบนอุปกรณ์นี้ได้"));
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        let quality = 0.78, data = canvas.toDataURL("image/jpeg", quality);
        while (data.length > 125000 && quality > 0.3) { quality -= 0.08; data = canvas.toDataURL("image/jpeg", quality); }
        if (data.length > 125000) return reject(new Error("ภาพยังใหญ่เกินไปหลังย่อ กรุณาเลือกรูปที่เล็กกว่านี้"));
        resolve(data);
      };
      image.src = String(reader.result || "");
    };
    reader.readAsDataURL(file);
  });
}
function insertIllustrationAtCursor() {
  const editor = $("manuscriptEditor"), field = $("manuscriptBody");
  if (!editor || !pendingIllustrationData) return;
  if ((field?.value || "").length + pendingIllustrationData.length + 1200 > 450000) {
    $("illustrationStatus").textContent = "บทนี้มีข้อมูลใกล้ถึงขีดจำกัดการซิงก์แล้ว กรุณาใช้ภาพที่เล็กลงหรือลดจำนวนภาพก่อน";
    return;
  }
  if (illustrationProject() && cloud.ready && cloud.activeProjectId && illustrationProject().id !== cloud.activeProjectId) {
    $("illustrationStatus").textContent = "หยุดแทรกภาพ: นิยายที่เลือกไม่ตรงกับพื้นที่ทำงานปัจจุบัน";
    return;
  }
  const figure = document.createElement("figure");
  figure.className = "manuscript-illustration";
  figure.style.cssText = "text-align:" + ($("illustrationAlign")?.value || "center") + ";margin:1.5em auto;width:100%;";
  const image = document.createElement("img");
  image.src = pendingIllustrationData;
  image.alt = $("illustrationCaption")?.value.trim() || "ภาพประกอบนิยาย";
  image.width = Math.max(1, image.naturalWidth || 1200); image.height = Math.max(1, image.naturalHeight || 800);
  image.style.cssText = "display:block;width:" + ($("illustrationWidth")?.value || "100%") + ";max-width:100%;height:auto;margin:0 auto;";
  figure.appendChild(image);
  const captionText = $("illustrationCaption")?.value.trim();
  if (captionText) {
    const caption = document.createElement("figcaption");
    caption.textContent = captionText;
    caption.style.cssText = "text-align:center;font-size:0.9em;margin-top:.5em;";
    figure.appendChild(caption);
  }
  const selection = window.getSelection();
  if (illustrationSavedRange && editor.contains(illustrationSavedRange.commonAncestorContainer)) {
    selection.removeAllRanges(); selection.addRange(illustrationSavedRange);
  } else {
    const range = document.createRange(); range.selectNodeContents(editor); range.collapse(false);
    selection.removeAllRanges(); selection.addRange(range);
  }
  const range = selection.getRangeAt(0);
  range.deleteContents(); range.insertNode(figure);
  const spacer = document.createElement("p"); spacer.innerHTML = "<br>";
  figure.after(spacer);
  const newRange = document.createRange(); newRange.setStart(spacer, 0); newRange.collapse(true);
  selection.removeAllRanges(); selection.addRange(newRange);
  editor.focus();
  const sanitized = sanitizeManuscriptHtml(editor.innerHTML);
  field.value = sanitized;
  save("manuscriptBody");
  $("illustrationStatus").textContent = "แทรกภาพลงในต้นฉบับแล้ว และบันทึกภาพไว้ในเนื้อหาของบทนี้";
  pendingIllustrationData = ""; illustrationSavedRange = null;
  $("illustrationSelectedPreview").hidden = true;
  $("insertIllustration").disabled = true;
  $("illustrationFile").value = "";
}
function setupIllustrationStudio() {
  const editor = $("manuscriptEditor");
  const rememberRange = () => {
    const selection = window.getSelection();
    if (editor && selection?.rangeCount && editor.contains(selection.anchorNode)) {
      illustrationSavedRange = selection.getRangeAt(0).cloneRange();
    }
  };
  editor?.addEventListener("mouseup", rememberRange);
  editor?.addEventListener("keyup", rememberRange);
  document.addEventListener("selectionchange", rememberRange);
  $("illustrationStyle")?.addEventListener("change", () => {
    const project = illustrationProject();
    if (project) localStorage.setItem(illustrationSettingsKey(project.id), JSON.stringify({
      style: $("illustrationStyle").value, direction: $("illustrationDirection").value,
      characterIds: Array.from($("illustrationCharacters")?.selectedOptions || []).map(option => option.value)
    }));
  });
  $("illustrationDirection")?.addEventListener("change", () => {
    const project = illustrationProject();
    if (project) localStorage.setItem(illustrationSettingsKey(project.id), JSON.stringify({
      style: $("illustrationStyle").value, direction: $("illustrationDirection").value,
      characterIds: Array.from($("illustrationCharacters")?.selectedOptions || []).map(option => option.value)
    }));
  });
  $("illustrationCharacters")?.addEventListener("change", () => {
    const project = illustrationProject();
    if (project) localStorage.setItem(illustrationSettingsKey(project.id), JSON.stringify({
      style: $("illustrationStyle").value,
      direction: $("illustrationDirection").value,
      characterIds: Array.from($("illustrationCharacters").selectedOptions || []).map(option => option.value)
    }));
  });
  $("buildIllustrationPrompt")?.addEventListener("click", () => {
    try { $("illustrationPrompt").value = buildIllustrationPromptText(); }
    catch (error) { $("illustrationStatus").textContent = error.message; }
  });
  $("copyIllustrationPrompt")?.addEventListener("click", async () => {
    try {
      if (!$("illustrationPrompt").value.trim()) $("illustrationPrompt").value = buildIllustrationPromptText();
      await copyStoryText($("illustrationPrompt").value);
      $("illustrationStatus").textContent = "คัดลอก Prompt แล้ว — ไม่มีการส่งข้อมูลไปบริการภายนอก";
    } catch (error) { $("illustrationStatus").textContent = error.message; }
  });
  $("illustrationFile")?.addEventListener("change", async event => {
    try {
      const data = await compressIllustration(event.target.files?.[0]);
      pendingIllustrationData = data;
      $("saveIllustrationToLibrary").disabled = false;
      const preview = $("illustrationSelectedPreview");
      preview.replaceChildren();
      const img = document.createElement("img"); img.src = data; img.alt = "ตัวอย่างภาพที่จะเพิ่ม";
      preview.appendChild(img); preview.hidden = false;
      $("insertIllustration").disabled = false;
      $("illustrationStatus").textContent = "เตรียมภาพแล้ว (" + Math.round(data.length * 0.75 / 1024) + " KB โดยประมาณ) — เปิดห้องเขียนและวางเคอร์เซอร์ก่อนแทรก";
    } catch (error) {
      pendingIllustrationData = ""; $("insertIllustration").disabled = true; $("saveIllustrationToLibrary").disabled = true;
      $("illustrationStatus").textContent = error.message;
    }
  });
  $("insertIllustration")?.addEventListener("click", insertIllustrationAtCursor);
  $("illustrationLibraryFilter")?.addEventListener("change", renderIllustrationLibrary);
  $("saveIllustrationToLibrary")?.addEventListener("click", async () => { try { await savePendingIllustrationToLibrary(); } catch (error) { $("illustrationStatus").textContent = error.message; } });
  $("illustrationFile")?.addEventListener("click", () => {
    const selection = window.getSelection();
    illustrationSavedRange = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  });
  loadIllustrationSettings();
}

async function illustrationLibraryRecords(projectId) {
  const db = await openCharacterVault();
  return new Promise((resolve,reject) => {
    const tx = db.transaction(ILLUSTRATION_LIBRARY_STORE,"readonly");
    const req = tx.objectStore(ILLUSTRATION_LIBRARY_STORE).index("projectId").getAll(projectId);
    req.onsuccess = () => { db.close(); resolve((req.result || []).sort((a,b) => b.createdAt-a.createdAt)); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}
async function collectIllustrationLibraryBackup(cloudProjects, localData) {
  if (!("indexedDB" in window)) return [];
  const allowed = new Set((cloudProjects || []).map(entry => entry.project?.id).filter(Boolean));
  const projects = safeJSON(localData?.sf_projects || "[]", []);
  if (Array.isArray(projects)) projects.forEach(project => { if (project?.id) allowed.add(project.id); });
  if (localData?.sf_active_project_id) allowed.add(localData.sf_active_project_id);
  const db = await openCharacterVault();
  const records = await new Promise((resolve,reject) => {
    const tx = db.transaction(ILLUSTRATION_LIBRARY_STORE,"readonly");
    const req = tx.objectStore(ILLUSTRATION_LIBRARY_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
  const filtered = records.filter(record => allowed.has(record.projectId));
  if (filtered.reduce((sum,record) => sum + String(record.dataUrl || "").length,0) > 12*1024*1024) throw new Error("คลังภาพประกอบมีขนาดเกิน 12 MB กรุณาลดจำนวนภาพก่อน Backup");
  return filtered;
}
async function restoreIllustrationLibraryRecords(records) {
  if (!Array.isArray(records) || !records.length) return;
  const db = await openCharacterVault();
  await new Promise((resolve,reject) => {
    const tx = db.transaction(ILLUSTRATION_LIBRARY_STORE,"readwrite");
    records.forEach(record => tx.objectStore(ILLUSTRATION_LIBRARY_STORE).put(record));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("กู้คืนคลังภาพประกอบไม่สำเร็จ")); };
  });
}
function validateIllustrationLibraryBackup(records, cloudProjects, localData) {
  if (!Array.isArray(records) || records.length > 1000) throw new Error("ข้อมูลคลังภาพประกอบใน Backup ไม่ถูกต้อง");
  const allowed = new Set((cloudProjects || []).map(entry => entry.project?.id).filter(Boolean));
  const projects = safeJSON(localData?.sf_projects || "[]", []);
  if (Array.isArray(projects)) projects.forEach(project => { if (project?.id) allowed.add(project.id); });
  if (localData?.sf_active_project_id) allowed.add(localData.sf_active_project_id);
  let total = 0;
  for (const record of records) {
    if (!record || typeof record !== "object" || !allowed.has(record.projectId) ||
        typeof record.id !== "string" || record.id.length > 100 ||
        typeof record.dataUrl !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(record.dataUrl) || record.dataUrl.length > 130000 ||
        typeof record.label !== "string" || record.label.length > 100 ||
        typeof record.caption !== "string" || record.caption.length > 300 ||
        typeof record.style !== "string" || record.style.length > 80 || !Number.isFinite(record.createdAt) ||
        (record.category != null && !["scene", "character", "location", "object", "cover", "other"].includes(record.category))) {
      throw new Error("พบภาพประกอบที่ไม่ถูกต้องหรือไม่ได้อยู่ในนิยายที่สำรองไว้");
    }
    total += record.dataUrl.length;
  }
  if (total > 12*1024*1024) throw new Error("คลังภาพประกอบใน Backup มีขนาดเกิน 12 MB");
}

async function savePendingIllustrationToLibrary() {
  const project = illustrationProject();
  if (!project?.id || !pendingIllustrationData) throw new Error("เลือกนิยายและภาพก่อนบันทึกเข้าคลัง");
  const rows = await illustrationLibraryRecords(project.id);
  if (illustrationProject()?.id !== project.id) throw new Error("นิยายที่เลือกเปลี่ยนไปแล้ว กรุณาเลือกภาพอีกครั้ง");
  if (rows.length >= 100 || rows.reduce((n,r) => n + (r.dataUrl || "").length,0) + pendingIllustrationData.length > 12*1024*1024) throw new Error("คลังภาพถึงขีดจำกัดแล้ว กรุณาลบภาพเก่าก่อน");
  const db = await openCharacterVault();
  const caption = $("illustrationCaption")?.value.trim() || "";
  const category = $("illustrationCategory")?.value || "other";
  await new Promise((resolve,reject) => {
    const tx = db.transaction(ILLUSTRATION_LIBRARY_STORE,"readwrite");
    tx.objectStore(ILLUSTRATION_LIBRARY_STORE).put({id:crypto.randomUUID(),projectId:project.id,dataUrl:pendingIllustrationData,label:caption.slice(0,100)||"ภาพประกอบ "+(rows.length+1),caption:caption.slice(0,300),category,style:$("illustrationStyle")?.value||"",createdAt:Date.now()});
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
  await renderIllustrationLibrary();
  $("illustrationStatus").textContent = "บันทึกภาพไว้ในคลังของนิยายนี้แล้ว (เก็บในอุปกรณ์นี้)";
}
async function renderIllustrationLibrary() {
  const target = $("illustrationLibraryGallery"), project = illustrationProject();
  if (!target) return;
  if (!project?.id) { target.textContent = "เลือกนิยายก่อนเพื่อเปิดคลังภาพประกอบ"; return; }
  target.textContent = "กำลังโหลดคลังภาพ…";
  try {
    const rows = await illustrationLibraryRecords(project.id);
    if (illustrationProject()?.id !== project.id) return;
    target.replaceChildren();
    const category = $("illustrationLibraryFilter")?.value || "all";
    const visibleRows = rows.filter(record => category === "all" || (record.category || "other") === category);
    if (!visibleRows.length) { target.textContent = rows.length ? "ไม่มีภาพในหมวดที่เลือก" : "คลังภาพของนิยายนี้ยังว่าง"; return; }
    const categoryLabels = { scene: "ฉากสำคัญ", character: "ตัวละคร", location: "สถานที่", object: "สิ่งของ", cover: "ปก / โปรโมต", other: "อื่น ๆ" };
    visibleRows.forEach(record => {
      const card = document.createElement("article"); card.className = "character-reference-card illustration-library-card";
      const img = document.createElement("img"); img.src = record.dataUrl; img.alt = record.caption || record.label; img.loading = "lazy";
      const title = document.createElement("b"); title.textContent = record.label;
      const caption = document.createElement("small"); caption.textContent = record.caption || "";
      const select = document.createElement("button"); select.type = "button"; select.className = "outline-button compact"; select.textContent = "เตรียมแทรก";
      select.addEventListener("click", () => {
        if (illustrationProject()?.id !== project.id) return;
        pendingIllustrationData = record.dataUrl; $("illustrationCaption").value = record.caption || "";
        if ($("illustrationCategory")) $("illustrationCategory").value = record.category || "other";
        $("insertIllustration").disabled = false; $("saveIllustrationToLibrary").disabled = false;
        const preview = $("illustrationSelectedPreview"); preview.replaceChildren();
        const p = document.createElement("img"); p.src = record.dataUrl; p.alt = "ภาพที่เลือก"; preview.appendChild(p); preview.hidden = false;
        $("illustrationStatus").textContent = "เลือกภาพจากคลังแล้ว — วางเคอร์เซอร์ในต้นฉบับแล้วกดแทรกภาพ";
      });
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "outline-button compact"; remove.textContent = "ลบ";
      remove.addEventListener("click", async () => {
        if (illustrationProject()?.id !== project.id) return;
        if (!confirm("ลบภาพนี้ออกจากคลังของนิยายนี้หรือไม่? ภาพในต้นฉบับจะไม่ถูกลบ")) return;
        if (illustrationProject()?.id !== project.id) return;
        const db = await openCharacterVault();
        await new Promise((resolve,reject) => { const tx=db.transaction(ILLUSTRATION_LIBRARY_STORE,"readwrite"); tx.objectStore(ILLUSTRATION_LIBRARY_STORE).delete(record.id); tx.oncomplete=()=>{db.close();resolve();}; tx.onerror=()=>{db.close();reject(tx.error);}; });
        await renderIllustrationLibrary();
      });
      const categoryTag = document.createElement("small"); categoryTag.className = "illustration-category-tag"; categoryTag.textContent = categoryLabels[record.category || "other"] || "อื่น ๆ";
      const meta = document.createElement("div"); meta.className = "character-reference-meta"; meta.append(title,categoryTag,caption);
      const actions = document.createElement("div"); actions.className = "module-actions"; actions.append(select,remove);
      card.append(img,meta,actions); target.appendChild(card);
    });
  } catch (error) { target.textContent = "เปิดคลังภาพไม่สำเร็จ: " + error.message; }
}

function buildStoryAssistantContext() {
  const localProjects = safeJSON(localStorage.getItem("sf_projects") || "[]", []);
  const activeLocalId = localStorage.getItem("sf_active_project_id");
  const active = cloud.ready
    ? cloud.projects.find(item => item.id === cloud.activeProjectId) || null
    : (Array.isArray(localProjects) ? localProjects.find(item => item.id === activeLocalId) || localProjects[0] : null);
  if (!active) throw new Error("กรุณาเลือกหรือบันทึกนิยายก่อนคัดลอกบริบท");

  const lines = [
    "# STORYFORGE — บริบทนิยาย",
    "ชื่อเรื่อง: " + (active.title || $("title")?.value || "ไม่ระบุ"),
    "Project ID: " + (active.id || "Local"),
    "แนวเรื่อง: " + (active.genre || "ไม่ระบุ"),
    "",
    "## การตั้งค่าการเขียน",
  ];
  let writingSettings = {};
  try { writingSettings = JSON.parse(localStorage.getItem(writingSettingsKey(active.id)) || "{}"); } catch {}
  lines.push(
    "จำนวนบทเป้าหมาย: " + (writingSettings.chapterCount || 20),
    "จำนวนคำต่อบท: " + (writingSettings.wordsPerChapter || 2000),
    "เป้าหมายคำของบทที่กำลังเขียน: " + (localStorage.getItem(writingWordGoalKey(active.id)) || writingSettings.wordsPerChapter || 2000),
    "มุมมอง: " + (writingSettings.pov || "third"),
    "สไตล์ภาษา: " + (writingSettings.style || "literary"),
    "ขอบเขตฉากผู้ใหญ่: " + (writingSettings.adultContent || "off"),
    "ข้อกำหนดเพิ่มเติม: " + (writingSettings.extraNotes || "ไม่มี")
  );
  const selectedGenres = Array.isArray(writingSettings.selectedGenres)
    ? writingSettings.selectedGenres
    : Object.keys(writingSettings.genres || {});
  selectedGenres.forEach(genre => lines.push("- " + genre + ": " + (writingSettings.genres?.[genre] || 5) + "/10"));
  lines.push("", "## เรื่องย่อและข้อมูลสำคัญ",
    active.context || "ยังไม่มีข้อมูล",
    ""
  );
  const projectIsCurrentCloud = cloud.ready && active.id === cloud.activeProjectId;
  if (projectIsCurrentCloud) {
    const modules = cloud.modules || {};
    const characters = modules.characters || [];
    const relationships = modules.relationships || [];
    const plots = modules["plot-threads"] || [];
    const worlds = modules["world-lore"] || [];
    const timeline = modules.timeline || [];
    const notes = (modules.notes || []).filter(item => item.note_type !== "project_memory");
    lines.push("## Character Vault");
    if (!characters.length) lines.push("ยังไม่มีข้อมูลตัวละคร");
    characters.forEach(character => {
      let profile = {};
      try { profile = typeof character.profile_json === "string" ? JSON.parse(character.profile_json || "{}") : (character.profile_json || {}); } catch {}
      lines.push("- " + character.name + (character.role ? " — " + character.role : ""));
      const profileLabels = {
        nickname:"ชื่อเล่น/นามแฝง", aliases:"ชื่อเรียกอื่น", gender:"เพศ", birthday:"วันเกิด", profession:"อาชีพ/ตำแหน่ง",
        age:"อายุ", pronouns:"สรรพนาม", species:"เผ่าพันธุ์", height:"ส่วนสูง/รูปร่าง",
        face:"รูปหน้า", skin:"สีผิว/จุดสังเกต", eyes:"ดวงตา", hair:"เส้นผม",
        build:"สัดส่วน", clothing:"เครื่องแต่งกาย", accessories:"เครื่องประดับ",
        expressions:"สีหน้า/ภาษากาย", appearance:"รูปลักษณ์โดยรวม",
        personality:"บุคลิก", motivation:"เป้าหมาย", backstory:"ภูมิหลัง",
        strengths:"จุดแข็ง", weaknesses:"จุดอ่อน", likes:"สิ่งที่ชอบ",
        dislikes:"สิ่งที่ไม่ชอบ", skills:"ทักษะ", family:"ครอบครัว/สังกัด",
        customFields:"ข้อมูลเฉพาะโลกนิยาย", secret:"ความลับ", description:"บันทึกเพิ่มเติม"
      };
      Object.entries(profile).forEach(([key, value]) => {
        if (value && String(value).trim()) lines.push("  - " + (profileLabels[key] || key) + ": " + String(value).trim());
      });
    });
    lines.push("", "## ความสัมพันธ์");
    if (!relationships.length) lines.push("ยังไม่มีข้อมูลความสัมพันธ์");
    relationships.forEach(item => {
      const from = characters.find(character => character.id === item.source_character_id)?.name || "ตัวละคร";
      const to = characters.find(character => character.id === item.target_character_id)?.name || "ตัวละคร";
      lines.push("- " + from + " — " + (item.relationship_type || "เกี่ยวข้อง") + " — " + to + (item.description ? ": " + item.description : ""));
    });
    lines.push("", "## เส้นเรื่อง");
    if (!plots.length) lines.push("ยังไม่มีเส้นเรื่อง");
    plots.forEach(item => {
      let refs = []; try { refs = JSON.parse(item.character_ids_json || "[]"); } catch {}
      const linked = refs.map(id => characters.find(character => character.id === id)?.name).filter(Boolean);
      lines.push("- " + item.title + " [" + (item.status || "ไม่ระบุสถานะ") + "]: " + (item.summary || "") + (linked.length ? " | ตัวละครที่เกี่ยวข้อง: " + linked.join(", ") : ""));
    });
    lines.push("", "## World Building");
    if (!worlds.length) lines.push("ยังไม่มีข้อมูลโลก");
    worlds.forEach(item => {
      let refs = []; try { refs = JSON.parse(item.character_ids_json || "[]"); } catch {}
      const linked = refs.map(id => characters.find(character => character.id === id)?.name).filter(Boolean);
      lines.push("- [" + (item.category || "other") + "] " + item.title + ": " + (item.content || "") + (linked.length ? " | ตัวละครที่เกี่ยวข้อง: " + linked.join(", ") : ""));
    });
    lines.push("", "## Timeline");
    if (!timeline.length) lines.push("ยังไม่มีเหตุการณ์");
    timeline.forEach(item => {
      let refs = []; try { refs = JSON.parse(item.character_ids_json || "[]"); } catch {}
      const linked = refs.map(id => characters.find(character => character.id === id)?.name).filter(Boolean);
      lines.push("- " + (item.story_time || "ไม่ระบุเวลา") + " — " + item.title + ": " + (item.description || "") + (linked.length ? " | ตัวละครที่เกี่ยวข้อง: " + linked.join(", ") : ""));
    });
    lines.push("", "## บันทึกเนื้อเรื่อง");
    if (!notes.length) lines.push("ยังไม่มีบันทึก");
    notes.forEach(item => { let refs = []; try { refs = JSON.parse(item.character_ids_json || "[]"); } catch {} const linked = refs.map(id => characters.find(character => character.id === id)?.name).filter(Boolean); lines.push("- " + (item.title || "บันทึก") + ": " + (item.content || "") + (linked.length ? " | ตัวละครที่เกี่ยวข้อง: " + linked.join(", ") : "")); });
    lines.push("", "## รายการบท");
    (cloud.chapters || []).forEach((item, index) => {
      const linked = chapterCharacterIds(item).map(id => characters.find(character => character.id === id)?.name).filter(Boolean);
      lines.push((index + 1) + ". " + (item.title || "บทไม่มีชื่อ") + " (" + (Number(item.word_count) || 0) + " คำ)" + (linked.length ? " | Canon: " + linked.join(", ") : ""));
    });
  } else {
    lines.push("## ข้อมูลโมดูล");
    lines.push("ยังไม่ได้เชื่อมต่อ Cloud ในโปรเจกต์ที่เลือก จึงแนบเฉพาะข้อมูลโครงการและต้นฉบับปัจจุบัน");
  }

  const chapterTitle = $("chapterTitle")?.value || "";
  const activeChapter = cloud.chapters.find(item => item.id === cloud.activeChapterId);
  const activeCharacterNames = chapterCharacterIds(activeChapter)
    .map(id => (cloud.modules.characters || []).find(character => character.id === id)?.name)
    .filter(Boolean);
  const manuscript = getManuscriptText().slice(0, 14000);
  lines.push("", "## บทที่กำลังเปิด", chapterTitle || "ยังไม่มีชื่อบท");
  lines.push("ตัวละคร Canon ของบทนี้: " + (activeCharacterNames.join(", ") || "ยังไม่ได้กำหนด"));
  lines.push(manuscript || "ยังไม่มีต้นฉบับ");
  if (getManuscriptText().length > 14000) lines.push("[ตัดต้นฉบับส่วนเกินออกเพื่อให้คัดลอกได้สะดวก]");
  const selectedMode = document.querySelector(".mode.active")?.dataset.mode || mode || "writer";
  const modeLabels = { writer:"นักเขียน", brainstorm:"ระดมไอเดีย", editor:"บรรณาธิการ", publisher:"สำนักพิมพ์" };
  lines.push("", "## รูปแบบความช่วยเหลือที่ต้องการ", modeLabels[selectedMode] || selectedMode);
  const request = $("prompt")?.value?.trim();
  lines.push("", "## คำสั่งจากผู้เขียน", request || "โปรดช่วยวิเคราะห์และให้คำแนะนำโดยยึดข้อมูล Canon ข้างต้น");
  lines.push("", "ข้อกำหนด: ใช้ข้อมูลของนิยายนี้เท่านั้น หากข้อมูลไม่พอให้ถามก่อน อย่าสร้างข้อเท็จจริง Canon ใหม่เอง");
  const context = lines.join("\n");
  const projectGuardrail = "\nข้อกำหนดสำคัญ: ใช้ข้อมูลของนิยายนี้เท่านั้น หากข้อมูลไม่พอให้ถามก่อน อย่าสร้างข้อเท็จจริง Canon ใหม่เอง";
  return context.length > 40000
    ? context.slice(0, 40000) + "\n[ตัดบริบทส่วนเกินเพื่อให้คัดลอกได้สะดวก]" + projectGuardrail
    : context;
}

async function copyStoryText(value) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("เบราว์เซอร์ไม่อนุญาตให้คัดลอกข้อความ");
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
      genre: getProjectGenre(),
      context: $("context").value,
      pen_name: $("penName").value.trim(),
      copyright_text: $("copyrightText").value.trim(),
      foreword: $("foreword").value,
      author_bio: $("authorBio").value
    };
    localStorage.setItem(writingSettingsKey(item.id), JSON.stringify(readWritingSettings()));
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
            body: JSON.stringify({ title: item.title, genre: item.genre, synopsis: item.context, pen_name: item.pen_name, copyright_text: item.copyright_text, foreword: item.foreword, author_bio: item.author_bio })
          });
        } else {
          saved = await cloudApi("/api/projects", {
            method: "POST",
            body: JSON.stringify({ title: item.title, genre: item.genre, synopsis: item.context, pen_name: item.pen_name, copyright_text: item.copyright_text, foreword: item.foreword, author_bio: item.author_bio })
          });
        }
        const project = saved.project;
        localStorage.setItem(writingSettingsKey(project.id), JSON.stringify(readWritingSettings()));
        cloud.activeProjectId = project.id;
        cloud.projects = [project, ...cloud.projects.filter(x => x.id !== project.id)];
        await loadCloudProject(project.id);
        loadWritingSettings(project.id);
        $("saveState").innerHTML = '<span class="status-dot"></span>บันทึกโครงการบน Cloud แล้ว';
        alert("บันทึกโครงการไปยังบัญชี Private Beta แล้วครับ");
      } catch (error) {
        $("saveState").textContent = "บันทึก Cloud ไม่สำเร็จ · ฉบับในเครื่องยังอยู่";
        alert("บันทึกขึ้น Cloud ไม่สำเร็จ: " + error.message + "\nข้อมูลฉบับในเครื่องยังคงอยู่ครับ");
      }
    } else {
      loadWritingSettings(item.id);
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
    setProjectGenre("");
    $("context").value = "";
    ["penName", "copyrightText", "foreword", "authorBio"].forEach(id => { if ($(id)) $(id).value = ""; });
    $("projectMemory").value = "";
    loadWritingSettings("draft");
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

  // OpenAI (ChatGPT) is the planned provider. Keep live requests disabled until API billing is explicitly approved and a server-side secret is configured.
  $("run").disabled = true;
  $("run").title = "เตรียมเชื่อมต่อ OpenAI (ChatGPT) — ยังไม่เปิดใช้ API";
  $("output").textContent =
    "ผู้ให้บริการหลักที่วางแผนไว้: OpenAI (ChatGPT)\n" +
    "สถานะ: ยังไม่เชื่อมต่อ API\n\n" +
    "คุณสามารถคัดลอกบริบทนิยายไปใช้ใน ChatGPT ได้ทันที\n" +
    "StoryForge จะไม่ส่งข้อมูลออกไปหรือเรียกบริการแบบคิดเงินโดยอัตโนมัติ";

  $("copyStoryContext")?.addEventListener("click", async () => {
    try {
      const context = buildStoryAssistantContext();
      await copyStoryText(context);
      alert("คัดลอกบริบทนิยายแล้วครับ นำไปวางใน ChatGPT ได้เลย");
    } catch (error) {
      alert("คัดลอกบริบทไม่สำเร็จ: " + error.message);
    }
  });

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
      $("title").value, $("chapterTitle").value, "", getManuscriptText()
    ].join("\n"));
  };
  $("exportBookTxt")?.addEventListener("click", exportEntireNovelTxt);
  $("exportBookDocx")?.addEventListener("click", exportEntireNovelDocx);
  $("exportBookEpub")?.addEventListener("click", exportEntireNovelEpub);
  $("exportBookPdf")?.addEventListener("click", exportEntireNovelPdf);
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

    downloadCurrentBackup()
      .then(() => { $("backupStatus").textContent = "ดาวน์โหลดไฟล์ Backup ลงอุปกรณ์แล้ว"; })
      .catch(error => { $("backupStatus").textContent = "สำรองข้อมูลไม่สำเร็จ: " + error.message; });
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
  if (cloud.activeProjectId && cloud.activeProjectId !== project.id) resetCharacterForm();
  cloud.activeProjectId = project.id;
  localStorage.setItem("sf_cloud_active_project_id", project.id);
  loadWritingSettings(project.id);
  $("title").value = project.title || "";
  setProjectGenre(project.genre || "");
  $("context").value = project.synopsis || "";
  $("penName").value = project.pen_name || "";
  $("copyrightText").value = project.copyright_text || "";
  $("foreword").value = project.foreword || "";
  $("authorBio").value = project.author_bio || "";
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
  renderChapterCharacterReferences();
}

function chapterCharacterIds(chapter = null) {
  try {
    const parsed = JSON.parse(chapter?.character_ids_json || "[]");
    return Array.isArray(parsed) ? parsed.filter(id => typeof id === "string") : [];
  } catch { return []; }
}

function analyzeStoryContinuity({ chapters = [], characters = [], timeline = [], plotThreads = [], scenes = [] } = {}) {
  const plotChapterIdsForCheck = plot => {
    try { const ids = JSON.parse(plot.chapter_ids_json || "[]"); return Array.isArray(ids) ? ids : []; } catch { return []; }
  };
  const sceneChapterIdsForCheck = scene => {
    try { const ids = JSON.parse(scene.chapter_ids_json || "[]"); return Array.isArray(ids) ? ids : []; } catch { return []; }
  };
  const chapterCharacterIdsForCheck = chapter => {
    try { const ids = JSON.parse(chapter.character_ids_json || "[]"); return Array.isArray(ids) ? ids : []; } catch { return []; }
  };
  const findings = [];
  const add = (kind, title, detail, chapterId = "") => findings.push({ kind, title, detail, chapterId });
  const normalize = value => String(value || "").normalize("NFC").toLocaleLowerCase("th-TH").replace(/[\s\u00a0]+/g, "");
  const characterById = new Map(characters.map(character => [character.id, character]));
  const chapterCanonIds = new Set();
  const normalizedTitles = new Map();

  for (const chapter of chapters) {
    const title = String(chapter.title || "").trim();
    const titleKey = normalize(title);
    if (!title) add("review", "บทไม่มีชื่อ", "เพิ่มชื่อบทเพื่อให้ค้นหาและอ้างอิงได้ง่าย", chapter.id);
    else if (normalizedTitles.has(titleKey)) {
      add("review", "ชื่อบทซ้ำ", "ชื่อบทนี้ซ้ำกับ “" + normalizedTitles.get(titleKey) + "”", chapter.id);
    } else normalizedTitles.set(titleKey, title);

    const body = normalize(chapter.text || chapter.body || "");
    if (!body) add("review", "บทไม่มีเนื้อหา", "บทนี้ยังไม่มีข้อความให้ตรวจความต่อเนื่อง", chapter.id);
    let ids = [];
    try { ids = JSON.parse(chapter.character_ids_json || "[]"); } catch {}
    if (!Array.isArray(ids)) ids = [];
    ids.forEach(id => chapterCanonIds.add(id));

    for (const id of ids) {
      const character = characterById.get(id);
      if (!character) continue;
      let profile = {};
      try { profile = JSON.parse(character.profile_json || "{}"); } catch {}
      const aliases = Array.isArray(profile.aliases) ? profile.aliases : String(profile.aliases || "").split(/[\n,;、，]+/);
      const names = [character.name, profile.nickname, ...aliases].filter(name => String(name || "").trim().length >= 2);
      if (body && names.length && !names.some(name => body.includes(normalize(name)))) {
        add("hint", "ตรวจการปรากฏของตัวละคร", "Canon ระบุ “" + character.name + "” แต่ไม่พบชื่อหรือชื่อเล่นในข้อความบทนี้ อาจใช้สรรพนามหรือชื่อเรียกอื่นอยู่แล้ว", chapter.id);
      }
    }

    for (const character of characters) {
      let profile = {};
      try { profile = JSON.parse(character.profile_json || "{}"); } catch {}
      const aliases = Array.isArray(profile.aliases) ? profile.aliases : String(profile.aliases || "").split(/[\n,;、，]+/);
      const names = [character.name, profile.nickname, ...aliases].filter(name => String(name || "").trim().length >= 2);
      const foundName = names.find(name => body.includes(normalize(name)));
      if (!foundName || ids.includes(character.id)) continue;
      add("hint", "ตรวจ Canon ตัวละคร", "พบชื่อเรียก “" + foundName.trim() + "” ของตัวละคร “" + character.name + "” ในเนื้อหา แต่ยังไม่ได้เชื่อมตัวละครนี้กับ Canon ของบท", chapter.id);
    }
  }

  const orderedTimeline = [...timeline].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0));
  const parseDate = value => {
    const raw = String(value || "").trim();
    let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    let year, month, day;
    if (match) [, year, month, day] = match.map(Number);
    else {
      match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
      if (!match) return null;
      [, day, month, year] = match.map(Number);
    }
    if (year > 2400) year -= 543;
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const stamp = Date.UTC(year, month - 1, day);
    const date = new Date(stamp);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? stamp : null;
  };
  let previous = null;
  for (const event of orderedTimeline) {
    const date = parseDate(event.story_time);
    if (date === null) continue;
    if (previous && date < previous.date) {
      add("review", "ลำดับ Timeline อาจไม่ตรงวันที่", "“" + event.title + "” ระบุวันที่ " + event.story_time + " แต่เรียงอยู่หลังเหตุการณ์ “" + previous.title + "” (" + previous.storyTime + ")");
    }
    previous = { date, title: event.title, storyTime: event.story_time };
  }

  for (const event of timeline) {
    let ids = [];
    try { ids = JSON.parse(event.character_ids_json || "[]"); } catch {}
    if (!Array.isArray(ids)) continue;
    const linked = ids.filter(id => characterById.has(id));
    if (linked.length && !linked.some(id => chapterCanonIds.has(id))) {
      add("hint", "เหตุการณ์ Timeline ยังไม่เชื่อมกับบท", "เหตุการณ์ “" + event.title + "” อ้างถึงตัวละคร แต่ยังไม่พบตัวละครเหล่านี้ใน Canon ของบทที่ตรวจ อาจเป็นเหตุการณ์ในอนาคตหรือยังไม่ได้เชื่อมบท");
    }
  }

  const chapterById = new Map(chapters.map(chapter => [chapter.id, chapter]));
  for (const plot of plotThreads) {
    const linkedChapterIds = plotChapterIdsForCheck(plot);
    const missingChapterIds = linkedChapterIds.filter(id => !chapterById.has(id));
    if (missingChapterIds.length) {
      add("review", "เส้นเรื่องอ้างอิงบทที่ไม่พบ", "พล็อต “" + plot.title + "” เชื่อมกับบทที่ไม่อยู่ในโครงการนี้แล้ว ควรตรวจการอ้างอิง");
    }
    if (!linkedChapterIds.length && plot.status !== "completed") {
      add("hint", "เส้นเรื่องยังไม่เชื่อมกับบท", "พล็อต “" + plot.title + "” ยังไม่ได้ระบุว่าดำเนินอยู่ในบทใด");
      continue;
    }
    let characterIds = [];
    try { characterIds = JSON.parse(plot.character_ids_json || "[]"); } catch {}
    const linkedCharacters = Array.isArray(characterIds) ? characterIds.filter(id => characterById.has(id)) : [];
    if (linkedCharacters.length && linkedChapterIds.some(id => chapterById.has(id))) {
      const chapterIds = new Set(linkedChapterIds.filter(id => chapterById.has(id)));
      const hasCanon = chapters.some(chapter => chapterIds.has(chapter.id) && chapterCharacterIdsForCheck(chapter).some(id => linkedCharacters.includes(id)));
      if (!hasCanon) add("hint", "ตรวจ Canon ของเส้นเรื่อง", "บทที่เชื่อมกับพล็อต “" + plot.title + "” ยังไม่มีตัวละครที่ระบุไว้ในเส้นเรื่องใน Canon ของบท");
    }
  }
  for (const scene of scenes) {
    const linkedChapterIds = sceneChapterIdsForCheck(scene);
    const missingChapterIds = linkedChapterIds.filter(id => !chapterById.has(id));
    if (missingChapterIds.length) {
      add("review", "ฉากอ้างอิงบทที่ไม่พบ", "ฉาก “" + scene.title + "” เชื่อมกับบทที่ไม่มีอยู่ในนิยายนี้แล้ว ควรตรวจการอ้างอิง");
    }
    if (!linkedChapterIds.length && !["written", "revised"].includes(scene.scene_status)) {
      add("hint", "ฉากยังไม่เชื่อมกับบท", "ฉาก “" + scene.title + "” ยังไม่ได้ระบุบทที่เกิดขึ้น เหมาะสำหรับตรวจแผนก่อนลงมือเขียน");
    }
    const linked = linkedChapterIds.filter(id => chapterById.has(id));
    if (linked.length && scene.scene_status === "written") {
      const hasText = linked.some(id => String(chapterById.get(id)?.text || chapterById.get(id)?.body || "").trim().length > 0);
      if (!hasText) add("hint", "ฉากเขียนแล้วแต่บทว่าง", "ฉาก “" + scene.title + "” ถูกทำเครื่องหมายว่าเขียนแล้ว แต่บทที่เชื่อมยังไม่มีข้อความ");
    }
  }
  return findings;
}

function renderContinuityResults(findings, meta = {}) {
  const target = $("continuityResults");
  const hint = $("continuityHint");
  if (!target || !hint) return;
  const reviewCount = findings.filter(item => item.kind === "review").length;
  const hintCount = findings.length - reviewCount;
  hint.textContent = (meta.scanned || 0).toLocaleString("th-TH") + " จาก " + (meta.total || 0).toLocaleString("th-TH") +
    " บท · พบรายการที่ควรตรวจ " + reviewCount.toLocaleString("th-TH") + " รายการ และข้อเสนอแนะ " + hintCount.toLocaleString("th-TH") + " รายการ" +
    (meta.partial ? " · ตรวจไม่ครบทุกบท: " + meta.partial : "") +
    " · ผลตรวจเป็นตัวช่วยสังเกต ไม่ใช่การยืนยันว่ามีข้อผิดพลาด";
  if (!findings.length) {
    target.innerHTML = '<p class="continuity-empty">ไม่พบสัญญาณที่ต้องตรวจจากกฎเบื้องต้นในข้อมูลที่สแกน</p>';
    return;
  }
  target.innerHTML = findings.slice(0, 80).map(item =>
    '<article class="continuity-item ' + (item.kind === "review" ? "needs-review" : "suggestion") + '">' +
      '<span>' + (item.kind === "review" ? "ควรตรวจทาน" : "ข้อเสนอแนะ") + '</span>' +
      '<div><b>' + escapeHtml(item.title) + '</b><p>' + escapeHtml(item.detail) + '</p></div>' +
      (item.chapterId ? '<button type="button" class="outline-button compact" data-continuity-chapter="' + escapeHtml(item.chapterId) + '">เปิดบท</button>' : '') +
    '</article>'
  ).join("") + (findings.length > 80 ? '<p class="form-hint">แสดง 80 รายการแรกจากทั้งหมด ' + findings.length + ' รายการ</p>' : "");
  target.querySelectorAll("[data-continuity-chapter]").forEach(button => button.addEventListener("click", () => selectCloudChapter(button.dataset.continuityChapter)));
}

async function runStoryContinuityCheck() {
  const button = $("runContinuityCheck");
  const hint = $("continuityHint");
  if (!cloud.ready || !cloud.activeProjectId) {
    if (hint) hint.textContent = "กรุณาเข้าสู่ระบบและเลือกโครงการ Cloud ก่อนตรวจความต่อเนื่อง";
    return;
  }
  const projectId = cloud.activeProjectId;
  button.disabled = true;
  button.textContent = "กำลังตรวจ...";
  $("continuityResults").innerHTML = "";
  if (cloud.activeChapterId) {
    const saved = await saveCloudChapter();
    if (!saved) {
      button.disabled = false;
      button.textContent = "ตรวจความต่อเนื่อง";
      hint.textContent = "ยังตรวจไม่ได้ เพราะบทปัจจุบันบันทึกไม่สำเร็จ กรุณาตรวจสถานะการบันทึกก่อน";
      return;
    }
  }
  try {
    const candidates = cloud.chapters.slice(0, 40);
    const chapters = [];
    const failures = [];
    let textBudget = 0;
    for (let offset = 0; offset < candidates.length; offset += 4) {
      if (cloud.activeProjectId !== projectId) throw new Error("โครงการที่เลือกเปลี่ยนไประหว่างตรวจ");
      const batch = await Promise.all(candidates.slice(offset, offset + 4).map(async item => {
        try {
          const result = await cloudApi("/api/chapters/" + encodeURIComponent(item.id));
          return result.chapter;
        } catch (error) {
          failures.push((item.title || "บทไม่มีชื่อ") + ": " + error.message);
          return null;
        }
      }));
      for (const chapter of batch.filter(Boolean)) {
        const raw = String(chapter.body || "");
        const text = raw.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");
        if (textBudget + text.length > 1000000) {
          failures.push("ถึงขีดจำกัดข้อความ 1,000,000 ตัวอักษร");
          break;
        }
        textBudget += text.length;
        chapters.push({ ...chapter, text });
      }
      if (failures.some(message => message.startsWith("ถึงขีดจำกัด"))) break;
    }
    if (cloud.activeProjectId !== projectId) throw new Error("โครงการที่เลือกเปลี่ยนไประหว่างตรวจ");
    const findings = analyzeStoryContinuity({
      chapters,
      characters: cloud.modules.characters || [],
      timeline: cloud.modules.timeline || [],
      plotThreads: cloud.modules["plot-threads"] || [],
      scenes: (cloud.modules.notes || []).filter(note => note.note_type === "scene")
    });
    const partial = [
      candidates.length < cloud.chapters.length ? "จำกัดการตรวจไว้ 40 บท" : "",
      failures.length ? failures.slice(0, 3).join(" · ") : ""
    ].filter(Boolean).join(" · ");
    renderContinuityResults(findings, { scanned: chapters.length, total: cloud.chapters.length, partial });
  } catch (error) {
    hint.textContent = "ตรวจความต่อเนื่องไม่สำเร็จ: " + error.message;
  } finally {
    button.disabled = false;
    button.textContent = "ตรวจอีกครั้ง";
  }
}

function renderChapterCharacterReferences() {
  const select = $("chapterCharacters");
  const panel = $("chapterCanonPanel");
  const continuityPanel = $("continuityPanel");
  if (continuityPanel) continuityPanel.hidden = !cloud.ready || !cloud.activeProjectId;
  if (!select || !panel) return;
  const enabled = cloud.ready && Boolean(cloud.activeProjectId && cloud.activeChapterId);
  panel.hidden = !enabled;
  if (!enabled) return;
  const selected = new Set(chapterCharacterIds(cloud.chapters.find(item => item.id === cloud.activeChapterId)));
  select.innerHTML = (cloud.modules.characters || []).map(character =>
    `<option value="${escapeHtml(character.id)}" ${selected.has(character.id) ? "selected" : ""}>${escapeHtml(character.name)}</option>`
  ).join("") || '<option value="" disabled>ยังไม่มีตัวละครในโครงการนี้</option>';
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

async function hydrateRelationshipPortraits(svg, characters, projectId) {
  if (!svg || !projectId || !characters.length) return;
  const ns = "http://www.w3.org/2000/svg";
  for (const character of characters) {
    try {
      const records = await characterVaultRecords(projectId, character.id);
      const canonical = records.find(record => record.canonical) || records[records.length - 1];
      if (!canonical || !svg.isConnected) continue;
      const node = svg.querySelector('[data-character-id="' + CSS.escape(character.id) + '"]');
      if (!node) continue;
      const rect = node.querySelector("rect");
      const x = Number(rect?.getAttribute("x")) || 0;
      const y = Number(rect?.getAttribute("y")) || 0;
      const clipId = "portrait_" + String(character.id).replace(/[^a-zA-Z0-9_-]/g, "");
      const defs = svg.querySelector("defs") || document.createElementNS(ns, "defs");
      if (!defs.parentNode) svg.prepend(defs);
      const clip = document.createElementNS(ns, "clipPath");
      clip.setAttribute("id", clipId);
      const circle = document.createElementNS(ns, "circle");
      circle.setAttribute("cx", String(x + 27)); circle.setAttribute("cy", String(y + 33)); circle.setAttribute("r", "17");
      clip.appendChild(circle); defs.appendChild(clip);
      const image = document.createElementNS(ns, "image");
      image.setAttribute("href", canonical.dataUrl);
      image.setAttribute("x", String(x + 10)); image.setAttribute("y", String(y + 16));
      image.setAttribute("width", "34"); image.setAttribute("height", "34");
      image.setAttribute("preserveAspectRatio", "xMidYMid slice");
      image.setAttribute("clip-path", "url(#" + clipId + ")");
      node.appendChild(image);
    } catch (error) {
      console.warn("Character portrait unavailable", error);
    }
  }
}

function renderRelationshipGraph() {
  const target = $("relationshipGraph");
  if (!target) return;
  const characters = cloud.modules.characters || [];
  const relationships = cloud.modules.relationships || [];
  if (!cloud.ready) {
    target.textContent = "เข้าสู่ระบบและเลือกโครงการเพื่อดูแผนผังความสัมพันธ์";
    return;
  }
  if (!characters.length) {
    target.textContent = "เพิ่มตัวละครเพื่อเริ่มสร้างแผนผังสายใยความสัมพันธ์";
    return;
  }
  const width = Math.max(620, Math.ceil(Math.sqrt(characters.length)) * 190 + 60);
  const nodeWidth = 154, nodeHeight = 66, gapX = 34, gapY = 54;
  const columns = Math.max(2, Math.floor((width - 40) / (nodeWidth + gapX)));
  const rows = Math.ceil(characters.length / columns);
  const height = Math.max(180, rows * (nodeHeight + gapY) + 40);
  const layoutKey = "sf_relationship_layout_" + (cloud.activeProjectId || "local");
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(layoutKey) || "{}"); } catch {}
  const positions = new Map();
  characters.forEach((item,index) => {
    const fallback = {x:24+(index%columns)*(nodeWidth+gapX),y:20+Math.floor(index/columns)*(nodeHeight+gapY)};
    const pos = saved[item.id] && Number.isFinite(saved[item.id].x) && Number.isFinite(saved[item.id].y) ? saved[item.id] : fallback;
    positions.set(item.id,{x:Math.max(0,Math.min(width-nodeWidth,pos.x)),y:Math.max(0,Math.min(height-nodeHeight,pos.y))});
  });
  const relationColor = value => {
    const t=String(value||"").toLowerCase();
    if(/ศัตรู|เกลียด|หักหลัง|คู่แข่ง|enemy|rival|betray|hostile/.test(t)) return "#c66b70";
    if(/ครอบครัว|พ่อ|แม่|พี่|น้อง|ลูก|family|father|mother|sibling|brother|sister/.test(t)) return "#7da7d8";
    if(/รัก|คนรัก|คู่หมั้น|แอบรัก|love|romance|partner|fiance/.test(t)) return "#d58aa9";
    if(/พันธมิตร|เพื่อน|ร่วมมือ|ally|friend|collaborat/.test(t)) return "#83b99a";
    if(/ธุรกิจ|เจ้านาย|ลูกน้อง|business|boss|employee/.test(t)) return "#a7adb8";
    if(/อาจารย์|ผู้ชี้แนะ|ศิษย์|mentor|teacher|student/.test(t)) return "#c5a15b";
    return "#b99a62";
  };
  const edges = relationships.map((rel,index) => {
    const a=positions.get(rel.source_character_id), b=positions.get(rel.target_character_id);
    if(!a||!b) return "";
    const x1=a.x+nodeWidth/2,y1=a.y+nodeHeight/2,x2=b.x+nodeWidth/2,y2=b.y+nodeHeight/2;
    const color=relationColor(rel.relationship_type);
    return `<g class="relationship-edge" data-edge-id="${escapeHtml(rel.id||String(index))}"><path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="${color}" stroke-width="2" opacity=".78" fill="none"/><text x="${(x1+x2)/2}" y="${(y1+y2)/2-8}" fill="${color}" font-size="12" text-anchor="middle" paint-order="stroke" stroke="#0c1626" stroke-width="4">${escapeHtml(rel.relationship_type||"เกี่ยวข้อง")}</text></g>`;
  }).join("");
  const nodes=characters.map(item=>{
    const p=positions.get(item.id), initials=String(item.name||"?").trim().slice(0,1);
    let profile={}; try { profile=JSON.parse(item.profile_json||"{}"); } catch {}
    const roleLabel=profile.profession||item.role||"ตัวละคร";
    return `<g class="relationship-node" data-character-id="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="ตัวละคร ${escapeHtml(item.name)}" style="cursor:grab"><rect x="${p.x}" y="${p.y}" width="${nodeWidth}" height="${nodeHeight}" rx="9" fill="#18263a" stroke="#c5a15b" stroke-width="1.5"/><circle cx="${p.x+27}" cy="${p.y+33}" r="17" fill="#382d29" stroke="#c5a15b"/><text x="${p.x+27}" y="${p.y+38}" fill="#eadbb9" font-size="15" text-anchor="middle">${escapeHtml(initials)}</text><text x="${p.x+52}" y="${p.y+28}" fill="#eadbb9" font-size="13">${escapeHtml(item.name.slice(0, 20))}</text><text x="${p.x+52}" y="${p.y+47}" fill="#a99b7e" font-size="10">${escapeHtml(String(roleLabel).slice(0,18))}</text></g>`;
  }).join("");
  target.innerHTML = `<div class="relationship-graph-tools"><span>ลากการ์ดเพื่อจัดตำแหน่ง · แตะตัวละครเพื่อดูข้อมูล</span><button type="button" class="outline-button compact" id="resetRelationshipLayout">จัดผังใหม่</button></div><svg viewBox="0 0 ${width} ${height}" width="100%" role="group" aria-label="แผนผังสายใยความสัมพันธ์ของตัวละคร">${edges}${nodes}</svg><div class="relationship-legend"><span><i style="background:#d58aa9"></i>ความรัก</span><span><i style="background:#c66b70"></i>ศัตรู/ขัดแย้ง</span><span><i style="background:#7da7d8"></i>ครอบครัว</span><span><i style="background:#83b99a"></i>พันธมิตร</span><span><i style="background:#c5a15b"></i>ผู้ชี้แนะ</span></div>`;
  const svg=target.querySelector("svg");
  hydrateRelationshipPortraits(svg, characters, cloud.activeProjectId);
  target.querySelectorAll(".relationship-node").forEach(node=>{
    node.addEventListener("pointerdown",event=>{
      if(event.button!==0) return;
      const id=node.dataset.characterId, start=positions.get(id), rect=svg.getBoundingClientRect();
      const sx=(event.clientX-rect.left)*width/rect.width-start.x, sy=(event.clientY-rect.top)*height/rect.height-start.y;
      let moved=false;
      node.setPointerCapture?.(event.pointerId);
      const move=e=>{
        const dx=(e.clientX-event.clientX), dy=(e.clientY-event.clientY);
        if(Math.hypot(dx,dy)>4) moved=true;
        const x=Math.max(0,Math.min(width-nodeWidth,(e.clientX-rect.left)*width/rect.width-sx));
        const y=Math.max(0,Math.min(height-nodeHeight,(e.clientY-rect.top)*height/rect.height-sy));
        positions.set(id,{x,y});
        saved[id]={x,y};
        node.setAttribute("transform","translate("+(x-start.x)+" "+(y-start.y)+")");
        target.querySelectorAll(".relationship-edge").forEach(edge=>{
          const rel=relationships.find(row=>row.id===edge.dataset.edgeId);
          if(!rel) return;
          const from=positions.get(rel.source_character_id), to=positions.get(rel.target_character_id);
          if(!from||!to) return;
          const x1=from.x+nodeWidth/2, y1=from.y+nodeHeight/2;
          const x2=to.x+nodeWidth/2, y2=to.y+nodeHeight/2;
          const path=edge.querySelector("path"), label=edge.querySelector("text");
          path?.setAttribute("d", "M "+x1+" "+y1+" L "+x2+" "+y2);
          label?.setAttribute("x", (x1+x2)/2);
          label?.setAttribute("y", (y1+y2)/2-8);
        });
      };
      const finish=()=>{
        node.removeEventListener("pointermove",move);
        node.removeEventListener("pointerup",finish);
        node.removeEventListener("pointercancel",finish);
        if(moved) node.dataset.dragged="true";
        localStorage.setItem(layoutKey,JSON.stringify(saved));
        renderRelationshipGraph();
      };
      node.addEventListener("pointermove",move);
      node.addEventListener("pointerup",finish,{once:true});
      node.addEventListener("pointercancel",finish,{once:true});
    });
    node.addEventListener("click",event=> {
      if(node.dataset.dragged==="true") { delete node.dataset.dragged; return; }
      if (event.target.closest?.("button")) return;
      const character=characters.find(item=>item.id===node.dataset.characterId);
      if(character) {
        startEditCharacter(character);
        showTab("characters");
        $("characterName")?.scrollIntoView({behavior:"smooth",block:"center"});
      }
    });
    node.addEventListener("keydown",event=>{
      if(event.key!=="Enter" && event.key!==" ") return;
      event.preventDefault();
      const character=characters.find(item=>item.id===node.dataset.characterId);
      if(character) {
        startEditCharacter(character);
        showTab("characters");
        $("characterName")?.scrollIntoView({behavior:"smooth",block:"center"});
      }
    });
  });
  target.querySelectorAll(".relationship-edge").forEach(edge=>{
    edge.style.cursor="pointer";
    edge.setAttribute("tabindex","0");
    edge.setAttribute("role","button");
    edge.setAttribute("aria-label","แก้ไขความสัมพันธ์");
    const edit=()=>editModuleItem("relationships",edge.dataset.edgeId);
    edge.addEventListener("click",edit);
    edge.addEventListener("keydown",event=>{
      if(event.key==="Enter" || event.key===" ") { event.preventDefault(); edit(); }
    });
  });
  $("resetRelationshipLayout")?.addEventListener("click",()=>{localStorage.removeItem(layoutKey);renderRelationshipGraph();});
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
    const cards = items.filter(item => item.status === column.key).map(item => {
      const linkedIds = new Set(plotChapterIds(item));
      const relatedScenes = (cloud.modules.notes || []).filter(scene => {
        if (scene.note_type !== "scene") return false;
        const ids = safeJSON(scene.chapter_ids_json || "[]", []);
        return Array.isArray(ids) && ids.some(id => linkedIds.has(id));
      });
      return `<article class="plot-board-card">
        <b>${escapeHtml(item.title)}</b>
        <p>${escapeHtml(item.summary || "ยังไม่มีคำอธิบาย")}</p>
        <div class="plot-linked-chapters"><small>เชื่อมกับบท ${plotChapterIds(item).length}/${(cloud.chapters || []).length} บท</small>
          ${plotChapterIds(item).map(id => {
            const chapter = cloud.chapters.find(row => row.id === id);
            return chapter ? '<button type="button" class="plot-chapter-link" data-plot-chapter="' + escapeHtml(id) + '">' + escapeHtml(chapter.title || "บทไม่มีชื่อ") + '</button>' : '<span class="plot-chapter-missing">บทที่อ้างอิงไม่พบ</span>';
          }).join("") || '<span class="plot-chapter-missing">ยังไม่ได้เชื่อมบท</span>'}
        </div>
        <div class="plot-linked-scenes"><small>ฉากที่เกี่ยวข้อง</small>
          ${relatedScenes.map(scene => {
            const ids = safeJSON(scene.chapter_ids_json || "[]", []);
            const firstChapter = (cloud.chapters || []).find(chapter => Array.isArray(ids) && ids.includes(chapter.id) && linkedIds.has(chapter.id));
            return '<span>' + escapeHtml(scene.title || "ฉากไม่มีชื่อ") + '</span>' +
              (firstChapter ? '<button type="button" class="plot-chapter-link" data-plot-scene-chapter="' + escapeHtml(firstChapter.id) + '">เปิดบทฉาก →</button>' : '');
          }).join("") || '<span class="plot-chapter-missing">ยังไม่มีฉากที่เชื่อมกับบทของเส้นเรื่องนี้</span>'}
        </div>
        <select data-plot-status="${escapeHtml(item.id)}" aria-label="เปลี่ยนสถานะเส้นเรื่อง">
          ${columns.map(option => `<option value="${option.key}" ${option.key === item.status ? "selected" : ""}>${option.title}</option>`).join("")}
        </select>
        <div class="module-actions"><button type="button" class="outline-button compact" data-module-edit="plot-threads" data-module-id="${escapeHtml(item.id)}">แก้ไข</button><button type="button" class="outline-button compact" data-module-delete="plot-threads" data-module-id="${escapeHtml(item.id)}">ลบ</button></div>
      </article>`;
    }).join("");
    return `<section class="plot-board-column"><header><b>${column.title}</b><span>${items.filter(item => item.status === column.key).length}</span></header>${cards || '<p class="muted-note">ยังไม่มีเส้นเรื่อง</p>'}</section>`;
  }).join("");
  target.querySelectorAll("[data-plot-chapter], [data-plot-scene-chapter]").forEach(button =>
    button.addEventListener("click", () => selectCloudChapter(button.dataset.plotChapter || button.dataset.plotSceneChapter))
  );
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

function selectedModuleCharacterIds(selectId) {
  return Array.from($(selectId)?.selectedOptions || []).map(option => option.value).filter(Boolean);
}

function populateModuleCharacterSelectors() {
  const characters = cloud.modules.characters || [];
  for (const id of ["plotCharacters", "worldCharacters", "timelineCharacters", "notesCharacters"]) {
    const select = $(id);
    if (!select) continue;
    const selected = new Set(Array.from(select.selectedOptions || []).map(option => option.value));
    select.innerHTML = characters.map(character =>
      '<option value="' + escapeHtml(character.id) + '">' + escapeHtml(character.name) + '</option>'
    ).join("");
    Array.from(select.options).forEach(option => { option.selected = selected.has(option.value); });
    select.disabled = !characters.length;
  }
  const chapterSelect = $("plotChapters");
  if (chapterSelect) {
    const selected = new Set(Array.from(chapterSelect.selectedOptions || []).map(option => option.value));
    chapterSelect.innerHTML = (cloud.chapters || []).map(chapter =>
      '<option value="' + escapeHtml(chapter.id) + '">' + escapeHtml(chapter.title || "บทไม่มีชื่อ") + '</option>'
    ).join("");
    Array.from(chapterSelect.options).forEach(option => { option.selected = selected.has(option.value); });
    chapterSelect.disabled = !cloud.chapters.length;
  }
}

function characterReferenceNames(item) {
  let ids = [];
  try { ids = JSON.parse(item.character_ids_json || "[]"); } catch {}
  return ids.map(id => (cloud.modules.characters || []).find(character => character.id === id)?.name).filter(Boolean);
}

function plotChapterIds(item) {
  try {
    const ids = JSON.parse(item?.chapter_ids_json || "[]");
    return Array.isArray(ids) ? ids.filter(id => typeof id === "string") : [];
  } catch { return []; }
}

function plotChapterNames(item) {
  return plotChapterIds(item).map(id => cloud.chapters.find(chapter => chapter.id === id)?.title || "บทที่ไม่พบ");
}

function promptChapterReferences(currentIds) {
  const chapters = cloud.chapters || [];
  if (!chapters.length) return [];
  const menu = chapters.map((chapter, index) => (index + 1) + ". " + (chapter.title || "บทไม่มีชื่อ")).join("\n");
  const current = (currentIds || []).map(id => chapters.findIndex(chapter => chapter.id === id) + 1).filter(n => n > 0).join(", ");
  const answer = prompt("เลือกบทที่เส้นเรื่องนี้เกี่ยวข้อง ใส่หมายเลขคั่นด้วยจุลภาค (เว้นว่าง = ยังไม่เชื่อมบท):\n" + menu, current);
  if (answer === null) return null;
  if (!answer.trim()) return [];
  const indexes = answer.split(",").map(value => Number(value.trim()) - 1);
  if (indexes.some(index => !Number.isInteger(index) || index < 0 || index >= chapters.length) || new Set(indexes).size !== indexes.length) {
    alert("หมายเลขบทไม่ถูกต้อง");
    return null;
  }
  return indexes.map(index => chapters[index].id);
}

function promptCharacterReferences(currentIds) {
  const characters = cloud.modules.characters || [];
  if (!characters.length) return [];
  const menu = characters.map((character, index) => (index + 1) + ". " + character.name).join("\n");
  const current = (currentIds || []).map(id => characters.findIndex(character => character.id === id) + 1).filter(n => n > 0).join(", ");
  const answer = prompt("เลือกตัวละครที่เกี่ยวข้อง ใส่หมายเลขคั่นด้วยจุลภาค (เว้นว่าง = ไม่เลือก):\n" + menu, current);
  if (answer === null) return null;
  if (!answer.trim()) return [];
  const indexes = answer.split(",").map(value => Number(value.trim()) - 1);
  if (indexes.some(index => !Number.isInteger(index) || index < 0 || index >= characters.length) || new Set(indexes).size !== indexes.length) {
    alert("หมายเลขตัวละครไม่ถูกต้อง");
    return null;
  }
  return indexes.map(index => characters[index].id);
}

function renderModuleLists() {
  const characters = cloud.modules.characters || [];
  const relationships = cloud.modules.relationships || [];
  const plots = cloud.modules["plot-threads"] || [];
  const worlds = cloud.modules["world-lore"] || [];
  const timeline = cloud.modules.timeline || [];
  const notes = cloud.modules.notes || [];
  const scenes = notes.filter(item => item.note_type === "scene");
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
    return [item.role, profile.nickname, profile.profession, profile.age, profile.species, profile.personality, profile.motivation].filter(Boolean).join(" · ");
  });
  render("relationshipList", relationships, "relationships", item => {
    const source = characters.find(x => x.id === item.source_character_id)?.name || "ตัวละคร";
    const target = characters.find(x => x.id === item.target_character_id)?.name || "ตัวละคร";
    return source + " ↔ " + target;
  }, item => [item.relationship_type, item.description].filter(Boolean).join(" · "));
  render("plotList", plots, "plot-threads", item => item.title, item => {
    const labels = { planned: "วางแผน", in_progress: "กำลังดำเนิน", completed: "เสร็จแล้ว", paused: "พักไว้" };
    const linked = plotChapterNames(item);
    return (labels[item.status] || item.status) + (item.summary ? " · " + item.summary : "") +
      (characterReferenceNames(item).length ? " · ตัวละคร: " + characterReferenceNames(item).join(", ") : "") +
      " · เชื่อมกับบท " + linked.length + "/" + (cloud.chapters || []).length +
      (linked.length ? " · " + linked.join(", ") : " · ยังไม่เชื่อมบท");
  });
  const chapterNamesFor = item => {
    const ids = safeJSON(item.chapter_ids_json || "[]", []);
    return (cloud.chapters || []).filter(chapter => Array.isArray(ids) && ids.includes(chapter.id)).map(chapter => chapter.title || "บทไม่มีชื่อ");
  };
  render("worldList", worlds, "world-lore", item => item.title, item => [item.category, item.content, characterReferenceNames(item).length ? "ตัวละคร: " + characterReferenceNames(item).join(", ") : "", chapterNamesFor(item).length ? "บท: " + chapterNamesFor(item).join(", ") : "ยังไม่เชื่อมบท"].filter(Boolean).join(" · "));
  render("timelineList", timeline, "timeline", item => item.title, item => [item.story_time, item.description, characterReferenceNames(item).length ? "ตัวละคร: " + characterReferenceNames(item).join(", ") : "", chapterNamesFor(item).length ? "บท: " + chapterNamesFor(item).join(", ") : "ยังไม่เชื่อมบท"].filter(Boolean).join(" · "));
  renderPlotBoard(plots);
  renderTimelineView(timeline);
  render("storyNoteList", notes.filter(item => item.note_type !== "project_memory" && item.note_type !== "scene"), "notes", item => item.title || "บันทึกไม่มีชื่อ", item => [item.content, characterReferenceNames(item).length ? "ตัวละคร: " + characterReferenceNames(item).join(", ") : ""].filter(Boolean).join(" · "));
  const sceneTypeLabels = { setup: "ปูเรื่อง", conflict: "ความขัดแย้ง", turning_point: "จุดเปลี่ยน", climax: "ไคลแมกซ์", resolution: "คลี่คลาย", other: "อื่น ๆ" };
  const sceneStatusLabels = { planned: "วางแผน", drafting: "กำลังเขียน", written: "เขียนแล้ว", revised: "ปรับแก้แล้ว" };
  const sceneList = $("sceneTrackerList");
  if (sceneList) sceneList.innerHTML = scenes.length ? scenes.map(scene => {
    const chapterIds = safeJSON(scene.chapter_ids_json || "[]", []);
    const chapters = (cloud.chapters || []).filter(chapter => chapterIds.includes(chapter.id));
    const charactersInScene = characterReferenceNames(scene);
    return `<article class="scene-tracker-item">
      <div class="scene-tracker-item-main"><div class="scene-tracker-tags"><span>${escapeHtml(sceneTypeLabels[scene.scene_type] || "ฉาก")}</span><span>${escapeHtml(sceneStatusLabels[scene.scene_status] || "วางแผน")}</span></div>
      <b>${escapeHtml(scene.title || "ฉากไม่มีชื่อ")}</b><p>${escapeHtml(scene.content || "")}</p>
      <small>บท: ${escapeHtml(chapters.map(ch => ch.title || "บทไม่มีชื่อ").join(", ") || "ยังไม่เชื่อมบท")} · ตัวละคร: ${escapeHtml(charactersInScene.join(", ") || "ยังไม่ระบุ")}</small>
      ${chapters.map(ch => `<button type="button" class="text-link scene-open-chapter" data-scene-chapter="${escapeHtml(ch.id)}">${escapeHtml(ch.title || "เปิดบท")} →</button>`).join(" ")}
      </div><div class="module-actions"><button type="button" class="outline-button compact" data-module-edit="notes" data-module-id="${escapeHtml(scene.id)}">แก้ไข</button><button type="button" class="outline-button compact" data-module-delete="notes" data-module-id="${escapeHtml(scene.id)}">ลบ</button></div>
    </article>`;
  }).join("") : `<p class="muted-note">${empty}</p>`;
  populateModuleCharacterSelectors();
  ["sceneChapters", "worldChapters", "timelineChapters"].forEach(populateChapterMultiSelect);
  populateModuleCharacterSelector("sceneCharacters");
  document.querySelectorAll("[data-scene-chapter]").forEach(button => button.addEventListener("click", () => selectCloudChapter(button.dataset.sceneChapter)));
  renderRelationshipOptions();
  renderRelationshipGraph();
  document.querySelectorAll("[data-module-delete]").forEach(button => button.addEventListener("click", () => deleteModuleItem(button.dataset.moduleDelete, button.dataset.moduleId)));
  document.querySelectorAll("[data-module-edit]").forEach(button => button.addEventListener("click", () => editModuleItem(button.dataset.moduleEdit, button.dataset.moduleId)));
  if ($("characterCount")) $("characterCount").textContent = characters.length.toLocaleString("th-TH");
  if ($("plotCount")) $("plotCount").textContent = plots.length.toLocaleString("th-TH");
  if ($("worldCount")) $("worldCount").textContent = worlds.length.toLocaleString("th-TH");
}

const CHARACTER_PROFILE_FIELDS = [
  "characterNickname", "characterAliases", "characterGender", "characterBirthday", "characterProfession",
  "characterAge", "characterPronouns", "characterSpecies", "characterHeight",
  "characterFace", "characterSkin", "characterEyes", "characterHair",
  "characterBuild", "characterClothing", "characterAccessories", "characterExpressions",
  "characterAppearance", "characterPersonality", "characterMotivation",
  "characterBackstory", "characterStrengths", "characterWeaknesses",
  "characterLikes", "characterDislikes", "characterSkills", "characterFamily",
  "characterCustomFields", "characterSecret", "characterProfile"
];

function characterProfileFromForm() {
  return {
    nickname: $("characterNickname").value,
    aliases: $("characterAliases").value,
    gender: $("characterGender").value,
    birthday: $("characterBirthday").value,
    profession: $("characterProfession").value,
    age: $("characterAge").value,
    pronouns: $("characterPronouns").value,
    species: $("characterSpecies").value,
    height: $("characterHeight").value,
    face: $("characterFace").value,
    skin: $("characterSkin").value,
    eyes: $("characterEyes").value,
    hair: $("characterHair").value,
    build: $("characterBuild").value,
    clothing: $("characterClothing").value,
    accessories: $("characterAccessories").value,
    expressions: $("characterExpressions").value,
    appearance: $("characterAppearance").value,
    personality: $("characterPersonality").value,
    motivation: $("characterMotivation").value,
    backstory: $("characterBackstory").value,
    strengths: $("characterStrengths").value,
    weaknesses: $("characterWeaknesses").value,
    likes: $("characterLikes").value,
    dislikes: $("characterDislikes").value,
    skills: $("characterSkills").value,
    family: $("characterFamily").value,
    customFields: $("characterCustomFields").value,
    secret: $("characterSecret").value,
    description: $("characterProfile").value
  };
}

// ==========================================
// CHARACTER REFERENCE VAULT — IndexedDB, isolated by project + character
// ==========================================
const CHARACTER_VAULT_DB = "storyforge_character_vault_v1";
const CHARACTER_VAULT_STORE = "references";
const ILLUSTRATION_LIBRARY_STORE = "illustrations";
function openCharacterVault() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("อุปกรณ์นี้ไม่รองรับคลังภาพ IndexedDB"));
    const request = indexedDB.open(CHARACTER_VAULT_DB, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CHARACTER_VAULT_STORE)) {
        const store = db.createObjectStore(CHARACTER_VAULT_STORE, { keyPath: "id" });
        store.createIndex("projectCharacter", ["projectId", "characterId"], { unique: false });
      }
      if (!db.objectStoreNames.contains(ILLUSTRATION_LIBRARY_STORE)) {
        const library = db.createObjectStore(ILLUSTRATION_LIBRARY_STORE, { keyPath: "id" });
        library.createIndex("projectId", "projectId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("เปิดคลังภาพไม่สำเร็จ"));
  });
}
async function characterVaultRecords(projectId, characterId) {
  const db = await openCharacterVault();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHARACTER_VAULT_STORE, "readonly");
    const request = tx.objectStore(CHARACTER_VAULT_STORE).index("projectCharacter").getAll([projectId, characterId]);
    request.onsuccess = () => { db.close(); resolve((request.result || []).sort((x,y) => x.createdAt - y.createdAt)); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
async function saveCharacterVaultRecord(record) {
  const db = await openCharacterVault();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHARACTER_VAULT_STORE, "readwrite");
    tx.objectStore(CHARACTER_VAULT_STORE).put(record);
    tx.oncomplete = () => { db.close(); resolve(record); };
    tx.onerror = () => { db.close(); reject(tx.error || new Error("บันทึกภาพไม่สำเร็จ")); };
  });
}
async function deleteCharacterVaultForCharacter(projectId, characterId) {
  const records = await characterVaultRecords(projectId, characterId);
  await Promise.all(records.map(record => deleteCharacterVaultRecord(record.id)));
}
async function deleteCharacterVaultRecord(id) {
  const db = await openCharacterVault();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHARACTER_VAULT_STORE, "readwrite");
    tx.objectStore(CHARACTER_VAULT_STORE).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
async function renderCharacterVault() {
  const target = $("characterReferenceGallery");
  const projectId = cloud.activeProjectId;
  const characterId = cloud.editingCharacterId;
  if (!target) return;
  if (!projectId || !characterId) {
    target.innerHTML = '<p class="muted-note">บันทึกตัวละครก่อนเพื่อเปิดคลังภาพอ้างอิง</p>';
    $("characterReferenceFile").disabled = true;
    return;
  }
  $("characterReferenceFile").disabled = false;
  try {
    const records = await characterVaultRecords(projectId, characterId);
    if (cloud.activeProjectId !== projectId || cloud.editingCharacterId !== characterId) return;
    target.innerHTML = records.length ? records.map(record => `
      <article class="character-reference-card" data-reference-id="${escapeHtml(record.id)}">
        <img src="${record.dataUrl}" alt="${escapeHtml(record.label || "ภาพอ้างอิงตัวละคร")}" loading="lazy">
        <div class="character-reference-meta"><b>${escapeHtml(record.label || "ภาพอ้างอิง")}</b><small>${escapeHtml(record.note || "ไม่มีหมายเหตุ")}</small><small>เวอร์ชัน ${record.version} · ${new Date(record.createdAt).toLocaleDateString("th-TH")}</small></div>
        <div class="module-actions">
          ${record.canonical ? '<span class="canonical-mark">ภาพ Canon</span>' : '<button type="button" class="outline-button compact" data-reference-canonical="' + escapeHtml(record.id) + '">ตั้งเป็น Canon</button>'}
          <button type="button" class="outline-button compact" data-reference-insert="${escapeHtml(record.id)}">แทรกในต้นฉบับ</button><button type="button" class="outline-button compact" data-reference-delete="${escapeHtml(record.id)}">ลบ</button>
        </div>
      </article>`).join("") : '<p class="muted-note">ยังไม่มีภาพอ้างอิง เพิ่มภาพต้นแบบเพื่อเก็บรายละเอียดรูปลักษณ์ให้คงที่</p>';
    target.querySelectorAll("[data-reference-canonical]").forEach(button => button.addEventListener("click", async () => {
      const all = await characterVaultRecords(projectId, characterId);
      await Promise.all(all.map(item => saveCharacterVaultRecord({ ...item, canonical: item.id === button.dataset.referenceCanonical })));
      await renderCharacterVault();
    }));
    target.querySelectorAll("[data-reference-insert]").forEach(button => button.addEventListener("click", async () => {
      const record = records.find(item => item.id === button.dataset.referenceInsert);
      if (!record) return;
      if (!cloud.activeProjectId || record.projectId !== cloud.activeProjectId) {
        $("characterVaultStatus").textContent = "ไม่สามารถแทรกภาพจากคนละโครงการได้";
        return;
      }
      pendingIllustrationData = record.dataUrl;
      if ($("illustrationCaption")) $("illustrationCaption").value = record.label || "ภาพอ้างอิงตัวละคร";
      insertIllustrationAtCursor();
      $("characterVaultStatus").textContent = "ส่งภาพอ้างอิงไปยังต้นฉบับแล้ว";
    }));
    target.querySelectorAll("[data-reference-delete]").forEach(button => button.addEventListener("click", async () => {
      if (!confirm("ลบภาพอ้างอิงเวอร์ชันนี้หรือไม่?")) return;
      await deleteCharacterVaultRecord(button.dataset.referenceDelete);
      await renderCharacterVault();
    }));
  } catch (error) {
    target.innerHTML = '<p class="muted-note">เปิดคลังภาพไม่สำเร็จ: ' + escapeHtml(error.message) + '</p>';
  }
}
async function addCharacterReference(file) {
  if (!cloud.activeProjectId || !cloud.editingCharacterId) throw new Error("กรุณาบันทึกและเลือกตัวละครก่อน");
  const current = await characterVaultRecords(cloud.activeProjectId, cloud.editingCharacterId);
  if (current.length >= 8) throw new Error("ตัวละครหนึ่งตัวเก็บภาพอ้างอิงได้สูงสุด 8 เวอร์ชัน");
  const dataUrl = await compressIllustration(file);
  const version = current.reduce((max, item) => Math.max(max, Number(item.version) || 0), 0) + 1;
  const record = {
    id: "ref_" + crypto.randomUUID(),
    projectId: cloud.activeProjectId,
    characterId: cloud.editingCharacterId,
    dataUrl,
    label: $("characterReferenceLabel").value.trim() || ("Reference " + version),
    note: $("characterReferenceNote").value.trim(),
    version,
    canonical: current.length === 0,
    createdAt: Date.now()
  };
  await saveCharacterVaultRecord(record);
  $("characterVaultStatus").textContent = "บันทึกภาพอ้างอิงเวอร์ชัน " + version + " แล้ว";
  $("characterReferenceFile").value = "";
  await renderCharacterVault();
}
function setupCharacterVault() {
  if ($("characterReferenceFile") && !$("characterReferenceFile").dataset.vaultBound) {
    $("characterReferenceFile").dataset.vaultBound = "true";
    $("characterReferenceFile").addEventListener("change", async event => {
    try {
      $("characterVaultStatus").textContent = "กำลังย่อและบันทึกภาพ...";
      await addCharacterReference(event.target.files?.[0]);
    } catch (error) { $("characterVaultStatus").textContent = error.message; }
    });
  }
  renderCharacterVault();
}

function resetCharacterForm() {
  cloud.editingCharacterId = "";
  $("characterName").value = "";
  $("characterRole").value = "";
  CHARACTER_PROFILE_FIELDS.forEach(id => { if ($(id)) $(id).value = ""; });
  $("addCharacter").textContent = "บันทึกตัวละคร";
  $("cancelCharacterEdit").hidden = true;
  if ($("characterReferenceFile")) $("characterReferenceFile").disabled = true;
  if ($("characterReferenceGallery")) $("characterReferenceGallery").innerHTML = '<p class="muted-note">บันทึกตัวละครก่อนเพื่อเปิดคลังภาพอ้างอิง</p>';
}

function startEditCharacter(item) {
  let profile = {};
  try { profile = JSON.parse(item.profile_json || "{}"); } catch {}
  cloud.editingCharacterId = item.id;
  $("characterName").value = item.name || "";
  $("characterRole").value = item.role || "";
  const values = {
    characterNickname: profile.nickname, characterAliases: profile.aliases, characterGender: profile.gender,
    characterBirthday: profile.birthday, characterProfession: profile.profession,
    characterAge: profile.age, characterPronouns: profile.pronouns,
    characterSpecies: profile.species, characterHeight: profile.height,
    characterFace: profile.face, characterSkin: profile.skin,
    characterEyes: profile.eyes, characterHair: profile.hair,
    characterBuild: profile.build, characterClothing: profile.clothing,
    characterAccessories: profile.accessories, characterExpressions: profile.expressions,
    characterAppearance: profile.appearance, characterPersonality: profile.personality,
    characterMotivation: profile.motivation, characterBackstory: profile.backstory,
    characterStrengths: profile.strengths, characterWeaknesses: profile.weaknesses,
    characterLikes: profile.likes, characterDislikes: profile.dislikes,
    characterSkills: profile.skills, characterFamily: profile.family,
    characterCustomFields: profile.customFields,
    characterSecret: profile.secret, characterProfile: profile.description
  };
  for (const [id, value] of Object.entries(values)) $(id).value = value || "";
  $("addCharacter").textContent = "บันทึกการแก้ไข";
  $("cancelCharacterEdit").hidden = false;
  $("characterName").focus();
  setupCharacterVault();
}

async function saveCharacter() {
  const name = $("characterName").value.trim();
  if (!name) return alert("กรุณาระบุชื่อตัวละคร");
  const profile = characterProfileFromForm();
  if (JSON.stringify(profile).length > 19000) {
    return alert("ข้อมูลตัวละครยาวเกินขนาดที่ระบบรองรับ กรุณาย่อรายละเอียดบางส่วนก่อนบันทึก");
  }
  const payload = {
    name,
    role: $("characterRole").value,
    profile_json: profile,
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
    if (ok) { resetCharacterForm(); const created = (cloud.modules.characters || []).find(item => item.name === name); if (created) startEditCharacter(created); }
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
    if (collection === "characters") await deleteCharacterVaultForCharacter(cloud.activeProjectId, itemId);
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
    const character_ids = promptCharacterReferences(JSON.parse(item.character_ids_json || "[]"));
    if (character_ids === null) return;
    const chapter_ids = promptChapterReferences(plotChapterIds(item));
    if (chapter_ids === null) return;
    payload = { title, summary, character_ids_json: character_ids, chapter_ids_json: chapter_ids };
  } else if (collection === "world-lore") {
    const category = prompt("หมวดหมู่ (place / history / rule / culture / faction / other)", item.category || "other");
    if (category === null) return;
    const title = prompt("หัวข้อ", item.title);
    if (title === null) return;
    const content = prompt("รายละเอียด", item.content || "");
    if (content === null) return;
    const character_ids = promptCharacterReferences(safeJSON(item.character_ids_json || "[]", []));
    if (character_ids === null) return;
    const chapter_ids = promptChapterReferences(safeJSON(item.chapter_ids_json || "[]", []));
    if (chapter_ids === null) return;
    payload = { category, title, content, character_ids_json: character_ids, chapter_ids_json: chapter_ids };
  } else if (collection === "timeline") {
    const title = prompt("ชื่อเหตุการณ์", item.title);
    if (title === null) return;
    const story_time = prompt("เวลาในเรื่อง", item.story_time || "");
    if (story_time === null) return;
    const description = prompt("รายละเอียด", item.description || "");
    if (description === null) return;
    const character_ids = promptCharacterReferences(safeJSON(item.character_ids_json || "[]", []));
    if (character_ids === null) return;
    const chapter_ids = promptChapterReferences(safeJSON(item.chapter_ids_json || "[]", []));
    if (chapter_ids === null) return;
    payload = { title, story_time, description, character_ids_json: character_ids, chapter_ids_json: chapter_ids };
  } else if (collection === "notes") {
    const title = prompt(item.note_type === "scene" ? "ชื่อฉาก" : "หัวข้อ", item.title || "");
    if (title === null) return;
    const content = prompt("รายละเอียด", item.content || "");
    if (content === null) return;
    const character_ids = promptCharacterReferences(safeJSON(item.character_ids_json || "[]", []));
    if (character_ids === null) return;
    payload = { title, content, character_ids_json: character_ids };
    if (item.note_type === "scene") {
      const scene_type = prompt("ประเภทฉาก (setup / conflict / turning_point / climax / resolution / other)", item.scene_type || "other");
      if (scene_type === null) return;
      const scene_status = prompt("สถานะฉาก (planned / drafting / written / revised)", item.scene_status || "planned");
      if (scene_status === null) return;
      const chapter_ids_json = promptChapterReferences(safeJSON(item.chapter_ids_json || "[]", []));
      if (chapter_ids_json === null) return;
      Object.assign(payload, { scene_type, scene_status, chapter_ids_json });
    }
  } else if (collection === "relationships") {
    const characters = cloud.modules.characters || [];
    if (characters.length < 2) return alert("ต้องมีตัวละครอย่างน้อยสองตัวเพื่อแก้ไขความสัมพันธ์");
    const choices = characters.map((character, index) => (index + 1) + ". " + character.name).join("\n");
    const currentSource = characters.findIndex(character => character.id === item.source_character_id);
    const currentTarget = characters.findIndex(character => character.id === item.target_character_id);
    const sourceChoice = prompt("เลือกตัวละครต้นทาง โดยใส่หมายเลข:\n" + choices, String(currentSource + 1));
    if (sourceChoice === null) return;
    const sourceIndex = Number(sourceChoice) - 1;
    if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= characters.length) return alert("หมายเลขตัวละครต้นทางไม่ถูกต้อง");
    const targetChoice = prompt("เลือกตัวละครปลายทาง โดยใส่หมายเลข:\n" + choices, String(currentTarget + 1));
    if (targetChoice === null) return;
    const targetIndex = Number(targetChoice) - 1;
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= characters.length || targetIndex === sourceIndex) return alert("กรุณาเลือกตัวละครปลายทางให้ถูกต้องและไม่ซ้ำกับต้นทาง");
    const relationship_type = prompt("ประเภทความสัมพันธ์", item.relationship_type || "");
    if (relationship_type === null) return;
    const description = prompt("รายละเอียด", item.description || "");
    if (description === null) return;
    payload = {
      source_character_id: characters[sourceIndex].id,
      target_character_id: characters[targetIndex].id,
      relationship_type, description
    };
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
    createModuleItem("plot-threads", { title, summary: $("plotSummary").value, status: $("plotStatus").value, character_ids_json: selectedModuleCharacterIds("plotCharacters"), chapter_ids_json: selectedModuleCharacterIds("plotChapters"), sort_order: cloud.modules["plot-threads"].length })
      .then(ok => { if (ok) { $("plotTitle").value = ""; $("plotSummary").value = ""; Array.from($("plotCharacters").options).forEach(option => { option.selected = false; }); Array.from($("plotChapters").options).forEach(option => { option.selected = false; }); } });
  });
  $("addWorld")?.addEventListener("click", () => {
    const title = $("worldTitle").value.trim();
    if (!title) return alert("กรุณาระบุชื่อข้อมูลโลก");
    createModuleItem("world-lore", { category: $("worldCategory").value, title, content: $("worldContent").value, character_ids_json: JSON.stringify(selectedModuleCharacterIds("worldCharacters")), chapter_ids_json: JSON.stringify(selectedModuleChapterIds("worldChapters")), sort_order: cloud.modules["world-lore"].length })
      .then(ok => { if (ok) { $("worldTitle").value = ""; $("worldContent").value = ""; ["worldCharacters", "worldChapters"].forEach(id => Array.from($(id)?.options || []).forEach(option => { option.selected = false; })); } });
  });
  $("addTimeline")?.addEventListener("click", () => {
    const title = $("timelineTitle").value.trim();
    if (!title) return alert("กรุณาระบุชื่อเหตุการณ์");
    createModuleItem("timeline", { title, story_time: $("timelineTime").value, description: $("timelineDescription").value, character_ids_json: JSON.stringify(selectedModuleCharacterIds("timelineCharacters")), chapter_ids_json: JSON.stringify(selectedModuleChapterIds("timelineChapters")), sort_order: cloud.modules.timeline.length })
      .then(ok => { if (ok) { $("timelineTitle").value = ""; $("timelineTime").value = ""; $("timelineDescription").value = ""; ["timelineCharacters", "timelineChapters"].forEach(id => Array.from($(id)?.options || []).forEach(option => { option.selected = false; })); } });
  });
  $("addStoryNote")?.addEventListener("click", () => {
    const title = $("storyNoteTitle").value.trim();
    if (!title) return alert("กรุณาระบุหัวข้อบันทึก");
    createModuleItem("notes", { title, content: $("storyNoteContent").value, note_type: "idea", pinned: false, character_ids_json: selectedModuleCharacterIds("notesCharacters") })
      .then(ok => { if (ok) { $("storyNoteTitle").value = ""; $("storyNoteContent").value = ""; Array.from($("notesCharacters")?.options || []).forEach(option => { option.selected = false; }); } });
  });
  $("addScene")?.addEventListener("click", async () => {
    const title = $("sceneTitle")?.value.trim();
    if (!title) return alert("กรุณาระบุชื่อฉาก");
    const ok = await createModuleItem("notes", {
      title, content: $("sceneDescription")?.value || "", note_type: "scene", pinned: false,
      scene_type: $("sceneType")?.value || "other", scene_status: $("sceneStatus")?.value || "planned",
      chapter_ids_json: JSON.stringify(selectedModuleChapterIds("sceneChapters")),
      character_ids_json: JSON.stringify(selectedModuleCharacterIds("sceneCharacters"))
    });
    if (ok) {
      ["sceneTitle", "sceneDescription"].forEach(id => { if ($(id)) $(id).value = ""; });
      ["sceneChapters", "sceneCharacters"].forEach(id => Array.from($(id)?.options || []).forEach(option => { option.selected = false; }));
      $("sceneType").value = "setup"; $("sceneStatus").value = "planned";
    }
  });
}

function selectedModuleChapterIds(selectId) {
  return Array.from($(selectId)?.selectedOptions || []).map(option => option.value).filter(Boolean);
}
function populateChapterMultiSelect(selectId) {
  const select = $(selectId);
  if (!select) return;
  const previous = new Set(Array.from(select.selectedOptions || []).map(option => option.value));
  select.replaceChildren();
  (cloud.chapters || []).forEach(chapter => {
    const option = document.createElement("option");
    option.value = chapter.id;
    option.textContent = chapter.title || "บทไม่มีชื่อ";
    option.selected = previous.has(chapter.id);
    select.appendChild(option);
  });
  if (!(cloud.chapters || []).length) {
    const option = document.createElement("option");
    option.disabled = true; option.textContent = "ยังไม่มีบทในนิยายนี้"; select.appendChild(option);
  }
}
function populateModuleCharacterSelector(selectId) {
  const select = $(selectId);
  if (!select) return;
  const previous = new Set(Array.from(select.selectedOptions || []).map(option => option.value));
  select.replaceChildren();
  (cloud.modules.characters || []).forEach(character => {
    const option = document.createElement("option");
    option.value = character.id; option.textContent = character.name || "ตัวละครไม่มีชื่อ";
    option.selected = previous.has(character.id); select.appendChild(option);
  });
  if (!(cloud.modules.characters || []).length) {
    const option = document.createElement("option"); option.disabled = true;
    option.textContent = "ยังไม่มีตัวละครในนิยายนี้"; select.appendChild(option);
  }
}
function renderChapterSelect() {
  const canManageChapters = cloud.ready && Boolean(cloud.activeProjectId);
  if ($("continuityPanel")) $("continuityPanel").hidden = !canManageChapters;
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
      list.innerHTML = cloud.chapters.map((item, index) => {
        const sceneCount = (cloud.modules.notes || []).filter(scene =>
          scene.note_type === "scene" && safeJSON(scene.chapter_ids_json || "[]", []).includes(item.id)
        ).length;
        return `<button type="button" class="chapter-list-item ${item.id === cloud.activeChapterId ? "active" : ""}" data-chapter-item="${escapeHtml(item.id)}"><span>${String(index + 1).padStart(2, "0")}</span><div><b>${escapeHtml(item.title || "บทไม่มีชื่อ")}</b><small>${({ planned: "วางแผน", draft: "ฉบับร่าง", revised: "ปรับแก้แล้ว", final: "ฉบับสมบูรณ์" })[item.writing_status || "draft"]} · ${(Number(item.word_count) || 0).toLocaleString("th-TH")} คำ · ${sceneCount} ฉาก</small>${item.synopsis ? '<small class="chapter-outline-summary">' + escapeHtml(item.synopsis) + '</small>' : '<small class="chapter-outline-summary muted">ยังไม่มีสรุปย่อ</small>'}</div></button>`;
      }).join("");
      list.querySelectorAll("[data-chapter-item]").forEach(button =>
        button.addEventListener("click", () => selectCloudChapter(button.dataset.chapterItem))
      );
    }
  }
  if ($("chapterTotal")) $("chapterTotal").textContent = cloud.ready
    ? cloud.chapters.length.toLocaleString("th-TH") + " บท"
    : "ฉบับในเครื่อง";
  populateModuleCharacterSelectors();
  renderPlotBoard(cloud.modules["plot-threads"] || []);
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
  $("chapterSynopsis").value = fullChapter.synopsis || "";
  $("chapterStatus").value = fullChapter.writing_status || "draft";
  renderChapterCharacterReferences();
  const localDraft = safeJSON(localStorage.getItem(localChapterDraftKey(item.id)) || "null", null);
  const hasRecoverableDraft = Boolean(localDraft &&
    (localDraft.title !== (fullChapter.title || "") || localDraft.body !== (fullChapter.body || "") ||
      (localDraft.synopsis || "") !== (fullChapter.synopsis || "") ||
      (localDraft.writing_status || "draft") !== (fullChapter.writing_status || "draft") ||
      JSON.stringify(chapterCharacterIds({ character_ids_json: localDraft.character_ids_json })) !== JSON.stringify(chapterCharacterIds(fullChapter))));
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
  const draft = {
    ...activeChapterDraft()
  };
  const lastSaved = cloud.chapters.find(item => item.id === chapterId);
  if (lastSaved && lastSaved.title === draft.title && lastSaved.body === draft.body &&
      (lastSaved.synopsis || "") === draft.synopsis && (lastSaved.writing_status || "draft") === draft.writing_status &&
      JSON.stringify(chapterCharacterIds(lastSaved)) === draft.character_ids_json) return true;
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
      storeLocalChapterDraft(chapterId, { title: result.chapter.title, body: result.chapter.body, synopsis: result.chapter.synopsis || "", writing_status: result.chapter.writing_status || "draft", character_ids_json: result.chapter.character_ids_json || "[]" }, result.chapter.revision);
      renderChapterCharacterReferences();
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
          ($("chapterTitle").value !== draft.title || $("manuscriptBody").value !== draft.body ||
          $("chapterSynopsis").value !== draft.synopsis || $("chapterStatus").value !== draft.writing_status ||
          JSON.stringify(Array.from($("chapterCharacters")?.selectedOptions || []).map(option => option.value).filter(Boolean)) !== draft.character_ids_json)) {
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
        synopsis: "",
        writing_status: "planned",
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
    $("chapterSynopsis").value = draft.synopsis || "";
    $("chapterStatus").value = draft.writing_status || "draft";
    const selectedCharacterIds = new Set(Array.isArray(draft.character_ids_json) ? draft.character_ids_json : chapterCharacterIds({ character_ids_json: draft.character_ids_json }));
    Array.from($("chapterCharacters")?.options || []).forEach(option => { option.selected = selectedCharacterIds.has(option.value); });
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
  if (!cloud.ready || !cloud.activeChapterId) return;
  if (!confirm("ต้องการลบบทนี้ออกจากโครงการหรือไม่? ฉบับกู้คืนในอุปกรณ์จะยังอยู่ แต่การลบ Cloud ไม่สามารถย้อนกลับได้")) return;
  if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
  const deletedId = cloud.activeChapterId;
  try {
    await cloudApi("/api/chapters/" + encodeURIComponent(deletedId), { method: "DELETE" });
    cloud.chapters = cloud.chapters.filter(item => item.id !== deletedId);
    cloud.activeChapterId = "";
    renderChapterCharacterReferences();
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
  cloud.ready = false;
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
      keys.forEach(key => {
        const value = localStorage.getItem(storageKeyFor(key));
        if (value !== null && $(key)) $(key).value = value;
      });
      renderProjects();
      renderModuleLists();
      renderChapterSelect();
      renderDashboard();
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
        renderProjects();
        renderModuleLists();
        renderChapterSelect();
        renderDashboard();
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
    keys.forEach(key => {
      const value = localStorage.getItem(storageKeyFor(key));
      if (value !== null && $(key)) $(key).value = value;
    });
    state.textContent = "ตรวจสอบสถานะบัญชีไม่ได้ · " + error.message;
    login.hidden = false;
    logout.hidden = true;
    renderProjects();
    renderModuleLists();
    renderChapterSelect();
    renderDashboard();
  }
}

function setupCloudEvents() {
  $("importLocalData")?.addEventListener("click", importLocalNovelData);
  $("newChapter")?.addEventListener("click", createCloudChapter);
  $("moveChapterUp")?.addEventListener("click", () => moveActiveChapter("up"));
  $("moveChapterDown")?.addEventListener("click", () => moveActiveChapter("down"));
  $("deleteChapter")?.addEventListener("click", deleteActiveChapter);
  $("chapterSelect")?.addEventListener("change", event => selectCloudChapter(event.target.value));
  $("chapterCharacters")?.addEventListener("change", scheduleCloudSave);
  $("chapterSynopsis")?.addEventListener("input", () => {
    if (cloud.activeChapterId) storeLocalChapterDraft(cloud.activeChapterId, activeChapterDraft(), cloud.revision);
    scheduleCloudSave();
  });
  $("chapterStatus")?.addEventListener("change", () => {
    if (cloud.activeChapterId) storeLocalChapterDraft(cloud.activeChapterId, activeChapterDraft(), cloud.revision);
    scheduleCloudSave();
  });
  $("runContinuityCheck")?.addEventListener("click", runStoryContinuityCheck);
  $("chapterHistoryButton")?.addEventListener("click", showChapterHistory);
  $("chapterHistoryInline")?.addEventListener("click", showChapterHistory);
  $("replaceAll")?.addEventListener("click", () => {
    const search = $("findText").value;
    if (!search) return alert("กรุณาระบุคำที่ต้องการค้นหา");
    const body = getManuscriptText();
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

let docxImageAssets = [];
function wordImageRun(node) {
  const src = node.getAttribute("src") || "";
  const match = src.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return "";
  const bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0));
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  const index = docxImageAssets.length + 1;
  const relationshipId = "rId" + (index + 1);
  const fileName = "image" + index + "." + extension;
  docxImageAssets.push({ fileName, extension, bytes, relationshipId });
  const width = Math.max(1, Number(node.getAttribute("width")) || 1200);
  const height = Math.max(1, Number(node.getAttribute("height")) || 800);
  const cx = Math.min(5486400, Math.round(7120000 * width / height));
  const cy = Math.min(7120000, Math.round(cx * height / width));
  const label = xmlEscape(node.getAttribute("alt") || "StoryForge illustration");
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + index + '" name="' + fileName + '" descr="' + label + '"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="' + index + '" name="' + fileName + '"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="' + relationshipId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

function wordRunsFromNode(node, inherited = {}) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (!node.nodeValue) return "";
    const props = [];
    if (inherited.bold) props.push("<w:b/>");
    if (inherited.italic) props.push("<w:i/>");
    if (inherited.underline) props.push('<w:u w:val="single"/>');
    const rPr = props.length ? `<w:rPr>${props.join("")}</w:rPr>` : "";
    return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(node.nodeValue)}</w:t></w:r>`;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  if (node.tagName === "BR") return "<w:r><w:br/></w:r>";
  if (node.tagName === "IMG") return wordImageRun(node);
  const next = { ...inherited };
  if (["B","STRONG"].includes(node.tagName)) next.bold = true;
  if (["I","EM"].includes(node.tagName)) next.italic = true;
  if (node.tagName === "U") next.underline = true;
  return [...node.childNodes].map(child => wordRunsFromNode(child, next)).join("");
}

function manuscriptHtmlToWord(htmlOverride) {
  const editor = $("manuscriptEditor");
  const rawHtml = htmlOverride === undefined ? (editor?.innerHTML || "") : String(htmlOverride || "");
  if (!rawHtml || typeof DOMParser === "undefined") {
    const fallback = htmlOverride === undefined ? getManuscriptText() : String(htmlOverride || "").replace(/<[^>]*>/g, " ");
    return fallback.split(/\r?\n/).map(line => wordParagraph(line)).join("");
  }
  const source = sanitizeManuscriptHtml(rawHtml);
  const doc = new DOMParser().parseFromString(source, "text/html");
  const blocks = [...doc.body.childNodes];
  if (!blocks.length) return getManuscriptText().split(/\r?\n/).map(line => wordParagraph(line)).join("");
  return blocks.map(node => {
    if (node.nodeType === Node.TEXT_NODE) return wordParagraph(node.nodeValue || "");
    const tag = node.tagName;
    const style = tag === "H1" ? "Heading1" : tag === "H2" ? "Heading2" : tag === "H3" ? "Heading3" : "";
    const prefixRun = tag === "LI" ? "<w:r><w:t>• </w:t></w:r>" : "";
    const runs = prefixRun + [...node.childNodes].map(child => wordRunsFromNode(child)).join("");
    const blockStyle = node.getAttribute("style") || "";
    const alignment = /text-align\s*:\s*center/i.test(blockStyle) ? '<w:jc w:val="center"/>' :
      /text-align\s*:\s*right/i.test(blockStyle) ? '<w:jc w:val="right"/>' :
      /text-align\s*:\s*justify/i.test(blockStyle) ? '<w:jc w:val="both"/>' : "";
    const pPr = [style ? `<w:pStyle w:val="${style}"/>` : "", tag === "BLOCKQUOTE" ? '<w:ind w:left="720"/>' : "", alignment].filter(Boolean).join("");
    return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${runs || "<w:r><w:t/></w:r>"}</w:p>`;
  }).join("");
}

function exportManuscriptDocx(chapters = null, projectTitle = null) {
  docxImageAssets = [];
  const isWholeBook = Array.isArray(chapters);
  const title = projectTitle || $("title").value || "StoryForge Manuscript";
  const chapter = isWholeBook ? "ฉบับเต็ม" : ($("chapterTitle").value || "ต้นฉบับ");
  const penName = $("penName")?.value.trim() || "";
  const copyrightText = $("copyrightText")?.value.trim() || "";
  const foreword = $("foreword")?.value || "";
  const authorBio = $("authorBio")?.value || "";
  const publicationFrontMatter = [
    penName ? wordParagraph("นามปากกา: " + penName) : "",
    copyrightText ? wordParagraph(copyrightText) : "",
    foreword ? wordParagraph("คำนำ", "Heading1") + manuscriptHtmlToWord(foreword) : ""
  ].join("");
  const publicationBackMatter = authorBio
    ? wordParagraph("เกี่ยวกับผู้เขียน", "Heading1") + manuscriptHtmlToWord(authorBio)
    : "";
  const tocParagraphs = isWholeBook
    ? wordParagraph("สารบัญ", "Heading1") + chapters.map((item, index) =>
        wordParagraph("บทที่ " + (index + 1) + " — " + (item.title || "บทไม่มีชื่อ"))
      ).join("")
    : "";
  const paragraphs = isWholeBook
    ? chapters.map((item, index) =>
        wordParagraph("บทที่ " + (index + 1) + " — " + (item.title || "บทไม่มีชื่อ"), "Heading1")
          .replace("<w:pPr>", "<w:pPr><w:pageBreakBefore/>") +
        manuscriptHtmlToWord(item.body || "")
      ).join("")
    : manuscriptHtmlToWord();
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${wordParagraph(title, "Title")}${publicationFrontMatter}${isWholeBook ? tocParagraphs : wordParagraph(chapter, "Heading1")}${paragraphs}${publicationBackMatter}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Default Extension="webp" ContentType="image/webp"/>
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
${docxImageAssets.map(asset => '<Relationship Id="' + asset.relationshipId + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + asset.fileName + '"/>').join("")}
</Relationships>` },
    { name: "word/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="TH Sarabun New" w:cs="TH Sarabun New"/><w:sz w:val="28"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
</w:styles>` },
    { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xmlEscape(title)} - ${xmlEscape(chapter)}</dc:title><dc:creator>${xmlEscape(penName || "StoryForge")}</dc:creator><dc:rights>${xmlEscape(copyrightText)}</dc:rights><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
</cp:coreProperties>` },
    { name: "docProps/app.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>StoryForge</Application></Properties>` }
  ];
  docxImageAssets.forEach(asset => files.push({ name: "word/media/" + asset.fileName, data: asset.bytes }));
  downloadBlob(exportBaseName() + ".docx", createStoredZip(files));
}

function exportManuscriptEpub(chapters = null, projectTitle = null) {
  if (Array.isArray(chapters)) {
    exportWholeNovelEpub(chapters, projectTitle);
    return;
  }
  const title = $("title").value || "StoryForge Manuscript";
  const chapter = $("chapterTitle").value || "ต้นฉบับ";
  const identifier = "urn:uuid:" + crypto.randomUUID();
  const editor = $("manuscriptEditor");
  const richBody = editor && editor.innerHTML && typeof DOMParser !== "undefined"
    ? sanitizeManuscriptHtml(editor.innerHTML) : "";
  const epubImages = [];
  let paragraphs = richBody;
  if (richBody) {
    const epubDoc = new DOMParser().parseFromString(richBody, "text/html");
    epubDoc.querySelectorAll("img").forEach((img, index) => {
      const match = (img.getAttribute("src") || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return;
      const extension = match[1] === "jpeg" ? "jpg" : match[1];
      const fileName = "illustration-" + (index + 1) + "." + extension;
      epubImages.push({ fileName, extension, bytes: Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)) });
      img.setAttribute("src", "images/" + fileName);
      img.removeAttribute("loading");
    });
    paragraphs = epubDoc.body.innerHTML;
  }
  paragraphs = paragraphs || getManuscriptText().split(/\r?\n/).map(line =>
    line ? `<p>${xmlEscape(line)}</p>` : '<p class="blank">&#160;</p>'
  ).join("");
  const files = [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { name: "OEBPS/content.opf", data: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="th">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${identifier}</dc:identifier><dc:title>${xmlEscape(title)} - ${xmlEscape(chapter)}</dc:title><dc:language>th</dc:language><dc:creator>StoryForge</dc:creator><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/>${epubImages.map((item,index) => '<item id="illustration' + (index + 1) + '" href="images/' + item.fileName + '" media-type="image/' + (item.extension === "jpg" ? "jpeg" : item.extension) + '"/>').join("")}</manifest>
<spine><itemref idref="chapter"/></spine></package>` },
    { name: "OEBPS/nav.xhtml", data: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="th"><head><title>สารบัญ</title></head><body><nav epub:type="toc" id="toc"><h1>สารบัญ</h1><ol><li><a href="chapter.xhtml">${xmlEscape(chapter)}</a></li></ol></nav></body></html>` },
    { name: "OEBPS/chapter.xhtml", data: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="th"><head><title>${xmlEscape(chapter)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>${xmlEscape(title)}</h1><h2>${xmlEscape(chapter)}</h2>${paragraphs}</body></html>` },
    { name: "OEBPS/style.css", data: "body{font-family:serif;line-height:1.65;margin:5%;}h1,h2{line-height:1.3;}p{margin:0 0 0.8em;text-indent:1.2em}.blank{height:0.8em}figure{margin:1.5em auto;text-align:center;break-inside:avoid}img{max-width:100%;height:auto}figcaption{font-style:italic;text-align:center}" }
  ];
  epubImages.forEach(item => files.push({ name: "OEBPS/images/" + item.fileName, data: item.bytes }));
  downloadBlob(exportBaseName() + ".epub", createStoredZip(files));
}

function exportWholeNovelEpub(chapters, projectTitle) {
  const title = projectTitle || $("title").value || "StoryForge Manuscript";
  const penName = $("penName")?.value.trim() || "StoryForge";
  const copyrightText = $("copyrightText")?.value.trim() || "";
  const authorBio = $("authorBio")?.value || "";
  const foreword = $("foreword")?.value || "";
  const synopsis = $("context")?.value || "";
  const identifier = "urn:uuid:" + crypto.randomUUID();
  const textToXhtml = value => String(value || "").split(/\n{2,}/).map(part =>
    "<p>" + xmlEscape(part).replace(/\n/g, "<br/>") + "</p>"
  ).join("");
  const images = [];
  const chapterFiles = chapters.map((chapter, index) => {
    const raw = sanitizeManuscriptHtml(chapter.body || "");
    const doc = new DOMParser().parseFromString(raw, "text/html");
    doc.querySelectorAll("img").forEach((img, imageIndex) => {
      const match = (img.getAttribute("src") || "").match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return;
      const extension = match[1] === "jpeg" ? "jpg" : match[1];
      const fileName = "illustration-" + (index + 1) + "-" + (imageIndex + 1) + "." + extension;
      images.push({ fileName, extension, bytes: Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)) });
      img.setAttribute("src", "images/" + fileName);
      img.removeAttribute("loading");
    });
    const body = (doc.body.innerHTML || "<p> </p>")
      .replace(/<br\s*>/gi, "<br/>")
      .replace(/<img([^>]*?)>/gi, "<img$1 />");
    return {
      fileName: "chapter-" + (index + 1) + ".xhtml",
      title: "บทที่ " + (index + 1) + " — " + (chapter.title || "บทไม่มีชื่อ"),
      body
    };
  });
  const manifestChapters = chapterFiles.map((item, index) =>
    '<item id="chapter' + (index + 1) + '" href="' + item.fileName + '" media-type="application/xhtml+xml"/>'
  ).join("");
  const frontMatter = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="th"><head><title>' + xmlEscape(title) + '</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><section epub:type="titlepage"><h1>' + xmlEscape(title) + '</h1><p>' + xmlEscape(penName) + '</p><p>' + xmlEscape(copyrightText) + '</p></section>' + (foreword ? '<section epub:type="foreword"><h2>คำนำ</h2>' + textToXhtml(foreword) + '</section>' : '') + '</body></html>';
  const backMatter = authorBio
    ? '<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="th"><head><title>เกี่ยวกับผู้เขียน</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>เกี่ยวกับผู้เขียน</h1>' + textToXhtml(authorBio) + '</body></html>'
    : "";
  const manifestImages = images.map((item, index) =>
    '<item id="illustration' + (index + 1) + '" href="images/' + item.fileName + '" media-type="image/' + (item.extension === "jpg" ? "jpeg" : item.extension) + '"/>'
  ).join("");
  const manifestFrontMatter = '<item id="frontmatter" href="frontmatter.xhtml" media-type="application/xhtml+xml"/>';
  const manifestBackMatter = backMatter ? '<item id="backmatter" href="backmatter.xhtml" media-type="application/xhtml+xml"/>' : "";
  const spine = '<itemref idref="frontmatter"/>' + chapterFiles.map((item, index) => '<itemref idref="chapter' + (index + 1) + '"/>').join("") + (backMatter ? '<itemref idref="backmatter"/>' : "");
  const nav = '<li><a href="frontmatter.xhtml">หน้าปกในและคำนำ</a></li>' + chapterFiles.map(item => '<li><a href="' + item.fileName + '">' + xmlEscape(item.title) + '</a></li>').join("") + (backMatter ? '<li><a href="backmatter.xhtml">เกี่ยวกับผู้เขียน</a></li>' : "");
  const files = [
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: "OEBPS/content.opf", data: '<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="th"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">' + identifier + '</dc:identifier><dc:title>' + xmlEscape(title) + '</dc:title><dc:language>th</dc:language><dc:creator>' + xmlEscape(penName) + '</dc:creator><dc:rights>' + xmlEscape(copyrightText) + '</dc:rights><dc:description>' + xmlEscape([synopsis, authorBio].filter(Boolean).join("\n\n")) + '</dc:description><meta property="dcterms:modified">' + new Date().toISOString().replace(/\.\d{3}Z$/, "Z") + '</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>' + manifestFrontMatter + manifestChapters + manifestBackMatter + manifestImages + '</manifest><spine>' + spine + '</spine></package>' },
    { name: "OEBPS/frontmatter.xhtml", data: '<?xml version="1.0" encoding="UTF-8"?>' + frontMatter },
    ...(backMatter ? [{ name: "OEBPS/backmatter.xhtml", data: '<?xml version="1.0" encoding="UTF-8"?>' + backMatter }] : []),
    { name: "OEBPS/nav.xhtml", data: '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="th"><head><title>สารบัญ</title></head><body><nav epub:type="toc" id="toc"><h1>' + xmlEscape(title) + '</h1><ol>' + nav + '</ol></nav></body></html>' },
    { name: "OEBPS/style.css", data: "body{font-family:serif;line-height:1.65;margin:5%;}h1,h2{line-height:1.3;}p{margin:0 0 0.8em;text-indent:1.2em}.blank{height:0.8em}figure{margin:1.5em auto;text-align:center;break-inside:avoid}img{max-width:100%;height:auto}figcaption{font-style:italic;text-align:center}" }
  ];
  chapterFiles.forEach((item, index) => files.push({
    name: "OEBPS/" + item.fileName,
    data: '<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xml:lang="th"><head><title>' + xmlEscape(item.title) + '</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><h1>' + xmlEscape(title) + '</h1><h2>' + xmlEscape(item.title) + '</h2>' + item.body + '</body></html>'
  }));
  images.forEach(item => files.push({ name: "OEBPS/images/" + item.fileName, data: item.bytes }));
  downloadBlob(exportBaseName() + "-ทั้งเล่ม.epub", createStoredZip(files));
}

async function exportEntireNovelEpub() {
  const projectId = cloud.activeProjectId;
  if (!cloud.authenticated || !cloud.ready || !projectId) {
    alert("การส่งออก EPUB ทั้งเล่มต้องเลือกนิยายที่เชื่อมต่อ Cloud และเข้าสู่ระบบก่อนครับ");
    return;
  }
  const button = $("exportBookEpub");
  if (button) { button.disabled = true; button.textContent = "กำลังรวบรวมบท..."; }
  try {
    if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
    if (cloud.activeChapterId && !(await saveCloudChapter())) {
      throw new Error("บันทึกบทปัจจุบันไม่สำเร็จ จึงหยุดส่งออกเพื่อป้องกันข้อมูลล่าสุดตกหล่น");
    }
    const project = cloud.projects.find(item => item.id === projectId);
    if (!project) throw new Error("ไม่พบโครงการที่เลือก");
    const list = await cloudApi("/api/projects/" + encodeURIComponent(projectId) + "/chapters");
    const rows = list.chapters || [];
    if (!rows.length) throw new Error("นิยายนี้ยังไม่มีบทให้ส่งออก");
    const chapters = await Promise.all(rows.map(async item => {
      const result = await cloudApi("/api/chapters/" + encodeURIComponent(item.id));
      if (!result.chapter || result.chapter.project_id !== projectId) throw new Error("พบข้อมูลบทข้ามนิยาย ระบบยกเลิกการส่งออก");
      return result.chapter;
    }));
    chapters.sort((left, right) => (left.sort_order - right.sort_order) ||
      String(left.created_at || "").localeCompare(String(right.created_at || "")));
    const totalSize = chapters.reduce((sum, item) => sum + String(item.body || "").length, 0);
    if (totalSize > 12 * 1024 * 1024) throw new Error("ต้นฉบับทั้งเล่มมีขนาดเกิน 12 MB กรุณาแบ่งส่งออกเป็นส่วน");
    exportManuscriptEpub(chapters, project.title || "ต้นฉบับนิยาย");
    const status = $("chapterSaveHint");
    if (status) status.textContent = "ส่งออก EPUB ทั้งเล่มแล้ว · " + chapters.length + " บท";
  } catch (error) {
    alert("ส่งออก EPUB ทั้งเล่มไม่สำเร็จ: " + error.message);
  } finally {
    if (button) { button.disabled = false; button.textContent = "EPUB ทั้งเล่ม"; }
  }
}

function exportManuscriptPdf() {
  const printNode = $("printManuscriptText");
  const title = $("title").value || "ต้นฉบับนิยาย";
  const chapter = $("chapterTitle").value || "ต้นฉบับ";
  const editor = $("manuscriptEditor");
  const bodyHtml = editor && editor.innerHTML && typeof DOMParser !== "undefined"
    ? sanitizeManuscriptHtml(editor.innerHTML)
    : getManuscriptText().split(/\r?\n/).map(line => `<p>${escapeHtml(line)}</p>`).join("");
  printNode.innerHTML =
    `<h1 class="print-book-title">${escapeHtml(title)}</h1>` +
    `<h2 class="print-chapter-title">${escapeHtml(chapter)}</h2>` +
    `<div class="print-book-body">${bodyHtml}</div>`;
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

function setWritingFocusMode(enabled) {
  const active = Boolean(enabled);
  document.body.classList.toggle("writing-focus-mode", active);
  const button = $("toggleWritingFocus");
  if (button) {
    button.setAttribute("aria-pressed", String(active));
    button.textContent = active ? "× ออกจากโหมดเขียน" : "⛶ โหมดเขียนเต็มจอ";
    button.title = active ? "กลับสู่หน้าทำงานปกติ" : "ซ่อนเมนูรอบข้างเพื่อเขียนอย่างต่อเนื่อง";
  }
  if (active) $("manuscriptEditor")?.focus();
}

function getManuscriptText() {
  const editor = $("manuscriptEditor");
  return editor ? (editor.innerText || "").replace(/\u00a0/g, " ").trimEnd() : String($("manuscriptBody")?.value || "");
}

function sanitizeManuscriptHtml(value) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(String(value || ""), "text/html");
  const allowed = new Set(["P","DIV","BR","STRONG","B","EM","I","U","H1","H2","H3","BLOCKQUOTE","UL","OL","LI","SPAN","FIGURE","FIGCAPTION","IMG"]);
  doc.body.querySelectorAll("*").forEach(node => {
    if (!allowed.has(node.tagName)) {
      node.replaceWith(doc.createTextNode(node.textContent || ""));
      return;
    }
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") || "";
      const alt = (node.getAttribute("alt") || "").slice(0, 300);
      const imageWidth = Number(node.getAttribute("width"));
      const imageHeight = Number(node.getAttribute("height"));
      const displayWidth = node.style.width;
      const safeImage = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src) && src.length <= 260000;
      [...node.attributes].forEach(attr => node.removeAttribute(attr.name));
      if (!safeImage) { node.replaceWith(doc.createTextNode(alt)); return; }
      node.setAttribute("src", src);
      node.setAttribute("alt", alt);
      [...node.attributes].filter(attr => attr.name !== "src" && attr.name !== "alt").forEach(attr => node.removeAttribute(attr.name));
      if (Number.isInteger(imageWidth) && imageWidth > 0 && imageWidth <= 10000) node.setAttribute("width", String(imageWidth));
      if (Number.isInteger(imageHeight) && imageHeight > 0 && imageHeight <= 10000) node.setAttribute("height", String(imageHeight));
      node.setAttribute("loading", "lazy");
      node.style.maxWidth = "100%";
      node.style.height = "auto";
      node.style.display = "block";
      if (/^(100|80|60|40)%$/.test(displayWidth)) node.style.width = displayWidth;
      return;
    }
    [...node.attributes].forEach(attr => {
      if (attr.name !== "style") node.removeAttribute(attr.name);
    });
    if (node.hasAttribute("style")) {
      const safe = [];
      const style = node.getAttribute("style");
      for (const declaration of style.split(";")) {
        const [name, ...rest] = declaration.split(":");
        const key = (name || "").trim().toLowerCase();
        const val = rest.join(":").trim();
        if (["text-align","font-family","font-size","line-height","width","max-width","height","display","margin"].includes(key) &&
            /^[\w\s,'"().-]+$/.test(val)) safe.push(key + ":" + val);
      }
      if (safe.length) node.setAttribute("style", safe.join(";"));
      else node.removeAttribute("style");
    }
  });
  return doc.body.innerHTML;
}

function setupManuscriptEditor() {
  const field = $("manuscriptBody");
  const editor = $("manuscriptEditor");
  if (!field || !editor) return;
  $("toggleWritingFocus")?.addEventListener("click", () =>
    setWritingFocusMode(!document.body.classList.contains("writing-focus-mode"))
  );
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && document.body.classList.contains("writing-focus-mode")) {
      setWritingFocusMode(false);
      return;
    }
    if (event.isComposing || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      save("manuscriptBody");
      if (cloud.activeChapterId) {
        if (cloud.saveTimer) { clearTimeout(cloud.saveTimer); cloud.saveTimer = null; }
        saveCloudChapter();
      }
    } else if (event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setWritingFocusMode(!document.body.classList.contains("writing-focus-mode"));
    }
  });
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  Object.defineProperty(field, "value", {
    configurable: true,
    get() { return descriptor.get.call(field); },
    set(value) {
      descriptor.set.call(field, value ?? "");
      const stored = String(value || "");
      const looksLikeMarkup = /<(p|div|br|strong|b|em|i|u|h[1-3]|blockquote|ul|ol|li|span|figure|figcaption|img)\b/i.test(stored);
      if (looksLikeMarkup) editor.innerHTML = sanitizeManuscriptHtml(stored);
      else editor.innerHTML = stored
        ? stored.split(/\r?\n/).map(line => "<p>" + escapeHtml(line) + "</p>").join("")
        : "";
    }
  });
  editor.addEventListener("input", event => {
    descriptor.set.call(field, editor.innerHTML);
    save("manuscriptBody", Boolean(event.isComposing));
  });
  editor.addEventListener("compositionend", () => {
    descriptor.set.call(field, editor.innerHTML);
    save("manuscriptBody");
  });
  document.querySelectorAll("[data-editor-command]").forEach(button => {
    button.addEventListener("mousedown", event => event.preventDefault());
    button.addEventListener("click", () => {
      editor.focus();
      const command = button.dataset.editorCommand;
      const commandValue = button.dataset.editorValue || null;
      document.execCommand(command, false, commandValue);
      descriptor.set.call(field, sanitizeManuscriptHtml(editor.innerHTML));
      save("manuscriptBody");
    });
  });
  const editorPrefs = safeJSON(localStorage.getItem("sf_editor_preferences") || "{}", {});
  const applyEditorPrefs = () => {
    if (editorPrefs.font) { editor.style.fontFamily = editorPrefs.font; $("editorFont").value = editorPrefs.font; }
    if (editorPrefs.size) { editor.style.fontSize = editorPrefs.size; $("editorSize").value = editorPrefs.size; }
    if (editorPrefs.lineHeight) { editor.style.lineHeight = editorPrefs.lineHeight; $("editorLineHeight").value = editorPrefs.lineHeight; }
    if (editorPrefs.margin) { editor.style.padding = editorPrefs.margin; $("editorPageMargin").value = editorPrefs.margin; }
  };
  const persistEditorPrefs = () => localStorage.setItem("sf_editor_preferences", JSON.stringify(editorPrefs));
  $("editorFont")?.addEventListener("change", event => {
    editorPrefs.font = event.target.value; editor.style.fontFamily = event.target.value;
    persistEditorPrefs(); editor.focus();
  });
  $("editorSize")?.addEventListener("change", event => {
    editorPrefs.size = event.target.value; editor.style.fontSize = event.target.value;
    persistEditorPrefs(); editor.focus();
  });
  $("editorLineHeight")?.addEventListener("change", event => {
    editorPrefs.lineHeight = event.target.value; editor.style.lineHeight = event.target.value;
    persistEditorPrefs();
  });
  $("editorPageMargin")?.addEventListener("change", event => {
    editorPrefs.margin = event.target.value; editor.style.padding = event.target.value;
    persistEditorPrefs();
  });
  applyEditorPrefs();
  $("autoFormatManuscript")?.addEventListener("click", () => {
    const paragraphs = getManuscriptText().split(/\n+/).map(line => line.trim()).filter(Boolean);
    editor.innerHTML = paragraphs.map(line => "<p>" + escapeHtml(line) + "</p>").join("");
    descriptor.set.call(field, editor.innerHTML);
    save("manuscriptBody");
    $("saveState").textContent = "จัดย่อหน้าเรียบร้อยแล้ว · ต้นฉบับเดิมยังคงอยู่";
  });
  $("aiFormatManuscript")?.addEventListener("click", () => {
    alert("ปุ่ม AI ช่วยจัดหน้าถูกเตรียมไว้แล้ว แต่ระบบ AI ยังไม่เปิดใช้งานใน Private Beta รุ่นนี้ จึงยังไม่ส่งเนื้อหาออกไปประมวลผล และจะไม่แก้ไขต้นฉบับของคุณครับ");
  });
}

function init() {

  setupManuscriptEditor();

  addBackupPanel();

  load();

  setupCustomGenre();
  setupWritingSettings();
  setProjectGenre(localStorage.getItem("sf_genre") || $("genre")?.value || "");
  setupEvents();

  setupBackupEvents();

  setupAuthEvents();
  if ($("wordGoal") && !$("wordGoal").value) $("wordGoal").value = "2000";
  updateWordGoal();
  setupCloudEvents();
  setupModuleEvents();
  setupCharacterVault();
  setupCoverStudio();
  setupIllustrationStudio();
  refreshAuthStatus();

  console.log("STORYFORGE initialized successfully");
}

init();
