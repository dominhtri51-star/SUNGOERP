/**
 * =========================================================================
 * SUNGO ERP - TRỢ LÝ AI DOANH NGHIỆP THÔNG MINH (AI ASSISTANT WIDGET)
 * 
 * - Đối thoại 2 chiều: Ghi âm giọng nói (STT) & Phản hồi bằng giọng đọc (TTS) vi-VN
 * - Ghi nhớ ngữ cảnh đa lượt (Multi-turn Context Memory)
 * - Tường lửa phân quyền nhân viên theo RBAC
 * - Thẻ tương tác nghiệp vụ chuyên nghiệp (14 Hành động cốt lõi)
 * =========================================================================
 */

(function () {
    // Khởi tạo trạng thái Trợ lý AI
    const state = {
        isOpen: false,
        isRecording: false,
        isSpeaking: false,
        voiceEnabled: true,
        sessionId: localStorage.getItem('sungo_ai_session_id') || ('sess_' + Date.now()),
        messages: [],
        recognition: null,
        synth: window.speechSynthesis || null,
        currentUtterance: null,
        userRole: 'GUEST'
    };

    // Lưu sessionId
    localStorage.setItem('sungo_ai_session_id', state.sessionId);

    // Lấy thông tin người dùng đang đăng nhập
    function getCurrentUser() {
        try {
            const token = localStorage.getItem('sungo_token');
            const rawUser = localStorage.getItem('sungo_user');
            if (!token || !rawUser) {
                return { id: null, role: 'GUEST', name: 'Khách', isGuest: true };
            }
            const u = JSON.parse(rawUser);
            if (!u || !u.id) {
                return { id: null, role: 'GUEST', name: 'Khách', isGuest: true };
            }
            return { ...u, isGuest: false };
        } catch (e) {
            return { id: null, role: 'GUEST', name: 'Khách', isGuest: true };
        }
    }

    // Tiền xử lý âm vị học giọng nói Solar trên Giao diện (Frontend Voice STT Normalizer)
    function cleanSpeechTranscript(text) {
        if (!text) return '';
        let str = String(text);
        // Nhận diện chuẩn xác thương hiệu biến tần & pin từ phiên âm giọng nói
        str = str.replace(/(?:lung\s+linh\s+chi|lưu\s+minh\s+chi|luu\s+minh\s+chi|lemon\s+tree|lemon\s+tri|lumen\s+tri|lumen\s+tree|lumentri|lumen\s+tre)/gi, 'Lumentree');
        str = str.replace(/(?:đầy\s+e|đê\s+e|đây\s+e|đề\s+e|de\s+ye|đê\s+dê)/gi, 'Deye');
        str = str.replace(/(?:sô\s+lít|so\s+lit|xô\s+lít|xo\s+lit|sô\s+li)/gi, 'Solis');
        str = str.replace(/(?:lúc\s+pao\s+quơ|lúc\s+pao|lắc\s+pao|luc\s+pao|lắc\s+pao\s+uơ)/gi, 'Luxpower');
        str = str.replace(/(?:gờ\s+rô\s+oat|gơ\s+rô\s+wat|gô\s+gát|gro\s+oat|gờ\s+rô\s+wat)/gi, 'Growatt');
        str = str.replace(/(?:hua\s+way|hoa\s+vĩ|hu\s+oa\s+oay|hua\s+oay)/gi, 'Huawei');
        str = str.replace(/(?:sun\s+gâu|sun\s+gờ\s+rô|săn\s+gâu)/gi, 'Sungrow');
        str = str.replace(/(?:jin\s+cô|gin\s+cô|din\s+cô|jinkosolar)/gi, 'Jinko');
        str = str.replace(/(?:lon\s+gi|long\s+gi|longji)/gi, 'Longi');
        str = str.replace(/(?:a\s+pét|a\s+bét|a\s+pếch|apec|a\s+péc)/gi, 'Apess');
        str = str.replace(/(?:ca\s+na\s+đi\s+an|ca\s+na\s+đa|canadain)/gi, 'Canadian');
        str = str.replace(/(?:gút\s+we|gút\s+guê)/gi, 'Goodwe');
        str = str.replace(/(?:sô\s+pha|so\s+fa)/gi, 'Sofar');

        // Phục hồi dấu phẩy thập phân khi mic nuốt dấu
        str = str.replace(/\b66\s*(?:kw|kilo\s*watt)\b/gi, '6.6kW');
        str = str.replace(/\b65\s*(?:kw|kilo\s*watt)\b/gi, '6.5kW');
        str = str.replace(/\b62\s*(?:kw|kilo\s*watt)\b/gi, '6.2kW');
        str = str.replace(/\b55\s*(?:kw|kilo\s*watt)\b/gi, '5.5kW');
        str = str.replace(/\b153\s*(?:kwh)\b/gi, '15.3kWh');
        str = str.replace(/\b512\s*(?:kwh)\b/gi, '5.12kWh');
        str = str.replace(/\b143\s*(?:kwh)\b/gi, '14.3kWh');
        return str;
    }

    // Khởi tạo Web Speech Recognition (Ghi âm giọng nói Tiếng Việt)
    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('⚠️ Trình duyệt không hỗ trợ Web Speech API nhận diện giọng nói!');
            return null;
        }

        try {
            const recog = new SpeechRecognition();
            recog.lang = 'vi-VN';
            recog.continuous = false;
            recog.interimResults = true;
            recog.maxAlternatives = 1;

            recog.onstart = function () {
                state.isRecording = true;
                updateMicUI();
            };

            recog.onresult = function (event) {
                let interimTranscript = '';
                let finalTranscript = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }
                const inputEl = document.getElementById('sungo-ai-input');
                if (inputEl) {
                    const raw = finalTranscript || interimTranscript;
                    inputEl.value = cleanSpeechTranscript(raw);
                }
            };

            recog.onerror = function (event) {
                console.warn('Speech recognition error:', event.error);
                state.isRecording = false;
                updateMicUI();
                if (event.error === 'not-allowed') {
                    showToast('⚠️ Vui lòng cấp quyền truy cập Microphone trên trình duyệt để ghi âm!', 'error');
                }
            };

            recog.onend = function () {
                state.isRecording = false;
                updateMicUI();
                const inputEl = document.getElementById('sungo-ai-input');
                if (inputEl && inputEl.value.trim().length > 1) {
                    const cleanVal = cleanSpeechTranscript(inputEl.value.trim());
                    inputEl.value = cleanVal;
                    sendMessage(cleanVal, true);
                }
            };

            return recog;
        } catch (e) {
            console.error('Lỗi khởi tạo SpeechRecognition:', e);
            return null;
        }
    }

    state.recognition = initSpeechRecognition();

    // Bật/Tắt ghi âm
    function toggleRecording() {
        if (!state.recognition) {
            showToast('⚠️ Trình duyệt của bạn không hỗ trợ tính năng Ghi âm giọng nói!', 'warning');
            return;
        }

        if (state.isSpeaking) {
            stopSpeaking();
        }

        if (state.isRecording) {
            state.recognition.stop();
        } else {
            try {
                const inputEl = document.getElementById('sungo-ai-input');
                if (inputEl) inputEl.value = '';
                state.recognition.start();
            } catch (err) {
                console.warn('Start recognition error:', err);
            }
        }
    }

    function updateMicUI() {
        const btn = document.getElementById('sungo-ai-mic-btn');
        const wave = document.getElementById('sungo-ai-wave-indicator');
        if (!btn) return;

        if (state.isRecording) {
            btn.classList.add('bg-red-600', 'text-white', 'animate-pulse');
            btn.classList.remove('bg-slate-800', 'text-amber-400');
            if (wave) wave.classList.remove('hidden');
        } else {
            btn.classList.remove('bg-red-600', 'text-white', 'animate-pulse');
            btn.classList.add('bg-slate-800', 'text-amber-400');
            if (wave) wave.classList.add('hidden');
        }
    }

    // Phát âm thanh phản hồi (Text-to-Speech Tiếng Việt Tốc Độ x2, Ngắn Gọn)
    function speakText(text) {
        if (!state.voiceEnabled || !state.synth) return;

        stopSpeaking();

        // Làm sạch Markdown và lược bỏ câu dư thừa trước khi đọc
        let cleanText = text
            .replace(/\*\*/g, '')
            .replace(/\*/g, '')
            .replace(/#{1,6}\s?/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/`[^`]+`/g, '')
            .replace(/[-•]\s/g, ', ')
            .replace(/👉|💬|⚠️|📦|📑|🛒|📊|🔍|📄|💰|🏆|⭐|🏥|👥|🎉/g, '')
            .trim();

        if (!cleanText) return;

        // Nếu nội dung dài, chỉ đọc câu tóm tắt trọng tâm
        if (cleanText.includes('Xác nhận') || cleanText.includes('Bản Nháp')) {
            const lines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length > 2) {
                cleanText = lines.slice(0, 4).join('. ');
            }
        }

        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.lang = 'vi-VN';
        utterance.rate = 1.85; // Tốc độ đọc x2 theo yêu cầu
        utterance.pitch = 1.0;

        // Chọn giọng đọc tiếng Việt nếu có
        const voices = state.synth.getVoices();
        const viVoice = voices.find(v => v.lang && v.lang.startsWith('vi'));
        if (viVoice) utterance.voice = viVoice;

        utterance.onstart = function () {
            state.isSpeaking = true;
            updateSpeakerUI();
        };

        utterance.onend = function () {
            state.isSpeaking = false;
            updateSpeakerUI();
        };

        utterance.onerror = function () {
            state.isSpeaking = false;
            updateSpeakerUI();
        };

        state.currentUtterance = utterance;
        state.synth.speak(utterance);
    }

    function stopSpeaking() {
        if (state.synth) {
            state.synth.cancel();
        }
        state.isSpeaking = false;
        updateSpeakerUI();
    }

    function updateSpeakerUI() {
        const stopBtn = document.getElementById('sungo-ai-stop-speech-btn');
        if (stopBtn) {
            if (state.isSpeaking) {
                stopBtn.classList.remove('hidden');
            } else {
                stopBtn.classList.add('hidden');
            }
        }
    }

    // Hiển thị thông báo nhỏ
    function showToast(msg, type = 'info') {
        const container = document.getElementById('notif-toast-container') || document.body;
        const toast = document.createElement('div');
        toast.className = `fixed bottom-24 right-6 z-[99999] px-4 py-3 rounded-2xl text-xs font-bold text-white shadow-2xl transition-all duration-300 transform translate-y-2 opacity-0 flex items-center gap-2 ${
            type === 'error' ? 'bg-red-600' : (type === 'warning' ? 'bg-amber-600' : 'bg-slate-900')
        }`;
        toast.innerHTML = `<span>${msg}</span>`;
        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.remove('translate-y-2', 'opacity-0');
        });

        setTimeout(() => {
            toast.classList.add('opacity-0', 'translate-y-2');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Markdown Parser đơn giản
    function formatMarkdown(text) {
        if (!text) return '';
        let html = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // In đậm **text**
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong class="text-amber-400 font-bold">$1</strong>');
        // In nghiêng *text*
        html = html.replace(/\*(.*?)\*/g, '<em class="text-slate-300">$1</em>');
        // Dấu gạch đầu dòng
        html = html.replace(/^[•\-]\s*(.*)$/gm, '<li class="ml-4 list-disc text-slate-200">$1</li>');
        // Xuống dòng
        html = html.replace(/\n/g, '<br/>');

        return html;
    }

    // Render Thẻ Tương Tác Nghiệp Vụ (Action Cards)
    function renderCard(card) {
        if (!card || typeof card !== 'object') return '';

        switch (card.type) {
            case 'ORDER_CARD':
                return `
                    <div class="mt-3 bg-slate-900/90 border border-amber-500/40 rounded-2xl p-4 shadow-xl">
                        <div class="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div class="flex items-center gap-2">
                                <span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                                <h4 class="font-black text-white text-xs tracking-wide">${card.title}</h4>
                            </div>
                            <span class="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] font-bold">${card.status}</span>
                        </div>
                        <div class="mt-2.5 space-y-1.5 text-xs text-slate-300">
                            <div class="flex justify-between"><span class="text-slate-400">Khách hàng:</span> <strong class="text-white">${card.customer}</strong></div>
                            <div class="flex justify-between"><span class="text-slate-400">Số điện thoại:</span> <span>${card.phone}</span></div>
                            <div class="flex justify-between pt-1 border-t border-slate-800 font-bold text-amber-400">
                                <span>Tổng tiền:</span> <span class="text-sm">${card.total_amount}</span>
                            </div>
                        </div>
                        <div class="mt-3 pt-2 flex gap-2">
                            <button onclick="window.loadModule && window.loadModule('order-history')" class="flex-1 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
                                <i class="fas fa-external-link-alt text-[10px]"></i> Xem Đơn Hàng
                            </button>
                        </div>
                    </div>
                `;

            case 'DRAFT_ORDER_CARD': {
                const isSale = card.order_type === 'SALE';
                const borderColor = isSale ? 'border-amber-500/50' : 'border-indigo-500/50';
                const tagBg = isSale ? 'bg-amber-500/20 text-amber-300' : 'bg-indigo-500/20 text-indigo-300';
                const tagText = isSale ? 'BÁN HÀNG (SO)' : 'MUA HÀNG (PO)';
                const btnConfirmBg = isSale ? 'bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 hover:brightness-110' : 'bg-gradient-to-r from-indigo-500 to-indigo-600 text-white hover:brightness-110';
                const items = (card.items && card.items.length > 0) ? card.items : [{}];
                const rawWarnings = [
                    ...(card.warnings || []),
                    card.floor_price_warning,
                    card.debt_warning,
                    card.atp_warning,
                    card.tech_tip,
                    card.compat_warning
                ].filter(Boolean);
                const warnings = Array.from(new Set(rawWarnings));

                const itemsHtml = items.map((item, idx) => `
                    <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80 space-y-1.5">
                        <div class="text-slate-300 font-bold flex items-center justify-between">
                            <span class="truncate max-w-[210px] text-white">${items.length > 1 ? (idx + 1) + '. ' : ''}${item.name || 'Thiết bị'}</span>
                            <span class="text-[11px] text-amber-400 font-mono">${item.sku ? '[' + item.sku + ']' : ''}</span>
                        </div>
                        <div class="flex justify-between text-[11px] text-slate-400">
                            <span>Số lượng: <strong class="text-emerald-400">${item.qty || 1} ${item.unit || 'Bộ'}</strong></span>
                            <span>Đơn giá: <strong class="text-slate-200">${item.price || '0đ'}</strong></span>
                        </div>
                        ${items.length > 1 ? `
                            <div class="flex justify-between text-[11px] font-semibold text-slate-300 pt-0.5 border-t border-slate-800/60">
                                <span>Thành tiền:</span>
                                <span class="text-amber-400 font-mono">${item.total || '0đ'}</span>
                            </div>
                        ` : ''}
                        ${item.stock_warning ? `
                            <div class="text-[10px] text-amber-300 bg-amber-500/10 p-1 rounded border border-amber-500/30 flex items-center gap-1">
                                <i class="fas fa-exclamation-triangle text-amber-400"></i> ${item.stock_warning}
                            </div>
                        ` : ''}
                        ${item.price_warning ? `
                            <div class="text-[10px] text-rose-300 bg-rose-500/10 p-1 rounded border border-rose-500/30 flex items-center gap-1">
                                <i class="fas fa-exclamation-circle text-rose-400"></i> ${item.price_warning}
                            </div>
                        ` : ''}
                    </div>
                `).join('');

                const warningsHtml = warnings.map(w => {
                    const isDanger = /CÔNG NỢ|GIÁ SÀN|thiếu hàng|hết hàng/i.test(w);
                    const isTip = /DC\/AC|TƯ VẤN/i.test(w);
                    const borderCls = isDanger ? 'border-rose-500/40 bg-rose-500/15 text-rose-300' : isTip ? 'border-blue-500/40 bg-blue-500/15 text-blue-300' : 'border-amber-500/40 bg-amber-500/15 text-amber-300';
                    const iconCls = isDanger ? 'fa-exclamation-circle text-rose-400' : isTip ? 'fa-lightbulb text-blue-400' : 'fa-exclamation-triangle text-amber-400';
                    return `
                        <div class="text-[11px] p-2 rounded-xl border flex items-start gap-1.5 ${borderCls}">
                            <i class="fas ${iconCls} mt-0.5 shrink-0"></i>
                            <span>${w}</span>
                        </div>
                    `;
                }).join('');

                return `
                    <div class="mt-3 bg-slate-900/95 border-2 ${borderColor} rounded-2xl p-4 shadow-2xl relative overflow-hidden">
                        <div class="absolute -right-8 -top-8 w-24 h-24 ${isSale ? 'bg-amber-500/10' : 'bg-indigo-500/10'} rounded-full blur-xl pointer-events-none"></div>
                        
                        <div class="flex items-center justify-between pb-2.5 border-b border-slate-800">
                            <div class="flex items-center gap-2">
                                <span class="w-2.5 h-2.5 rounded-full ${isSale ? 'bg-amber-400' : 'bg-indigo-400'} animate-ping"></span>
                                <h4 class="font-black text-white text-xs tracking-wide uppercase">${card.title || 'Bản Xem Trước'}</h4>
                            </div>
                            <span class="px-2.5 py-0.5 rounded-full ${tagBg} text-[10px] font-black tracking-wider">${tagText}</span>
                        </div>

                        <div class="mt-3 space-y-2 text-xs">
                            <div class="bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80 space-y-1.5">
                                <div class="flex justify-between items-center">
                                    <span class="text-slate-400 font-medium">${card.partner_label || (isSale ? 'Khách hàng' : 'Nhà cung cấp')}:</span>
                                    <strong class="text-white text-right">${card.partner_name || 'Chưa rõ'} ${card.partner_code ? '<span class="text-amber-400 font-mono text-[10px]">[' + card.partner_code + ']</span>' : ''}</strong>
                                </div>
                                ${card.partner_phone ? `
                                    <div class="flex justify-between items-center text-[11px]">
                                        <span class="text-slate-400">Số điện thoại:</span>
                                        <span class="text-slate-200 font-mono">${card.partner_phone}</span>
                                    </div>
                                ` : ''}
                            </div>

                            <div class="space-y-1.5">
                                ${itemsHtml}
                            </div>

                            <div class="bg-slate-950/90 p-2.5 rounded-xl border border-slate-800 flex justify-between items-center font-bold ${isSale ? 'text-amber-400' : 'text-indigo-400'}">
                                <span>Tổng cộng:</span>
                                <span class="text-base font-black font-mono">${card.total_amount || '0đ'}</span>
                            </div>

                            ${warningsHtml}

                            ${card.notes ? `
                                <div class="text-[11px] text-slate-400 italic bg-slate-950/40 px-2.5 py-1.5 rounded-lg border border-slate-800/50">
                                    <i class="fas fa-info-circle mr-1"></i> Ghi chú: ${card.notes}
                                </div>
                            ` : ''}

                            <div class="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 font-medium text-center">
                                💬 <em>Đúng thông tin chưa anh/chị? Cần sửa gì hay Tạo đơn ngay?</em>
                            </div>
                        </div>

                        <!-- Action Buttons -->
                        <div class="mt-3 space-y-2">
                            <!-- Quick Delta Buttons [-1] [+1] [+5] -->
                            <div class="flex items-center justify-between gap-1 bg-slate-950/80 p-1.5 rounded-xl border border-slate-800">
                                <span class="text-[10px] text-slate-400 pl-1 font-medium">Chỉnh nhanh:</span>
                                <div class="flex gap-1.5">
                                    <button onclick="window.SungoAI.ask('-1')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold transition active:scale-95 cursor-pointer">-1</button>
                                    <button onclick="window.SungoAI.ask('+1')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold transition active:scale-95 cursor-pointer">+1</button>
                                    <button onclick="window.SungoAI.ask('+5')" class="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold transition active:scale-95 cursor-pointer">+5</button>
                                </div>
                                <button onclick="window.SungoAI.ask('Đổi số lượng')" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px] font-bold transition active:scale-95 cursor-pointer">Sửa số khác</button>
                            </div>

                            <button onclick="window.SungoAI.ask('Xác nhận tạo đơn')" class="w-full ${btnConfirmBg} font-black py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-lg shadow-amber-500/20 active:scale-95">
                                <i class="fas fa-check-circle text-sm"></i> Xác Nhận Tạo Đơn
                            </button>
                            <div class="flex gap-2">
                                <button onclick="window.loadModule && window.loadModule('${isSale ? 'sales' : 'purchases'}')" class="flex-1 bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 font-medium py-2 rounded-xl text-[11px] flex items-center justify-center gap-1 transition cursor-pointer active:scale-95" title="Mở form tạo đơn trên màn hình">
                                    <i class="fas fa-edit text-[10px]"></i> Mở Form Nhập Tay
                                </button>
                                <button onclick="window.SungoAI.ask('Hủy bỏ đơn này')" class="flex-1 bg-red-950/50 hover:bg-red-900/60 text-red-300 border border-red-500/30 font-bold py-2 rounded-xl text-[11px] flex items-center justify-center gap-1 transition cursor-pointer active:scale-95">
                                    <i class="fas fa-times-circle text-[10px]"></i> Hủy Đơn
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }

            case 'PURCHASE_CARD':
                return `
                    <div class="mt-3 bg-slate-900/90 border border-indigo-500/40 rounded-2xl p-4 shadow-xl">
                        <div class="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div class="flex items-center gap-2">
                                <span class="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse"></span>
                                <h4 class="font-black text-white text-xs tracking-wide">${card.title}</h4>
                            </div>
                            <span class="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-bold">${card.status}</span>
                        </div>
                        <div class="mt-2.5 space-y-1.5 text-xs text-slate-300">
                            <div class="flex justify-between"><span class="text-slate-400">Nhà cung cấp:</span> <strong class="text-white">${card.supplier}</strong></div>
                            <div class="flex justify-between"><span class="text-slate-400">Số lượng đặt:</span> <span class="text-emerald-400 font-bold">${card.quantity}</span></div>
                            <div class="flex justify-between pt-1 border-t border-slate-800 font-bold text-indigo-400">
                                <span>Tổng chi phí:</span> <span class="text-sm">${card.total_cost}</span>
                            </div>
                        </div>
                        <div class="mt-3 pt-2 flex gap-2">
                            <button onclick="window.loadModule && window.loadModule('purchases')" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
                                <i class="fas fa-external-link-alt text-[10px]"></i> Xem Danh Sách Đơn Mua
                            </button>
                        </div>
                    </div>
                `;

            case 'PRODUCT_CARD':
                return `
                    <div class="mt-3 bg-slate-900/90 border border-blue-500/40 rounded-2xl p-4 shadow-xl">
                        <div class="flex items-center justify-between pb-2 border-b border-slate-800">
                            <h4 class="font-black text-white text-xs truncate max-w-[200px]">${card.title}</h4>
                            <span class="px-2 py-0.5 rounded-md bg-blue-500/20 text-blue-300 text-[10px] font-bold">${card.sku}</span>
                        </div>
                        <div class="mt-2.5 space-y-1 text-xs text-slate-300">
                            <div class="flex justify-between"><span class="text-slate-400">Danh mục:</span> <span class="text-slate-200">${card.category}</span></div>
                            <div class="flex justify-between"><span class="text-slate-400">Tồn kho ban đầu:</span> <span class="text-emerald-400 font-bold">${card.stock}</span></div>
                            <div class="flex justify-between pt-1 border-t border-slate-800 font-bold text-amber-400">
                                <span>Giá niêm yết:</span> <span class="text-sm">${card.price}</span>
                            </div>
                        </div>
                        <div class="mt-3 pt-2">
                            <button onclick="window.loadModule && window.loadModule('admin-products')" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
                                <i class="fas fa-boxes text-[10px]"></i> Xem Danh Mục Sản Phẩm
                            </button>
                        </div>
                    </div>
                `;

            case 'QUOTATION_CARD':
                return `
                    <div class="mt-3 bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-4 shadow-xl">
                        <div class="flex items-center justify-between pb-2 border-b border-slate-800">
                            <h4 class="font-black text-white text-xs">${card.title}</h4>
                            <span class="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold">${card.system_type}</span>
                        </div>
                        <div class="mt-2.5 space-y-1 text-xs text-slate-300">
                            <div class="flex justify-between"><span class="text-slate-400">Khách hàng:</span> <strong class="text-white">${card.customer}</strong></div>
                            <div class="flex justify-between"><span class="text-slate-400">Công suất:</span> <span class="text-amber-400 font-bold">${card.system_kwp}</span></div>
                            <div class="flex justify-between pt-1 border-t border-slate-800 font-bold text-emerald-400">
                                <span>Giá trị báo giá:</span> <span class="text-sm">${card.total_amount}</span>
                            </div>
                        </div>
                        <div class="mt-3 pt-2 flex gap-2">
                            <button onclick="window.loadModule && window.loadModule('boq-list')" class="flex-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
                                <i class="fas fa-file-invoice text-[10px]"></i> Mở Danh Sách BOQ
                            </button>
                        </div>
                    </div>
                `;

            case 'PRODUCT_DOCS_CARD':
                return `
                    <div class="mt-3 bg-slate-900/90 border border-cyan-500/40 rounded-2xl p-4 shadow-xl">
                        <div class="flex items-center justify-between pb-2 border-b border-slate-800">
                            <h4 class="font-black text-white text-xs truncate max-w-[200px]">${card.title}</h4>
                            <span class="text-[10px] text-amber-400 font-bold">${card.price}</span>
                        </div>
                        <div class="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <a href="${card.datasheet_url}" target="_blank" class="bg-slate-800 hover:bg-slate-700 text-cyan-300 py-2 px-2.5 rounded-xl flex items-center justify-center gap-1.5 font-bold transition">
                                <i class="fas fa-file-pdf"></i> Tải Datasheet
                            </a>
                            <a href="${card.catalog_url}" target="_blank" class="bg-slate-800 hover:bg-slate-700 text-amber-300 py-2 px-2.5 rounded-xl flex items-center justify-center gap-1.5 font-bold transition">
                                <i class="fas fa-book-open"></i> Tải Catalog
                            </a>
                        </div>
                        <div class="mt-3 pt-2">
                            <button onclick="window.SungoAI.copyZaloMessage(${JSON.stringify(card.zalo_message).replace(/"/g, '&quot;')})" class="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-black py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 transition cursor-pointer shadow-md">
                                <i class="fas fa-copy"></i> Sao Chép Mẫu Tin Gửi Zalo Cho Khách
                            </button>
                        </div>
                    </div>
                `;

            case 'BUSINESS_HEALTH_CARD':
                return `
                    <div class="mt-3 bg-slate-900/90 border border-${card.color}-500/50 rounded-2xl p-4 shadow-xl">
                        <div class="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div class="flex items-center gap-2">
                                <i class="fas fa-heartbeat text-${card.color}-400"></i>
                                <h4 class="font-black text-white text-xs">Sức Khỏe Doanh Nghiệp</h4>
                            </div>
                            <span class="px-2.5 py-0.5 rounded-full bg-${card.color}-500/20 text-${card.color}-400 text-[10px] font-black">${card.status}</span>
                        </div>
                        <div class="mt-2.5 grid grid-cols-2 gap-2 text-xs">
                            <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                                <span class="text-[10px] text-slate-400 block">Tiền mặt & Quỹ</span>
                                <strong class="text-emerald-400 text-xs">${card.cash}</strong>
                            </div>
                            <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                                <span class="text-[10px] text-slate-400 block">Công nợ 131</span>
                                <strong class="text-amber-400 text-xs">${card.receivables}</strong>
                            </div>
                            <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                                <span class="text-[10px] text-slate-400 block">Giá trị tồn kho</span>
                                <strong class="text-cyan-400 text-xs">${card.inventory}</strong>
                            </div>
                            <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                                <span class="text-[10px] text-slate-400 block">Current Ratio</span>
                                <strong class="text-purple-400 text-xs">${card.current_ratio}x</strong>
                            </div>
                        </div>
                        <div class="mt-3 pt-2">
                            <button onclick="window.loadModule && window.loadModule('business-health')" class="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
                                <i class="fas fa-chart-line text-[10px]"></i> Mở Báo Cáo Tài Chính CFO
                            </button>
                        </div>
                    </div>
                `;

            case 'CONTRACT_CARD':
                return `
                    <div class="mt-3 bg-slate-900/90 border border-purple-500/40 rounded-2xl p-4 shadow-xl">
                        <div class="flex items-center justify-between pb-2 border-b border-slate-800">
                            <h4 class="font-black text-white text-xs">${card.title}</h4>
                            <span class="px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 text-[10px] font-bold">${card.status}</span>
                        </div>
                        <div class="mt-2.5 space-y-1 text-xs text-slate-300">
                            <div class="flex justify-between"><span class="text-slate-400">Khách hàng:</span> <strong class="text-white">${card.customer}</strong></div>
                            <div class="flex justify-between pt-1 border-t border-slate-800 font-bold text-purple-400">
                                <span>Giá trị hợp đồng:</span> <span class="text-sm">${card.total_value}</span>
                            </div>
                        </div>
                        <div class="mt-3 pt-2 flex gap-2">
                            <a href="${card.sign_url}" target="_blank" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white font-black py-2 rounded-xl text-xs flex items-center justify-center gap-1.5 transition cursor-pointer">
                                <i class="fas fa-signature text-[10px]"></i> Cổng Ký Hợp Đồng
                            </a>
                        </div>
                    </div>
                `;

            case 'WARRANTY_CARD':
                return `
                    <div class="mt-3 bg-slate-900/90 border border-emerald-500/40 rounded-2xl p-4 shadow-xl">
                        <div class="flex items-center justify-between pb-2 border-b border-slate-800">
                            <div class="flex items-center gap-2">
                                <i class="fas fa-shield-alt text-emerald-400"></i>
                                <h4 class="font-black text-white text-xs">Mã Serial: ${card.serial}</h4>
                            </div>
                            <span class="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-black">${card.status}</span>
                        </div>
                        <div class="mt-2.5 space-y-1 text-xs text-slate-300">
                            <div class="flex justify-between"><span class="text-slate-400">Thiết bị:</span> <strong class="text-white truncate max-w-[180px]">${card.product_name}</strong></div>
                            <div class="flex justify-between"><span class="text-slate-400">Hạn bảo hành:</span> <span>${card.expiry_date}</span></div>
                            <div class="flex justify-between font-bold text-emerald-400">
                                <span>Thời gian còn lại:</span> <span>${card.days_remaining}</span>
                            </div>
                        </div>
                    </div>
                `;

            case 'PERMISSION_DENIED_CARD':
                return `
                    <div class="mt-3 bg-red-950/40 border border-red-500/50 rounded-2xl p-3.5 shadow-xl flex items-start gap-3">
                        <div class="w-8 h-8 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center shrink-0 mt-0.5">
                            <i class="fas fa-user-lock text-sm"></i>
                        </div>
                        <div class="text-xs">
                            <h5 class="font-bold text-red-300">Tường Lửa Phân Quyền (RBAC)</h5>
                            <p class="text-slate-300 mt-0.5">${card.message}</p>
                            <span class="inline-block mt-1 px-2 py-0.5 rounded bg-red-500/20 text-red-200 text-[10px] font-mono font-bold">Role: ${card.role}</span>
                        </div>
                    </div>
                `;

            default:
                return '';
        }
    }

    // Gửi tin nhắn đến API backend
    async function sendMessage(text, fromVoice = false) {
        if (!text || !text.trim()) return;

        const chatBody = document.getElementById('sungo-ai-chat-body');
        const inputEl = document.getElementById('sungo-ai-input');
        if (inputEl) inputEl.value = '';

        // Hiển thị tin nhắn người dùng lên khung chat
        appendMessage('user', text);

        // Hiệu ứng đang suy nghĩ (typing indicator)
        const typingId = 'typing-' + Date.now();
        appendTypingIndicator(typingId);

        // Hỗ trợ người dùng bấm nút "Đăng nhập hệ thống"
        const currentUser = getCurrentUser();
        const norm = text.toLowerCase().trim();
        if (currentUser.isGuest && (norm === 'dang nhap he thong' || norm === 'đăng nhập hệ thống' || norm === 'dang nhap' || norm === 'đăng nhập')) {
            removeTypingIndicator(typingId);
            const userInput = document.getElementById('username') || document.querySelector('input[name="username"]') || document.querySelector('input[type="text"]');
            if (userInput && (window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || document.getElementById('btn-login'))) {
                userInput.focus();
                userInput.classList.add('ring-2', 'ring-amber-500');
                setTimeout(() => userInput.classList.remove('ring-2', 'ring-amber-500'), 2500);
                appendMessage('assistant', '👉 Vui lòng nhập Tên đăng nhập và Mật khẩu ở khung bên cạnh để đăng nhập vào hệ thống SUNGO ERP.');
                return;
            } else {
                appendMessage('assistant', '🔄 Đang chuyển hướng bạn đến trang đăng nhập SUNGO ERP...');
                setTimeout(() => { window.location.href = '/index.html'; }, 800);
                return;
            }
        }

        try {
            let token = localStorage.getItem('sungo_token');
            if (!token) {
                try {
                    const u = JSON.parse(localStorage.getItem('sungo_user') || '{}');
                    token = u.token || '';
                } catch (e) {}
            }

            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({
                    message: text,
                    sessionId: state.sessionId,
                    voiceMode: fromVoice
                })
            });

            const data = await res.json();
            removeTypingIndicator(typingId);

            if (data.success) {
                appendMessage('assistant', data.reply, data.card, data.thought);
                renderQuickReplies(data.quick_replies);

                // Nếu bật giọng đọc hoặc gửi bằng giọng nói -> Tự động phát phản hồi
                if (state.voiceEnabled || fromVoice) {
                    speakText(data.reply);
                }
            } else {
                appendMessage('assistant', `⚠️ Lỗi: ${data.error || 'Không thể kết nối máy chủ AI'}`);
            }
        } catch (err) {
            removeTypingIndicator(typingId);
            appendMessage('assistant', '⚠️ Mất kết nối đến máy chủ ERP! Vui lòng thử lại sau.');
        }
    }

    function safeEscapeHtml(text) {
        if (typeof window.escapeHtml === 'function') return window.escapeHtml(text);
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function appendMessage(sender, content, card = null, thought = null) {
        const chatBody = document.getElementById('sungo-ai-chat-body');
        if (!chatBody) return;

        const isUser = sender === 'user';
        const msgWrapper = document.createElement('div');
        msgWrapper.className = `flex gap-2.5 ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in`;

        const avatar = isUser
            ? `<div class="w-8 h-8 rounded-xl bg-amber-500 text-slate-950 font-black text-xs flex items-center justify-center shrink-0 shadow-md">BẠN</div>`
            : `<div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-600 text-slate-950 font-black text-xs flex items-center justify-center shrink-0 shadow-md"><i class="fas fa-robot"></i></div>`;

        const bubble = document.createElement('div');
        bubble.className = `max-w-[85%] sm:max-w-[78%] rounded-2xl p-3.5 text-xs shadow-md leading-relaxed ${
            isUser
                ? 'bg-amber-500 text-slate-950 font-semibold rounded-tr-xs'
                : 'bg-slate-800/90 text-slate-200 border border-slate-700/80 rounded-tl-xs backdrop-blur-md'
        }`;

        const latencyInfo = thought && thought.latency_breakdown
            ? `<span class="text-[9px] font-mono text-slate-400 font-normal">(${thought.latency_breakdown.total_ms}ms · NLU: ${thought.latency_breakdown.nlu_ms}ms)</span>`
            : (thought && thought.latency_ms ? `<span class="text-[9px] font-mono text-slate-400 font-normal">(${thought.latency_ms}ms)</span>` : '');

        const feedbackBar = !isUser ? `
            <div class="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-700/60 text-[10px] text-slate-400">
                <span class="text-slate-400 flex items-center gap-1"><i class="fas fa-brain text-amber-400"></i> Copilot ReAct Engine ${latencyInfo}</span>
                <div class="flex items-center gap-2.5 ai-feedback-actions">
                    <button class="ai-rate-btn hover:text-emerald-400 transition" data-rating="UP" title="Phản hồi chính xác"><i class="far fa-thumbs-up"></i></button>
                    <button class="ai-rate-btn hover:text-rose-400 transition" data-rating="DOWN" title="Phản hồi sai / cần sửa"><i class="far fa-thumbs-down"></i></button>
                    <button class="ai-rate-btn hover:text-amber-400 transition font-medium" data-rating="STANDARD" title="Lưu thành mẫu chuẩn để AI tự học"><i class="far fa-star text-amber-400"></i> Mẫu chuẩn</button>
                </div>
            </div>
        ` : '';

        bubble.innerHTML = `
            <div class="whitespace-pre-line">${isUser ? safeEscapeHtml(content) : formatMarkdown(content)}</div>
            ${card ? renderCard(card) : ''}
            ${feedbackBar}
        `;

        // Bắt sự kiện đánh giá phản hồi để AI tự học
        if (!isUser) {
            const btns = bubble.querySelectorAll('.ai-rate-btn');
            btns.forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const rating = btn.getAttribute('data-rating');
                    const actionsBox = bubble.querySelector('.ai-feedback-actions');
                    if (actionsBox) {
                        actionsBox.innerHTML = `<span class="text-emerald-400 font-medium"><i class="fas fa-check-circle mr-1"></i>Đã ghi nhận (${rating === 'STANDARD' ? 'Mẫu chuẩn' : rating})</span>`;
                    }
                    try {
                        await fetch('/api/ai/feedback', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                sessionId: state.sessionId,
                                userPrompt: '',
                                feedbackRating: rating,
                                correctionType: rating === 'STANDARD' ? 'STANDARD_GROUND_TRUTH' : 'USER_RATING'
                            })
                        });
                    } catch (err) {
                        console.warn('Gửi feedback thất bại:', err);
                    }
                });
            });
        }

        if (isUser) {
            msgWrapper.appendChild(bubble);
            msgWrapper.appendChild(document.createRange().createContextualFragment(avatar));
        } else {
            msgWrapper.appendChild(document.createRange().createContextualFragment(avatar));
            msgWrapper.appendChild(bubble);
        }

        chatBody.appendChild(msgWrapper);
        chatBody.scrollTop = chatBody.scrollHeight;
    }

    let typingTimer = null;
    function appendTypingIndicator(id) {
        const chatBody = document.getElementById('sungo-ai-chat-body');
        if (!chatBody) return;

        const indicator = document.createElement('div');
        indicator.id = id;
        indicator.className = 'flex gap-2.5 justify-start animate-fade-in';
        indicator.innerHTML = `
            <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-600 text-slate-950 font-black text-xs flex items-center justify-center shrink-0 shadow-md">
                <i class="fas fa-robot animate-spin"></i>
            </div>
            <div class="bg-slate-800/90 text-amber-400 rounded-2xl rounded-tl-xs px-4 py-3 border border-slate-700/80 flex items-center gap-2 text-xs">
                <span class="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce"></span>
                <span class="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                <span class="w-1.5 h-1.5 bg-amber-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                <span id="${id}-text" class="ml-1 text-[11px] font-bold text-slate-300">🔍 Nhịp 1: Bóc tách thực thể & lọc nhiễu...</span>
            </div>
        `;
        chatBody.appendChild(indicator);
        chatBody.scrollTop = chatBody.scrollHeight;

        const stages = [
            '🔍 Nhịp 1: Bóc tách thực thể & lọc nhiễu...',
            '⚡ Nhịp 2: Tra cứu kho & đối chiếu thông số...',
            '🛡️ Nhịp 3: Kiểm duyệt logic & tính giá...'
        ];
        let step = 0;
        if (typingTimer) clearInterval(typingTimer);
        typingTimer = setInterval(() => {
            step = (step + 1) % stages.length;
            const textEl = document.getElementById(`${id}-text`);
            if (textEl) textEl.textContent = stages[step];
        }, 750);
    }

    function removeTypingIndicator(id) {
        if (typingTimer) {
            clearInterval(typingTimer);
            typingTimer = null;
        }
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    // Render gợi ý câu hỏi nhanh (Smart Chips) theo vai trò nhân viên
    function renderQuickReplies(replies) {
        const container = document.getElementById('sungo-ai-chips');
        if (!container) return;

        const user = getCurrentUser();
        const role = String(user.role || 'GUEST').toUpperCase();

        let defaultChips = [];
        if (user.isGuest || role === 'GUEST') {
            defaultChips = ['Đăng nhập hệ thống', 'Tra cứu bảo hành', 'Xem tài liệu sản phẩm'];
        } else if (role.includes('SALE')) {
            defaultChips = ['Tạo đơn 10 tấm pin Canadian', 'Kiểm tra tồn kho tấm pin', 'Báo cáo doanh thu của tôi', 'Gửi datasheet pin Canadian'];
        } else if (role.includes('KHO') || role.includes('INVENTORY') || role.includes('THU_MUA')) {
            defaultChips = ['Kiểm tra hàng tồn kho', 'Cảnh báo hàng sắp hết', 'Lên đơn đặt mua hàng', 'Phân tích sản phẩm tồn'];
        } else if (role.includes('KE_TOAN')) {
            defaultChips = ['Kiểm tra công nợ 131', 'Doanh thu tháng này', 'Sức khỏe doanh nghiệp', 'Tạo hợp đồng'];
        } else {
            // ADMIN / GIÁM ĐỐC
            defaultChips = ['Sức khoẻ doanh nghiệp', 'Báo cáo doanh thu hôm nay', 'Điểm danh nhân sự', 'Phân tích khách hàng VIP'];
        }

        const chips = (replies && replies.length > 0) ? replies : defaultChips;

        container.innerHTML = chips.map(chip => `
            <button onclick="window.SungoAI.ask('${chip.replace(/'/g, "\\'")}')" class="px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-amber-400 border border-slate-700/80 text-[11px] font-semibold whitespace-nowrap transition cursor-pointer active:scale-95 shrink-0">
                ${chip}
            </button>
        `).join('');
    }

    // Tạo giao diện Trợ Lý AI vào DOM
    function injectAssistantUI() {
        if (document.getElementById('sungo-ai-container')) return;

        const user = getCurrentUser();
        state.userRole = user.role || 'GUEST';

        const welcomeHtml = (user.isGuest || user.role === 'GUEST') ? `
            <div class="flex gap-2.5 justify-start">
                <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-slate-700 to-slate-800 text-amber-400 font-black text-xs flex items-center justify-center shrink-0 shadow-md border border-slate-700">
                    <i class="fas fa-robot"></i>
                </div>
                <div class="max-w-[85%] rounded-2xl rounded-tl-xs p-3.5 text-xs bg-slate-800/90 text-slate-200 border border-slate-700/80 shadow-md leading-relaxed">
                    Chào Quý khách! Em là <strong>Trợ Lý AI SUNGO</strong>.<br><br>
                    <div class="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-[11px] mb-2 font-medium flex items-center gap-1.5">
                        <i class="fas fa-lock text-amber-400"></i>
                        <span><strong>Trạng thái:</strong> Khách (Chưa đăng nhập)</span>
                    </div>
                    <ul class="space-y-1 text-slate-300">
                        <li>🔑 Để <strong>Tạo đơn hàng, xem Doanh thu, Báo cáo tài chính, Kho & Nhân sự</strong>: Vui lòng đăng nhập tài khoản.</li>
                        <li>🔍 Bạn có thể tra cứu thông tin <strong>Bảo hành thiết bị</strong> hoặc <strong>Tài liệu kỹ thuật / Datasheet</strong> công khai.</li>
                    </ul>
                    <div class="mt-2.5 text-[11px] text-amber-400 font-semibold">Bấm vào gợi ý bên dưới hoặc gõ yêu cầu để bắt đầu!</div>
                </div>
            </div>
        ` : `
            <div class="flex gap-2.5 justify-start">
                <div class="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-amber-600 text-slate-950 font-black text-xs flex items-center justify-center shrink-0 shadow-md">
                    <i class="fas fa-robot"></i>
                </div>
                <div class="max-w-[85%] rounded-2xl rounded-tl-xs p-3.5 text-xs bg-slate-800/90 text-slate-200 border border-slate-700/80 shadow-md leading-relaxed">
                    Chào ${safeEscapeHtml(user.name || 'Anh/Chị')}! Em là <strong>Trợ Lý Google Gemini AI (SUNGO Enterprise AI)</strong>. Em có thể giúp:
                    <ul class="mt-2 space-y-1 text-slate-300">
                        <li>📦 <strong>Tạo đơn hàng & sản phẩm</strong> nhanh chóng</li>
                        <li>📑 <strong>Lập báo giá Solar & soạn hợp đồng</strong> online</li>
                        <li>📊 <strong>Báo cáo doanh thu & sức khỏe tài chính CFO</strong></li>
                        <li>🔍 <strong>Kiểm tra tồn kho, serial bảo hành, công nợ 131</strong></li>
                        <li>📄 <strong>Gửi Datasheet & phân tích khách hàng VIP</strong></li>
                    </ul>
                    <div class="mt-2.5 text-[11px] text-amber-400 font-semibold">Bấm vào nút Micro bên dưới hoặc gõ yêu cầu để bắt đầu!</div>
                </div>
            </div>
        `;

        const container = document.createElement('div');
        container.id = 'sungo-ai-container';
        container.innerHTML = `
            <!-- NÚT NỔI GỌI AI (FLOATING ACTION BUTTON) -->
            <button id="sungo-ai-fab" onclick="window.SungoAI.toggle()" class="fixed right-4 md:right-72 z-[60] w-14 h-14 rounded-2xl bg-gradient-to-tr from-amber-500 via-amber-600 to-amber-500 text-slate-950 font-black shadow-2xl shadow-amber-500/40 flex items-center justify-center hover:scale-110 active:scale-95 transition-all cursor-pointer group ring-4 ring-amber-400/20" style="bottom: 5rem;" title="Trợ Lý AI SUNGO (Ctrl + J)">
                <i class="fas fa-robot text-xl group-hover:rotate-12 transition-transform"></i>
                <span class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-slate-900 animate-ping"></span>
                <span class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-slate-900"></span>
            </button>

            <!-- LỚP PHỦ NỀN MỜ CHO MOBILE -->
            <div id="sungo-ai-backdrop" onclick="window.SungoAI.toggle(false)" class="fixed inset-0 bg-black/60 backdrop-blur-xs z-[75] hidden transition-opacity duration-300 opacity-0 md:hidden"></div>

            <!-- KHAY CHAT TRỢ LÝ AI (DRAWER / MODAL) -->
            <aside id="sungo-ai-panel" class="fixed inset-y-0 right-0 z-[80] w-full sm:w-[450px] md:w-[480px] bg-slate-950 text-white flex flex-col shadow-2xl border-l border-slate-800 transform translate-x-full transition-transform duration-300 ease-in-out">
                
                <!-- HEADER TRỢ LÝ AI -->
                <div class="p-4 pt-safe sm:pt-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md flex items-center justify-between shrink-0" style="padding-top: max(1rem, calc(env(safe-area-inset-top, 0px) + 0.75rem));">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-600 text-slate-950 flex items-center justify-center font-black shadow-md shadow-amber-500/20">
                            <i class="fas fa-robot text-base"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <h3 class="font-black text-sm text-white tracking-tight">Trợ Lý Google Gemini AI</h3>
                                <span class="px-1.5 py-0.2 rounded-full text-[9px] font-black bg-blue-500/20 text-blue-400 border border-blue-500/30">Google AI</span>
                            </div>
                            <p class="text-[10px] text-amber-400 font-semibold" id="sungo-ai-user-badge">Đang kết nối Gemini Engine...</p>
                        </div>
                    </div>

                    <div class="flex items-center gap-1.5">
                        <!-- Nút bật/tắt giọng đọc TTS -->
                        <button id="sungo-ai-voice-toggle" onclick="window.SungoAI.toggleVoice()" class="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 transition text-xs cursor-pointer" title="Bật/Tắt phản hồi bằng giọng nói">
                            <i id="sungo-ai-voice-icon" class="fas fa-volume-up"></i>
                        </button>

                        <!-- Nút làm mới hội thoại (Reset Context) -->
                        <button onclick="window.SungoAI.newChat()" class="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-400 transition text-xs cursor-pointer" title="Làm mới phiên đối thoại">
                            <i class="fas fa-sync-alt"></i>
                        </button>

                        <!-- Nút đóng -->
                        <button onclick="window.SungoAI.toggle(false)" class="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition text-xs cursor-pointer" title="Đóng">
                            <i class="fas fa-times text-sm"></i>
                        </button>
                    </div>
                </div>

                <!-- THANH BÁO ĐANG PHÁT GIỌNG ĐỌC (STOP SPEECH BAR) -->
                <div id="sungo-ai-stop-speech-btn" class="hidden bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between text-xs text-amber-300">
                    <span class="flex items-center gap-2 font-bold">
                        <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                        AI đang đọc phản hồi...
                    </span>
                    <button onclick="window.SungoAI.stopSpeaking()" class="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-[10px] cursor-pointer">
                        Dừng Nói
                    </button>
                </div>

                <!-- KHUNG DANH SÁCH TIN NHẮN (CHAT BODY) -->
                <div id="sungo-ai-chat-body" class="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-950/60">
                    ${welcomeHtml}
                </div>

                <!-- THANH GỢI Ý CÂU HỎI THÔNG MINH (SMART CHIPS) -->
                <div id="sungo-ai-chips" class="p-2.5 border-t border-slate-800/80 bg-slate-900/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
                    <!-- Dynamic Smart Chips -->
                </div>

                <!-- VÙNG NHẬP LIỆU & NÚT MICRO GHI ÂM (INPUT TOOLBAR) -->
                <div class="p-3 pb-safe sm:pb-3 bg-slate-900 border-t border-slate-800 shrink-0" style="padding-bottom: max(0.75rem, calc(env(safe-area-inset-bottom, 0px) + 0.5rem));">
                    <!-- SÓNG ÂM KHI ĐANG GHI ÂM -->
                    <div id="sungo-ai-wave-indicator" class="hidden mb-2 px-3 py-1.5 rounded-xl bg-red-950/60 border border-red-500/50 flex items-center justify-between text-xs text-red-300">
                        <div class="flex items-center gap-2 font-bold">
                            <span class="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping"></span>
                            Đang lắng nghe giọng nói của bạn...
                        </div>
                        <button onclick="window.SungoAI.toggleRecording()" class="text-[10px] text-white bg-red-600 px-2 py-0.5 rounded font-bold cursor-pointer">Xong</button>
                    </div>

                    <div class="flex items-center gap-2">
                        <!-- NÚT GHI ÂM MICROPHONE -->
                        <button id="sungo-ai-mic-btn" onclick="window.SungoAI.toggleRecording()" class="w-10 h-10 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-400 flex items-center justify-center transition shrink-0 cursor-pointer shadow-sm active:scale-95" title="Nhấn để nói tiếng Việt">
                            <i class="fas fa-microphone text-sm"></i>
                        </button>

                        <!-- Ô NHẬP VĂN BẢN -->
                        <input id="sungo-ai-input" type="text" placeholder="Hỏi AI hoặc nhấn micro để nói..." class="flex-1 bg-slate-950 text-white placeholder-slate-500 text-xs px-3.5 py-2.5 rounded-xl border border-slate-700/80 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 transition">

                        <!-- NÚT GỬI -->
                        <button onclick="window.SungoAI.sendCurrentInput()" class="w-10 h-10 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black flex items-center justify-center transition shrink-0 cursor-pointer shadow-md shadow-amber-500/20 active:scale-95">
                            <i class="fas fa-paper-plane text-xs"></i>
                        </button>
                    </div>
                </div>
            </aside>
        `;

        document.body.appendChild(container);

        // Bắt sự kiện phím Enter trên input
        const inputEl = document.getElementById('sungo-ai-input');
        if (inputEl) {
            inputEl.addEventListener('keypress', function (e) {
                if (e.key === 'Enter') {
                    window.SungoAI.sendCurrentInput();
                }
            });
        }

        // Bắt phím tắt Ctrl + J hoặc Cmd + K
        window.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && (e.key === 'j' || e.key === 'J')) {
                e.preventDefault();
                window.SungoAI.toggle();
            }
        });

        // Cập nhật thông tin role người dùng
        const badgeEl = document.getElementById('sungo-ai-user-badge');
        if (badgeEl) {
            if (user.isGuest || user.role === 'GUEST') {
                badgeEl.innerText = 'Khách (Chưa đăng nhập)';
                badgeEl.className = 'text-[10px] text-slate-400 font-semibold';
            } else {
                badgeEl.innerText = `${user.name || 'Nhân Viên'} (${user.role || 'USER'})`;
                badgeEl.className = 'text-[10px] text-amber-400 font-semibold';
            }
        }

        renderQuickReplies();
    }

    // Giao diện điều khiển toàn cục (Global API)
    window.SungoAI = {
        toggle: function (forceState) {
            state.isOpen = (forceState !== undefined) ? forceState : !state.isOpen;
            const panel = document.getElementById('sungo-ai-panel');
            const backdrop = document.getElementById('sungo-ai-backdrop');

            if (!panel) {
                injectAssistantUI();
                return;
            }

            if (state.isOpen) {
                panel.classList.remove('translate-x-full');
                if (backdrop) {
                    backdrop.classList.remove('hidden');
                    setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
                }
                const input = document.getElementById('sungo-ai-input');
                if (input) setTimeout(() => input.focus(), 300);
            } else {
                panel.classList.add('translate-x-full');
                if (backdrop) {
                    backdrop.classList.add('opacity-0');
                    setTimeout(() => backdrop.classList.add('hidden'), 300);
                }
                stopSpeaking();
            }
        },

        ask: function (prompt) {
            if (!state.isOpen) this.toggle(true);
            sendMessage(prompt, false);
        },

        sendCurrentInput: function () {
            const input = document.getElementById('sungo-ai-input');
            if (input && input.value.trim()) {
                sendMessage(input.value.trim(), false);
            }
        },

        toggleRecording: toggleRecording,

        stopSpeaking: stopSpeaking,

        toggleVoice: function () {
            state.voiceEnabled = !state.voiceEnabled;
            const icon = document.getElementById('sungo-ai-voice-icon');
            if (icon) {
                if (state.voiceEnabled) {
                    icon.className = 'fas fa-volume-up text-amber-400';
                    showToast('🔊 Đã bật phản hồi bằng giọng nói!');
                } else {
                    icon.className = 'fas fa-volume-mute text-slate-400';
                    stopSpeaking();
                    showToast('🔇 Đã tắt phản hồi bằng giọng nói!');
                }
            }
        },

        newChat: async function () {
            state.sessionId = 'sess_' + Date.now();
            localStorage.setItem('sungo_ai_session_id', state.sessionId);

            try {
                let token = localStorage.getItem('sungo_token');
                await fetch('/api/ai/reset', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': token ? `Bearer ${token}` : ''
                    },
                    body: JSON.stringify({ sessionId: state.sessionId })
                });
            } catch (e) {}

            const body = document.getElementById('sungo-ai-chat-body');
            const currentUser = getCurrentUser();
            if (body) {
                const isG = currentUser.isGuest || currentUser.role === 'GUEST';
                body.innerHTML = `
                    <div class="flex gap-2.5 justify-start animate-fade-in">
                        <div class="w-8 h-8 rounded-xl ${isG ? 'bg-gradient-to-tr from-slate-700 to-slate-800 text-amber-400 border border-slate-700' : 'bg-gradient-to-tr from-amber-500 to-amber-600 text-slate-950'} font-black text-xs flex items-center justify-center shrink-0 shadow-md">
                            <i class="fas fa-robot"></i>
                        </div>
                        <div class="max-w-[85%] rounded-2xl rounded-tl-xs p-3.5 text-xs bg-slate-800/90 text-slate-200 border border-slate-700/80 shadow-md">
                            ${isG ? 'Đã làm mới phiên đối thoại! Bạn hiện đang ở chế độ <strong>Khách (Chưa đăng nhập)</strong>. Quý khách muốn tra cứu bảo hành hay xem tài liệu sản phẩm nào ạ?' : 'Đã làm mới phiên đối thoại! Ngữ cảnh trước đây đã được giải phóng. Anh/Chị muốn thực hiện tác vụ nào tiếp theo?'}
                        </div>
                    </div>
                `;
            }
            renderQuickReplies();
            showToast('Đã làm mới phiên làm việc AI!');
        },

        copyZaloMessage: function (msg) {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(msg).then(() => {
                    showToast('✅ Đã sao chép tin nhắn Zalo vào Clipboard! Có thể dán gửi khách ngay.');
                }).catch(() => {
                    prompt('Sao chép tin nhắn Zalo thủ công:', msg);
                });
            } else {
                prompt('Sao chép tin nhắn Zalo thủ công:', msg);
            }
        }
    };

    // Tự động nạp UI khi DOM sẵn sàng
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectAssistantUI);
    } else {
        injectAssistantUI();
    }
})();
