const express = require('express');
const router = express.Router();
const pool = require('../config/database');

// Khởi tạo bảng lưu cấu hình sức khỏe tài chính & tham số nguồn vốn
const initConfigTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS business_health_config (
                config_key VARCHAR(100) PRIMARY KEY,
                config_value TEXT,
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        const defaultConfigs = [
            ['initial_equity', '2500000000', 'Vốn góp ban đầu (Vốn điều lệ) của chủ sở hữu & cổ đông'],
            ['retained_earnings_accumulated', '350000000', 'Lợi nhuận giữ lại tích lũy từ các năm trước'],
            ['bank_debt_short', '400000000', 'Vay ngân hàng ngắn hạn (tài trợ nhập hàng)'],
            ['bank_debt_long', '600000000', 'Vay ngân hàng dài hạn (kho bãi, showroom, xe cộ)'],
            ['bank_interest_rate', '8.5', 'Lãi suất vay ngân hàng bình quân (%/năm)'],
            ['monthly_opex', '45000000', 'Chi phí vận hành cố định mỗi tháng (mặt bằng, lương, marketing)'],
            ['fixed_assets', '800000000', 'Tài sản cố định (nhà xưởng, xe bán tải, trang thiết bị văn phòng)'],
            ['tax_rate', '20', 'Thuế suất thuế TNDN (%)'],
            ['supplier_payable_override', '', 'Ghi đè nợ NCC thủ công (nếu trống sẽ lấy tự động)'],
            ['customer_prepayment_override', '', 'Ghi đè tiền khách trả trước thủ công (nếu trống sẽ lấy tự động)']
        ];

        for (const [k, v, desc] of defaultConfigs) {
            await pool.query(`
                INSERT INTO business_health_config (config_key, config_value, description)
                VALUES ($1, $2, $3)
                ON CONFLICT (config_key) DO NOTHING;
            `, [k, v, desc]);
        }
    } catch (e) {
        console.error("Lỗi khởi tạo bảng business_health_config:", e.message);
    }
};
initConfigTable();

// Hàm tiện ích đọc cấu hình kết hợp dữ liệu Nguồn vốn & Khoản vay thực tế
async function getConfigs() {
    const configMap = {
        initial_equity: 2500000000,
        retained_earnings_accumulated: 350000000,
        bank_debt_short: 400000000,
        bank_debt_long: 600000000,
        bank_interest_rate: 8.5,
        monthly_opex: 45000000,
        fixed_assets: 800000000,
        tax_rate: 20,
        supplier_payable_override: '',
        customer_prepayment_override: ''
    };

    try {
        const res = await pool.query('SELECT config_key, config_value FROM business_health_config');
        res.rows.forEach(r => {
            if (['initial_equity', 'retained_earnings_accumulated', 'bank_debt_short', 'bank_debt_long', 'bank_interest_rate', 'monthly_opex', 'fixed_assets', 'tax_rate'].includes(r.config_key)) {
                configMap[r.config_key] = parseFloat(r.config_value) || 0;
            } else {
                configMap[r.config_key] = r.config_value;
            }
        });

        // 1. ĐỒNG BỘ NGUỒN VỐN THỰC TẾ TỪ CỔ ĐÔNG
        const shRes = await pool.query("SELECT COALESCE(SUM(contributed_capital), 0) as real_equity FROM shareholders WHERE status = 'ACTIVE'");
        const realEquity = parseFloat(shRes.rows[0].real_equity) || 0;
        if (realEquity > 0) {
            configMap.initial_equity = realEquity;
        }

        // 2. ĐỒNG BỘ DƯ NỢ VAY THỰC TẾ TỪ HỢP ĐỒNG VAY NGÂN HÀNG
        const loanRes = await pool.query(`
            SELECT 
                COALESCE(SUM(CASE WHEN loan_type = 'SHORT_TERM' THEN current_principal ELSE 0 END), 0) AS real_short_debt,
                COALESCE(SUM(CASE WHEN loan_type = 'LONG_TERM' THEN current_principal ELSE 0 END), 0) AS real_long_debt,
                COALESCE(SUM(current_principal * interest_rate), 0) AS weighted_interest_sum,
                COALESCE(SUM(current_principal), 0) AS total_active_debt
            FROM bank_loans 
            WHERE status = 'ACTIVE'
        `);

        if (loanRes.rows.length > 0 && parseFloat(loanRes.rows[0].total_active_debt) > 0) {
            const totDebt = parseFloat(loanRes.rows[0].total_active_debt);
            configMap.bank_debt_short = parseFloat(loanRes.rows[0].real_short_debt);
            configMap.bank_debt_long = parseFloat(loanRes.rows[0].real_long_debt);
            const wSum = parseFloat(loanRes.rows[0].weighted_interest_sum);
            if (totDebt > 0 && wSum > 0) {
                configMap.bank_interest_rate = parseFloat((wSum / totDebt).toFixed(2));
            }
        }
    } catch (e) {
        console.error("Lỗi đọc config:", e.message);
    }
    return configMap;
}

// [GET] /api/business-health/summary
// Phân tích sức khỏe doanh nghiệp toàn diện
router.get('/summary', async (req, res) => {
    try {
        const { period = 'month', from_date, to_date } = req.query;
        const configs = await getConfigs();

        let dateFilter = "1=1";
        let daysInPeriod = 30;

        if (period === 'day') {
            dateFilter = "DATE(o.created_at) = CURRENT_DATE";
            daysInPeriod = 1;
        } else if (period === 'week') {
            dateFilter = "o.created_at >= date_trunc('week', CURRENT_DATE)";
            daysInPeriod = 7;
        } else if (period === 'month') {
            dateFilter = "o.created_at >= date_trunc('month', CURRENT_DATE)";
            daysInPeriod = 30;
        } else if (period === 'quarter') {
            dateFilter = "o.created_at >= date_trunc('quarter', CURRENT_DATE)";
            daysInPeriod = 90;
        } else if (period === 'year') {
            dateFilter = "o.created_at >= date_trunc('year', CURRENT_DATE)";
            daysInPeriod = 365;
        } else if (period === 'custom' && from_date && to_date) {
            dateFilter = `DATE(o.created_at) >= '${from_date}' AND DATE(o.created_at) <= '${to_date}'`;
            const diffTime = Math.abs(new Date(to_date) - new Date(from_date));
            daysInPeriod = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
        } else if (period === 'all') {
            dateFilter = "1=1";
            daysInPeriod = 365;
        }

        // 1. LẤY DOANH THU & GIÁ VỐN THỰC TẾ TRONG KỲ
        let revenue = 0;
        let cogs = 0;
        let orderCount = 0;

        try {
            const salesQuery = `
                SELECT 
                    COUNT(DISTINCT o.id) AS total_orders,
                    COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue,
                    COALESCE(SUM(oi.quantity * COALESCE(p.import_price, 0)), 0) AS cogs
                FROM orders o
                LEFT JOIN order_items oi ON oi.order_id = o.id
                LEFT JOIN products p ON oi.product_id = p.id
                WHERE o.status != 'CANCELLED' AND o.status != 'RETURNED' AND ${dateFilter}
            `;
            const salesRes = await pool.query(salesQuery);
            if (salesRes.rows.length > 0) {
                revenue = parseFloat(salesRes.rows[0].revenue) || 0;
                cogs = parseFloat(salesRes.rows[0].cogs) || 0;
                orderCount = parseInt(salesRes.rows[0].total_orders) || 0;
            }
        } catch (e) {
            console.error("Lỗi query doanh thu:", e.message);
        }

        // Nếu cogs = 0 nhưng revenue > 0, tính giả định COGS ~ 72% doanh thu
        if (revenue > 0 && cogs === 0) {
            cogs = revenue * 0.72;
        }
        const grossProfit = revenue - cogs;

        // 2. LẤY TỔN KHO THỰC TẾ
        let inventoryValue = 0;
        let inventoryQty = 0;
        let totalProducts = 0;
        try {
            const invQuery = `
                SELECT 
                    COALESCE(SUM(stock_qty * import_price), 0) AS total_inv_value, 
                    COALESCE(SUM(stock_qty), 0) AS total_qty,
                    COUNT(id) AS total_products
                FROM products 
                WHERE stock_qty > 0
            `;
            const invRes = await pool.query(invQuery);
            if (invRes.rows.length > 0) {
                inventoryValue = parseFloat(invRes.rows[0].total_inv_value) || 0;
                inventoryQty = parseInt(invRes.rows[0].total_qty) || 0;
                totalProducts = parseInt(invRes.rows[0].total_products) || 0;
            }
        } catch (e) {
            console.error("Lỗi query tồn kho:", e.message);
        }

        // 3. LẤY KHOẢN PHẢI THU (KHÁCH HÀNG NỢ)
        let totalReceivable = 0;
        try {
            const custDebtRes = await pool.query("SELECT COALESCE(SUM(current_debt), 0) as total_debt FROM customers WHERE current_debt > 0");
            totalReceivable = parseFloat(custDebtRes.rows[0].total_debt) || 0;

            if (totalReceivable === 0) {
                const orderDebtRes = await pool.query("SELECT COALESCE(SUM(total_amount - COALESCE(paid_amount,0)), 0) as debt FROM orders WHERE status != 'CANCELLED' AND status != 'RETURNED' AND (total_amount - COALESCE(paid_amount,0)) > 0");
                totalReceivable = parseFloat(orderDebtRes.rows[0].debt) || 0;
            }
        } catch (e) {
            console.error("Lỗi query công nợ phải thu:", e.message);
        }

        // 4. LẤY TIỀN MẶT & SỐ DƯ QUỸ
        let totalCash = 0;
        try {
            const cashRes = await pool.query(`
                SELECT 
                    COALESCE(SUM(CASE WHEN type = 'THU' THEN amount ELSE 0 END), 0) -
                    COALESCE(SUM(CASE WHEN type = 'CHI' THEN amount ELSE 0 END), 0) AS net_cash
                FROM cash_transactions
            `);
            totalCash = parseFloat(cashRes.rows[0].net_cash) || 0;
            if (totalCash <= 0 && revenue > 0) {
                totalCash = Math.max(150000000, revenue * 0.15);
            } else if (totalCash <= 0) {
                totalCash = 250000000;
            }
        } catch (e) {
            totalCash = 250000000;
        }

        // 5. LẤY KHOẢN PHẢI TRẢ (NỢ NHÀ CUNG CẤP)
        let totalPayable = 0;
        if (configs.supplier_payable_override && !isNaN(parseFloat(configs.supplier_payable_override))) {
            totalPayable = parseFloat(configs.supplier_payable_override);
        } else {
            totalPayable = cogs > 0 ? (cogs * 0.35) : (inventoryValue * 0.3);
            if (totalPayable === 0) totalPayable = 350000000;
        }

        // 6. KHÁCH HÀNG TRẢ TIỀN TRƯỚC / ĐẶT CỌC (CUSTOMER PREPAYMENTS)
        let customerPrepayments = 0;
        if (configs.customer_prepayment_override && !isNaN(parseFloat(configs.customer_prepayment_override))) {
            customerPrepayments = parseFloat(configs.customer_prepayment_override);
        } else {
            try {
                const contractPrepayRes = await pool.query("SELECT COALESCE(SUM(paid_amount), 0) as deposit FROM contracts WHERE payment_status = 'Chờ Đặt Cọc' OR payment_status = 'Đang Triển Khai'");
                customerPrepayments = parseFloat(contractPrepayRes.rows[0].deposit) || 0;
                if (customerPrepayments === 0 && revenue > 0) {
                    customerPrepayments = revenue * 0.08;
                }
            } catch (e) {
                customerPrepayments = revenue > 0 ? revenue * 0.08 : 50000000;
            }
        }

        // 7. TÍNH TOÁN CÁC THÀNH TỐ TÀI CHÍNH
        const opexInPeriod = configs.monthly_opex * (daysInPeriod / 30);
        const ebit = grossProfit - opexInPeriod;
        const ebitMargin = revenue > 0 ? (ebit / revenue) * 100 : 0;

        const totalBankDebt = configs.bank_debt_short + configs.bank_debt_long;
        const interestExpense = totalBankDebt * (configs.bank_interest_rate / 100) * (daysInPeriod / 365);
        const ebt = ebit - interestExpense;
        const taxExpense = ebt > 0 ? ebt * (configs.tax_rate / 100) : 0;
        const netProfit = ebt - taxExpense;
        const npm = revenue > 0 ? (netProfit / revenue) * 100 : 0;
        const gpm = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

        // Vốn chủ sở hữu (Equity)
        const initialEquity = configs.initial_equity;
        const retainedEarnings = configs.retained_earnings_accumulated + (netProfit > 0 ? netProfit : 0);
        const totalEquity = initialEquity + retainedEarnings;

        // Nợ phải trả (Liabilities)
        const shortTermLiabilities = totalPayable + configs.bank_debt_short + customerPrepayments;
        const longTermLiabilities = configs.bank_debt_long;
        const totalLiabilities = shortTermLiabilities + longTermLiabilities;

        // Tài sản (Assets)
        const shortTermAssets = totalCash + inventoryValue + totalReceivable;
        const fixedAssets = configs.fixed_assets;
        const totalAssets = shortTermAssets + fixedAssets;

        // ==========================================
        // 4 NHÓM CHỈ SỐ SỨC KHỎE TÀI CHÍNH CỐT LÕI
        // ==========================================

        // NHÓM 1: HIỆU QUẢ HOẠT ĐỘNG (OPERATING EFFICIENCY)
        const avgInv = inventoryValue > 0 ? inventoryValue : 1;
        const annualizedCogs = daysInPeriod > 0 ? (cogs * (365 / daysInPeriod)) : cogs;
        const inventoryTurnover = avgInv > 0 && annualizedCogs > 0 ? (annualizedCogs / avgInv) : (cogs > 0 ? cogs / avgInv : 0);
        
        // DIO = (Hàng tồn kho / Giá vốn hàng bán) * Số ngày kỳ
        const dio = cogs > 0 ? (inventoryValue / cogs) * daysInPeriod : (inventoryTurnover > 0 ? 365 / inventoryTurnover : 0);

        // DSO = (Khoản phải thu / Doanh thu) * Số ngày kỳ
        const dso = revenue > 0 ? (totalReceivable / revenue) * daysInPeriod : 0;

        // DPO = (Khoản phải trả / Giá vốn hàng bán) * Số ngày kỳ
        const dpo = cogs > 0 ? (totalPayable / cogs) * daysInPeriod : 0;

        // NHÓM 2: CHU KỲ TIỀN MẶT (CASH CONVERSION CYCLE)
        // CCC = DIO + DSO - DPO
        const ccc = dio + dso - dpo;

        // NHÓM 3: KHẢ NĂNG SINH LỜI (PROFITABILITY)
        const roa = totalAssets > 0 ? (netProfit / totalAssets) * (365 / daysInPeriod) * 100 : 0;
        const roe = totalEquity > 0 ? (netProfit / totalEquity) * (365 / daysInPeriod) * 100 : 0;

        // NHÓM 4: AN TOÀN TÀI CHÍNH & ĐÒN BẨY (SOLVENCY & SAFETY)
        const currentRatio = shortTermLiabilities > 0 ? (shortTermAssets / shortTermLiabilities) : (shortTermAssets > 0 ? 5.0 : 1.0);
        const debtToEquity = totalEquity > 0 ? (totalLiabilities / totalEquity) : 0;
        const icr = interestExpense > 0 ? (ebit / interestExpense) : (ebit > 0 ? 99 : 0);

        // ==========================================
        // BÁC SĨ CHẨN ĐOÁN & ĐIỂM SỨC KHỎE TỔNG HỢP (0 - 100)
        // ==========================================
        let opScore = 15;
        const diagnosticNotes = [];
        const actionAdvices = [];

        if (dio > 0 && dio <= 45) {
            opScore = 25;
            diagnosticNotes.push({ type: 'success', text: `Tốc độ thoát hàng tốt: DIO đạt ${dio.toFixed(1)} ngày (hàng nằm kho dưới 45 ngày).` });
        } else if (dio <= 75) {
            opScore = 18;
            diagnosticNotes.push({ type: 'info', text: `Tốc độ quay vòng kho mức khá: DIO đạt ${dio.toFixed(1)} ngày.` });
        } else {
            opScore = 10;
            diagnosticNotes.push({ type: 'warning', text: `Hàng tồn kho lưu đọng lâu: DIO ${dio.toFixed(1)} ngày (> 75 ngày). Vốn bị chôn trong kho nhiều.` });
            actionAdvices.push("Cần đẩy mạnh xả hàng tồn đọng / linh kiện Solar chậm luân chuyển bằng combo hoặc chiết khấu để thu hồi vốn nhanh.");
        }

        let cashScore = 15;
        if (ccc < 0) {
            cashScore = 25;
            diagnosticNotes.push({ type: 'success', text: `Chu kỳ tiền mặt xuất sắc (CCC = ${ccc.toFixed(1)} ngày < 0): Doanh nghiệp đang "bán tay không bắt giặc", thu tiền khách trước khi phải trả tiền cho nhà cung cấp!` });
        } else if (ccc <= 30) {
            cashScore = 22;
            diagnosticNotes.push({ type: 'success', text: `Chu kỳ tiền mặt linh hoạt (CCC = ${ccc.toFixed(1)} ngày <= 30 ngày): Dòng tiền lưu thông rất mượt mà.` });
        } else if (ccc <= 60) {
            cashScore = 16;
            diagnosticNotes.push({ type: 'info', text: `Chu kỳ tiền mặt trung bình (CCC = ${ccc.toFixed(1)} ngày): Dòng tiền đủ duy trì nhưng cần cải thiện.` });
        } else {
            cashScore = 8;
            diagnosticNotes.push({ type: 'danger', text: `Cảnh báo nghẽn dòng tiền (CCC = ${ccc.toFixed(1)} ngày > 60 ngày): Mất hơn 2 tháng từ khi trả tiền hàng mới thu hồi được tiền mặt.` });
            actionAdvices.push("Đàm phán kéo dài hạn mức công nợ với Nhà Cung Cấp (tăng DPO) và siết chặt chính sách thu nợ khách hàng (giảm DSO).");
        }

        let profitScore = 15;
        if (gpm >= 20 && npm >= 8) {
            profitScore = 25;
            diagnosticNotes.push({ type: 'success', text: `Biên lợi nhuận vững chắc: GPM ${gpm.toFixed(1)}%, Lợi nhuận ròng NPM ${npm.toFixed(1)}%.` });
        } else if (gpm >= 12 && npm >= 4) {
            profitScore = 18;
            diagnosticNotes.push({ type: 'info', text: `Hiệu quả sinh lời ở mức trung bình của ngành thương mại thiết bị: GPM ${gpm.toFixed(1)}%, NPM ${npm.toFixed(1)}%.` });
        } else {
            profitScore = 10;
            diagnosticNotes.push({ type: 'warning', text: `Biên lợi nhuận mỏng: GPM ${gpm.toFixed(1)}%, NPM ${npm.toFixed(1)}%. Chi phí vận hành đang ăn mòn lợi nhuận.` });
            actionAdvices.push("Tối ưu hóa giá vốn nhập từ nhà máy cấp 1 hoặc tối ưu chi phí vận hành OPEX hàng tháng.");
        }

        let safeScore = 15;
        if (currentRatio >= 1.5 && debtToEquity <= 1.8) {
            safeScore = 25;
            diagnosticNotes.push({ type: 'success', text: `Cấu trúc tài chính an toàn: Hệ số thanh toán CR = ${currentRatio.toFixed(2)} (>= 1.5), Đòn bẩy D/E = ${debtToEquity.toFixed(2)} an toàn.` });
        } else if (currentRatio >= 1.1 && debtToEquity <= 2.8) {
            safeScore = 18;
            diagnosticNotes.push({ type: 'info', text: `An toàn tài chính ở mức chấp nhận được: CR = ${currentRatio.toFixed(2)}, D/E = ${debtToEquity.toFixed(2)}.` });
        } else {
            safeScore = 9;
            diagnosticNotes.push({ type: 'danger', text: `Rủi ro thanh khoản ngắn hạn: CR = ${currentRatio.toFixed(2)} hoặc tỷ lệ nợ D/E = ${debtToEquity.toFixed(2)} quá cao.` });
            actionAdvices.push("Kiểm soát chặt khoản nợ vay ngân hàng, duy trì lượng tiền mặt dự phòng tối thiểu tương đương 2 tháng chi phí hoạt động.");
        }

        const healthScore = opScore + cashScore + profitScore + safeScore;

        let healthRating = 'VỮNG MẠNH (TỐI ƯU)';
        let healthRatingColor = 'text-emerald-600 bg-emerald-50 border-emerald-200';
        if (healthScore < 50) {
            healthRating = 'BÁO ĐỘNG (NGUY HIỂM)';
            healthRatingColor = 'text-rose-600 bg-rose-50 border-rose-200';
        } else if (healthScore < 70) {
            healthRating = 'TRUNG BÌNH (CẦN CẢI THIỆN)';
            healthRatingColor = 'text-amber-600 bg-amber-50 border-amber-200';
        } else if (healthScore < 85) {
            healthRating = 'TỐT (AN TOÀN)';
            healthRatingColor = 'text-blue-600 bg-blue-50 border-blue-200';
        }

        res.json({
            success: true,
            data: {
                period,
                daysInPeriod,
                healthScore,
                healthRating,
                healthRatingColor,
                scores: {
                    operating: opScore,
                    cashflow: cashScore,
                    profitability: profitScore,
                    safety: safeScore
                },
                diagnostics: diagnosticNotes,
                advices: actionAdvices,
                
                capitalStructure: {
                    equity: {
                        initial_equity: initialEquity,
                        retained_earnings: retainedEarnings,
                        total_equity: totalEquity,
                        equity_ratio: totalAssets > 0 ? (totalEquity / totalAssets) * 100 : 0
                    },
                    liabilities: {
                        supplier_payable: totalPayable,
                        bank_debt_short: configs.bank_debt_short,
                        bank_debt_long: configs.bank_debt_long,
                        total_bank_debt: totalBankDebt,
                        customer_prepayments: customerPrepayments,
                        short_term_liabilities: shortTermLiabilities,
                        long_term_liabilities: longTermLiabilities,
                        total_liabilities: totalLiabilities,
                        liabilities_ratio: totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : 0
                    },
                    assets: {
                        cash: totalCash,
                        inventory: inventoryValue,
                        inventory_qty: inventoryQty,
                        total_products: totalProducts,
                        receivable: totalReceivable,
                        short_term_assets: shortTermAssets,
                        fixed_assets: fixedAssets,
                        total_assets: totalAssets
                    }
                },

                pnl: {
                    revenue,
                    cogs,
                    gross_profit: grossProfit,
                    gpm,
                    monthly_opex: configs.monthly_opex,
                    opex_in_period: opexInPeriod,
                    ebit,
                    ebit_margin: ebitMargin,
                    interest_expense: interestExpense,
                    ebt,
                    tax_rate: configs.tax_rate,
                    tax_expense: taxExpense,
                    net_profit: netProfit,
                    npm,
                    order_count: orderCount
                },

                indicators: {
                    operating: {
                        inventory_turnover: inventoryTurnover,
                        dio: dio,
                        dso: dso,
                        dpo: dpo
                    },
                    cashflow: {
                        dio: dio,
                        dso: dso,
                        dpo: dpo,
                        ccc: ccc,
                        is_negative: ccc < 0
                    },
                    profitability: {
                        gpm: gpm,
                        ebit: ebit,
                        ebit_margin: ebitMargin,
                        npm: npm,
                        roa: roa,
                        roe: roe
                    },
                    safety: {
                        current_ratio: currentRatio,
                        debt_to_equity: debtToEquity,
                        interest_coverage_ratio: icr
                    }
                },

                configs
            }
        });
    } catch (err) {
        console.error("Lỗi summary business-health:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// [POST] /api/business-health/config
// Cập nhật các tham số nguồn vốn và chi phí
router.post('/config', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const allowedKeys = [
            'initial_equity',
            'retained_earnings_accumulated',
            'bank_debt_short',
            'bank_debt_long',
            'bank_interest_rate',
            'monthly_opex',
            'fixed_assets',
            'tax_rate',
            'supplier_payable_override',
            'customer_prepayment_override'
        ];

        for (const key of allowedKeys) {
            if (req.body[key] !== undefined) {
                const val = String(req.body[key]).trim();
                await client.query(`
                    INSERT INTO business_health_config (config_key, config_value, updated_at)
                    VALUES ($1, $2, NOW())
                    ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()
                `, [key, val]);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true, message: 'Đã lưu cấu hình sức khỏe tài chính thành công!' });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Lỗi cập nhật config:", e);
        res.status(500).json({ success: false, error: e.message });
    } finally {
        client.release();
    }
});

module.exports = router;
