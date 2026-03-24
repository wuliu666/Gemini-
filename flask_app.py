import sys, os, json, string, random, requests, sqlite3, uuid, base64
import google.generativeai as genai
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  
CORS(app, supports_credentials=True, resources={r"/*": {"origins": "*"}})

# ================= 配置区 =================
MASTER_KEY = "admin_666"      
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KEYS_FILE = os.path.join(BASE_DIR, "keys.json")

DB_FILE = os.path.join(BASE_DIR, 'assets.db')
ASSETS_DIR = os.path.join(BASE_DIR, 'static', 'assets')

if not os.path.exists(ASSETS_DIR): os.makedirs(ASSETS_DIR)

def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY, title TEXT, type TEXT, prompt TEXT, 
        file_path TEXT, library_mode TEXT, uploader_key TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    # 升级版会话表：分离电脑端和手机端的 Token，允许双端同时在线，同端互踢
    c.execute('''CREATE TABLE IF NOT EXISTS user_sessions_v2 (
        user_key TEXT PRIMARY KEY, desktop_token TEXT, mobile_token TEXT, last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS user_chats (
        user_key TEXT PRIMARY KEY, chat_data TEXT
    )''')
    conn.commit()
    conn.close()
init_db()

def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description): d[col[0]] = row[idx]
    return d

# 👇 九雨团队专属系统提示词 👇
AGENT_SOUL = """
### 初始化指令
欢迎使用九雨团队剧本转分镜功能
 
---
*初始化完成后，系统将进入就绪状态。以下为工作指令。*
 
故事小说
 
输入信息
 
上下文参考
{{前面文案}}
- 前一个分镜：前一个分镜内容作为当前分镜的前序内容，要保持故事进展的顺序逻辑，是当前分镜的铺垫，如果为第一个分镜则留空。
{{前面分镜2}}
- 后一个分镜：后一个分镜内容作为当前分镜的后续内容，当前分镜的故事进展要与后一个分镜连贯顺畅，保证故事的完整。
{{后面分镜2}}
 
输入文案规则
输入文案是动态画面和台词的唯一来源，所有内容必须严格限定在【输入文案】的信息范围内，绝不进行任何超出原文的联想或创造。
 
【补充：上游剧本格式识别与转换协议】
您接收的【输入文案】是上游“剧本改编工具”的产出，包含特殊标记。您必须按此协议处理：
1. `▲` 动作行：此符号后的内容为核心戏剧动作，必须作为`video_prompt`描述的骨架和时序依据。
2.  `（OS）` 或 `（心声）`：
    -严禁直接生成为画外音。
    -必须转化为角色的面部特写镜头（捕捉复杂表情变化）或一个标志性肢体动作（如握拳、深呼吸、冷笑）。
    -仅在`配音指令`的“状态”中标注“（内心独白）”。
3.  `角色：（表情）台词`：
    - `台词` -> 填入【对话模块】的`台词`字段。
    - `（表情）` -> 转化为具体的表演指令，写入镜头`场景`描述中。
4.  `（回忆）`：必须在`video_prompt`中使用视觉特效描述，如“画面做旧褪色、慢动作、柔光叠化转场”。
5.  文学表述转化词典（遇到即触发）：
    - “时间流逝/几年后” -> 使用快速蒙太奇（数个1秒镜头展示标志性变化）。
    - “他心中一动/灵光一闪” -> 眼部大特写，瞳孔微缩，眼神骤亮，可配合`[音效：细微叮声]`。
    - “全场哗然” -> 快速横摇或甩镜扫过3-4张不同的震惊面孔，配合`[音效：环境喧哗声]`。
 
输入文案(当前输入文案唯一来源)
{{输入文案}}
 
---
 
### 【最高协议层：生成铁律】
在开始任何创作前，您必须按以下绝对优先级执行：
1.  宪法级（绝不可违反）：
   a.  **来源与认证**：所有内容必须严格基于 `{{输入文案}}`。
   b.  时空连续：必须参考 `{{前面分镜2}}` 和 `{{后面分镜2}}`，确保动作、视线、位置无缝衔接。
   c.  格式克隆：输出必须与下方 `#输出示例1` 的所有格式、标签、标点完全一致。
 
2.  反射级（条件触发，必须执行）：
    -触发“对话” -> 必须使用“过肩正反打”，关键台词给说话者特写，强烈反应给听者特写。
    -触发“强烈情绪”（震惊/愤怒）-> 下一镜头必须切入角色反应特写（眼/手/呼吸）。
    -触发“关键道具”（信/凶器）-> 必须给道具大特写（≥2秒），后接发现者反应镜头。
    -触发“强弱关系” -> 强者用微俯拍/前景，弱者用仰拍/后景。
 
3.  节奏级（诊断与执行）：
    首先诊断本段15秒文案的核心情绪，并锁定镜头风格：
    -激烈/爆发（打斗、奔跑）：镜头极短（1-3秒），用甩镜、急推、大特写、手持抖动。
    -紧张/对峙（解密、威胁）：镜头短（2-5秒），用快速变焦、缓慢推近、特写。
    -常态/叙事（对话、日常）：镜头中等（3-7秒），用平稳横移、跟拍、中近景。
    -舒缓/抒情（回忆、抒情）：镜头长（5-15秒），用缓推、固定镜头、全景/中景。
 
【补充：冲突解决协议】
- “一镜到底” vs “节奏控制”：以“节奏控制”为准。激烈场面必须快速切镜，放弃长镜头。
- “情绪诊断” vs “默认语法”：以“情绪诊断”为准。抒情段落即使有对话，也用缓推而非快速正反打。
- 多规则同时触发：按此优先级执行：`关键道具` > `强烈情绪` > `对话` > `强弱关系`。
 
---
 
生成规则 (必须严格遵守)
1. 内容来源：生成的所有内容必须严格基于 【当前分镜的核心文案】。绝不允许虚构、联想或添加文案中未提及的任何情节、动作、场景或角色心理。
2. 保持连续性：你必须参考 【前一个分镜】 和 【后一个分镜】 的信息，确保新分镜的起始画面状态与前一镜的结束画面状态无缝衔接，同时为后一镜的画面开始做好铺垫。
3. 提示词分工：
  - 图片提示词 (prompt)：用一句话描述这个分镜中最具代表性的静态画面。侧重于构图、人物姿态、环境和氛围。此部分不使用特殊映射代码。
  - 视频提示词 (video_prompt)：描述从分镜开始到结束的连续动态画面。此部分必须使用特殊映射代码，并严格遵循以下镜头语法。
 
## 【导演决策核心协议】
 
在开始创作前，你必须将自己视为导演，按此协议决策：
 
### 第一阶段：诊断 (Diagnosis)
1. **剧情类型诊断**：识别当前15秒片段属于哪种核心剧情模式？
   - `重生觉醒/实力反转` -> 触发“扮猪吃虎”模板。
   - `悬疑揭秘/关键线索` -> 触发“悬疑压迫”模板。
   - `甜宠互动/情感升温` -> 触发“情感沉浸”模板。
   - `激烈对抗/战斗` -> 触发“力量爆发”模板。
2. **情绪频谱诊断**：判断当前段落的**核心情绪轴**（可多选，排优先级）：
   - 情绪A：`压抑/恐惧` -> 调用“阴郁视觉库”。
   - 情绪B：`愤怒/爆发` -> 调用“激进运镜库”。
   - 情绪C：`悲伤/抒情` -> 调用“诗意缓动库”。
   - 情绪D：`悬疑/思考` -> 调用“焦点引导库”。
 
### 第二阶段：匹配 (Matching)
自动从后文的“**高级战术库**”中调用对应的镜头、光影、声音套餐，进行组合。
 
### 第三阶段：组装 (Assembly)
将匹配到的战术元素，严格按照下文“**输出格式宪法**”组装成最终分镜。禁止任何格式偏差。
 
##转换要求
1. 目标：
把【输入文案】改写成“场—15秒分镜组—镜头”结构的标准短剧分镜剧本，节奏快、信息清晰、可直接拍摄。如果画面没有对白和明确的表达内容，不加入对白、旁白和内心OS，只呈现动态的镜头画面和声音。
 
2. 分镜组核心逻辑
时长：每个分镜组严格控制在15秒以内。
镜头数：默认1个镜头（追求一镜到底）。仅在发生时空跳跃、主观视角切换或情绪断裂时，可切分为2个镜头。严禁使用3个或以上镜头。
节奏：镜头时长和运动必须严格遵循上方“节奏级”诊断结果。
 
3. 必须遵守的拍摄清单
- 新场景：第一个镜头必须是全景或中景，建立空间关系。
- 人物移动：使用跟踪镜头（跟拍、侧移）。
- 对话：必须使用过肩镜头(OTS)建立轴线，并进行正反打。
- 情绪点：在情绪顶点切入角色面部或手部特写。
- 关键物：在道具被揭示时，给予其大特写并保持。
- 结尾：每个分镜组的最后一个镜头，必须是特写或大特写（表情/关键物），在张力顶点结束。
 
## 【高级战术库：导演的预制方案】
 
### 1. 剧情模式战术包
- **扮猪吃虎包**（用于实力反转）：
  - **开场**：弱者低机位仰视强者，画面压抑。
  - **转折点**：一个极短的静止帧（0.3秒），弱者眼神骤变。
  - **反击**：镜头运动从缓慢突然变为**高速甩镜、急推、瞬间特写**，配合[音效：刀剑出鞘/破风声]。
  - **结尾**：给胜利者一个**平静的俯视特写**，与开场形成绝对反差。
 
- **悬疑压迫包**（用于揭秘）：
  - **核心**：大量使用**浅景深**，焦点在对话者和关键道具间缓慢转移。
  - **运镜**：多用**缓慢的推近**制造窒息感，或**快速的横摇**制造突然发现。
  - **声音**：持续的低频环境音，关键信息揭露时**声音骤停**。
  - **剪辑**：在给出答案前，插入一个**无关但令人不安的物体特写**（如晃动的吊灯、滴水的水龙头）作为干扰项。
 
- **情感沉浸包**（用于甜宠/虐恋）：
  - **核心**：**双人镜头**优先，多用**过肩镜头**建立亲密空间。
  - **运镜**：**环绕镜头**、**同步手持跟随**，制造“共同经历”感。
  - **节奏**：镜头时长**适当放长**（5-8秒），给情绪留白。
  - **特效**：可酌情添加**柔光、粒子、慢动作**突出唯美瞬间。
 
### 2. 情绪视觉化包
- **阴郁视觉库**（压抑/恐惧）：低饱和度、高对比度、冷色调（蓝/青）。光影：硬光，大面积的阴影吞噬角色。构图：角色被置于画面边缘或前景遮挡。
- **激进运镜库**（愤怒/爆发）：镜头时长极短（0.5-2秒）。运动：**甩镜、急速变焦、旋转、破碎式剪辑**。景别：大量**大特写**（眼睛、拳头、武器）。
- **诗意缓动库**（悲伤/抒情）：镜头运动匀速且慢，多用**推、拉、摇**，忌快速切换。光影：柔光、逆光、剪影。声音：加入环境音（雨声、风声）或抒情音乐。
- **焦点引导库**（悬疑/思考）：通过**焦点转移**（从模糊到清晰）引导观众视线。常用**窥视构图**（门缝、钥匙孔）、**分裂画面**表现内心挣扎。
 
### 3. 复杂场景处理包
- **群戏处理**：
  - 建立：首个镜头必须是**全景**，交代所有人位置。
  - 核心：采用**多焦点构图**，利用景深将人群分层。
  - 对话：在多人对话中，采用**三角形调度法**，镜头在三个关键人物间循环切换，形成张力。
- **长镜头动作戏**：
  - 设计一个**核心动线**（如从走廊打到客厅）。
  - 运镜**严格绑定主体**：主角冲，镜头跟；主角转身，镜头甩。
  - 在动作间隙（如撞到墙的瞬间）插入**0.5秒的对手反应特写**，再切回主镜头。
 
【特殊情境预设镜头库】
- 表现“思考/计算”：角色眼部快速微动特写 + 手指无意识敲击/笔尖快速书写特写 + 脑内信息碎片闪回（0.5秒/个）。
- 表现“跟踪/监视”：主观视角 + 前景遮挡物（树叶/栏杆） + 长焦压缩感 + 轻微手持呼吸感。
- 表现“巨大冲击/爆炸”：中心特写 -> 白光（2帧） -> 黑场（2帧） -> 慢动作碎片飞溅 -> 角色被气浪推飞的仰拍。
- 表现“深情对视”：双方眼部特写交替切换，镜头缓推，背景虚化。
 
【高阶运镜灵感库】（在遵循基础规则的前提下，可择优选用）
增强“震惊”：除了“急推”，可考虑“快速变焦（从模糊到清晰）”或“镜头猛地后拉，同时主角前冲”的对比运动。
增强“压迫”：在对方拿出关键道具时，可使用“从对方冷笑的嘴角，快速甩镜至道具特写”。
增强“心理活动”：在角色看到关键信息时，可插入“匹配剪辑”：如怀表徽记大特写 → 快速闪回（0.5秒）另一个出现相同徽记的记忆碎片。
 
【高级特效描述库】
魔法释放：“掌心凝聚出旋转的蓝色能量球体，周围空气因高温而扭曲，伴有粒子溅射效果。”
时空穿越：“角色身影化作无数道向后飞驰的流光残影，背景场景快速解构与重组。”
内心世界：“画面分裂为多重镜像，每个镜像展示不同的记忆片段，伴随扭曲的低声耳语。”
 
4. 创作原则库（用于优化描述）
- 可视化：禁止“他想”、“她感到”。必须转化为具体的表情、动作或台词。
- 连贯性：确保动作衔接、视线匹配、位置一致、色调统一。
- 运镜描述：在`video_prompt`中描述景别、机位角度、镜头运动（如“特写，俯拍，快速推进”）及运动节奏。
- 声音标注：明确标出`[音效：...]`和`[音乐]`，对白放入【对话模块】。
- 模块化：同一连续场景的多镜头共享同样的基础光线、服装和空间布局。
 
---
 
### 最终输出格式与规范
你必须生成一个完整的分镜工作包，其格式、结构与写作风格必须与下方的 “#输出示例1” 完全一致。`#输出示例1`是您输出格式的唯一且绝对的宪法。
 
### 【输出格式化前的最终校验】
生成最终输出前，必须执行：
1. 按宪法组装分镜。
【输出格式的绝对明文规定】
以下格式细节，无论示例中如何，都必须严格遵守：
1. 标点：镜头描述中动作序列用“→”连接，单个动作时长标注用“（Xs）”（如“（2.5s）”），禁止使用“2.5秒”等其他格式。
2. 占位符：配音指令中必须使用“角色｜VoiceID｜状态（...）｜语气（...）”的格式，竖线分隔，状态和语气括号不可省略。
3. 台词格式：台词：“...”这一行，冒号必须使用全角中文冒号“：”，且引号内为台词完整内容。
4. 时间点格式：`对应镜头`中的时间点必须使用“`000-XXX`”格式，不足三位用0补齐。例如：`002-010`，`000-005`。
 
## 【输出格式化宪法】
你的最终输出必须是一个可被机器解析的极度标准化的“工作包”。格式是最高法律。
 
### 格式结构（必须严格遵循，与示例1完全一致）：
剧情：[用一句话概括本段核心矛盾]
高光：[提炼本段最吸引人的视觉爆点]
背景：[场景+时间+光线+氛围]
环境：[更具体的环境、道具、位置关系描述]
 
镜头 1
持续时间 [N] 秒
场景 【运镜描述】镜头起始画面（Xs）→发展动作（Ys）→ 结果画面（Zs）。
 
【对话模块】
台词：“...”
配音指令：角色名｜VoiceID｜状态（...）｜语气（...）
对应镜头：镜头X，时间点 000-XXX
 
[更多镜头...]
 
物理接戏：镜头从【上一镜的关键锚点】开始，紧接着【本镜的核心动作】，最后停在【下一镜的承接锚点】。
 
### 写作细则：
1. **场景描述**：必须用`【】`括起运镜，用`→`连接动作，每个动作后必须用`（Xs）`注明时长。禁止使用“然后”、“接着”等词汇。
2. **时长管理**：所有镜头时长相加必须严格等于15秒。单镜头时长由“节奏控制器”和“剧情诊断”共同决定。
3. **术语使用**：可以使用专业术语（如OSS、推焦），但必须在括号内用白话解释效果（如“营造压迫感”）。
"""

def load_keys():
    if os.path.exists(KEYS_FILE):
        try:
            with open(KEYS_FILE, 'r', encoding='utf-8') as f: return json.load(f)
        except: pass
    return {MASTER_KEY: {"status": "active", "note": "超级管理员", "is_deleted": False}}

def save_keys(data):
    with open(KEYS_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=4)

# ================= 🛡️ 智能设备漫游与同步 API =================
@app.route('/api/heartbeat', methods=['POST'])
def heartbeat():
    data = request.json
    user_key = data.get('user_key')
    session_token = data.get('session_token')
    device_type = data.get('device_type')
    
    if not user_key or not session_token or not device_type: return jsonify({"valid": False})
    
    # 管理员特权：永远在线，允许多设备无限登录
    if user_key == MASTER_KEY:
        return jsonify({"valid": True})
        
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT desktop_token, mobile_token FROM user_sessions_v2 WHERE user_key=?", (user_key,))
    row = c.fetchone()
    conn.close()
    
    if row:
        desktop_token, mobile_token = row
        # 校验对应的设备类型的Token
        if device_type == 'desktop' and desktop_token == session_token: return jsonify({"valid": True})
        if device_type == 'mobile' and mobile_token == session_token: return jsonify({"valid": True})
        
    return jsonify({"valid": False})

@app.route('/verify', methods=['POST'])
def verify():
    pwd = request.json.get('password')
    session_token = request.json.get('session_token')
    device_type = request.json.get('device_type') # 'desktop' 或 'mobile'
    keys = load_keys()
    
    if pwd in keys:
        if keys[pwd].get("is_deleted", False):
            return jsonify({"error": "请联系管理员~"}), 403
            
        conn = sqlite3.connect(DB_FILE)
        c = conn.cursor()
        
        # 插入或更新该设备类型的 Token，实现同类型设备互踢，不同类型设备共存
        c.execute("SELECT user_key FROM user_sessions_v2 WHERE user_key=?", (pwd,))
        if c.fetchone():
            if device_type == 'desktop':
                c.execute("UPDATE user_sessions_v2 SET desktop_token=?, last_active=CURRENT_TIMESTAMP WHERE user_key=?", (session_token, pwd))
            else:
                c.execute("UPDATE user_sessions_v2 SET mobile_token=?, last_active=CURRENT_TIMESTAMP WHERE user_key=?", (session_token, pwd))
        else:
            if device_type == 'desktop':
                c.execute("INSERT INTO user_sessions_v2 (user_key, desktop_token) VALUES (?, ?)", (pwd, session_token))
            else:
                c.execute("INSERT INTO user_sessions_v2 (user_key, mobile_token) VALUES (?, ?)", (pwd, session_token))
        conn.commit()
        conn.close()
        
        return jsonify({"status": "success", "is_admin": (pwd == MASTER_KEY), "note": keys[pwd].get("note", "Creator")})
    return jsonify({"error": "请输入你的内容"}), 403

@app.route('/api/get_chats', methods=['POST'])
def get_chats():
    user_key = request.json.get('user_key')
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("SELECT chat_data FROM user_chats WHERE user_key=?", (user_key,))
    row = c.fetchone()
    conn.close()
    if row: return jsonify(json.loads(row[0]))
    return jsonify([])

@app.route('/api/save_chats', methods=['POST'])
def save_chats():
    data = request.json
    user_key = data.get('user_key')
    chat_data = json.dumps(data.get('chats', []))
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("INSERT OR REPLACE INTO user_chats (user_key, chat_data) VALUES (?, ?)", (user_key, chat_data))
    conn.commit()
    conn.close()
    return jsonify({"success": True})

# ================= 真实文件系统 API =================
@app.route('/api/upload_asset', methods=['POST'])
def upload_asset():
    if 'file' not in request.files: return jsonify({"error": "No file"}), 400
    file = request.files['file']
    title = request.form.get('title', '未命名')
    asset_type = request.form.get('type', 'character')
    prompt = request.form.get('prompt', '')
    library_mode = request.form.get('library_mode', 'team')
    user_key = request.form.get('user_key', '')
    thumb_base64 = request.form.get('thumb_base64', '')

    ext = os.path.splitext(file.filename)[1]
    if not ext: ext = '.png'
    unique_id = f"asset_{uuid.uuid4().hex}"
    filename = f"{unique_id}{ext}"
    
    file_path = os.path.join(ASSETS_DIR, filename)
    file.save(file_path)
    rel_path = f"/static/assets/{filename}"
    
    if thumb_base64 and "," in thumb_base64:
        try:
            header, encoded = thumb_base64.split(",", 1)
            thumb_data = base64.b64decode(encoded)
            with open(os.path.join(ASSETS_DIR, f"{unique_id}_thumb.jpg"), "wb") as f: f.write(thumb_data)
        except: pass

    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("INSERT INTO assets (id, title, type, prompt, file_path, library_mode, uploader_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
              (unique_id, title, asset_type, prompt, rel_path, library_mode, user_key))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "asset": {"id": unique_id, "title": title, "type": asset_type, "prompt": prompt, "image": rel_path, "library_mode": library_mode}})

@app.route('/api/get_assets', methods=['POST'])
def get_assets():
    data = request.json
    library_mode = data.get('library_mode', 'team')
    user_key = data.get('user_key', '')
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = dict_factory
    c = conn.cursor()
    if library_mode == 'team': c.execute("SELECT id, title, type, prompt, file_path as image FROM assets WHERE library_mode='team' ORDER BY created_at DESC")
    else: c.execute("SELECT id, title, type, prompt, file_path as image FROM assets WHERE library_mode='personal' AND uploader_key=? ORDER BY created_at DESC", (user_key,))
    rows = c.fetchall()
    conn.close()
    for r in rows:
        expected_thumb = r['image'].rsplit('.', 1)[0] + '_thumb.jpg'
        if os.path.exists(os.path.join(BASE_DIR, expected_thumb.lstrip('/'))): r['thumb'] = expected_thumb
        else: r['thumb'] = r['image']
    return jsonify(rows)

@app.route('/api/delete_asset', methods=['POST'])
def delete_asset():
    asset_ids = request.json.get('ids', [])
    if not asset_ids: return jsonify({"success": True})
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    placeholders = ','.join('?' for _ in asset_ids)
    c.execute(f"SELECT file_path FROM assets WHERE id IN ({placeholders})", asset_ids)
    paths = c.fetchall()
    for p in paths:
        rel = p[0].lstrip('/') 
        full_path = os.path.join(BASE_DIR, rel)
        thumb_path = os.path.join(BASE_DIR, p[0].rsplit('.', 1)[0].lstrip('/') + '_thumb.jpg')
        if os.path.exists(full_path): os.remove(full_path)
        if os.path.exists(thumb_path): os.remove(thumb_path)
    c.execute(f"DELETE FROM assets WHERE id IN ({placeholders})", asset_ids)
    conn.commit()
    conn.close()
    return jsonify({"success": True})

@app.route('/api/update_asset', methods=['POST'])
def update_asset():
    data = request.json
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute("UPDATE assets SET title=?, type=?, prompt=? WHERE id=?", (data.get('title'), data.get('type'), data.get('prompt'), data.get('id')))
    conn.commit()
    conn.close()
    return jsonify({"success": True})
    
@app.route('/api/bulk_update_category', methods=['POST'])
def bulk_update_category():
    data = request.json
    asset_ids = data.get('ids', [])
    new_type = data.get('type')
    if not asset_ids or not new_type: return jsonify({"success": False})
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    placeholders = ','.join('?' for _ in asset_ids)
    c.execute(f"UPDATE assets SET type=? WHERE id IN ({placeholders})", [new_type] + asset_ids)
    conn.commit()
    conn.close()
    return jsonify({"success": True})

# ================= 全局 API 与 聊天路由 =================
@app.route('/admin/get_config', methods=['POST'])
def get_config():
    if request.json.get('admin_key') != MASTER_KEY: return jsonify({"error": "无权"}), 403
    keys = load_keys()
    return jsonify(keys.get('__GLOBAL_CONFIG__', {"gemini_key": "", "geeknow_key": "", "grsai_key": ""}))

@app.route('/admin/save_config', methods=['POST'])
def save_config():
    data = request.json
    if data.get('admin_key') != MASTER_KEY: return jsonify({"error": "无权"}), 403
    keys = load_keys()
    keys['__GLOBAL_CONFIG__'] = {"gemini_key": data.get('gemini_key', ''),"geeknow_key": data.get('geeknow_key', ''),"grsai_key": data.get('grsai_key', '')}
    save_keys(keys)
    return jsonify({"success": True})

@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    pwd, msg, hist = data.get('password'), data.get('message'), data.get('history', [])
    source = data.get('api_source', 'gemini') 
    actual_model_name = data.get('model_type', 'gemini-3-pro-preview' if source == 'geeknow' else 'gemini-3.1-pro') 
    keys = load_keys()
    if pwd not in keys or keys[pwd].get("is_deleted", False): return jsonify({"error": "请联系管理员~"}), 403
    global_conf = keys.get('__GLOBAL_CONFIG__', {})
    dynamic_key = global_conf.get(f'{source}_key', '')
    if not dynamic_key: return jsonify({"error": f"系统暂未配置 [{source}] 通道的 API Key，请联系管理员~"}), 400
        
    warning_msg = ""
    try:
        if source == "gemini":
            genai.configure(api_key=dynamic_key)
            model = genai.GenerativeModel(model_name=actual_model_name, system_instruction=AGENT_SOUL)
            formatted = [{"role": "user" if m["role"]=="user" else "model", "parts": [m["content"]]} for m in hist]
            chat_session = model.start_chat(history=formatted)
            response = chat_session.send_message(msg)
            return jsonify({"reply": response.text})
        else:
            messages = [{"role": "system", "content": AGENT_SOUL}]
            for m in hist: messages.append({"role": "user" if m["role"]=="user" else "assistant", "content": m["content"]})
            messages.append({"role": "user", "content": msg})
            headers = {"Authorization": f"Bearer {dynamic_key}", "Content-Type": "application/json"}
            payload = {"model": actual_model_name, "messages": messages, "temperature": 0.7}
            api_url = "https://www.geeknow.top/v1/chat/completions" if source == "geeknow" else "https://api.grsai.com/v1/chat/completions"
            resp = requests.post(api_url, json=payload, headers=headers, timeout=60)
            if resp.ok: return jsonify({"reply": resp.json()['choices'][0]['message']['content'] + warning_msg})
            else: return jsonify({"error": f"中转API报错: {resp.text}"}), 500
    except Exception as e:
        return jsonify({"error": f"API 调用失败: {str(e)}"}), 500

# ================= 后台密钥管理 =================
@app.route('/admin/list', methods=['POST'])
def list_keys():
    if request.json.get('admin_key') != MASTER_KEY: return jsonify({"error": "无权"}), 403
    return jsonify({"keys": load_keys()})

@app.route('/admin/create', methods=['POST'])
def create_key():
    data = request.json
    if data.get('admin_key') != MASTER_KEY: return jsonify({"error": "无权"}), 403
    new_k = ''.join(random.choice(string.ascii_letters + string.digits) for _ in range(18))
    keys = load_keys()
    keys[new_k] = {"status": "active", "note": data.get('note', '新团队成员'), "is_deleted": False}
    save_keys(keys)
    return jsonify({"success": True, "new_key": new_k})

@app.route('/admin/toggle_delete', methods=['POST'])
def toggle_delete():
    data = request.json
    if data.get('admin_key') != MASTER_KEY: return jsonify({"error": "无权"}), 403
    target = data.get('target_key')
    keys = load_keys()
    if target in keys and target != MASTER_KEY:
        keys[target]["is_deleted"] = not keys[target].get("is_deleted", False)
        save_keys(keys)
        return jsonify({"success": True})
    return jsonify({"error": "操作失败"}), 404

@app.route('/admin/hard_delete', methods=['POST'])
def hard_delete():
    data = request.json
    if data.get('admin_key') != MASTER_KEY: return jsonify({"error": "无权"}), 403
    target = data.get('target_key')
    keys = load_keys()
    if target in keys and target != MASTER_KEY:
        del keys[target] 
        save_keys(keys)
        return jsonify({"success": True})
    return jsonify({"error": "操作失败"}), 404

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
