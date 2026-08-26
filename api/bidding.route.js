const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const dataDir = path.join(__dirname, "../data");
const dbFile = path.join(dataDir, "bidding_projects.json");
const teamsFile = path.join(dataDir, "contractor_teams.json");
const handoverFile = path.join(dataDir, "bidding_handovers.json");

// Đảm bảo các file lưu trữ tồn tại
const initDB = () => {
    try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        if (!fs.existsSync(teamsFile)) fs.writeFileSync(teamsFile, "[]", "utf8");
        if (!fs.existsSync(dbFile)) fs.writeFileSync(dbFile, "[]", "utf8");
        if (!fs.existsSync(handoverFile)) fs.writeFileSync(handoverFile, "[]", "utf8");
    } catch(e) {
        console.error("Lỗi khởi tạo bidding DB files:", e);
    }
};
initDB();

function readDB(file) {
    try {
        if (!fs.existsSync(file)) return [];
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch(e) { return []; }
}
function writeDB(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// 1. GET /api/bidding/projects (Admin & Manager lấy toàn bộ dự án)
router.get("/projects", (req, res) => {
    try {
        let projects = readDB(dbFile);
        const teams = readDB(teamsFile);
        const handovers = readDB(handoverFile);

        projects.sort((a, b) => Number(b.id) - Number(a.id));

        const enriched = projects.map(p => {
            const team = teams.find(t => Number(t.id) === Number(p.assigned_contractor_id));
            const sup = teams.find(t => Number(t.id) === Number(p.assigned_supervisor_id));
            const supp = teams.find(t => Number(t.id) === Number(p.assigned_supplier_id));
            const ho = handovers.find(h => Number(h.project_id) === Number(p.id));

            return {
                ...p,
                contractor_info: team || null,
                supervisor_info: sup || null,
                supplier_info: supp || null,
                handover_data: ho || null
            };
        });

        res.json({ success: true, data: enriched });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. GET /api/bidding/my-projects (Dành riêng cho Nhà Thầu đăng nhập)
router.get("/my-projects", (req, res) => {
    try {
        let projects = readDB(dbFile);
        const handovers = readDB(handoverFile);
        const teamId = req.query.team_id ? Number(req.query.team_id) : 1; // Default Team 1 for demo

        // Lọc dự án được chỉ định cho nhà thầu này
        const myProjects = projects.filter(p => Number(p.assigned_contractor_id) === teamId || Number(p.assigned_supervisor_id) === teamId);
        myProjects.sort((a, b) => Number(b.id) - Number(a.id));

        const enriched = myProjects.map(p => {
            const ho = handovers.find(h => Number(h.project_id) === Number(p.id));
            return {
                ...p,
                handover_data: ho || null
            };
        });

        res.json({ success: true, data: enriched });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. GET /api/bidding/projects/:id
router.get("/projects/:id", (req, res) => {
    try {
        const id = Number(req.params.id);
        const projects = readDB(dbFile);
        const p = projects.find(x => Number(x.id) === id);
        if (!p) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        const teams = readDB(teamsFile);
        const handovers = readDB(handoverFile);
        const team = teams.find(t => Number(t.id) === Number(p.assigned_contractor_id));
        const ho = handovers.find(h => Number(h.project_id) === id);

        res.json({
            success: true,
            data: {
                ...p,
                contractor_info: team || null,
                handover_data: ho || null
            }
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. POST /api/bidding/projects (Công ty tạo dự án mới & chỉ định nhà thầu)
router.post("/projects", (req, res) => {
    try {
        const projects = readDB(dbFile);
        const teams = readDB(teamsFile);
        const b = req.body;
        const newId = projects.length > 0 ? Math.max(...projects.map(d => Number(d.id) || 0)) + 1 : 1;

        const assignedContractorId = b.assigned_contractor_id ? Number(b.assigned_contractor_id) : null;
        const contractorTeam = teams.find(t => t.id === assignedContractorId);

        const newProject = {
            id: newId,
            project_code: b.project_code || ("DA-2026-" + String(newId).padStart(3, "0")),
            project_name: b.project_name || "Dự Án Solar Mới",
            customer_name: b.customer_name || "Khách Hàng",
            customer_phone: b.customer_phone || "",
            customer_contact_person: b.customer_contact_person || "",
            province_city: b.province_city || "TP. Hồ Chí Minh",
            district: b.district || "",
            address: b.address || "",
            distance_km: parseFloat(b.distance_km) || 0,
            gps_location: b.gps_location || "",
            customer_type: b.customer_type || "Nhà dân",
            system_type: b.system_type || "Hybrid",
            capacity_kwp: parseFloat(b.capacity_kwp) || 0,
            inverter_brand: b.inverter_brand || "Deye",
            inverter_qty: parseInt(b.inverter_qty) || 1,
            panel_brand: b.panel_brand || "Canadian Solar",
            panel_qty: parseInt(b.panel_qty) || 0,
            battery_kwh: parseFloat(b.battery_kwh) || 0,
            battery_brand: b.battery_brand || "",
            battery_qty: parseInt(b.battery_qty) || 0,
            roof_type: b.roof_type || "Mái tôn",
            labor_cost: parseFloat(b.labor_cost) || 0,
            assigned_contractor_id: assignedContractorId,
            assigned_contractor_name: contractorTeam ? contractorTeam.name : (b.assigned_contractor_name || "Chưa chỉ định"),
            assigned_supervisor_id: b.assigned_supervisor_id ? Number(b.assigned_supervisor_id) : null,
            assigned_supervisor_name: b.assigned_supervisor_name || "Đơn Vị Giám Sát EPC Pro",
            assigned_supplier_id: b.assigned_supplier_id ? Number(b.assigned_supplier_id) : null,
            assigned_supplier_name: b.assigned_supplier_name || "Nhà Cung Cấp Pin & Inverter SunPower",
            expected_start_date: b.expected_start_date || "",
            expected_end_date: b.expected_end_date || "",
            sales_pic: b.sales_pic || "Admin",
            lead_engineer: b.lead_engineer || "Kỹ sư phụ trách",
            construction_requirements: b.construction_requirements || "",
            bom_items: b.bom_items || [],
            work_scope: b.work_scope || [
                "Vận chuyển thiết bị và tấm pin lên mái an toàn",
                "Lắp ray nhôm và phụ kiện khung giàn",
                "Lắp đặt và đấu nối các chuỗi tấm pin DC",
                "Treo biến tần Inverter và tủ điện bảo vệ AC/DC",
                "Lắp đặt pin lưu trữ và kết nối BMS",
                "Đấu nối tiếp địa chống sét đạt tiêu chuẩn < 4 Ohm",
                "Cài đặt App giám sát, kết nối Wifi và cấu hình CT bám tải",
                "Dọn dẹp vệ sinh công trường và bàn giao"
            ],
            status: assignedContractorId ? "ASSIGNED" : "NEW",
            progress: 0,
            checkin_data: null,
            acceptance_documents: [],
            settlement_status: "Chưa thanh toán",
            settlement_amount: 0,
            evaluation: null,
            created_at: new Date().toISOString()
        };

        projects.push(newProject);
        writeDB(dbFile, projects);
        res.status(201).json({ success: true, data: newProject, message: "🎉 Đã tạo dự án và chỉ định nhà thầu thành công!" });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. POST /api/bidding/projects/:id/assign (Chỉ định hoặc thay đổi nhà thầu cho dự án)
router.post("/projects/:id/assign", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const { contractor_id, supervisor_id, supplier_id, labor_cost } = req.body;

        let projects = readDB(dbFile);
        let teams = readDB(teamsFile);

        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex === -1) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        const contractor = teams.find(t => Number(t.id) === Number(contractor_id));
        const supervisor = teams.find(t => Number(t.id) === Number(supervisor_id));
        const supplier = teams.find(t => Number(t.id) === Number(supplier_id));

        if (contractor) {
            projects[pIndex].assigned_contractor_id = Number(contractor_id);
            projects[pIndex].assigned_contractor_name = contractor.name;
        }
        if (supervisor) {
            projects[pIndex].assigned_supervisor_id = Number(supervisor_id);
            projects[pIndex].assigned_supervisor_name = supervisor.name;
        }
        if (supplier) {
            projects[pIndex].assigned_supplier_id = Number(supplier_id);
            projects[pIndex].assigned_supplier_name = supplier.name;
        }
        if (labor_cost !== undefined) {
            projects[pIndex].labor_cost = parseFloat(labor_cost);
        }
        if (projects[pIndex].status === "NEW") {
            projects[pIndex].status = "ASSIGNED";
        }

        writeDB(dbFile, projects);
        res.json({
            success: true,
            message: "🎉 Đã chỉ định nhà thầu phụ trách cho dự án thành công!",
            data: projects[pIndex]
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. POST /api/bidding/projects/:id/checkin (Nhà thầu check-in GPS)
router.post("/projects/:id/checkin", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const { gps, address, note, photo_url } = req.body;

        let projects = readDB(dbFile);
        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex === -1) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        const checkinRecord = {
            timestamp: new Date().toISOString(),
            gps: gps || "10.8031, 106.7329",
            address: address || projects[pIndex].address,
            photo_url: photo_url || "",
            note: note || "Đội thợ đã có mặt tại công trình."
        };

        projects[pIndex].checkin_data = checkinRecord;
        if (projects[pIndex].status === "ASSIGNED" || projects[pIndex].status === "NEW") {
            projects[pIndex].status = "IN_PROGRESS";
        }
        if (projects[pIndex].progress === 0) {
            projects[pIndex].progress = 10;
        }

        writeDB(dbFile, projects);
        res.json({ success: true, message: "✅ Check-in GPS hiện trường thành công!", data: checkinRecord });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. POST /api/bidding/projects/:id/progress (Nhà thầu cập nhật % tiến độ)
router.post("/projects/:id/progress", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const { progress, status } = req.body;

        let projects = readDB(dbFile);
        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex === -1) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        if (progress !== undefined) projects[pIndex].progress = Math.min(100, Math.max(0, parseInt(progress)));
        if (status) projects[pIndex].status = status;
        if (projects[pIndex].progress >= 100) projects[pIndex].status = "UNDER_INSPECTION";

        writeDB(dbFile, projects);
        res.json({ success: true, data: projects[pIndex] });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 8. POST /api/bidding/projects/:id/handover (Lưu 6 ảnh & Thông tin App Inverter)
router.post("/projects/:id/handover", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const b = req.body;

        let handovers = readDB(handoverFile);
        handovers = handovers.filter(x => Number(x.project_id) !== projectId);

        const newHandover = {
            id: handovers.length > 0 ? Math.max(...handovers.map(d => Number(d.id) || 0)) + 1 : 1,
            project_id: projectId,
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

        // Cập nhật tiến độ dự án nếu có
        if (b.progress !== undefined) {
            let projects = readDB(dbFile);
            const pIndex = projects.findIndex(x => Number(x.id) === projectId);
            if (pIndex !== -1) {
                projects[pIndex].progress = parseInt(b.progress);
                writeDB(dbFile, projects);
            }
        }

        res.json({ success: true, data: newHandover, message: "🎉 Đã lưu bộ 6 ảnh hiện trường và thông tin App Inverter thành công!" });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 9. POST /api/bidding/projects/:id/documents (Nhà thầu/Công ty tải lên tư liệu nghiệm thu bổ sung)
router.post("/projects/:id/documents", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const { name, file_url, notes, uploaded_by } = req.body;

        let projects = readDB(dbFile);
        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex === -1) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        if (!projects[pIndex].acceptance_documents) {
            projects[pIndex].acceptance_documents = [];
        }

        const docId = projects[pIndex].acceptance_documents.length + 1;
        const newDoc = {
            id: docId,
            name: name || "Tư liệu nghiệm thu mới",
            file_url: file_url || "",
            notes: notes || "",
            uploaded_by: uploaded_by || "Nhà thầu thi công",
            uploaded_at: new Date().toISOString()
        };

        projects[pIndex].acceptance_documents.push(newDoc);
        writeDB(dbFile, projects);

        res.status(201).json({ success: true, data: newDoc, message: "✅ Đã thêm tư liệu nghiệm thu thành công!" });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 10. POST /api/bidding/projects/:id/evaluate (Công ty / Giám Sát duyệt nghiệm thu, chấm điểm & tất toán)
router.post("/projects/:id/evaluate", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const { rating_stars, criteria, comment, reviewer, settlement_status, settlement_amount } = req.body;

        let projects = readDB(dbFile);
        let teams = readDB(teamsFile);

        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex === -1) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        const evalRecord = {
            rating_stars: Math.min(5, Math.max(1, Number(rating_stars) || 5)),
            criteria: criteria || {
                speed_ontime: 5,
                quality_aesthetic: 5,
                safety_standard: 5,
                attitude_service: 5
            },
            reviewer: reviewer || "Kỹ Sư Trưởng SUNGO",
            review_date: new Date().toISOString().split("T")[0],
            comment: comment || "Đội thợ thi công đạt chuẩn chất lượng SUNGO."
        };

        projects[pIndex].evaluation = evalRecord;
        if (settlement_status) projects[pIndex].settlement_status = settlement_status;
        if (settlement_amount !== undefined) projects[pIndex].settlement_amount = parseFloat(settlement_amount);
        projects[pIndex].status = "COMPLETED";
        projects[pIndex].progress = 100;

        writeDB(dbFile, projects);

        // Tích lũy điểm vào hồ sơ nhà thầu
        const contractorId = projects[pIndex].assigned_contractor_id;
        if (contractorId) {
            const tIndex = teams.findIndex(t => Number(t.id) === Number(contractorId));
            if (tIndex !== -1) {
                const curRating = Number(teams[tIndex].rating_avg) || 5.0;
                const curDone = Number(teams[tIndex].total_projects_done) || 0;
                const newRating = Number((((curRating * curDone) + evalRecord.rating_stars) / (curDone + 1)).toFixed(1));
                
                teams[tIndex].rating_avg = newRating;
                teams[tIndex].total_projects_done = curDone + 1;
                writeDB(teamsFile, teams);
            }
        }

        res.json({
            success: true,
            message: "🌟 Đã duyệt nghiệm thu, chấm điểm & tất toán dự án thành công!",
            data: projects[pIndex]
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET & POST /api/bidding/teams (Danh bạ nhà thầu)
router.get("/teams", (req, res) => {
    try {
        const teams = readDB(teamsFile);
        res.json({ success: true, data: teams });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/teams", (req, res) => {
    try {
        const teams = readDB(teamsFile);
        const b = req.body;
        const newId = teams.length > 0 ? Math.max(...teams.map(d => Number(d.id) || 0)) + 1 : 1;

        const newTeam = {
            id: newId,
            code: b.code || ("TEAM-" + String(newId).padStart(2, "0")),
            name: b.name || "Đội Thi Công Mới",
            type: b.type || "CONSTRUCTION",
            leader: b.leader || "",
            phone: b.phone || "",
            email: b.email || "",
            coverage_areas: b.coverage_areas || "TP.HCM và lân cận",
            member_count: parseInt(b.member_count) || 4,
            rating_avg: 5.0,
            total_projects_done: 0,
            skills: b.skills || "Lắp đặt điện mặt trời dân dụng & công nghiệp",
            bank_info: b.bank_info || "",
            status: "ACTIVE",
            created_at: new Date().toISOString()
        };

        teams.push(newTeam);
        writeDB(teamsFile, teams);
        res.status(201).json({ success: true, data: newTeam });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
