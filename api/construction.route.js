const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const dataDir = path.join(__dirname, "../data");
const dbFile = path.join(dataDir, "bidding_projects.json");
const legacyDbFile = path.join(dataDir, "projects.json");
const handoverFile = path.join(dataDir, "bidding_handovers.json");
const legacyHandoverFile = path.join(dataDir, "handovers.json");

function readDB(file) {
    try {
        if (!fs.existsSync(file)) return [];
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch(e) { return []; }
}
function writeDB(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// 1. GET /api/construction/projects (Lấy toàn bộ hồ sơ dự án đồng bộ)
router.get("/projects", (req, res) => {
    try {
        let projects = readDB(dbFile);
        if (projects.length === 0) {
            projects = readDB(legacyDbFile);
        }
        const handovers = readDB(handoverFile);

        projects.sort((a, b) => Number(b.id) - Number(a.id));

        const enriched = projects.map(p => {
            const ho = handovers.find(h => Number(h.project_id) === Number(p.id));
            return {
                ...p,
                handover_data: ho || null
            };
        });

        res.json({ success: true, data: enriched });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. GET /api/construction/projects/:id
router.get("/projects/:id", (req, res) => {
    try {
        const id = Number(req.params.id);
        const projects = readDB(dbFile);
        const item = projects.find(x => Number(x.id) === id);
        if (!item) return res.status(404).json({ success: false, error: "Không tìm thấy hồ sơ dự án" });

        const handovers = readDB(handoverFile);
        const ho = handovers.find(h => Number(h.project_id) === id);

        res.json({ success: true, data: { ...item, handover_data: ho || null } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. POST /api/construction/projects (Tạo hồ sơ dự án mới)
router.post("/projects", (req, res) => {
    try {
        let projects = readDB(dbFile);
        const b = req.body;
        const newId = projects.length > 0 ? Math.max(...projects.map(d => Number(d.id) || 0)) + 1 : 1;

        const newProject = {
            id: newId,
            project_code: b.project_code || ("DA-2026-" + String(newId).padStart(3, "0")),
            project_name: b.project_name || "Dự án mới",
            customer_name: b.customer_name || "Khách hàng",
            customer_phone: b.customer_phone || "",
            customer_contact_person: b.customer_contact_person || "",
            province_city: b.province_city || "TP. Hồ Chí Minh",
            district: b.district || "",
            address: b.address || "",
            system_type: b.system_type || "Hybrid",
            capacity_kwp: parseFloat(b.capacity_kwp) || 0,
            battery_kwh: parseFloat(b.battery_kwh) || 0,
            inverter_brand: b.inverter_brand || "Deye",
            inverter_qty: parseInt(b.inverter_qty) || 1,
            panel_brand: b.panel_brand || "Canadian Solar",
            panel_qty: parseInt(b.panel_qty) || 0,
            roof_type: b.roof_type || "Mái tôn",
            labor_cost: parseFloat(b.labor_cost) || 0,
            assigned_contractor_id: b.assigned_contractor_id ? Number(b.assigned_contractor_id) : 1,
            assigned_contractor_name: b.assigned_contractor_name || "Đội Kỹ Thuật Solar Fast",
            assigned_supervisor_name: b.assigned_supervisor_name || "Đơn Vị Giám Sát EPC Pro",
            assigned_supplier_name: b.assigned_supplier_name || "Nhà Cung Cấp Pin & Inverter SunPower",
            lead_engineer: b.lead_engineer || "Phạm Hoàng Nam",
            construction_requirements: b.construction_requirements || "",
            bom_items: b.bom_items || [],
            work_scope: b.work_scope || [],
            status: b.status || "IN_PROGRESS",
            progress: parseInt(b.progress) || 0,
            checkin_data: null,
            acceptance_documents: [],
            settlement_status: "Chưa thanh toán",
            settlement_amount: 0,
            evaluation: null,
            created_at: new Date().toISOString()
        };

        projects.push(newProject);
        writeDB(dbFile, projects);
        writeDB(legacyDbFile, projects); // Đồng bộ cả 2 file

        res.status(201).json({ success: true, data: newProject, message: "Tạo hồ sơ dự án thành công!" });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. GET /api/construction/handover/:projectId
router.get("/handover/:projectId", (req, res) => {
    try {
        const pid = Number(req.params.projectId);
        let handovers = readDB(handoverFile);
        if (handovers.length === 0) handovers = readDB(legacyHandoverFile);

        const ho = handovers.find(h => Number(h.project_id) === pid);
        res.json({ success: true, data: ho || null });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. POST /api/construction/handover/:projectId (Lưu 6 ảnh & Thông tin App Inverter)
router.post("/handover/:projectId", (req, res) => {
    try {
        const pid = Number(req.params.projectId);
        const b = req.body;

        let handovers = readDB(handoverFile);
        handovers = handovers.filter(h => Number(h.project_id) !== pid);

        const newHandover = {
            id: handovers.length > 0 ? Math.max(...handovers.map(d => Number(d.id) || 0)) + 1 : 1,
            project_id: pid,
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
            updated_at: new Date().toISOString()
        };

        handovers.push(newHandover);
        writeDB(handoverFile, handovers);
        writeDB(legacyHandoverFile, handovers); // Đồng bộ

        // Cập nhật tiến độ dự án
        let projects = readDB(dbFile);
        const pIndex = projects.findIndex(x => Number(x.id) === pid);
        if (pIndex !== -1) {
            if (b.progress !== undefined) projects[pIndex].progress = parseInt(b.progress);
            writeDB(dbFile, projects);
            writeDB(legacyDbFile, projects);
        }

        res.json({ success: true, data: newHandover, message: "🎉 Đã lưu toàn bộ hồ sơ 6 ảnh và thông tin App Inverter thành công!" });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
