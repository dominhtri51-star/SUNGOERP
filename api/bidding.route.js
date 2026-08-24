const express = require("express");
const fs = require("fs");
const path = require("path");
const router = express.Router();

const dataDir = path.join(__dirname, "../data");
const dbFile = path.join(dataDir, "bidding_projects.json");
const teamsFile = path.join(dataDir, "contractor_teams.json");
const bidsFile = path.join(dataDir, "project_bids.json");
const handoverFile = path.join(dataDir, "bidding_handovers.json");

// AUTO-HEAL: Đảm bảo thư mục và các file dữ liệu luôn tồn tại
const initDB = () => {
    try {
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        
        // 1. Seed Teams
        if (!fs.existsSync(teamsFile) || fs.readFileSync(teamsFile, "utf8").trim() === "[]") {
            const seedTeams = [
                {
                    id: 1,
                    code: "TEAM-01",
                    name: "Đội Kỹ Thuật Solar Fast",
                    leader: "Nguyễn Văn Hùng",
                    phone: "0912.345.678",
                    email: "solarfast.sg@gmail.com",
                    coverage_areas: "TP.HCM, Bình Dương, Đồng Nai",
                    member_count: 6,
                    rating_avg: 4.9,
                    total_projects_done: 28,
                    skills: "Thi công Hybrid 1P/3P cao cấp, Mái ngói biệt thự, Lắp đặt trạm biến áp, Nghiệm thu EVN",
                    bank_info: "1903456789011 - Techcombank (Nguyen Van Hung)",
                    status: "ACTIVE",
                    created_at: "2026-01-15T08:00:00.000Z"
                },
                {
                    id: 2,
                    code: "TEAM-02",
                    name: "Đội Cơ Điện Mặt Trời Miền Tây",
                    leader: "Lê Văn Minh",
                    phone: "0988.765.432",
                    email: "mientay.solar@gmail.com",
                    coverage_areas: "Long An, Tiền Giang, Bến Tre, Cần Thơ",
                    member_count: 5,
                    rating_avg: 4.8,
                    total_projects_done: 22,
                    skills: "Hệ Solar Farm, Bơm tưới tiêu năng lượng, Khung giàn cao tầng, Hệ Độc lập Off-grid",
                    bank_info: "0123456789 - Vietcombank (Le Van Minh)",
                    status: "ACTIVE",
                    created_at: "2026-02-10T09:00:00.000Z"
                },
                {
                    id: 3,
                    code: "TEAM-03",
                    name: "Đội Điện Mặt Trời Sài Gòn Pro",
                    leader: "Trần Quốc Tuấn",
                    phone: "0903.112.233",
                    email: "saigonpro.solar@gmail.com",
                    coverage_areas: "TP. Thủ Đức, Q.7, Nhà Bè, Bình Chánh, Bình Dương",
                    member_count: 4,
                    rating_avg: 5.0,
                    total_projects_done: 19,
                    skills: "Hàn khung sắt hộp sân thượng, Mái ngói cao cấp, Đấu nối ATS tủ điện tổng, Cấu hình CT bám tải",
                    bank_info: "0451000345678 - Vietcombank (Tran Quoc Tuan)",
                    status: "ACTIVE",
                    created_at: "2026-03-01T08:30:00.000Z"
                },
                {
                    id: 4,
                    code: "TEAM-04",
                    name: "Đội Thi Công An Phát Solar",
                    leader: "Phạm Đình Trọng",
                    phone: "0977.889.900",
                    email: "anphat.epc@gmail.com",
                    coverage_areas: "Đồng Nai, Bình Thuận, Bà Rịa - Vũng Tàu",
                    member_count: 7,
                    rating_avg: 4.7,
                    total_projects_done: 15,
                    skills: "Mái tôn Seamlock nhà xưởng, Hệ thống ESS công nghiệp, Đóng cọc tiếp địa bãi",
                    bank_info: "2200101234567 - MBBank (Pham Dinh Trong)",
                    status: "ACTIVE",
                    created_at: "2026-04-05T10:00:00.000Z"
                }
            ];
            fs.writeFileSync(teamsFile, JSON.stringify(seedTeams, null, 2), "utf8");
        }

        // 2. Seed Projects & Bids
        if (!fs.existsSync(dbFile) || fs.readFileSync(dbFile, "utf8").trim() === "[]") {
            const seedProjects = [
                {
                    id: 1,
                    project_code: "DA-2026-001",
                    project_name: "Hệ Solar Hybrid 12 kWp + 16 kWh - Biệt Thự Thảo Điền",
                    customer_name: "Trần Quốc Tuấn",
                    customer_phone: "0903.888.999",
                    customer_contact_person: "Chị Mai (Vợ anh Tuấn) - 0903.888.777",
                    province_city: "TP. Hồ Chí Minh",
                    district: "TP. Thủ Đức",
                    address: "Số 45 Đường số 12, P. Thảo Điền, TP. Thủ Đức, TP. Hồ Chí Minh",
                    distance_km: 14.5,
                    gps_location: "10.8031, 106.7329",
                    customer_type: "Nhà dân",
                    system_type: "Hybrid",
                    capacity_kwp: 12.0,
                    inverter_brand: "Deye 12kW Hybrid 3 Pha (SUN-12K-SG04LP3)",
                    inverter_qty: 1,
                    panel_brand: "Canadian Solar 600W BiHiKu7",
                    panel_qty: 20,
                    battery_kwh: 16.0,
                    battery_brand: "Sungo Lithium 51.2V 100Ah (3 Pack)",
                    battery_qty: 3,
                    roof_type: "Mái ngói Thái (Độ dốc 30 độ)",
                    max_labor_budget: 10000000,
                    bidding_deadline: "2026-08-28",
                    expected_start_date: "2026-09-01",
                    sales_pic: "Nguyễn Văn A (Sales Lead)",
                    lead_engineer: "Phạm Hoàng Nam (Kỹ sư trưởng)",
                    construction_requirements: "Mái ngói cần đi hài nhẹ nhàng tránh vỡ ngói; luồn ống ruột gà PVC chống cháy chống chuột; bọc co nhiệt đầu cos.",
                    survey_images: [],
                    bom_items: [
                        { name: "Tấm pin Canadian Solar 600W BiHiKu7", qty: 20, unit: "Tấm", note: "Đã tập kết tại kho SUNGO" },
                        { name: "Biến tần Hybrid Deye 12kW 3 Pha", qty: 1, unit: "Bộ", note: "Kèm Smart Meter 3P & Wifi" },
                        { name: "Pin lưu trữ Lithium Sungo 5.12kWh", qty: 3, unit: "Pack", note: "Tổng 15.36kWh kèm cáp song song" },
                        { name: "Tủ điện Solar ATS 3 Pha AC/DC chống sét", qty: 1, unit: "Tủ", note: "Đã ráp sẵn thiết bị Hager/Chint" },
                        { name: "Cáp Solar DC 6.0mm2 chuyên dụng", qty: 120, unit: "Mét", note: "Màu đỏ + đen" },
                        { name: "Chân ngói inox 304 + Rail nhôm 4.2m", qty: 20, unit: "Bộ", note: "Kèm kẹp biên và kẹp giữa" },
                        { name: "Cọc tiếp địa đồng D16 dài 2.4m + Dây M25", qty: 3, unit: "Bộ", note: "Đóng cọc sâu đạt < 4 Ohm" }
                    ],
                    work_scope: [
                        "Vận chuyển thiết bị và tấm pin lên mái ngói an toàn",
                        "Định vị bát móc ngói inox và lắp ray nhôm anodized",
                        "Lắp đặt và cân chỉnh 20 tấm pin theo góc nghiêng chuẩn",
                        "Đi đường dây DC 6mm2 luồn ống ruột gà chống cháy",
                        "Treo biến tần Deye 12kW và 3 pack pin Lithium Sungo",
                        "Lắp đặt tủ điện ATS 3 pha, đấu nối tiếp địa chống sét",
                        "Cài đặt App Solarman, kết nối Wifi và cấu hình CT bám tải",
                        "Vệ sinh mặt tấm pin, dọn dẹp mặt bằng thi công",
                        "Hỗ trợ nghiệm thu với chủ nhà và hướng dẫn sử dụng"
                    ],
                    status: "BIDDING_OPEN",
                    progress: 0,
                    winning_team_id: null,
                    winning_bid_id: null,
                    winning_team_name: null,
                    settlement_status: "Chưa thanh toán",
                    settlement_amount: 0,
                    evaluation: null,
                    created_at: "2026-08-20T08:30:00.000Z"
                },
                {
                    id: 2,
                    project_code: "DA-2026-002",
                    project_name: "Hệ Solar Hòa Lưới Bám Tải 15 kWp - Nhà Xưởng May Gia Định",
                    customer_name: "Công Ty TNHH May Mặc Gia Định (Anh Hùng)",
                    customer_phone: "0918.555.666",
                    customer_contact_person: "Anh Hùng (Trưởng Ban Quản Lý) - 0918.555.666",
                    province_city: "Bình Dương",
                    district: "TP. Thuận An",
                    address: "Lô B2 KCN VSIP 1, Đại Lộ Độc Lập, TP. Thuận An, Bình Dương",
                    distance_km: 26.0,
                    gps_location: "10.9324, 106.7021",
                    customer_type: "Nhà xưởng",
                    system_type: "Hòa Lưới",
                    capacity_kwp: 15.0,
                    inverter_brand: "Sungrow 15kW 3 Pha (SG15RT)",
                    inverter_qty: 1,
                    panel_brand: "Jinko Solar 580W Tiger Neo N-type",
                    panel_qty: 26,
                    battery_kwh: 0,
                    battery_brand: "Không có (Hòa lưới trực tiếp)",
                    battery_qty: 0,
                    roof_type: "Mái tôn Seamlock công nghiệp",
                    max_labor_budget: 11000000,
                    bidding_deadline: "2026-08-25",
                    expected_start_date: "2026-08-29",
                    sales_pic: "Lê Minh Trí (Sales B2B)",
                    lead_engineer: "Nguyễn Thanh Tùng",
                    construction_requirements: "Tuân thủ bảo hộ lao động nhà xưởng KCN (nón, giày bảo hộ, dây đai an toàn toàn thân). Bắt kẹp kẹp Seamlock không bắn vít thủng tôn.",
                    survey_images: [],
                    bom_items: [
                        { name: "Tấm pin Jinko 580W N-type TopCon", qty: 26, unit: "Tấm", note: "Hiệu suất cao 22.4%" },
                        { name: "Inverter Sungrow 15kW 3 Pha SG15RT", qty: 1, unit: "Bộ", note: "Kèm Wifi dongle & Smart meter" },
                        { name: "Kẹp tôn Seamlock nhôm đúc áp lực cao", qty: 60, unit: "Cái", note: "Không đục lỗ mái tôn" },
                        { name: "Tủ điện đóng cắt bảo vệ AC 3 Pha", qty: 1, unit: "Tủ", note: "MCCB Mitsubishi + Chống sét OBO" }
                    ],
                    work_scope: [
                        "Kéo dây an toàn bảo hộ trên mái tôn seamlock",
                        "Lắp đặt kẹp seamlock và thanh rail",
                        "Lắp đặt 26 tấm pin solar",
                        "Đấu nối tủ điện công nghiệp và biến tần Sungrow",
                        "Cài đặt Zero Export bám tải công suất xưởng"
                    ],
                    status: "RECEIVING_BIDS",
                    progress: 0,
                    winning_team_id: null,
                    winning_bid_id: null,
                    winning_team_name: null,
                    settlement_status: "Chưa thanh toán",
                    settlement_amount: 0,
                    evaluation: null,
                    created_at: "2026-08-21T09:15:00.000Z"
                },
                {
                    id: 3,
                    project_code: "DA-2026-003",
                    project_name: "Hệ Solar Hybrid 8 kWp + 10 kWh - Nhà Phố Chị Hằng (Bình Thạnh)",
                    customer_name: "Nguyễn Thu Hằng",
                    customer_phone: "0909.123.456",
                    customer_contact_person: "Chị Hằng - 0909.123.456",
                    province_city: "TP. Hồ Chí Minh",
                    district: "Quận Bình Thạnh",
                    address: "284/15 Nơ Trang Long, Phường 12, Quận Bình Thạnh, TP. Hồ Chí Minh",
                    distance_km: 8.2,
                    gps_location: "10.8142, 106.6975",
                    customer_type: "Nhà dân",
                    system_type: "Hybrid",
                    capacity_kwp: 8.0,
                    inverter_brand: "Luxpower 8kW Eco Hybrid (SNA5000 / LXP 8k)",
                    inverter_qty: 1,
                    panel_brand: "Longi 550W Hi-MO 5",
                    panel_qty: 15,
                    battery_kwh: 10.24,
                    battery_brand: "Sungo Lithium PowerWall 10kWh",
                    battery_qty: 2,
                    roof_type: "Khung giàn sắt cao 2.5m sân thượng",
                    max_labor_budget: 9000000,
                    bidding_deadline: "2026-08-18",
                    expected_start_date: "2026-08-22",
                    sales_pic: "Trần Văn Nam",
                    lead_engineer: "Phạm Hoàng Nam",
                    construction_requirements: "Nhà trong hẻm, xe 1.5 tấn không vào được, cần thợ vận chuyển bộ 50m vào nhà.",
                    survey_images: [],
                    bom_items: [
                        { name: "Tấm pin Longi 550W", qty: 15, unit: "Tấm", note: "Dàn 8.25kWp" },
                        { name: "Inverter Luxpower 8kW Hybrid", qty: 1, unit: "Bộ", note: "Wifi dongle" },
                        { name: "Pin lưu trữ Sungo Lithium 5.12kWh", qty: 2, unit: "Pack", note: "Tổng 10.24kWh" }
                    ],
                    work_scope: [
                        "Lắp tấm pin lên khung giàn sắt cao 2.5m sân thượng",
                        "Treo inverter và pin lưu trữ gắn tường",
                        "Đấu nối tủ điện hybrid và cài đặt app Luxpower"
                    ],
                    status: "IN_PROGRESS",
                    progress: 65,
                    winning_team_id: 3,
                    winning_bid_id: 4,
                    winning_team_name: "Đội Điện Mặt Trời Sài Gòn Pro",
                    checkin_data: {
                        timestamp: "2026-08-22T07:45:00.000Z",
                        gps: "10.8142, 106.6975",
                        address: "284/15 Nơ Trang Long, P.12, Bình Thạnh, TP.HCM",
                        photo_url: "https://images.unsplash.com/photo-1509391365360-2e959784a276?w=600&auto=format&fit=crop&q=60",
                        note: "Đội 4 thợ đã có mặt đầy đủ vật tư lúc 07:45 sáng, tiến hành kéo dàn pin lên sân thượng."
                    },
                    settlement_status: "Đã tạm ứng (50%)",
                    settlement_amount: 8500000,
                    evaluation: null,
                    created_at: "2026-08-16T14:00:00.000Z"
                },
                {
                    id: 4,
                    project_code: "DA-2026-004",
                    project_name: "Hệ Solar Độc Lập 5 kWp + 10 kWh - Nông Trại Bưởi Da Xanh (Bến Tre)",
                    customer_name: "Huỳnh Văn Ba",
                    customer_phone: "0939.777.888",
                    customer_contact_person: "Anh Ba - 0939.777.888",
                    province_city: "Bến Tre",
                    district: "Huyện Châu Thành",
                    address: "Ấp Phú An, Xã Quới Sơn, Huyện Châu Thành, Bến Tre",
                    distance_km: 82.0,
                    gps_location: "10.3015, 106.3421",
                    customer_type: "Farm",
                    system_type: "Độc Lập",
                    capacity_kwp: 5.0,
                    inverter_brand: "Sungo Off-Grid 5kW Pure Sine Wave",
                    inverter_qty: 1,
                    panel_brand: "Canadian 550W",
                    panel_qty: 10,
                    battery_kwh: 10.0,
                    battery_brand: "Sungo Lithium 51.2V 200Ah",
                    battery_qty: 1,
                    roof_type: "Mái tôn trang trại vườn bưởi",
                    max_labor_budget: 7000000,
                    bidding_deadline: "2026-08-10",
                    expected_start_date: "2026-08-14",
                    sales_pic: "Nguyễn Văn A",
                    lead_engineer: "Lê Văn Trọng",
                    construction_requirements: "Vườn cây rậm rạp, cần bọc ống ruột gà PVC kỹ tránh sóc cắn dây.",
                    survey_images: [],
                    bom_items: [
                        { name: "Tấm pin Canadian 550W", qty: 10, unit: "Tấm", note: "Đã lắp hoàn chỉnh" },
                        { name: "Inverter Off-grid Sungo 5kW", qty: 1, unit: "Bộ", note: "Đang hoạt động tốt" },
                        { name: "Pin lưu trữ Lithium Sungo 10kWh", qty: 1, unit: "Pack", note: "Nạp xả 100%" }
                    ],
                    work_scope: [
                        "Lắp đặt 10 tấm pin trên mái nhà điều hành trang trại",
                        "Lắp đặt hệ thống Off-grid cấp điện máy bơm và chiếu sáng"
                    ],
                    status: "COMPLETED",
                    progress: 100,
                    winning_team_id: 2,
                    winning_bid_id: 5,
                    winning_team_name: "Đội Cơ Điện Mặt Trời Miền Tây",
                    checkin_data: {
                        timestamp: "2026-08-14T08:00:00.000Z",
                        gps: "10.3015, 106.3421",
                        address: "Ấp Phú An, Xã Quới Sơn, Huyện Châu Thành, Bến Tre",
                        photo_url: "https://images.unsplash.com/photo-1509391365360-2e959784a276?w=600&auto=format&fit=crop&q=60",
                        note: "Đội 5 thợ có mặt đúng giờ, khảo sát tiếp địa vườn bưởi."
                    },
                    settlement_status: "Đã tất toán (100%)",
                    settlement_amount: 6800000,
                    evaluation: {
                        rating_stars: 5,
                        criteria: {
                            speed_ontime: 5,
                            quality_aesthetic: 5,
                            safety_standard: 5,
                            attitude_service: 5
                        },
                        reviewer: "Phạm Hoàng Nam (Kỹ sư SUNGO)",
                        review_date: "2026-08-16",
                        comment: "Đội thợ làm việc cực kỳ chuyên nghiệp, đường ống dây bọc thẩm mỹ cao, bàn giao sớm hơn tiến độ 1 ngày. Khách hàng khen ngợi rất nhiều."
                    },
                    created_at: "2026-08-08T07:00:00.000Z"
                }
            ];
            fs.writeFileSync(dbFile, JSON.stringify(seedProjects, null, 2), "utf8");

            const seedBids = [
                {
                    id: 1,
                    project_id: 1,
                    team_id: 1,
                    team_code: "TEAM-01",
                    team_name: "Đội Kỹ Thuật Solar Fast",
                    leader: "Nguyễn Văn Hùng",
                    phone: "0912.345.678",
                    labor_price: 9500000,
                    extra_cost: 0,
                    total_price: 9500000,
                    team_size: 5,
                    estimated_days: 2,
                    expected_start_date: "2026-09-01",
                    warranty_months: 24,
                    notes: "Đội đã có kinh nghiệm 15 mái ngói biệt thự Thảo Điền, cam kết không vỡ 1 viên ngói nào, có máy đo Voc và tiếp địa Fluke.",
                    status: "PENDING",
                    created_at: "2026-08-21T10:00:00.000Z"
                },
                {
                    id: 2,
                    project_id: 1,
                    team_id: 3,
                    team_code: "TEAM-03",
                    team_name: "Đội Điện Mặt Trời Sài Gòn Pro",
                    leader: "Trần Quốc Tuấn",
                    phone: "0903.112.233",
                    labor_price: 9000000,
                    extra_cost: 500000,
                    total_price: 9500000,
                    team_size: 4,
                    estimated_days: 2,
                    expected_start_date: "2026-09-02",
                    warranty_months: 12,
                    notes: "Bao gồm chi phí gia cố thêm chân ngói chống bão, kỹ sư có chứng chỉ an toàn nhóm 3.",
                    status: "PENDING",
                    created_at: "2026-08-21T14:30:00.000Z"
                },
                {
                    id: 3,
                    project_id: 2,
                    team_id: 4,
                    team_code: "TEAM-04",
                    team_name: "Đội Thi Công An Phát Solar",
                    leader: "Phạm Đình Trọng",
                    phone: "0977.889.900",
                    labor_price: 10500000,
                    extra_cost: 0,
                    total_price: 10500000,
                    team_size: 6,
                    estimated_days: 3,
                    expected_start_date: "2026-08-29",
                    warranty_months: 24,
                    notes: "Đã hoàn thành nhiều dự án seamlock tại VSIP 1, đầy đủ giấy phép vào cổng KCN.",
                    status: "PENDING",
                    created_at: "2026-08-22T08:00:00.000Z"
                },
                {
                    id: 4,
                    project_id: 3,
                    team_id: 3,
                    team_code: "TEAM-03",
                    team_name: "Đội Điện Mặt Trời Sài Gòn Pro",
                    leader: "Trần Quốc Tuấn",
                    phone: "0903.112.233",
                    labor_price: 8500000,
                    extra_cost: 0,
                    total_price: 8500000,
                    team_size: 4,
                    estimated_days: 2,
                    expected_start_date: "2026-08-22",
                    warranty_months: 24,
                    notes: "Trúng thầu thi công",
                    status: "ACCEPTED",
                    created_at: "2026-08-17T09:00:00.000Z"
                },
                {
                    id: 5,
                    project_id: 4,
                    team_id: 2,
                    team_code: "TEAM-02",
                    team_name: "Đội Cơ Điện Mặt Trời Miền Tây",
                    leader: "Lê Văn Minh",
                    phone: "0988.765.432",
                    labor_price: 6800000,
                    extra_cost: 0,
                    total_price: 6800000,
                    team_size: 5,
                    estimated_days: 1.5,
                    expected_start_date: "2026-08-14",
                    warranty_months: 24,
                    notes: "Đã hoàn thành xuất sắc",
                    status: "ACCEPTED",
                    created_at: "2026-08-11T10:00:00.000Z"
                }
            ];
            fs.writeFileSync(bidsFile, JSON.stringify(seedBids, null, 2), "utf8");
        }

        // 3. Seed Handovers
        if (!fs.existsSync(handoverFile) || fs.readFileSync(handoverFile, "utf8").trim() === "[]") {
            const seedHandovers = [
                {
                    id: 1,
                    project_id: 4,
                    app_name: "Sungo Monitor Solar",
                    app_account: "huynhvanba.solar@gmail.com",
                    app_password: "Sungo@123456",
                    app_status: "HOẠT ĐỘNG MƯỢT MÀ",
                    img_panels: "https://images.unsplash.com/photo-1509391365360-2e959784a276?w=800&auto=format&fit=crop&q=60",
                    img_cabinet: "https://images.unsplash.com/photo-1558441719-8b489c638a10?w=800&auto=format&fit=crop&q=60",
                    img_inverter: "https://images.unsplash.com/photo-1513694203232-719a280e022f?w=800&auto=format&fit=crop&q=60",
                    img_battery: "https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&auto=format&fit=crop&q=60",
                    img_wiring: "https://images.unsplash.com/photo-1621905252507-b35492cc74b4?w=800&auto=format&fit=crop&q=60",
                    img_app: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&auto=format&fit=crop&q=60",
                    technical_checklist: {
                        voc_test: true,
                        grounding_resistance: true,
                        insulation_test: true,
                        leak_proof_roof: true,
                        ct_zero_export: true,
                        backup_load_test: true
                    },
                    customer_signature: "Huỳnh Văn Ba",
                    handover_date: "2026-08-16",
                    created_at: "2026-08-16T10:30:00.000Z"
                }
            ];
            fs.writeFileSync(handoverFile, JSON.stringify(seedHandovers, null, 2), "utf8");
        }
    } catch(e) {
        console.error("Lỗi khởi tạo DB Bidding:", e);
    }
};

initDB();

function readDB(file) {
    try {
        if (!fs.existsSync(file)) return [];
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch(e) {
        return [];
    }
}

function writeDB(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// BẢO MẬT & MASKING DỮ LIỆU
function maskProjectData(p, userRole = "ADMIN", userTeamId = null) {
    const isUnassigned = (p.status === "NEW" || p.status === "BIDDING_OPEN" || p.status === "RECEIVING_BIDS") && !p.winning_team_id;
    
    if (userRole === "ADMIN" || userRole === "SUPER_ADMIN" || userRole === "SALE" || userRole === "NHA_THAU_GIAM_SAT" || (userTeamId && p.winning_team_id === userTeamId)) {
        return { ...p, is_masked: false };
    }
    
    if (isUnassigned) {
        return {
            ...p,
            is_masked: true,
            customer_name: "Khách Hàng (" + (p.customer_type || "Tiềm năng") + ")",
            customer_phone: "090****LOCK",
            customer_contact_person: "*** Mở khóa sau khi trúng thầu",
            address: "Khu vực: " + (p.district || "Quận/Huyện") + " - " + (p.province_city || "Tỉnh/Thành") + " (Địa chỉ chi tiết mở khóa sau khi trúng thầu)",
            gps_location: "*** Mở khóa sau khi trúng thầu"
        };
    }
    
    return { ...p, is_masked: false };
}

// 1. GET /api/bidding/projects
router.get("/projects", (req, res) => {
    try {
        let projects = readDB(dbFile);
        const bids = readDB(bidsFile);
        const teams = readDB(teamsFile);
        const userRole = req.query.role || "ADMIN";
        const userTeamId = req.query.team_id ? Number(req.query.team_id) : null;

        projects.sort((a, b) => Number(b.id) - Number(a.id));

        const enriched = projects.map(p => {
            const projBids = bids.filter(b => b.project_id === p.id);
            const winningTeam = p.winning_team_id ? teams.find(t => t.id === p.winning_team_id) : null;
            
            const masked = maskProjectData(p, userRole, userTeamId);
            return {
                ...masked,
                total_bids_count: projBids.length,
                lowest_bid_amount: projBids.length > 0 ? Math.min(...projBids.map(b => Number(b.total_price) || 0)) : null,
                winning_team_info: winningTeam ? {
                    id: winningTeam.id,
                    name: winningTeam.name,
                    leader: winningTeam.leader,
                    phone: winningTeam.phone,
                    rating_avg: winningTeam.rating_avg
                } : null
            };
        });

        res.json({ success: true, data: enriched });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. GET /api/bidding/projects/:id
router.get("/projects/:id", (req, res) => {
    try {
        const id = Number(req.params.id);
        const projects = readDB(dbFile);
        const p = projects.find(x => Number(x.id) === id);
        if (!p) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        const bids = readDB(bidsFile).filter(b => Number(b.project_id) === id);
        const teams = readDB(teamsFile);
        const userRole = req.query.role || "ADMIN";
        const userTeamId = req.query.team_id ? Number(req.query.team_id) : null;

        const enrichedBids = bids.map(b => {
            const team = teams.find(t => Number(t.id) === Number(b.team_id));
            return {
                ...b,
                team_info: team || { name: b.team_name, rating_avg: 5.0, total_projects_done: 0 }
            };
        });

        const masked = maskProjectData(p, userRole, userTeamId);
        res.json({
            success: true,
            data: {
                ...masked,
                bids: enrichedBids
            }
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. POST /api/bidding/projects
router.post("/projects", (req, res) => {
    try {
        const projects = readDB(dbFile);
        const b = req.body;
        const newId = projects.length > 0 ? Math.max(...projects.map(d => Number(d.id) || 0)) + 1 : 1;

        const newProject = {
            id: newId,
            project_code: b.project_code || ("DA-2026-" + String(newId).padStart(3, "0")),
            project_name: b.project_name || "Hệ Điện Mặt Trời Mới",
            customer_name: b.customer_name || "Khách hàng",
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
            max_labor_budget: parseFloat(b.max_labor_budget) || 0,
            bidding_deadline: b.bidding_deadline || new Date(Date.now() + 7*86400000).toISOString().split("T")[0],
            expected_start_date: b.expected_start_date || "",
            sales_pic: b.sales_pic || "",
            lead_engineer: b.lead_engineer || "",
            construction_requirements: b.construction_requirements || "",
            survey_images: b.survey_images || [],
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
            status: b.status || "BIDDING_OPEN",
            progress: 0,
            winning_team_id: null,
            winning_bid_id: null,
            winning_team_name: null,
            settlement_status: "Chưa thanh toán",
            settlement_amount: 0,
            evaluation: null,
            created_at: new Date().toISOString()
        };

        projects.push(newProject);
        writeDB(dbFile, projects);
        res.status(201).json({ success: true, data: newProject });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. GET & POST /api/bidding/teams
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

// 5. POST /api/bidding/projects/:id/bids
router.post("/projects/:id/bids", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const projects = readDB(dbFile);
        const p = projects.find(x => Number(x.id) === projectId);
        if (!p) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        const b = req.body;
        const bids = readDB(bidsFile);
        const teams = readDB(teamsFile);
        const team = teams.find(t => Number(t.id) === Number(b.team_id));

        const laborPrice = parseFloat(b.labor_price) || 0;
        const extraCost = parseFloat(b.extra_cost) || 0;
        const totalPrice = laborPrice + extraCost;

        const newId = bids.length > 0 ? Math.max(...bids.map(d => Number(d.id) || 0)) + 1 : 1;

        const newBid = {
            id: newId,
            project_id: projectId,
            team_id: Number(b.team_id),
            team_code: team ? team.code : "TEAM-XX",
            team_name: team ? team.name : (b.team_name || "Đội thợ"),
            leader: team ? team.leader : "",
            phone: team ? team.phone : "",
            labor_price: laborPrice,
            extra_cost: extraCost,
            total_price: totalPrice,
            team_size: parseInt(b.team_size) || (team ? team.member_count : 4),
            estimated_days: parseFloat(b.estimated_days) || 2,
            expected_start_date: b.expected_start_date || "",
            warranty_months: parseInt(b.warranty_months) || 24,
            notes: b.notes || "",
            status: "PENDING",
            created_at: new Date().toISOString()
        };

        bids.push(newBid);
        writeDB(bidsFile, bids);

        if (p.status === "BIDDING_OPEN") {
            p.status = "RECEIVING_BIDS";
            writeDB(dbFile, projects);
        }

        res.status(201).json({ success: true, data: newBid });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. POST /api/bidding/projects/:id/select-team
router.post("/projects/:id/select-team", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const { team_id, bid_id } = req.body;

        let projects = readDB(dbFile);
        let bids = readDB(bidsFile);
        let teams = readDB(teamsFile);

        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex === -1) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        const selectedTeam = teams.find(t => Number(t.id) === Number(team_id));
        if (!selectedTeam) return res.status(404).json({ success: false, error: "Không tìm thấy thông tin đội thi công" });

        bids.forEach(b => {
            if (Number(b.project_id) === projectId) {
                if (Number(b.team_id) === Number(team_id)) {
                    b.status = "ACCEPTED";
                } else {
                    b.status = "REJECTED";
                }
            }
        });
        writeDB(bidsFile, bids);

        projects[pIndex].status = "TEAM_SELECTED";
        projects[pIndex].winning_team_id = Number(team_id);
        projects[pIndex].winning_bid_id = bid_id ? Number(bid_id) : null;
        projects[pIndex].winning_team_name = selectedTeam.name;
        writeDB(dbFile, projects);

        res.json({
            success: true,
            message: "🎉 Đã chọn " + selectedTeam.name + " làm đơn vị thi công chính thức. Toàn bộ thông tin khách hàng đã được mở khóa!",
            data: projects[pIndex]
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. POST /api/bidding/projects/:id/checkin
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
            note: note || "Đội thi công đã có mặt tại hiện trường công trình."
        };

        projects[pIndex].checkin_data = checkinRecord;
        if (projects[pIndex].status === "TEAM_SELECTED" || projects[pIndex].status === "MATERIAL_DISPATCHED") {
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

// 8. POST /api/bidding/projects/:id/progress
router.post("/projects/:id/progress", (req, res) => {
    try {
        const projectId = Number(req.params.id);
        const { progress, status } = req.body;

        let projects = readDB(dbFile);
        const pIndex = projects.findIndex(x => Number(x.id) === projectId);
        if (pIndex === -1) return res.status(404).json({ success: false, error: "Không tìm thấy dự án" });

        if (progress !== undefined) projects[pIndex].progress = Math.min(100, Math.max(0, parseInt(progress)));
        if (status) projects[pIndex].status = status;
        if (projects[pIndex].progress >= 100) projects[pIndex].status = "COMPLETED";

        writeDB(dbFile, projects);
        res.json({ success: true, data: projects[pIndex] });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 9. GET & POST /api/bidding/handover/:projectId
router.get("/handover/:projectId", (req, res) => {
    try {
        const projectId = Number(req.params.projectId);
        const handovers = readDB(handoverFile);
        const item = handovers.find(x => Number(x.project_id) === projectId);
        res.json({ success: true, data: item || null });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post("/handover/:projectId", (req, res) => {
    try {
        const projectId = Number(req.params.projectId);
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
            technical_checklist: b.technical_checklist || {
                voc_test: true,
                grounding_resistance: true,
                insulation_test: true,
                leak_proof_roof: true,
                ct_zero_export: true,
                backup_load_test: true
            },
            customer_signature: b.customer_signature || "",
            handover_date: b.handover_date || new Date().toISOString().split("T")[0],
            created_at: new Date().toISOString()
        };

        handovers.push(newHandover);
        writeDB(handoverFile, handovers);

        if (b.progress !== undefined) {
            let projects = readDB(dbFile);
            const pIndex = projects.findIndex(x => Number(x.id) === projectId);
            if (pIndex !== -1) {
                projects[pIndex].progress = parseInt(b.progress);
                writeDB(dbFile, projects);
            }
        }

        res.json({ success: true, data: newHandover, message: "🎉 Đã lưu đầy đủ 6 góc ảnh hiện trường và thông tin App Inverter!" });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 10. POST /api/bidding/projects/:id/evaluate
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

        const winningTeamId = projects[pIndex].winning_team_id;
        if (winningTeamId) {
            const tIndex = teams.findIndex(t => Number(t.id) === Number(winningTeamId));
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
            message: "🌟 Đã quyết toán và đánh giá đội thợ thành công! Điểm uy tín đã được cập nhật.",
            data: projects[pIndex]
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
