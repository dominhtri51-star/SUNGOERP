const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const aiService = require('../services/ai.service');

/**
 * POST /api/ai/chat
 * Xử lý tin nhắn đối thoại người dùng (qua text hoặc speech-to-text)
 */
router.post('/chat', async (req, res) => {
    try {
        const { message, sessionId, voiceMode } = req.body;
        
        if (!message || typeof message !== 'string' || !message.trim()) {
            return res.status(400).json({ success: false, error: 'Tin nhắn không được để trống!' });
        }

        const user = req.user || { id: null, role: 'ADMIN', full_name: 'Quản Trị Viên' };
        const finalSessionId = sessionId || ('sess_' + (user.id || 'guest') + '_' + Date.now());

        const result = await aiService.processChatMessage(
            user.id, 
            finalSessionId, 
            message.trim(), 
            user.role || 'ADMIN', 
            user
        );

        return res.json({
            success: true,
            sessionId: finalSessionId,
            reply: result.reply,
            card: result.card,
            action_type: result.action_type,
            quick_replies: result.quick_replies,
            voiceMode: !!voiceMode
        });
    } catch (err) {
        console.error('Lỗi API /api/ai/chat:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ai/history
 * Lấy lịch sử hội thoại gần nhất của phiên làm việc
 */
router.get('/history', async (req, res) => {
    try {
        const { sessionId } = req.query;
        if (!sessionId) {
            return res.json({ success: true, messages: [] });
        }

        const convRes = await pool.query(
            'SELECT id FROM ai_conversations WHERE session_id = $1 LIMIT 1',
            [sessionId]
        );

        if (convRes.rows.length === 0) {
            return res.json({ success: true, messages: [] });
        }

        const convId = convRes.rows[0].id;
        const msgRes = await pool.query(`
            SELECT id, sender, content, intent, action_type, action_data, created_at
            FROM ai_messages
            WHERE conversation_id = $1
            ORDER BY created_at ASC, id ASC
            LIMIT 50
        `, [convId]);

        return res.json({
            success: true,
            messages: msgRes.rows.map(m => ({
                id: m.id,
                sender: m.sender,
                content: m.content,
                intent: m.intent,
                action_type: m.action_type,
                card: m.action_data,
                created_at: m.created_at
            }))
        });
    } catch (err) {
        console.error('Lỗi API /api/ai/history:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/ai/reset
 * Làm mới phiên đối thoại và xóa bộ nhớ ngữ cảnh hiện tại
 */
router.post('/reset', async (req, res) => {
    try {
        const { sessionId } = req.body;
        if (sessionId) {
            await pool.query(
                `UPDATE ai_conversations 
                 SET context_state = '{}'::jsonb, updated_at = CURRENT_TIMESTAMP
                 WHERE session_id = $1`,
                [sessionId]
            );
        }
        return res.json({
            success: true,
            message: 'Đã làm mới ngữ cảnh hội thoại thành công!'
        });
    } catch (err) {
        console.error('Lỗi API /api/ai/reset:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ai/config
 * Lấy cấu hình trợ lý AI cho ứng dụng
 */
router.get('/config', async (req, res) => {
    try {
        const settingsRes = await pool.query(
            `SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('ai_gemini_key', 'ai_voice_enabled', 'ai_tts_speed')`
        );
        const map = {};
        settingsRes.rows.forEach(r => { map[r.setting_key] = r.setting_value; });

        return res.json({
            success: true,
            data: {
                has_gemini_key: !!(process.env.GEMINI_API_KEY || map.ai_gemini_key),
                voice_enabled: map.ai_voice_enabled !== 'false',
                tts_speed: parseFloat(map.ai_tts_speed) || 1.0,
                assistant_name: 'Trợ Lý SUNGO Google AI',
                provider: 'Google Gemini'
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/ai/config
 * Cấu hình API Key hoặc tham số AI (Dành cho Quản trị viên)
 */
router.post('/config', async (req, res) => {
    try {
        if (!req.user || !['ADMIN', 'SUPER_ADMIN', 'GIAM_DOC'].includes(String(req.user.role).toUpperCase())) {
            return res.status(403).json({ success: false, error: 'Chỉ Quản trị viên mới được cấu hình thông số AI!' });
        }

        const { gemini_key, voice_enabled, tts_speed } = req.body;

        if (gemini_key !== undefined) {
            await pool.query(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES ('ai_gemini_key', $1)
                 ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
                [gemini_key]
            );
        }

        if (voice_enabled !== undefined) {
            await pool.query(
                `INSERT INTO system_settings (setting_key, setting_value)
                 VALUES ('ai_voice_enabled', $1)
                 ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
                [String(voice_enabled)]
            );
        }

        return res.json({ success: true, message: 'Đã cập nhật cấu hình Trợ lý AI thành công!' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/ai/feedback
 * Ghi nhận đánh giá phản hồi (👍/👎) hoặc sửa đổi của người dùng để AI tự học
 */
router.post('/feedback', async (req, res) => {
    try {
        const { sessionId, userPrompt, aiGeneratedSku, aiGeneratedName, userCorrectedSku, userCorrectedName, correctionType, feedbackRating } = req.body;
        const user = req.user || {};

        await pool.query(`
            INSERT INTO ai_correction_logs (session_id, user_id, user_prompt, ai_generated_sku, ai_generated_name, user_corrected_sku, user_corrected_name, correction_type, feedback_rating)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            sessionId || null,
            user.id || null,
            userPrompt || '',
            aiGeneratedSku || null,
            aiGeneratedName || null,
            userCorrectedSku || null,
            userCorrectedName || null,
            correctionType || 'FEEDBACK',
            feedbackRating || 'UP'
        ]);

        return res.json({ success: true, message: 'Đã lưu phản hồi thành công! Dữ liệu sẽ dùng để huấn luyện và nâng cấp độ thông minh của AI.' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ai/rules
 * Lấy danh sách quy tắc kinh doanh đang hoạt động
 */
router.get('/rules', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ai_business_rules ORDER BY id ASC');
        return res.json({ success: true, data: result.rows });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/ai/rules
 * Thêm hoặc cập nhật quy tắc kinh doanh
 */
router.post('/rules', async (req, res) => {
    try {
        const { rule_code, rule_name, rule_condition, rule_action, is_active } = req.body;
        if (!rule_code || !rule_name) {
            return res.status(400).json({ success: false, error: 'Thiếu mã hoặc tên quy tắc!' });
        }
        await pool.query(`
            INSERT INTO ai_business_rules (rule_code, rule_name, rule_condition, rule_action, is_active)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (rule_code) DO UPDATE 
            SET rule_name = EXCLUDED.rule_name,
                rule_condition = EXCLUDED.rule_condition,
                rule_action = EXCLUDED.rule_action,
                is_active = EXCLUDED.is_active
        `, [rule_code, rule_name, rule_condition || '', rule_action || '', is_active !== false]);

        return res.json({ success: true, message: 'Đã lưu quy tắc nghiệp vụ thành công!' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
