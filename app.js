const API_BASE_URL = "http://124.223.40.104:5000";
const HUB_ID = 'STORYBOARD_HUB'; 
const IMAGE_SPLIT_ID = 'IMAGE_SPLIT_TOOL';
const IMAGE_GEN_ID = 'IMAGE_GEN_TOOL'; 
const TEAM_ASSET_ID = 'TEAM_ASSET_LIBRARY';
const PERSONAL_ASSET_ID = 'PERSONAL_ASSET_LIBRARY';

let currentUserKey = null;
let isAdmin = false; 
let chats = [];
let currentChatId = null; 
let renamingChatId = null; 
let currentTab = 'all';
let pendingConfirmCallback = null;

let currentUploadedImageBase64 = null; 
let currentSelectedRatioText = '16:9';
let currentSelectedResText = '高清 2K';

let teamAssets = JSON.parse(localStorage.getItem('team_assets')) || [];
let personalAssets = []; 
let currentAssetFilter = 'all';
let currentLibraryMode = 'team'; 
let editingAssetId = null;
let isBulkMode = false;
let selectedAssetIds = new Set();

let auditLogs = JSON.parse(localStorage.getItem('sys_audit_logs')) || [];
let dynamicModels = JSON.parse(localStorage.getItem('sys_dynamic_models')) || {
    text: [ {id:'fast', name:'⚡ 快速'}, {id:'thinking', name:'🧠 思考'}, {id:'pro', name:'👑 旗舰'} ],
    image: [ {id:'nanopro', name:'👑 Nano Banana Pro'}, {id:'nano2', name:'🍌 Nano Banana 2'} ]
};
let userUsages = JSON.parse(localStorage.getItem('sys_user_usages')) || {};

function addAuditLog(action, user = currentUserKey) { const time = new Date().toLocaleString('zh-CN', { hour12: false }); auditLogs.unshift({ time, user: user || 'System', action }); if(auditLogs.length > 100) auditLogs.pop(); localStorage.setItem('sys_audit_logs', JSON.stringify(auditLogs)); }
function getUserUsage(key) { if(!userUsages[key]) userUsages[key] = { images: 0, limit: 1000 }; return userUsages[key]; }
function incrementUsage(key) { let u = getUserUsage(key); u.images += 1; localStorage.setItem('sys_user_usages', JSON.stringify(userUsages)); }

function init() {
    loadDynamicModelsToUI();
    const k = localStorage.getItem('user_secret_key');
    if (k) { document.getElementById('secretKey').value = k; verifyKey(); } 
    else { document.getElementById('chatList').innerHTML = ''; document.getElementById('chatBox').innerHTML = ''; document.getElementById('inputSection').style.display = 'none'; document.getElementById('headerEditIcon').style.display = 'none'; }
}

function loadDynamicModelsToUI() {
    const ts = document.getElementById('modelSelect'); const is = document.getElementById('imgGenModelSelect');
    ts.innerHTML = ''; is.innerHTML = '';
    dynamicModels.text.forEach(m => ts.innerHTML += `<option value="${m.id}">${m.name}</option>`);
    dynamicModels.image.forEach(m => is.innerHTML += `<option value="${m.id}">${m.name}</option>`);
}

async function verifyKey() {
    const p = document.getElementById('secretKey').value.trim(); if(!p) return;
    try {
        const res = await fetch(`${API_BASE_URL}/verify`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:p}) });
        const d = await res.json();
        if(res.ok) {
            localStorage.setItem('user_secret_key', p); currentUserKey = p; isAdmin = d.is_admin;
            personalAssets = JSON.parse(localStorage.getItem('personal_assets_' + currentUserKey)) || [];
            chats = JSON.parse(localStorage.getItem('chats_' + currentUserKey)) || [];
            if (!chats.find(c => c.id === IMAGE_GEN_ID)) { chats.push({id: IMAGE_GEN_ID, title: "AI生图记录", messages: [], isImageGen: true}); saveChats(); }
            getUserUsage(p); localStorage.setItem('sys_user_usages', JSON.stringify(userUsages));
            document.getElementById('modelSelect').value = localStorage.getItem('model_type_' + currentUserKey) || dynamicModels.text[0].id;
            document.getElementById('keySection').style.display = 'none'; document.getElementById('headerActions').style.display = 'flex';
            document.getElementById('adminBtn').style.display = isAdmin ? 'inline-block' : 'none'; document.getElementById('apiBtn').style.display = isAdmin ? 'inline-block' : 'none';
            addAuditLog('登录系统'); switchChat(HUB_ID);
        } else { alert(d.error || "验证失败"); }
    } catch(e) { alert("网络连接失败"); }
}

let isSidebarCollapsed = false;
function toggleSidebar() { isSidebarCollapsed = !isSidebarCollapsed; const sidebar = document.getElementById('appSidebar'); if(isSidebarCollapsed) sidebar.classList.add('collapsed'); else sidebar.classList.remove('collapsed'); }

// 【杀手级功能 4】: 云端数据同步 (UI 模拟逻辑)
function syncWithCloud() {
    const syncBtn = document.getElementById('syncBtn');
    const originalText = syncBtn.innerHTML;
    syncBtn.innerHTML = "⏳ 同步中...";
    syncBtn.disabled = true;
    
    // 模拟云端 API 请求延迟
    setTimeout(() => {
        syncBtn.innerHTML = "✅ 已同步";
        addAuditLog('执行了云端数据双向同步');
        setTimeout(() => {
            syncBtn.innerHTML = originalText;
            syncBtn.disabled = false;
        }, 2000);
    }, 1500);
}

function openConfirmModal(callback) { pendingConfirmCallback = callback; document.getElementById('confirmModal').classList.add('show'); }
function closeConfirmModal() { document.getElementById('confirmModal').classList.remove('show'); pendingConfirmCallback = null; }
function executeConfirm() { if(pendingConfirmCallback) pendingConfirmCallback(); closeConfirmModal(); }
function logout() { openConfirmModal(() => { addAuditLog('退出登录'); localStorage.removeItem('user_secret_key'); location.reload(); }); }
function changeModel() { if(currentUserKey) localStorage.setItem('model_type_' + currentUserKey, document.getElementById('modelSelect').value); }
async function openApiModal() { document.getElementById('apiModal').classList.add('show'); }
function closeApiModal() { document.getElementById('apiModal').classList.remove('show'); }
async function saveApiSettings() { alert("配置已保存"); addAuditLog('修改了全局 API 配置'); closeApiModal(); }

// 管理员面板省略旧代码保持原样...
let targetQuotaKey = null;
function switchAdminTab(tabName) { document.querySelectorAll('.admin-tab-btn').forEach(b => b.classList.remove('active')); document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active')); document.getElementById(`tabBtn-${tabName}`).classList.add('active'); document.getElementById(`adminTab-${tabName}`).classList.add('active'); if(tabName === 'keys') refreshKeyList(); if(tabName === 'models') renderAdminModels(); if(tabName === 'logs') renderAuditLogs(); }
async function openAdminPanel() { document.getElementById('adminModal').classList.add('show'); switchAdminTab('keys'); }
function closeAdminPanel() { document.getElementById('adminModal').classList.remove('show'); }
function copyAdminKey(text, btn) { navigator.clipboard.writeText(text).then(() => { const original = btn.innerHTML; btn.innerHTML = '✅'; btn.style.color = '#34c759'; setTimeout(() => { btn.innerHTML = original; btn.style.color = ''; }, 1500); }); }
async function refreshKeyList() { const ak = localStorage.getItem('user_secret_key'); const tb = document.getElementById('keyTableBody'); tb.innerHTML = ''; try { const res = await fetch(`${API_BASE_URL}/admin/list`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key:ak}) }); if(res.ok) { const d = await res.json(); for(let k in d.keys) { if(k === ak) continue; const info = d.keys[k]; const u = getUserUsage(k); const tr = document.createElement('tr'); if(info.is_deleted) tr.className = 'status-del'; tr.innerHTML = `<td style="padding: 8px; border-bottom: 1px solid var(--border-color);"><div style="display: flex; align-items: center; justify-content: space-between; font-family: monospace;">${k}<button class="action-btn" style="margin: 0; padding: 2px; font-size: 0.8rem;" onclick="copyAdminKey('${k}', this)">📋</button></div></td><td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${info.note}</td><td style="padding: 8px; border-bottom: 1px solid var(--border-color); color: ${u.images >= u.limit ? 'var(--danger-color)' : 'inherit'}">${u.images} / ${u.limit} 张</td><td style="padding: 8px; border-bottom: 1px solid var(--border-color); display: flex; gap: 4px;"><button class="modal-btn" style="padding:4px 6px; font-size:12px; background:var(--bg-input); color:var(--text-main); border:1px solid var(--border-color);" onclick="openQuotaModal('${k}', ${u.limit})">额度</button><button class="modal-btn" style="padding:4px 6px; font-size:12px; background:${info.is_deleted?'#34c759':'#ff3b30'}; color:white;" onclick="toggleKeyStatus('${k}')">${info.is_deleted?'恢复':'停用'}</button></td>`; tb.appendChild(tr); } } } catch(e) { console.log(e); } }
async function toggleKeyStatus(t) { const ak = localStorage.getItem('user_secret_key'); await fetch(`${API_BASE_URL}/admin/toggle_delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key:ak, target_key:t}) }); addAuditLog(`更改了密钥状态: ${t}`); await refreshKeyList(); }
async function generateNewKey() { const ak = localStorage.getItem('user_secret_key'); const n = document.getElementById('newKeyNote').value.trim(); if(!n) return alert("请输入备注"); await fetch(`${API_BASE_URL}/admin/create`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({admin_key:ak, note:n}) }); document.getElementById('newKeyNote').value = ''; addAuditLog(`生成了新密钥，备注: ${n}`); await refreshKeyList(); }
function openQuotaModal(key, currentLimit) { targetQuotaKey = key; document.getElementById('quotaInput').value = currentLimit; document.getElementById('quotaModal').classList.add('show'); }
function closeQuotaModal() { document.getElementById('quotaModal').classList.remove('show'); targetQuotaKey = null; }
function saveQuota() { const val = parseInt(document.getElementById('quotaInput').value); if(isNaN(val) || val < 0) return alert("请输入有效整数"); userUsages[targetQuotaKey].limit = val; localStorage.setItem('sys_user_usages', JSON.stringify(userUsages)); addAuditLog(`修改了密钥 ${targetQuotaKey} 的额度为: ${val}`); closeQuotaModal(); refreshKeyList(); }
function renderAdminModels() { const tl = document.getElementById('textModelList'); const il = document.getElementById('imageModelList'); tl.innerHTML = ''; il.innerHTML = ''; dynamicModels.text.forEach(m => tl.innerHTML += `<div class="model-item-row"><span>${m.name} (${m.id})</span><button class="action-btn delete-action" style="font-size:12px;" onclick="removeModel('text', '${m.id}')">🗑️</button></div>`); dynamicModels.image.forEach(m => il.innerHTML += `<div class="model-item-row"><span>${m.name} (${m.id})</span><button class="action-btn delete-action" style="font-size:12px;" onclick="removeModel('image', '${m.id}')">🗑️</button></div>`); }
function addModel(type) { const id = document.getElementById(type === 'text' ? 'newTextModelId' : 'newImageModelId').value.trim(); const name = document.getElementById(type === 'text' ? 'newTextModelName' : 'newImageModelName').value.trim(); if(!id || !name) return alert("必须填写ID和显示名"); dynamicModels[type].push({id, name}); localStorage.setItem('sys_dynamic_models', JSON.stringify(dynamicModels)); addAuditLog(`添加了新模型: ${name}`); document.getElementById(type === 'text' ? 'newTextModelId' : 'newImageModelId').value = ''; document.getElementById(type === 'text' ? 'newTextModelName' : 'newImageModelName').value = ''; renderAdminModels(); loadDynamicModelsToUI(); }
function removeModel(type, id) { if(dynamicModels[type].length <= 1) return alert("至少保留一个模型"); dynamicModels[type] = dynamicModels[type].filter(m => m.id !== id); localStorage.setItem('sys_dynamic_models', JSON.stringify(dynamicModels)); addAuditLog(`删除了模型: ${id}`); renderAdminModels(); loadDynamicModelsToUI(); }
function renderAuditLogs() { const tb = document.getElementById('auditLogTableBody'); tb.innerHTML = ''; auditLogs.forEach(l => { tb.innerHTML += `<tr><td style="padding: 8px; border-bottom: 1px solid var(--border-color); color: var(--text-secondary);">${l.time}</td><td style="padding: 8px; border-bottom: 1px solid var(--border-color); font-family: monospace;">${l.user.substring(0,8)}...</td><td style="padding: 8px; border-bottom: 1px solid var(--border-color);">${l.action}</td></tr>`; }); }

// ================== 素材库逻辑 ==================
function renderAssetLibraryTool(mode) {
    currentLibraryMode = mode; const isPersonal = mode === 'personal';
    const titleText = isPersonal ? '🔒 我的个人专属素材库' : '📁 团队公共素材与角色库';
    const descText = isPersonal ? '您在此处上传的素材仅您自己可见，放心用于个人创作。' : '由管理员统一维护的高质量基准素材，全员共享。';
    const canUpload = isPersonal || isAdmin;

    let html = `<div style="max-width: 1000px; margin: 0 auto; width: 100%; padding: 30px; box-sizing: border-box; animation: pop 0.3s ease;"><div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 16px;"><div><h2 style="margin: 0 0 6px 0;">${titleText}</h2><div style="font-size: 0.85rem; color: var(--text-secondary);">${descText}</div></div><div style="display:flex; gap:10px;">`;
    if(!isBulkMode) html += `<button onclick="toggleBulkMode()" style="background: var(--bg-input); color: var(--text-main); border: 1px solid var(--border-color); padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600;">☑️ 批量操作</button>`;
    if (canUpload && !isBulkMode) html += `<button onclick="document.getElementById('batchAssetUpload').click()" style="background: var(--bg-user-msg); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600;">＋ 添加新素材</button>`;
    html += `</div></div><div style="display: flex; gap: 10px; margin-bottom: 24px;"><button class="nav-btn ${currentAssetFilter === 'all' ? 'active' : ''}" style="padding: 8px 16px;" onclick="filterAssets('all')">全部展示</button><button class="nav-btn ${currentAssetFilter === 'character' ? 'active' : ''}" style="padding: 8px 16px;" onclick="filterAssets('character')">👤 角色设定</button><button class="nav-btn ${currentAssetFilter === 'scene' ? 'active' : ''}" style="padding: 8px 16px;" onclick="filterAssets('scene')">🏞️ 场景概念</button></div><div id="assetGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 20px;"></div></div>`;
    
    const toolbar = document.getElementById('bulkToolbar');
    if (isBulkMode) {
        toolbar.style.display = 'flex'; document.getElementById('bulkSelectCount').innerText = `已选择 ${selectedAssetIds.size} 项`;
        const canManage = isPersonal || isAdmin; document.getElementById('bulkCategoryBtn').style.display = canManage ? 'inline-block' : 'none'; document.getElementById('bulkDeleteBtn').style.display = canManage ? 'inline-block' : 'none';
    } else { toolbar.style.display = 'none'; }
    return html;
}

async function handleBatchAssetUpload(input) {
    if (!input.files || input.files.length === 0) return;
    const files = Array.from(input.files); let upCount = 0;
    for (let file of files) { await new Promise((resolve) => { const reader = new FileReader(); reader.onload = (e) => { const newAsset = { id: 'asset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5), title: file.name.substring(0, file.name.lastIndexOf('.')) || file.name, type: 'character', image: e.target.result, prompt: '' }; if (currentLibraryMode === 'team') teamAssets.unshift(newAsset); else personalAssets.unshift(newAsset); upCount++; resolve(); }; reader.readAsDataURL(file); }); }
    if (currentLibraryMode === 'team') localStorage.setItem('team_assets', JSON.stringify(teamAssets)); else localStorage.setItem('personal_assets_' + currentUserKey, JSON.stringify(personalAssets)); addAuditLog(`上传了 ${upCount} 个素材`); input.value = ''; document.getElementById('chatBox').innerHTML = renderAssetLibraryTool(currentLibraryMode); renderAssetGrid();
}
function filterAssets(type) { currentAssetFilter = type; if(currentChatId === TEAM_ASSET_ID || currentChatId === PERSONAL_ASSET_ID) { document.getElementById('chatBox').innerHTML = renderAssetLibraryTool(currentLibraryMode); renderAssetGrid(); } }
function renderAssetGrid() {
    const grid = document.getElementById('assetGrid'); if(!grid) return; grid.innerHTML = '';
    const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; const filtered = currentAssetFilter === 'all' ? sourceArray : sourceArray.filter(a => a.type === currentAssetFilter);
    const canManage = (currentLibraryMode === 'personal') || isAdmin;
    if (filtered.length === 0) { grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-secondary);">暂无相关素材，请点击右上角添加。</div>`; return; }

    filtered.forEach(asset => {
        const isSelected = selectedAssetIds.has(asset.id);
        let cardHtml = `<div class="asset-card ${isSelected ? 'selected' : ''}">`;
        if (isBulkMode) { cardHtml += `<div class="bulk-overlay" onclick="toggleSelectAsset('${asset.id}')"></div><div class="checkbox-icon">✓</div>`; }
        cardHtml += `<img src="${asset.image}" style="width: 100%; height: 240px; object-fit: cover; border-bottom: 1px solid var(--border-color);"><div style="padding: 16px;"><div style="font-weight: bold; margin-bottom: 6px; font-size: 1.05rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${asset.title}">${asset.title}</div><div style="font-size: 0.8rem; color: var(--text-secondary); margin-bottom: 12px; display: inline-block; background: var(--bg-container); padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border-color);">${asset.type === 'character' ? '👤 角色设定' : '🏞️ 场景概念'}</div><div style="display: flex; gap: 8px;"><button class="nav-btn" style="flex: 1; padding: 8px; font-size: 0.85rem;" title="复制提示词与Seed参数" onclick="copyAssetPrompt('${asset.id}')">📋 词+Seed</button><button class="nav-btn" style="flex: 1; padding: 8px; font-size: 0.85rem; border-color: var(--shen-color); color: var(--shen-color);" title="去生图控制台载入此素材" onclick="useAssetInGen('${asset.id}')">🎨 去创作</button></div>`;
        if (canManage && !isBulkMode) { cardHtml += `<div style="display: flex; gap: 8px; margin-top: 8px;"><button class="nav-btn" style="flex: 1; padding: 6px; font-size: 0.85rem;" title="单独编辑素材属性" onclick="editAsset('${asset.id}')">✏️ 编辑</button><button class="nav-btn" style="flex: 1; padding: 6px; font-size: 0.85rem; border: none; color: var(--danger-color); background: transparent; opacity: 0.7;" title="删除此素材" onclick="deleteAsset('${asset.id}')" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.7'">🗑️ 删除</button></div>`; }
        cardHtml += `</div></div>`; grid.innerHTML += cardHtml;
    });
}
function toggleBulkMode() { isBulkMode = !isBulkMode; selectedAssetIds.clear(); document.getElementById('chatBox').innerHTML = renderAssetLibraryTool(currentLibraryMode); renderAssetGrid(); }
function toggleSelectAsset(id) { if (selectedAssetIds.has(id)) selectedAssetIds.delete(id); else selectedAssetIds.add(id); document.getElementById('bulkSelectCount').innerText = `已选择 ${selectedAssetIds.size} 项`; renderAssetGrid(); }

async function executeBulkDownload() {
    if(selectedAssetIds.size === 0) return alert("请先选择要下载的素材！");
    const zip = new JSZip(); const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; let count = 0;
    selectedAssetIds.forEach((id) => {
        const asset = sourceArray.find(a => a.id === id);
        if(asset && asset.image) { count++; const data = asset.image.split(',')[1]; let ext = 'png'; if(asset.image.includes('jpeg')) ext = 'jpg'; else if(asset.image.includes('webp')) ext = 'webp'; zip.file(`${asset.title}_${count}.${ext}`, data, {base64: true}); }
    });
    zip.generateAsync({type: "blob"}).then(content => { const link = document.createElement('a'); link.href = URL.createObjectURL(content); link.download = `素材批量下载_${Date.now()}.zip`; link.click(); addAuditLog(`批量下载了 ${count} 个素材`); toggleBulkMode(); });
}
function executeBulkDelete() {
    if(selectedAssetIds.size === 0) return alert("请先选择要删除的素材！");
    openConfirmModal(() => {
        const c = selectedAssetIds.size;
        if (currentLibraryMode === 'team') { teamAssets = teamAssets.filter(a => !selectedAssetIds.has(a.id)); localStorage.setItem('team_assets', JSON.stringify(teamAssets)); } else { personalAssets = personalAssets.filter(a => !selectedAssetIds.has(a.id)); localStorage.setItem('personal_assets_' + currentUserKey, JSON.stringify(personalAssets)); }
        addAuditLog(`批量删除了 ${c} 个素材`); toggleBulkMode(); 
    });
}
function openBulkCategoryModal() { if(selectedAssetIds.size === 0) return alert("请先选择素材！"); document.getElementById('bulkCategoryModal').classList.add('show'); }
function closeBulkCategoryModal() { document.getElementById('bulkCategoryModal').classList.remove('show'); }
function confirmBulkCategory() {
    const newType = document.getElementById('bulkCategorySelect').value; const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets;
    sourceArray.forEach(asset => { if(selectedAssetIds.has(asset.id)) { asset.type = newType; } });
    if (currentLibraryMode === 'team') localStorage.setItem('team_assets', JSON.stringify(teamAssets)); else localStorage.setItem('personal_assets_' + currentUserKey, JSON.stringify(personalAssets));
    addAuditLog(`批量修改了 ${selectedAssetIds.size} 个素材分类`); closeBulkCategoryModal(); toggleBulkMode();
}

function editAsset(id) { editingAssetId = id; const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; const asset = sourceArray.find(a => a.id === id); if(!asset) return; document.getElementById('editAssetTitle').value = asset.title; document.getElementById('editAssetType').value = asset.type; document.getElementById('editAssetPrompt').value = asset.prompt || ''; document.getElementById('editAssetModal').classList.add('show'); }
function saveAssetEdit() { const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; const asset = sourceArray.find(a => a.id === editingAssetId); if(!asset) return; asset.title = document.getElementById('editAssetTitle').value.trim(); asset.type = document.getElementById('editAssetType').value; asset.prompt = document.getElementById('editAssetPrompt').value.trim(); if (currentLibraryMode === 'team') localStorage.setItem('team_assets', JSON.stringify(teamAssets)); else localStorage.setItem('personal_assets_' + currentUserKey, JSON.stringify(personalAssets)); closeEditAssetModal(); document.getElementById('chatBox').innerHTML = renderAssetLibraryTool(currentLibraryMode); renderAssetGrid(); }
function closeEditAssetModal() { document.getElementById('editAssetModal').classList.remove('show'); }
function deleteAsset(id) { openConfirmModal(() => { if (currentLibraryMode === 'team') { teamAssets = teamAssets.filter(a => a.id !== id); localStorage.setItem('team_assets', JSON.stringify(teamAssets)); } else { personalAssets = personalAssets.filter(a => a.id !== id); localStorage.setItem('personal_assets_' + currentUserKey, JSON.stringify(personalAssets)); } document.getElementById('chatBox').innerHTML = renderAssetLibraryTool(currentLibraryMode); renderAssetGrid(); }); }
function copyAssetPrompt(id) { const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; const asset = sourceArray.find(a => a.id === id); if (asset && asset.prompt) { navigator.clipboard.writeText(asset.prompt).then(() => { alert("提示词与 Seed 复制成功！"); }); } else { alert("该素材暂未填写提示词。"); } }

// 【杀手级功能 1】：工作流一键联动 (从素材库或聊天提取参数，直接跳到生图)
function useAssetInGen(assetId) { 
    const sourceArray = currentLibraryMode === 'team' ? teamAssets : personalAssets; const asset = sourceArray.find(a => a.id === assetId); if (!asset) return; 
    extractAndGenerateImage(asset.prompt || '', asset.image);
}

function extractAndGenerateImage(promptText, referenceImage = null) {
    switchChat(IMAGE_GEN_ID); 
    if (referenceImage) {
        currentUploadedImageBase64 = referenceImage; 
        const wrap = document.getElementById('imgUploadPreview'); wrap.style.display = 'inline-block'; 
        wrap.innerHTML = `<div class="img-preview-wrap"><img src="${currentUploadedImageBase64}" class="img-preview-thumb"><div class="img-preview-close" onclick="clearGenImage()">×</div></div>`; 
    }
    // 提取并清洗文本，去除多余标点
    document.getElementById('imgGenInput').value = promptText.replace(/[【】🎬]/g, '').trim(); 
}

// ================== 多宫格拆分核心逻辑 (缩略) ==================
function renderImageSplitterTool() { return `<div style="max-width:650px;margin:0 auto;width:100%;padding:30px;background:var(--bg-container);border-radius:12px;border:1px solid var(--border-color);color:var(--text-main);box-sizing:border-box;"><h2 style="text-align:center;margin-top:0;margin-bottom:24px;">🧩 批量图片拆分工具</h2><div style="background:var(--bg-input);border:1px solid var(--border-color);padding:18px;margin-bottom:20px;border-radius:10px;"><div style="font-weight:600;margin-bottom:12px;color:var(--shen-color);">1. 拆分设置</div><div style="display:flex;gap:20px;"><label style="display:flex;align-items:center;gap:8px;">行数: <input type="number" id="splitRows" value="2" min="1" style="width:70px;padding:6px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-container);color:var(--text-main);outline:none;"></label><label style="display:flex;align-items:center;gap:8px;">列数: <input type="number" id="splitCols" value="2" min="1" style="width:70px;padding:6px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-container);color:var(--text-main);outline:none;"></label></div></div><div style="background:var(--bg-input);border:1px solid var(--border-color);padding:18px;margin-bottom:20px;border-radius:10px;"><div style="font-weight:600;margin-bottom:12px;"><label style="cursor:pointer;display:flex;align-items:center;gap:8px;" title="使用色块在拆分前盖住原图的某个区域"><input type="checkbox" id="enableWm" onchange="document.getElementById('wmSettings').style.display=this.checked?'block':'none'"> 2. 开启去水印 (色块覆盖法)</label></div><div id="wmSettings" style="display:none;padding-top:10px;border-top:1px dashed var(--border-color);"><div style="display:flex;gap:15px;margin-bottom:12px;flex-wrap:wrap;"><label style="display:flex;align-items:center;gap:5px;">X: <input type="number" id="wmX" value="0" style="width:60px;padding:6px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-container);color:var(--text-main);"></label><label style="display:flex;align-items:center;gap:5px;">Y: <input type="number" id="wmY" value="0" style="width:60px;padding:6px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-container);color:var(--text-main);"></label><label style="display:flex;align-items:center;gap:5px;">W: <input type="number" id="wmW" value="150" style="width:60px;padding:6px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-container);color:var(--text-main);"></label><label style="display:flex;align-items:center;gap:5px;">H: <input type="number" id="wmH" value="50" style="width:60px;padding:6px;border-radius:6px;border:1px solid var(--border-color);background:var(--bg-container);color:var(--text-main);"></label></div><label style="display:flex;align-items:center;gap:8px;">颜色: <input type="color" id="wmColor" value="#ffffff" style="border:none;border-radius:4px;cursor:pointer;background:transparent;padding:0;height:28px;width:40px;"></label></div></div><div style="background:var(--bg-input);border:1px solid var(--border-color);padding:18px;margin-bottom:24px;border-radius:10px;"><div style="font-weight:600;margin-bottom:12px;color:var(--shen-color);">3. 批量上传</div><input type="file" id="splitUpload" accept="image/jpeg, image/png, image/webp" multiple style="width:100%;color:var(--text-main);padding:10px;border:1px dashed var(--border-color);border-radius:8px;background:var(--bg-container);cursor:pointer;" title="支持多选图片批量拆分"></div><button id="processSplitBtn" onclick="runImageSplitter()" style="background-color:var(--bg-user-msg);color:white;border:none;padding:14px 20px;font-size:1rem;border-radius:8px;cursor:pointer;width:100%;font-weight:600;transition:0.2s;" title="一键切分并导出为 ZIP">🚀 开始处理并打包下载 (ZIP)</button><div id="splitStatus" style="margin-top:18px;font-size:0.95rem;color:var(--highlight-color);font-weight:600;text-align:center;"></div></div>`; }
async function runImageSplitter() {
    const uploadInput = document.getElementById('splitUpload'); const statusDiv = document.getElementById('splitStatus'); const processBtn = document.getElementById('processSplitBtn'); const files = uploadInput.files;
    if (files.length === 0) return alert('请先选择图片');
    statusDiv.innerText = '正在处理，请稍候...'; processBtn.disabled = true;
    const zip = new JSZip(), rows = parseInt(document.getElementById('splitRows').value), cols = parseInt(document.getElementById('splitCols').value);
    const wmConfig = { enabled: document.getElementById('enableWm').checked, x: parseInt(document.getElementById('wmX').value), y: parseInt(document.getElementById('wmY').value), w: parseInt(document.getElementById('wmW').value), h: parseInt(document.getElementById('wmH').value), color: document.getElementById('wmColor').value };
    for (let i = 0; i < files.length; i++) {
        await new Promise((resolve) => {
            const img = new Image(); img.src = URL.createObjectURL(files[i]);
            img.onload = () => {
                const mainCanvas = document.createElement('canvas'); mainCanvas.width = img.width; mainCanvas.height = img.height; const mainCtx = mainCanvas.getContext('2d'); mainCtx.drawImage(img, 0, 0);
                if (wmConfig.enabled) { mainCtx.fillStyle = wmConfig.color; mainCtx.fillRect(wmConfig.x, wmConfig.y, wmConfig.w, wmConfig.h); }
                const pieceWidth = img.width / cols, pieceHeight = img.height / rows, originalName = files[i].name.substring(0, files[i].name.lastIndexOf('.')) || files[i].name;
                for (let r = 0; r < rows; r++) { for (let c = 0; c < cols; c++) { const pieceCanvas = document.createElement('canvas'); pieceCanvas.width = pieceWidth; pieceCanvas.height = pieceHeight; const pieceCtx = pieceCanvas.getContext('2d'); pieceCtx.drawImage(mainCanvas, c * pieceWidth, r * pieceHeight, pieceWidth, pieceHeight, 0, 0, pieceWidth, pieceHeight); zip.file(`${originalName}_r${r+1}_c${c+1}.png`, pieceCanvas.toDataURL('image/png').replace(/^data:image\/(png|jpg|jpeg|webp);base64,/, ""), { base64: true }); } } resolve(); 
            }; img.onerror = () => resolve(); 
        });
    }
    zip.generateAsync({ type: 'blob' }).then(function(content) { const link = document.createElement('a'); link.href = URL.createObjectURL(content); link.download = 'processed_images.zip'; link.click(); statusDiv.innerText = '处理成功'; processBtn.disabled = false; addAuditLog('使用了多宫格图片拆分工具');});
}

// ================== AI 生图核心逻辑 (包含系统强制约束) ==================
function toggleImgGenSettings() { const panel = document.getElementById('imgGenSettingsPanel'); panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; }
function selectRatio(el, ratioText, width, height) { document.querySelectorAll('.ratio-btn').forEach(i => i.classList.remove('active')); el.classList.add('active'); currentSelectedRatioText = ratioText; document.getElementById('imgWidth').value = width; document.getElementById('imgHeight').value = height; const iconDiv = el.querySelector('.ratio-icon'); if (iconDiv) document.getElementById('toggleRatioIcon').className = iconDiv.className; document.getElementById('toggleRatioText').innerText = ratioText; }
function selectRes(el, cleanText) { document.querySelectorAll('.res-btn').forEach(i => i.classList.remove('active')); el.classList.add('active'); currentSelectedResText = cleanText; document.getElementById('toggleResText').innerText = cleanText; }
function previewGenImage(input) { if (input.files && input.files[0]) { const reader = new FileReader(); reader.onload = function(e) { currentUploadedImageBase64 = e.target.result; const wrap = document.getElementById('imgUploadPreview'); wrap.style.display = 'inline-block'; wrap.innerHTML = `<div class="img-preview-wrap"><img src="${currentUploadedImageBase64}" class="img-preview-thumb"><div class="img-preview-close" onclick="clearGenImage()">×</div></div>`; }; reader.readAsDataURL(input.files[0]); } }
function clearGenImage() { currentUploadedImageBase64 = null; document.getElementById('imgGenUpload').value = ''; document.getElementById('imgUploadPreview').style.display = 'none'; document.getElementById('imgUploadPreview').innerHTML = ''; }
function generateMockImageBase64(text, w=512, h=512) { const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg-user-msg') || '#007AFF'; ctx.fillRect(0,0,w,h); ctx.fillStyle = '#fff'; ctx.font = 'bold 36px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w/2, h/2); return canvas.toDataURL('image/png'); }

// 【杀手级功能 2】：提示词工程增强台，底层垫入标准约束
function sendImageGenMessage() {
    let u = getUserUsage(currentUserKey);
    if (u.images >= u.limit) return alert(`您的生图额度已耗尽 (已用 ${u.images} / 额度 ${u.limit})，请联系管理员增加额度！`);

    const input = document.getElementById('imgGenInput');
    let msg = input.value.trim();
    if(!msg && !currentUploadedImageBase64) return;
    
    // 获取基础参数
    const chat = chats.find(c => c.id === IMAGE_GEN_ID);
    const w = document.getElementById('imgWidth').value;
    const h = document.getElementById('imgHeight').value;
    const sel = document.getElementById('imgGenModelSelect');
    const modelText = sel.options[sel.selectedIndex].text;
    const styleValue = document.getElementById('stylePresetSelect').value;

    // 风格字典拼装
    let styleText = "";
    if(styleValue === 'guoman') styleText = "，高质量国漫精绘风格";
    else if(styleValue === 'suspense') styleText = "，现代悬疑压迫感，暗黑光影";
    else if(styleValue === 'visual_novel') styleText = "，二次元视觉小说风格，精致CG，日系赛璐璐";

    // 工业化底层约束：强制要求漫画文本为简体中文，禁止乱码繁体
    const systemConstraint = " 【强制底层约束：画面中的文本必须全部使用简体中文，绝对不能有乱码和繁体字】";
    
    // 反向提示词 (Negative Prompt) 隐式注入
    const negativePrompt = "反向提示词：bad anatomy, traditional chinese characters, gibberish, messy text";

    const finalEngineeredPrompt = (msg || '（无提示词）') + styleText + systemConstraint + "\n" + negativePrompt;

    document.getElementById('imgGenSettingsPanel').style.display = 'none';
    chat.messages.push({ role: 'user', content: `【模型】${modelText}\n【尺寸设定】${currentSelectedRatioText} (${w}x${h}) | ${currentSelectedResText}\n【提示词】${finalEngineeredPrompt}`, attachedImage: currentUploadedImageBase64 });
    input.value = ''; clearGenImage(); renderMessages();
    
    setTimeout(() => {
        incrementUsage(currentUserKey); addAuditLog(`使用了 ${modelText} 生成图片`); 
        const mockImages = [generateMockImageBase64(`图像1\n(${w}x${h})`), generateMockImageBase64(`图像2\n(${w}x${h})`), generateMockImageBase64(`图像3\n(${w}x${h})`), generateMockImageBase64(`图像4\n(${w}x${h})`)];
        chat.messages.push({ role: 'bot', type: 'image_gallery', content: '展示阵列：', images: mockImages }); saveChats(); renderMessages();
    }, 1500);
}
function downloadSingleImage(base64Data, index) { const link = document.createElement('a'); link.href = base64Data; link.download = `Img_${index+1}.png`; link.click(); }
function downloadGalleryZip(msgIndex) {
    const chat = chats.find(c => c.id === IMAGE_GEN_ID), msg = chat.messages[msgIndex]; if(!msg || !msg.images) return;
    const zip = new JSZip(); msg.images.forEach((b64, i) => { zip.file(`Img_${i+1}.png`, b64.split(',')[1], { base64: true }); });
    zip.generateAsync({ type: 'blob' }).then(content => { const link = document.createElement('a'); link.href = URL.createObjectURL(content); link.download = `Images.zip`; link.click(); addAuditLog('打包下载了生成的画廊');});
}

// ================== 主路由与通用聊天 ==================
function renderHubContent() {
    let html = `<div class="hub-container"><div class="hub-icon-big">🎬</div><div class="hub-title">剧本转分镜 (九雨)</div><button class="hub-new-btn" onclick="createNewStoryboard()" title="建立新的分镜创作空间">＋ 新建分镜项目</button><div class="hub-recent-section"><div class="hub-list-title">近期对话</div>`;
    const sbChats = chats.filter(c => c.isStoryboard).sort((a,b) => b.id - a.id);
    if (sbChats.length === 0) { html += `<div style="text-align:center; color: var(--text-secondary); padding: 30px;">暂无分镜项目</div>`; } 
    else { sbChats.forEach(c => { html += `<div class="hub-item" onclick="switchChat('${c.id}')"><div class="hub-item-icon">🎬</div><div class="hub-item-title" title="${c.title}">${c.title}</div><div class="hub-item-actions"><button onclick="openRenameModal('${c.id}', event)" title="重命名此项目">✏️ 重命名</button><button onclick="deleteChat('${c.id}', event)" title="永久删除此项目">🗑️ 删除</button></div></div>`; }); }
    return html + `</div></div>`;
}

function switchChat(id) { 
    isBulkMode = false; selectedAssetIds.clear(); 
    currentChatId = id; 
    const inputSec = document.getElementById('inputSection'), imgGenSec = document.getElementById('imageGenInputSection'), chatBox = document.getElementById('chatBox'), title = document.getElementById('headerTitle'), backBtn = document.getElementById('backToHubBtn'), editIcon = document.getElementById('headerEditIcon'), input = document.getElementById('userInput');
    const exportBtn = document.getElementById('exportPdfBtn'); // 获取 PDF 导出按钮
    
    inputSec.style.display = 'none'; imgGenSec.style.display = 'none'; backBtn.style.display = 'none'; editIcon.style.display = 'none'; exportBtn.style.display = 'none';
    if(document.getElementById('imgGenSettingsPanel')) document.getElementById('imgGenSettingsPanel').style.display = 'none';
    
    if (id === HUB_ID) { title.innerText = "九雨系统控制台"; chatBox.innerHTML = renderHubContent(); } 
    else if (id === TEAM_ASSET_ID) { title.innerText = "📁 团队公共素材库"; chatBox.innerHTML = renderAssetLibraryTool('team'); renderAssetGrid(); } 
    else if (id === PERSONAL_ASSET_ID) { title.innerText = "🔒 我的个人素材库"; chatBox.innerHTML = renderAssetLibraryTool('personal'); renderAssetGrid(); } 
    else if (id === IMAGE_SPLIT_ID) { title.innerText = "批量图片拆分与去水印工具"; chatBox.innerHTML = renderImageSplitterTool(); } 
    else if (id === IMAGE_GEN_ID) { title.innerText = "🎨 AI生图控制台"; imgGenSec.style.display = 'flex'; renderMessages(); } 
    else {
        const c = chats.find(x => x.id === id); title.innerText = c.title; editIcon.style.display = 'inline-block'; inputSec.style.display = 'flex';
        // 显示导出按钮
        exportBtn.style.display = 'inline-block'; 

        if (c.isStoryboard) { backBtn.style.display = 'inline-block'; input.placeholder = "请输入您的剧本......"; } else { input.placeholder = "请输入您的文本内容"; }
        input.value = ''; renderMessages(); 
    }
    renderSidebar(); 
}

function renderSidebar() {
    const list = document.getElementById('chatList'); list.innerHTML = '';
    let display = currentTab === 'fav' ? chats.filter(c => c.isFavorite && !c.isStoryboard && !c.isImageGen) : chats.filter(c => !c.isStoryboard && !c.isImageGen); 
    
    document.getElementById('storyboardBtn').classList.toggle('active', currentChatId === HUB_ID || chats.find(c=>c.id===currentChatId)?.isStoryboard);
    document.getElementById('imageGenBtn').classList.toggle('active', currentChatId === IMAGE_GEN_ID);
    document.getElementById('teamAssetBtn').classList.toggle('active', currentChatId === TEAM_ASSET_ID);
    document.getElementById('personalAssetBtn').classList.toggle('active', currentChatId === PERSONAL_ASSET_ID);
    document.getElementById('imageSplitBtn').classList.toggle('active', currentChatId === IMAGE_SPLIT_ID);
    
    display.sort((a,b)=>(b.isPinned - a.isPinned) || (b.id - a.id)).forEach(c => {
        const div = document.createElement('div'); div.className = `chat-item ${c.id === currentChatId ? 'active' : ''}`; div.onclick = () => switchChat(c.id);
        div.innerHTML = `<span class="chat-title" title="${c.title}">${c.isPinned?'📌 ':''}💬 ${c.title}</span><div class="chat-actions"><button class="action-btn" onclick="togglePin('${c.id}', event)" title="${c.isPinned?'取消置顶':'置顶对话'}">📍</button><button class="action-btn" onclick="toggleFav('${c.id}', event)" title="${c.isFavorite?'取消收藏':'收藏对话'}">${c.isFavorite?'🌟':'⭐'}</button><button class="action-btn" onclick="openRenameModal('${c.id}', event)" title="重命名">✏️</button><button class="action-btn" onclick="deleteChat('${c.id}', event)" title="删除">🗑️</button></div>`;
        list.appendChild(div);
    });
}

function renderMessages() {
    if([HUB_ID, IMAGE_SPLIT_ID, TEAM_ASSET_ID, PERSONAL_ASSET_ID].includes(currentChatId)) return;
    const box = document.getElementById('chatBox'); box.innerHTML = '';
    const chat = chats.find(c => c.id === currentChatId); if(!chat) return;
    
    chat.messages.forEach((m, index) => {
        const div = document.createElement('div'); div.className = `message ${m.role === 'user' ? 'user-msg' : 'bot-msg'}`;
        const contentDiv = document.createElement('div'); contentDiv.className = 'msg-content'; contentDiv.textContent = m.content; 
        if (m.role === 'user' && m.attachedImage) { const imgWrap = document.createElement('div'); imgWrap.style.marginTop = '10px'; imgWrap.innerHTML = `<img src="${m.attachedImage}" style="max-width: 120px; border-radius: 8px; border: 2px solid rgba(255,255,255,0.3);">`; contentDiv.appendChild(imgWrap); }
        if (m.type === 'image_gallery' && m.images) {
            const galleryDiv = document.createElement('div'); galleryDiv.className = 'gallery-container';
            m.images.forEach((imgBase64, imgIndex) => { const item = document.createElement('div'); item.className = 'gallery-item'; item.innerHTML = `<img src="${imgBase64}"><button class="dl-btn" onclick="downloadSingleImage('${imgBase64}', ${imgIndex})" title="保存此单张图片">⬇️</button>`; galleryDiv.appendChild(item); });
            contentDiv.appendChild(galleryDiv);
        }
        
        const actionBar = document.createElement('div'); actionBar.className = 'msg-actions';
        
        // 【联动功能 1】：在分镜助手的机器回复处，加入提取并生图按钮
        if (chat.isStoryboard && m.role === 'bot') {
            const extractBtn = document.createElement('button'); extractBtn.className = 'msg-action-btn'; extractBtn.innerHTML = '✨ 提取并生成画面'; extractBtn.title = "自动提取此镜头的描述去生成对应的图片";
            extractBtn.onclick = () => extractAndGenerateImage(m.content); actionBar.appendChild(extractBtn);
        }

        if (m.type === 'image_gallery') { const zipBtn = document.createElement('button'); zipBtn.className = 'msg-action-btn'; zipBtn.innerHTML = '📦 打包下载 ZIP'; zipBtn.title = "将本次生成的所有图片打包下载"; zipBtn.onclick = () => downloadGalleryZip(index); actionBar.appendChild(zipBtn); }
        const copyBtn = document.createElement('button'); copyBtn.className = 'msg-action-btn'; copyBtn.innerHTML = '📋 一键复制'; copyBtn.title = "复制本段文字内容"; copyBtn.onclick = () => { navigator.clipboard.writeText(m.content).then(() => { copyBtn.innerHTML = '✅ 已复制'; setTimeout(() => copyBtn.innerHTML = '📋 一键复制', 2000); }); }; actionBar.appendChild(copyBtn);
        if (currentChatId !== IMAGE_GEN_ID) { const delBtn = document.createElement('button'); delBtn.className = 'msg-action-btn delete-action'; delBtn.innerHTML = '🗑️ 删除'; delBtn.title = "删除此条回复记录"; delBtn.onclick = () => { openConfirmModal(() => { chat.messages.splice(index, 1); saveChats(); renderMessages(); }); }; actionBar.appendChild(delBtn); }
        div.appendChild(contentDiv); div.appendChild(actionBar); box.appendChild(div);
    });
    box.scrollTop = box.scrollHeight;
}

// 【杀手级功能 3】：自动化剧本/分镜表排版导出 (利用 print 引擎转 PDF)
function exportToPDF() {
    const chat = chats.find(c => c.id === currentChatId);
    if (!chat || chat.messages.length === 0) return alert("当前文档没有可导出的内容。");
    
    let printHTML = `<h1 style="text-align: center;">${chat.title}</h1><hr style="margin-bottom: 20px;">`;
    chat.messages.forEach((m) => {
        printHTML += `<div class="print-msg">
            <div class="print-role">${m.role === 'user' ? '🎬 剧本/输入' : '🎥 分镜描述/AI回复'}</div>
            <div class="print-content">${m.content}</div>`;
        if (m.attachedImage) printHTML += `<img src="${m.attachedImage}" class="print-img">`;
        if (m.type === 'image_gallery' && m.images) {
            printHTML += `<div style="display:flex; gap:10px; margin-top:10px; flex-wrap:wrap;">`;
            m.images.forEach(img => printHTML += `<img src="${img}" class="print-img" style="max-width: 200px;">`);
            printHTML += `</div>`;
        }
        printHTML += `</div>`;
    });
    
    const printArea = document.getElementById('printArea');
    printArea.innerHTML = printHTML;
    addAuditLog('导出了剧本分镜 PDF 文档');
    
    // 调用浏览器打印（可保存为PDF）
    window.print();
}

function createNewChat() { const id = Date.now().toString(); chats.unshift({id, title:"💬 新闲聊", messages:[], isPinned:false, isFavorite:false, isStoryboard:false}); saveChats(); switchChat(id); }
function createNewStoryboard() { const id = Date.now().toString(); chats.unshift({id, title:"未命名分镜项目", messages:[], isPinned:false, isFavorite:false, isStoryboard:true}); saveChats(); switchChat(id); addAuditLog('新建了分镜项目');}
function saveChats() { if(currentUserKey) localStorage.setItem('chats_' + currentUserKey, JSON.stringify(chats)); }
function togglePin(id, e) { e.stopPropagation(); const c = chats.find(x=>x.id===id); c.isPinned = !c.isPinned; saveChats(); renderSidebar(); }
function toggleFav(id, e) { e.stopPropagation(); const c = chats.find(x=>x.id===id); c.isFavorite = !c.isFavorite; saveChats(); renderSidebar(); }
function switchTab(t) { currentTab = t; document.getElementById('tab-all').classList.toggle('active', t==='all'); document.getElementById('tab-fav').classList.toggle('active', t==='fav'); renderSidebar(); }
function deleteChat(id, e) { e.stopPropagation(); openConfirmModal(() => { chats = chats.filter(x=>x.id!==id); saveChats(); if(currentChatId === HUB_ID || currentChatId === id) { switchChat(HUB_ID); } else { renderSidebar(); } }); }
function renameCurrentChat() { if (![HUB_ID, IMAGE_GEN_ID, IMAGE_SPLIT_ID, TEAM_ASSET_ID, PERSONAL_ASSET_ID].includes(currentChatId)) { openRenameModal(currentChatId, new Event('click')); } }
function openRenameModal(id, e) { e.stopPropagation(); renamingChatId = id; document.getElementById('renameInput').value = chats.find(c => c.id === id).title; document.getElementById('renameModal').classList.add('show'); }
function closeRenameModal() { document.getElementById('renameModal').classList.remove('show'); }
function confirmRename() { const v = document.getElementById('renameInput').value.trim(); if(v) { const c = chats.find(x=>x.id===renamingChatId); c.title = v; if(renamingChatId===currentChatId) document.getElementById('headerTitle').innerText=v; saveChats(); if(currentChatId === HUB_ID) document.getElementById('chatBox').innerHTML = renderHubContent(); else renderSidebar(); } closeRenameModal(); }
function toggleTheme() { document.body.classList.toggle('dark-theme'); }

async function sendMessage() {
    if(!currentUserKey) return;
    const k = currentUserKey, modelType = document.getElementById('modelSelect').value, input = document.getElementById('userInput'), msg = input.value.trim(), chat = chats.find(c => c.id === currentChatId);
    if(!msg || !chat) return; chat.messages.push({ role:'user', content:msg });
    if(chat.title.includes("新") || chat.title.includes("未命名")) { chat.title = msg.substring(0,12); document.getElementById('headerTitle').innerText = chat.title; }
    input.value = ''; renderMessages();
    try {
        const res = await fetch(`${API_BASE_URL}/chat`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ password:k, message:msg, history:chat.messages.slice(0,-1), model_type:modelType }) });
        const d = await res.json(); chat.messages.push({ role:'bot', content: res.ok ? (d.reply || d.error) : (d.error || "请求异常") });
        saveChats(); renderMessages(); renderSidebar();
    } catch(e) { chat.messages.push({ role:'bot', content:"网络连接失败，请重试~" }); renderMessages(); }
}
init();