const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

// Trỏ thẳng vào thư mục data để lưu file vật lý
const dbFile = path.join(__dirname, "../data/projects.json");
const handoverFile = path.join(__dirname, "../data/handovers.json");

// AUTO-HEAL: Đảm bảo có Database
const initDB = () => {
    try {
        const dataDir = path.join(__dirname, "../data");
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, "[]", "utf8");
        if (!fs.existsSync(handoverFile)) fs.writeFileSync(handoverFile, "[]", "utf8");
    } catch(e) { console.error("Lỗi tạo file DB:", e); }
};
initDB();

function readDB(file) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch(e) { return []; }
}
function writeDB(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// 1. Lấy danh sách
router.get("/projects", (req, res) => {
  try {
    let data = readDB(dbFile);
    data.sort((a, b) => Number(b.id) - Number(a.id));
    res.json({ success: true, data: data });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 2. Lấy 1 dự án
router.get("/projects/:id", (req, res) => {
  try {
    const data = readDB(dbFile);
    const item = data.find(x => Number(x.id) === Number(req.params.id));
    if (!item) return res.status(404).json({ success: false, error: "Không tìm thấy" });
    res.json({ success: true, data: item });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 3. Tạo dự án mới (LƯU THẲNG Ổ CỨNG)
router.post("/projects", (req, res) => {
  try {
    let data = readDB(dbFile);
    const b = req.body;
    const newId = data.length > 0 ? Math.max(...data.map(d => Number(d.id) || 0)) + 1 : 1;
    
    const newProject = {
      id: newId,
      project_code: b.project_code || ("DA-" + Math.floor(1000 + Math.random() * 9000)),
      project_name: b.project_name || "Dự án mới",
      customer_name: b.customer_name || "Khách hàng",
      customer_phone: b.customer_phone || "",
      address: b.address || "",
      system_type: b.system_type || "Hybrid",
      capacity_kwp: parseFloat(b.capacity_kwp) || 0,
      battery_kwh: parseFloat(b.battery_kwh) || 0,
      inverter_brand: b.inverter_brand || "SUNGO",
      lead_engineer: b.lead_engineer || "Kỹ sư phụ trách",
      status: b.status || "IN_PROGRESS",
      progress: parseInt(b.progress) || 0,
      created_at: new Date().toISOString()
    };

    data.push(newProject);
    writeDB(dbFile, data);
    res.status(201).json({ success: true, data: newProject });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 4. Lấy nghiệm thu
router.get("/handover/:projectId", (req, res) => {
  try {
    const data = readDB(handoverFile);
    const items = data.filter(x => Number(x.project_id) === Number(req.params.projectId));
    res.json({ success: true, data: items.length > 0 ? items[items.length - 1] : null });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// 5. Lưu nghiệm thu & ảnh
router.post("/handover/:projectId", (req, res) => {
  try {
    const projectId = Number(req.params.projectId);
    const b = req.body;
    
    let handovers = readDB(handoverFile);
    handovers = handovers.filter(x => Number(x.project_id) !== projectId);

    const newHandover = {
      id: handovers.length > 0 ? Math.max(...handovers.map(d => Number(d.id) || 0)) + 1 : 1,
      project_id: projectId,
      customer_name: b.customer_name || "",
      customer_phone: b.customer_phone || "",
      address: b.address || "",
      installed_kwp: parseFloat(b.installed_kwp) || 0,
      app_name: b.app_name || "",
      app_account: b.app_account || "",
      app_password: b.app_password || "",
      app_status: b.app_status || "HOẠT ĐỘNG MƯỢT MÀ",
      img_panels: b.img_panels || "",
      img_cabinet: b.img_cabinet || "",
      img_inverter: b.img_inverter || "",
      img_battery: b.img_battery || "",
      img_wiring: b.img_wiring || "",
      img_app: b.img_app || "",
      notes: b.notes || "",
      created_at: new Date().toISOString()
    };

    handovers.push(newHandover);
    writeDB(handoverFile, handovers);

    if (b.progress !== undefined) {
        let projects = readDB(dbFile);
        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex !== -1) {
            projects[pIndex].progress = parseInt(b.progress) || 100;
            projects[pIndex].status = projects[pIndex].progress >= 100 ? "COMPLETED" : "IN_PROGRESS";
            writeDB(dbFile, projects);
        }
    }
    res.json({ success: true, data: newHandover });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
