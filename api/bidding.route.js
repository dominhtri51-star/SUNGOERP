const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const dataDir = path.join(__dirname, "../data");
const dbFile = path.join(dataDir, "bidding_projects.json");
const legacyDbFile = path.join(dataDir, "projects.json");
const teamsFile = path.join(dataDir, "contractor_teams.json");
const bidsFile = path.join(dataDir, "project_bids.json");
const handoverFile = path.join(dataDir, "bidding_handovers.json");

const DEFAULT_TEAMS = [
    {
        id: 1,
        code: "TEAM-01",
        name: "Đội Kỹ Thuật Solar Fast",
        type: "CONSTRUCTION",
        leader: "Phạm Hoàng Nam",
        phone: "0903112233",
        email: "solarfast@gmail.com",
        coverage_areas: "TP.HCM, Bình Dương, Đồng Nai, Long An",
        member_count: 6,
        rating_avg: 5.0,
        total_projects_done: 18,
        skills: "Thi công trọn gói Hybrid/On-grid mái tôn, mái ngói, mái bằng, đo tiếp địa < 4 Ohm, cài đặt App Inverter",
        bank_info: "MB Bank - 0903112233 - Pham Hoang Nam",
        status: "ACTIVE"
    },
    {
        id: 2,
        code: "TEAM-02",
        name: "Đơn Vị Giám Sát EPC Pro",
        type: "SUPERVISOR",
        leader: "Nguyễn Văn Giám Sát",
        phone: "0908889900",
        email: "epcpro.supervision@gmail.com",
        coverage_areas: "Toàn Quốc",
        member_count: 4,
        rating_avg: 5.0,
        total_projects_done: 25,
        skills: "Giám sát an toàn điện, đo kiểm Fluke, kiểm định chất lượng thi công EPC",
        bank_info: "Techcombank - 190333444555 - Nguyen Van Giam Sat",
        status: "ACTIVE"
    },
    {
        id: 3,
        code: "TEAM-03",
        name: "Nhà Cung Cấp Pin & Inverter SunPower",
        type: "SUPPLIER",
        leader: "Trần Cung Ứng",
        phone: "0912334455",
        email: "sunpower.supplier@gmail.com",
        coverage_areas: "Miền Nam & Miền Trung",
        member_count: 10,
        rating_avg: 4.9,
        total_projects_done: 42,
        skills: "Cung cấp sỉ tấm pin Canadian/Jinko/Longi, biến tần Deye/Solis/Growatt, phụ kiện nhôm",
        bank_info: "Vietcombank - 007100998877 - Tran Cung Ung",
        status: "ACTIVE"
    }
];

// Đảm bảo các file lưu trữ tồn tại
const initDB = () => {
    try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        if (!fs.existsSync(teamsFile) || JSON.parse(fs.readFileSync(teamsFile, "utf8") || "[]").length === 0) {
            fs.writeFileSync(teamsFile, JSON.stringify(DEFAULT_TEAMS, null, 2), "utf8");
        }
        if (!fs.existsSync(dbFile)) {
            if (fs.existsSync(legacyDbFile)) {
                fs.copyFileSync(legacyDbFile, dbFile);
            } else {
                fs.writeFileSync(dbFile, "[]", "utf8");
            }
        }
        if (!fs.existsSync(bidsFile)) fs.writeFileSync(bidsFile, "[]", "utf8");
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

// Helper: Phân quyền & bảo mật thông tin (Data Masking)
function maskProjectForRole(p, role = 'ADMIN', teamId = null) {
    if (!p) return null;
    const isInternal = ['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC', 'QUAN_LY', 'SALE_ADMIN', 'KE_TOAN'].includes(role);
    const isAwarded = teamId && (
        Number(p.assigned_contractor_id) === Number(teamId) || 
        Number(p.assigned_supervisor_id) === Number(teamId) || 
        Number(p.assigned_supplier_id) === Number(teamId)
    );

    // Nếu là Admin nội bộ hoặc Nhà thầu đã được giao dự án -> Giữ nguyên thông tin đầy đủ
    if (isInternal || isAwarded) {
        return {
            ...p,
            is_unlocked: true
        };
    }

    // Đối với các nhà thầu xem trên Sàn Đấu Thầu (Marketplace)
    const masked = { ...p };
    masked.is_unlocked = false;
    masked.customer_phone = "🔒 [Chỉ mở khóa sau khi trúng thầu]";
    masked.customer_contact_person = "🔒 [Ẩn khi mở thầu]";
    masked.customer_name = p.customer_type === 'Doanh nghiệp' ? 'Khách Hàng Doanh Nghiệp' : 'Khách Hàng Nhà Dân';
    
    const safeLoc = [p.district, p.province_city].filter(Boolean).join(', ');
    masked.address = safeLoc ? `Khu vực: ${safeLoc} (Số nhà cụ thể mở khóa khi trúng thầu)` : (p.province_city || 'TP. Hồ Chí Minh');
    masked.gps_location = '';

    // Đối với nhà thầu thi công hoặc giám sát: chỉ giữ số lượng & quy cách thiết bị để tính nhân công, ẩn giá vốn nội bộ
    if (role === 'NHA_THAU_THI_CONG' || role === 'NHA_THAU_GIAM_SAT') {
        masked.bom_items = (p.bom_items || []).map(b => ({
            name: b.name,
            qty: b.qty,
            unit: b.unit,
            note: b.note || ''
        }));
    }

    return masked;
}

// 1. GET /api/bidding/projects (Admin & Quản Lý Dự Án - Lấy danh sách kèm số lượng hồ sơ thầu)
router.get("/projects", (req, res) => {
    try {
        let projects = readDB(dbFile);
        const teams = readDB(teamsFile);
        const bids = readDB(bidsFile);
        const handovers = readDB(handoverFile);
        const role = (req.user && req.user.role) ? req.user.role : (req.headers['x-user-role'] || req.query.role || 'GUEST');
        const teamId = req.query.team_id ? Number(req.query.team_id) : null;

        projects.sort((a, b) => Number(b.id) - Number(a.id));

        const enriched = projects.map(p => {
            const team = teams.find(t => Number(t.id) === Number(p.assigned_contractor_id));
            const sup = teams.find(t => Number(t.id) === Number(p.assigned_supervisor_id));
            const supp = teams.find(t => Number(t.id) === Number(p.assigned_supplier_id));
            const ho = handovers.find(h => Number(h.project_id) === Number(p.id));
            const projectBids = bids.filter(b => Number(b.project_id) === Number(p.id));

            const item = {
                ...p,
                contractor_info: team || null,
                supervisor_info: sup || null,
                supplier_info: supp || null,
                handover_data: ho || null,
                bids_count: projectBids.length,
                bids: ['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC', 'QUAN_LY'].includes(role) ? projectBids : undefined
            };

            return maskProjectForRole(item, role, teamId);
        });

        res.json({ success: true, data: enriched });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. GET /api/bidding/marketplace (Sàn Đấu Thầu - Dành cho các bên xem dự án mở thầu)
router.get("/marketplace", (req, res) => {
    try {
        let projects = readDB(dbFile);
        const teams = readDB(teamsFile);
        const bids = readDB(bidsFile);
        const role = req.headers['x-user-role'] || req.query.role || 'NHA_THAU_THI_CONG';
        const teamId = req.query.team_id ? Number(req.query.team_id) : null;

        // Lọc các dự án đang mở thầu hoặc dự án mới
        let marketProjects = projects.filter(p => p.status === 'OPEN_BIDDING' || p.status === 'NEW' || !p.assigned_contractor_id);
        marketProjects.sort((a, b) => Number(b.id) - Number(a.id));

        const enriched = marketProjects.map(p => {
            const projectBids = bids.filter(b => Number(b.project_id) === Number(p.id));
            const myBid = teamId ? projectBids.find(b => Number(b.team_id) === Number(teamId)) : null;

            const item = {
                ...p,
                bids_count: projectBids.length,
                my_bid: myBid || null
            };

            return maskProjectForRole(item, role, teamId);
        });

        res.json({ success: true, data: enriched });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. GET /api/bidding/my-projects (Dành riêng cho Nhà Thầu đã trúng thầu / được giao việc)
router.get("/my-projects", (req, res) => {
    try {
        let projects = readDB(dbFile);
        const handovers = readDB(handoverFile);
        const teams = readDB(teamsFile);
        const teamId = req.query.team_id ? Number(req.query.team_id) : 1; // Mặc định Đội 1 nếu demo

        // Lọc các dự án mà nhà thầu này là đội thi công, giám sát hoặc nhà cung cấp
        const myProjects = projects.filter(p => 
            Number(p.assigned_contractor_id) === teamId || 
            Number(p.assigned_supervisor_id) === teamId ||
            Number(p.assigned_supplier_id) === teamId
        );
        myProjects.sort((a, b) => Number(b.id) - Number(a.id));

        const enriched = myProjects.map(p => {
            const ho = handovers.find(h => Number(h.project_id) === Number(p.id));
            const team = teams.find(t => Number(t.id) === Number(p.assigned_contractor_id));
            return {
                ...p,
                contractor_info: team || null,
                handover_data: ho || null,
                is_unlocked: true // Đã trúng thầu thì mở khóa 100%
            };
        });

        res.json({ success: true, data: enriched });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. GET /api/bidding/projects/:id (Chi tiết dự án)
router.get("/projects/:id", (req, res) => {
    try {
        const id = Number(req.params.id);
        const projects = readDB(dbFile);
        const p = projects.find(x => Number(x.id) === id);
        if (!p) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        const teams = readDB(teamsFile);
        const handovers = readDB(handoverFile);
        const bids = readDB(bidsFile);
        const role = (req.user && req.user.role) ? req.user.role : (req.headers['x-user-role'] || req.query.role || 'GUEST');
        const teamId = req.query.team_id ? Number(req.query.team_id) : null;

        const team = teams.find(t => Number(t.id) === Number(p.assigned_contractor_id));
        const ho = handovers.find(h => Number(h.project_id) === id);
        const projectBids = bids.filter(b => Number(b.project_id) === id);

        const enriched = {
            ...p,
            contractor_info: team || null,
            handover_data: ho || null,
            bids_count: projectBids.length,
            bids: ['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC', 'QUAN_LY'].includes(role) ? projectBids : (teamId ? projectBids.filter(b => Number(b.team_id) === teamId) : [])
        };

        res.json({
            success: true,
            data: maskProjectForRole(enriched, role, teamId)
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. POST /api/bidding/projects (Tạo / Đăng dự án mới)
router.post("/projects", (req, res) => {
    try {
        const projects = readDB(dbFile);
        const teams = readDB(teamsFile);
        const b = req.body;
        const newId = projects.length > 0 ? Math.max(...projects.map(d => Number(d.id) || 0)) + 1 : 1;

        const assignedContractorId = b.assigned_contractor_id ? Number(b.assigned_contractor_id) : null;
        const contractorTeam = teams.find(t => Number(t.id) === assignedContractorId);
        const status = b.status || (assignedContractorId ? "ASSIGNED" : "OPEN_BIDDING");

        const newProject = {
            id: newId,
            project_code: b.project_code || ("DA-2026-" + String(newId).padStart(3, "0")),
            project_name: b.project_name || "Dự Án Solar EPC",
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
            roof_direction: b.roof_direction || "Hướng Nam",
            roof_pitch: b.roof_pitch || "15 độ",
            floor_count: b.floor_count || "2 tầng",
            ladder_access: b.ladder_access || "Lối thang bộ lên mái",
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
            site_notes: b.site_notes || "",
            construction_requirements: b.construction_requirements || "",
            survey_photos: Array.isArray(b.survey_photos) ? b.survey_photos : [],
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
            status: status,
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
        res.status(201).json({ 
            success: true, 
            data: newProject, 
            message: status === 'OPEN_BIDDING' ? "📢 Đã đăng dự án lên Sàn Đấu Thầu thành công!" : "🎉 Đã tạo dự án và chỉ định nhà thầu thành công!" 
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5.1 PUT /api/bidding/projects/:id (Cập nhật dự án, ảnh khảo sát và ghi chú)
router.put("/projects/:id", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        let projects = readDB(dbFile);
        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex === -1) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        const b = req.body;
        projects[pIndex] = {
            ...projects[pIndex],
            ...b,
            id: projectId, // không đổi ID
            survey_photos: Array.isArray(b.survey_photos) ? b.survey_photos : (projects[pIndex].survey_photos || []),
            updated_at: new Date().toISOString()
        };

        writeDB(dbFile, projects);
        res.json({ success: true, data: projects[pIndex], message: "✅ Đã cập nhật thông tin dự án thành công!" });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. POST /api/bidding/projects/:id/bids (Nhà thầu / Giám sát / Cung cấp nộp báo giá chào thầu)
router.post("/projects/:id/bids", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const projects = readDB(dbFile);
        const p = projects.find(x => Number(x.id) === projectId);
        if (!p) return res.status(404).json({ success: false, error: "Không tìm thấy dự án đấu thầu" });

        const teams = readDB(teamsFile);
        const bids = readDB(bidsFile);
        const b = req.body;

        const teamId = Number(b.team_id) || 1;
        const team = teams.find(t => Number(t.id) === teamId);
        const newBidId = bids.length > 0 ? Math.max(...bids.map(x => Number(x.id) || 0)) + 1 : 1;

        const newBid = {
            id: newBidId,
            project_id: projectId,
            project_code: p.project_code,
            project_name: p.project_name,
            team_id: teamId,
            team_code: team ? team.code : ("TEAM-" + teamId),
            team_name: team ? team.name : (b.team_name || "Nhà Thầu"),
            team_leader: team ? team.leader : "",
            team_phone: team ? team.phone : "",
            team_rating: team ? team.rating_avg : 5.0,
            bidder_type: b.bidder_type || (team ? team.type : "CONSTRUCTION"),
            labor_price: parseFloat(b.labor_price) || 0,
            extra_cost: parseFloat(b.extra_cost) || 0,
            total_bid_amount: (parseFloat(b.labor_price) || 0) + (parseFloat(b.extra_cost) || 0),
            team_size: parseInt(b.team_size) || 4,
            estimated_days: parseFloat(b.estimated_days) || 2,
            warranty_months: parseInt(b.warranty_months) || 24,
            notes: b.notes || "",
            status: "PENDING",
            created_at: new Date().toISOString()
        };

        // Nếu nhà thầu đã gửi báo giá trước đó cho dự án này -> Cập nhật lại
        const existingIdx = bids.findIndex(x => Number(x.project_id) === projectId && Number(x.team_id) === teamId);
        if (existingIdx !== -1) {
            bids[existingIdx] = { ...bids[existingIdx], ...newBid, id: bids[existingIdx].id };
        } else {
            bids.push(newBid);
        }

        writeDB(bidsFile, bids);
        res.status(201).json({
            success: true,
            message: "🎉 Đã gửi hồ sơ báo giá đấu thầu thành công! Công ty sẽ duyệt và phản hồi.",
            data: newBid
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. GET /api/bidding/projects/:id/bids (Lấy danh sách các báo giá của dự án)
router.get("/projects/:id/bids", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const bids = readDB(bidsFile);
        const role = (req.user && req.user.role) ? req.user.role : (req.headers['x-user-role'] || req.query.role || 'GUEST');
        const teamId = req.query.team_id ? Number(req.query.team_id) : null;

        let projectBids = bids.filter(b => Number(b.project_id) === projectId);
        if (!['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC', 'QUAN_LY'].includes(role) && teamId) {
            projectBids = projectBids.filter(b => Number(b.team_id) === teamId);
        }

        res.json({ success: true, data: projectBids });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 8. POST /api/bidding/projects/:id/award (Admin duyệt trúng thầu & đóng thầu)
router.post("/projects/:id/award", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const { bid_id, contractor_id, supervisor_id, supplier_id, labor_cost, notes } = req.body;

        let projects = readDB(dbFile);
        let teams = readDB(teamsFile);
        let bids = readDB(bidsFile);

        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex === -1) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        let winningContractorId = contractor_id ? Number(contractor_id) : null;
        let finalLaborCost = labor_cost !== undefined ? parseFloat(labor_cost) : projects[pIndex].labor_cost;

        // Nếu duyệt qua bid_id
        if (bid_id) {
            const bid = bids.find(b => Number(b.id) === Number(bid_id) && Number(b.project_id) === projectId);
            if (bid) {
                winningContractorId = Number(bid.team_id);
                finalLaborCost = Number(bid.total_bid_amount);
            }
        }

        const contractor = teams.find(t => Number(t.id) === Number(winningContractorId));
        const supervisor = supervisor_id ? teams.find(t => Number(t.id) === Number(supervisor_id)) : null;
        const supplier = supplier_id ? teams.find(t => Number(t.id) === Number(supplier_id)) : null;

        if (contractor) {
            projects[pIndex].assigned_contractor_id = Number(winningContractorId);
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
        if (finalLaborCost) {
            projects[pIndex].labor_cost = finalLaborCost;
        }

        // Đóng thầu & chuyển sang trạng thái đã giao việc
        projects[pIndex].status = "ASSIGNED";
        if (notes) projects[pIndex].construction_requirements = (projects[pIndex].construction_requirements ? projects[pIndex].construction_requirements + '\n' : '') + notes;

        // Cập nhật trạng thái các bids
        bids.forEach(b => {
            if (Number(b.project_id) === projectId) {
                if (Number(b.team_id) === Number(winningContractorId)) {
                    b.status = "ACCEPTED";
                } else if (b.status === "PENDING") {
                    b.status = "REJECTED";
                }
            }
        });

        writeDB(dbFile, projects);
        writeDB(bidsFile, bids);

        res.json({
            success: true,
            message: `🎉 Đã duyệt trúng thầu cho "${contractor ? contractor.name : 'Nhà Thầu'}" với giá ${finalLaborCost.toLocaleString('vi-VN')} đ! Đã đóng thầu và bắt đầu triển khai.`,
            data: projects[pIndex]
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 9. POST /api/bidding/projects/:id/checkin (Nhà thầu check-in GPS)
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
            note: note || "Đội thợ đã có mặt tại hiện trường thi công."
        };

        projects[pIndex].checkin_data = checkinRecord;
        if (projects[pIndex].status === "ASSIGNED" || projects[pIndex].status === "NEW" || projects[pIndex].status === "OPEN_BIDDING") {
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

// 10. POST /api/bidding/projects/:id/progress (Nhà thầu cập nhật % tiến độ)
router.post("/projects/:id/progress", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const { progress, status, stage_note } = req.body;

        let projects = readDB(dbFile);
        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex === -1) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        if (progress !== undefined) projects[pIndex].progress = Math.min(100, Math.max(0, parseInt(progress)));
        if (status) projects[pIndex].status = status;
        if (projects[pIndex].progress >= 100) projects[pIndex].status = "UNDER_INSPECTION";
        if (stage_note) {
            projects[pIndex].stage_note = stage_note;
        }

        writeDB(dbFile, projects);
        res.json({ success: true, data: projects[pIndex], message: "✅ Đã cập nhật tiến độ dự án!" });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 11. POST /api/bidding/projects/:id/handover (Lưu 6 ảnh hiện trường & Thông tin App Inverter)
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

        // Cập nhật tiến độ dự án
        let projects = readDB(dbFile);
        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex !== -1) {
            if (b.progress !== undefined) projects[pIndex].progress = parseInt(b.progress);
            if (projects[pIndex].progress >= 90 && projects[pIndex].status === "IN_PROGRESS") {
                projects[pIndex].status = "UNDER_INSPECTION";
            }
            writeDB(dbFile, projects);
        }

        res.json({ success: true, data: newHandover, message: "🎉 Đã lưu bộ 6 ảnh hiện trường và thông tin App Inverter thành công!" });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 12. POST /api/bidding/projects/:id/documents (Tải lên tư liệu nghiệm thu bổ sung)
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

// 13. POST /api/bidding/projects/:id/evaluate (Duyệt nghiệm thu, chấm điểm & tất toán)
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

// 14. DELETE /api/bidding/projects/:id (Admin xóa dự án rác)
router.delete("/projects/:id", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        let projects = readDB(dbFile);
        let bids = readDB(bidsFile);
        let handovers = readDB(handoverFile);

        const p = projects.find(x => Number(x.id) === projectId);
        if (!p) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        projects = projects.filter(x => Number(x.id) !== projectId);
        bids = bids.filter(x => Number(x.project_id) !== projectId);
        handovers = handovers.filter(x => Number(x.project_id) !== projectId);

        writeDB(dbFile, projects);
        writeDB(bidsFile, bids);
        writeDB(handoverFile, handovers);

        res.json({ success: true, message: `✅ Đã xóa dự án "${p.project_name || ('#' + projectId)}" và các chứng từ liên quan!` });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 15. GET & POST /api/bidding/teams (Danh bạ nhà thầu)
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
        res.status(201).json({ success: true, data: newTeam, message: "✅ Đã lưu hồ sơ nhà thầu mới!" });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
