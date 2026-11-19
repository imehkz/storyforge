const $ = id => document.getElementById(id);

let mode = "writer";
let backupBusy = false;
let nextAutoBackupAt = null;

const keys = [
  "title",
  "genre",
  "context",
  "chapterTitle",
  "manuscript",
  "projectMemory",
  "globalMemory"
];

function addBackupPanel() {
  const content = document.querySelector(".content");

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
        <input id="autoBackup" type="checkbox" style="width:auto">
        เปิดใช้งาน Backup อัตโนมัติ
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

addBackupPanel();

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

function download(name, text) {
  const blob = new Blob([text], {
    type: "application/json;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = name;
  a.click();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCurrentBackup() {
  const date = new Date().toISOString().replace(/[:.]/g, "-");

  download(
    `STORYFORGE-backup-${date}.json`,
    makeBackupFile()
  );
}

async function sendTelegramBackup(isAutomatic = false) {
  if (backupBusy) return;

  const secret = $("backupSecret").value.trim();

  if (!secret) {
    if (!isAutomatic) {
      alert("กรุณากรอก Backup Secret ก่อนครับ");
    }

    $("backupStatus").textContent =
      "ยังไม่ได้กรอกรหัส Backup Secret";

    return false;
  }

  backupBusy = true;

  $("backupStatus").textContent =
    isAutomatic
      ? "กำลังสำรองข้อมูลอัตโนมัติ..."
      : "กำลังส่งไฟล์สำรองไป Telegram...";

  $("telegramBackup").disabled = true;

  try {
    const content = makeBackupFile();

    const response = await fetch("/api/telegram-backup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-backup-secret": secret
      },
      body: JSON.stringify({
        filename: "STORYFORGE-backup.json",
        content
      })
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "สำรองข้อมูลไม่สำเร็จ");
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

function setupAutoBackup() {
  $("autoBackup").addEventListener("change", () => {
    if ($("autoBackup").checked) {
      if (!$("backupSecret").value.trim()) {
        $("autoBackup").checked = false;

        alert("กรุณากรอก Backup Secret ก่อนเปิดระบบอัตโนมัติ");
        return;
      }

      const hours = Number($("backupInterval").value);

      nextAutoBackupAt = Date.now() + hours * 60 * 60 * 1000;

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

      nextAutoBackupAt = Date.now() + hours * 60 * 60 * 1000;

      $("backupStatus").textContent =
        `ปรับเวลา Backup เป็นทุก ${hours} ชั่วโมงแล้ว`;
    }
  });

  setInterval(async () => {
    if (
      !$("autoBackup").checked ||
      !nextAutoBackupAt ||
      Date.now() < nextAutoBackupAt
    ) {
      return;
    }

    const hours = Number($("backupInterval").value);

    nextAutoBackupAt = Date.now() + hours * 60 * 60 * 1000;

    await sendTelegramBackup(true);

  }, 60 * 1000);
}

function restoreFromFile() {
  const file = $("restoreFile").files[0];

  if (!file) {
    alert("กรุณาเลือกไฟล์ Backup ก่อนครับ");
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
        throw new Error("ไฟล์นี้ไม่ใช่ Backup ของ STORYFORGE");
      }

      const entries = Object.entries(backup.data);

      if (
        entries.length === 0 ||
        entries.some(([key, value]) =>
          !key.startsWith("sf_") ||
          typeof value !== "string"
        )
      ) {
        throw new Error("ข้อมูลในไฟล์ Backup ไม่ถูกต้อง");
      }

      if (
        !confirm(
          "ระบบจะดาวน์โหลดข้อมูลปัจจุบันเก็บไว้ก่อน " +
          "จากนั้นจะแทนที่ข้อมูล STORYFORGE ปัจจุบันด้วยข้อมูลในไฟล์นี้\n\n" +
          "ต้องการดำเนินการต่อหรือไม่?"
        )
      ) {
        return;
      }

      downloadCurrentBackup();

      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("sf_")) {
          localStorage.removeItem(key);
        }
      }

      for (const [key, value] of entries) {
        localStorage.setItem(key, value);
      }

      alert("กู้คืนข้อมูลสำเร็จแล้วครับ เว็บไซต์จะโหลดใหม่");

      location.reload();

    } catch (error) {
      alert("ไม่สามารถกู้คืนข้อมูลได้: " + error.message);
    }
  };

  reader.onerror = () => {
    alert("อ่านไฟล์ Backup ไม่สำเร็จ");
  };

  reader.readAsText(file);
}

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

function load() {
  keys.forEach(key => {
    const value = localStorage.getItem("sf_" + key);

    if (value !== null && $(key)) {
      $(key).value = value;
    }
  });

  renderProjects();
}

function save() {
  keys.forEach(key => {
    localStorage.setItem("sf_" + key, $(key).value);
  });

  $("saveState").textContent =
    "บันทึกล่าสุดในอุปกรณ์นี้";
}

keys.forEach(key => {
  $(key).addEventListener("input", save);
});

document.querySelectorAll(".nav").forEach(button => {
  button.onclick = () => {
    document.querySelectorAll(".nav").forEach(item =>
      item.classList.remove("active")
    );

    button.classList.add("active");

    document.querySelectorAll(".panel").forEach(panel =>
      panel.classList.add("hidden")
    );

    $(button.dataset.tab).classList.remove("hidden");

    if (button.dataset.tab === "projects") {
      renderProjects();
    }
  };
});

document.querySelectorAll(".mode").forEach(button => {
  button.onclick = () => {
    document.querySelectorAll(".mode").forEach(item =>
      item.classList.remove("active")
    );

    button.classList.add("active");
    mode = button.dataset.mode;
  };
});

$("saveProject").onclick = () => {
  save();

  let projects = safeJSON(
    localStorage.getItem("sf_projects") || "[]",
    []
  );

  const item = {
    title: $("title").value || "โครงการไม่มีชื่อ",
    genre: $("genre").value,
    context: $("context").value
  };

  projects = projects.filter(x => x.title !== item.title);
  projects.unshift(item);

  localStorage.setItem(
    "sf_projects",
    JSON.stringify(projects)
  );

  renderProjects();

  alert("บันทึกโครงการแล้ว");
};

$("saveMemory").onclick = () => {
  save();
  alert("บันทึกความจำแล้ว");
};

function renderProjects() {
  const projects = safeJSON(
    localStorage.getItem("sf_projects") || "[]",
    []
  );

  $("projectList").innerHTML = projects.length
    ? projects.map(item =>
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

$("run").onclick = async () => {
  const prompt = $("prompt").value;

  if (!prompt.trim()) {
    alert("กรุณาพิมพ์คำสั่ง");
    return;
  }

  $("run").disabled = true;
  $("run").textContent = "กำลังทำงาน...";
  $("output").textContent = "กำลังเชื่อมต่อ AI...";

  try {
    const context = [
      `ชื่อโครงการ: ${$("title").value}`,
      `แนว: ${$("genre").value}`,
      $("context").value,
      $("projectMemory").value,
      $("globalMemory").value
    ].join("\n\n");

    const response = await fetch("/api/agent", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        prompt,
        mode,
        context
      })
    });

    const result = await response.json();

    $("output").textContent =
      result.text || result.error || "ไม่พบคำตอบ";

  } catch (error) {
    $("output").textContent =
      "เชื่อมต่อไม่สำเร็จ: " + error.message;

  } finally {
    $("run").disabled = false;
    $("run").textContent = "✦ เริ่มทำงานกับ AI";
  }
};

$("copy").onclick = () => {
  navigator.clipboard.writeText($("output").textContent)
    .then(() => alert("คัดลอกแล้ว"))
    .catch(() => alert("ไม่สามารถคัดลอกได้"));
};

$("download").onclick = () => {
  download(
    "storyforge-ai-output.txt",
    $("output").textContent
  );
};

$("export").onclick = () => {
  download(
    ($("chapterTitle").value || "manuscript") + ".txt",
    $("manuscript").value
  );
};

load();
