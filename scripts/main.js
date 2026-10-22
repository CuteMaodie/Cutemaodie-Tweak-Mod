/**
 * Cutemaodie's Tweak Mod  ——  PvZ2 Gardendless GP-Next JS 模组
 * ==========================================================================
 * 当前包含的调整（这里只列最早几项，完整列表见下方 CFG / features.json）：
 *   1. 巴豆     被啃死时，杀死所有正在啃食它的非机械僵尸（复制 N 份原版击杀）
 *   2. 钢地刺   阳光 250→200；可承受打击次数 3→9；每承受 3 次掉一颗牙
 *   3. 心蕊     攻击的 debuff 由单体改为 1x3（以命中目标为中心，同排左右各一格）
 *   4. 暗影龙葵 阳光 75→125；暗影态攻击一次打中 3 个目标（= 穿透 2 个）+ 飞天豌豆档击退(0.25)
 *   5. 白萝卜   0.00175 秒内只能受到一次伤害（实测等价于「同一帧内只结算一次伤害」）
 *   6. 甜薯     每秒自回血 20 点（吃「受到治疗 ×200%」加成 → 实际 40/秒）
 *              注意：窗口越长 = 挡掉的伤害越多 = 越肉。窗口内被挡下的伤害是【直接消失】的，
 *              所以对「每帧结算的小额啃食伤害」来说，实际 DPS 会乘上 dt/窗口 这个系数。
 * ==========================================================================
 * 关键实现笔记（踩过的坑）：
 *
 * (A) 数值改动走运行时数据（PvZ2ObjectContainer），并钩住 JSONs.readJsons 再落一次。
 *
 * (B) 弹道私有字段会被引擎丢掉！
 *     commonShot 的 objdata setter 是：
 *         Object.getOwnPropertyNames(this._objdata).forEach(k => o[k] = e[k])
 *     —— 它遍历的是「弹道 props 实例已有的字段名」，只拷贝同名值。
 *     所以自定义的 GPNMaxPierce 传到这一层会被静默丢弃（原版字段
 *     KnockbackDistance 之类则没事）。修法：包一层 setter，在过滤发生前
 *     从原始数据里把私有字段捞到实例上（见 makePiercePatch 的 A 段）。
 *
 * (D) 甜薯 / 白萝卜的补丁全部挂在【Plant 基类】上，用 this.Plant_Type（codename）判定。
 *     不要挂在 SweetPotatoPlant / TurnipPlant 子类上 —— 一旦预制体挂的类名和预期不一致，
 *     子类原型补丁会静默失效（表现就是「改了但没效果」）。
 *
 * (C) 穿透只对「带 GPNMaxPierce 标记 + 处于暗影态」的弹道生效，绝不碰原版其它炮弹
 *     （原版 A.K.E.E. 数据里也有 MaxHitCount，但引擎根本没读它，拿它当开关会误伤）。
 *     暗影态标记由重写后的 NightShade._shoot 打到弹道上。
 */

const MOD_ID = 'Cutemaodies_Tweaks';
const MOD_VERSION = '1.2.0';
/* ★ 实例身份：每次模块被加载都会生成一个新的 ID。
 *   用途：确认"同一份代码是否被加载了多次"（多实例会各自写 FEATURES / 各自 apply 数据补丁 ⇒ 互相覆盖）。
 *   判据：日志里出现多个不同的 INSTANCE=xxx 就是多实例。 */
const GPN_INSTANCE_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
let gpnApplyCount = 0;                     // 诊断用：apply() 被调用了几次
try { if (typeof window !== 'undefined' && window) { if (window.__gpnInstances === undefined) window.__gpnInstances = []; window.__gpnInstances.push(GPN_INSTANCE_ID); } } catch (e) { /* 忽略 */ }


/* =========================================================================
 * 功能开关 —— 从同目录的 features.json 读取
 *   · 改完必须【完全退出游戏再重新启动】才生效（在「模组」页按「保存并应用」没用）
 *   · 读不到 / 解析失败 -> 全部按【开启】处理，绝不让模组挂掉
 * =======================================================================*/
const FEATURES = {
    chilibean: true,        // 巴豆：被啃死时杀死所有正在啃它的非机械僵尸
    spikerock: true,        // 钢地刺：阳光200 / 承受9次 / 每3次掉一颗牙 / 冷却15秒
    bloomingheart: true,    // 心蕊：debuff 1x3 + 带 debuff 的僵尸啃食减伤
    nightshade: true,       // 暗影龙葵：阳光125 / 暗影态穿透3 + 击退0.25格
    turnip: true,           // 白萝卜：0.00175 秒内只受一次伤害
    sweetpotato: true,      // 甜薯：受治疗x200% / 自回血20（吃x2 -> 实际40/秒）
    tallnut: true,          // 高坚果：免疫位移 + 扛3次巨人砸击
    pushPlantFix: true,     // 推植物被挡时跳过挡路者（不飞出屏幕）
    perfumeshroom: true,    // 香水菇：香水火施加6层心蕊 debuff / 火13.5秒
    starfruit: true,        // 星星果系：穿透 + 单格溅射 + 阳光125
    starfruitFollowMerge: true,  // 星星果 A2 追击：延迟窗口合并（关掉 = 每次触发各补一轮）
    noctarine: true,        // 暗影油桃：毒气时长x2 / 攻击x0.5 / 阳光100
    zoybeanpod: true,       // 腐尸豆荚：召唤权重（可召唤城堡头僵尸 / 超新星巨尸）
    dandelion: true,        // 蒲公英：索敌优化 / 额外子弹 / 阳光325 / 对飞行×2+眩晕
    pepperpult: true,       // 甜椒投手：阳光225 / 冷却15秒 / 落点3x3灼烧1秒
    hurrikale: true,        // 飓风甘蓝：全屏寒风（其他行 50% 推力）+ 全屏吹飞飞行僵尸
    cabbagepult: true,      // 卷心菜投手：子弹首次命中后再**弹跳 1 格**（不索敌；同伤害）+ 阳光 125
    kernelpult: true,       // 玉米投手：黄油**落点留下地面黄油**（与黄油毛茛同款；普通 120 秒 / 大招 150 秒）
    // ↓ 下面这几个以前【忘了登记】：features.json 里写了 false 也不会生效（featOn 找不到这个键 -> 当成开）
    phatbeet: true,         // 魔音甜菜：普攻眩晕 / 大招眩晕+击起 / 解除安抚 / 音乐免疫
    garlic: true,           // 大蒜：每口固定伤害 37.5 / 阳光 75 / 冷却 15 秒
    snowpea: true,          // 寒冰射手：单格冰减速 + 概率冰锥（冻结）
    redstinger: true,       // 红针花：承伤 ×0.2 / ×0.1 + 左键切形态
    murkadamia: true,       // 暗影夏威夷果：暗影态本体隐身 / 暗影物质 5000
    splitpea: true,         // 裂荚射手：左键左右翻转 / 前后豌豆对调
    meteorflowerAim: true,  // 流星花：索敌改造（第1颗本行优先/可索障碍与护盾、第2颗不再打歪）；关掉=原版索敌
    sporeshroom: true,      // 孢子菇：亡语（1×3 伤害+感染+0.75s眩晕）／阳光200／血量150／图鉴两条特点；关掉=全回原版
    // ↓ 诊断日志总开关：★注意★ 它在表里登记成 false —— 日志开关故意和别的开关【反着来】：
    //   · 只有 features.json 里显式写 true 才开；写 false / 删掉 / 整个文件读不到 ⇒ 一律【关】；
    //   · 打开后 = 所有"每次触发一条"的诊断日志（各功能的 debugLog）全部回来，方便排查。
    verboseLog: false,      // 诊断日志总开关（默认关；排查时把 features.json 里的 verboseLog 改成 true）
};

/** 【运行期开关表】= 下面导出的 `_features`，**同一个对象**。
 *  · `featOn(...)` 一律**运行期现查**这张表 ⇒ 游戏内配置界面改开关能**立刻生效**（不必退出重进）；
 *  · `featLoad()` 把 features.json 的初值写进它；界面以后写它；
 *  · 之所以不另建一张表：自检（以及将来可能的"重载"）是**改 `_features` 再 setup**，
 *    只有让"导出的开关表" = "内部读的表"，那条链路才成立（曾经另建表导致自检 9 项失败）。 */
const FEATURES_LIVE = FEATURES;

/** 只有【显式写了 false】才算关；键不存在 / 不是布尔 -> 按开 */
function featOn(name) { return FEATURES_LIVE[name] !== false; }

/** 设置一个开关（运行期，立刻生效）；返回是否真的变化了。
 *  这是"游戏内配置界面"写入的入口：改值后调用方按需重新应用数据补丁。 */
function featSet(name, on) {
    if (!(name in FEATURES_LIVE)) return false;
    const next = (on !== false);
    const prev = FEATURES_LIVE[name] !== false;
    FEATURES_LIVE[name] = next;
    if (prev !== next) { try { gpnFeatStorageSaveSoon(); } catch (e) { /* 忽略 */ } }
    if (prev !== next && name === 'snowpea' && gpnSnowPeaGoldApply) { try { gpnSnowPeaGoldApply(); } catch (e2) { /* 忽略 */ } }   // gpnSnowPeaGoldApply 立即重刷
    return prev !== next;
}

/* ============================================================================
 * 开关的持久化（GP-Next 官方存储 ctx.storage）
 *   目标：配置界面里改过的开关状态，**退出游戏重进后保留**。
 *   · 只存"布尔开关"（24 个键）；数值仍由代码里的 CFG 决定，不进存储；
 *   · 启动优先级：代码默认 → features.json 的值（老玩家迁移）→ **存储里的值（最高）**；
 *   · 官方 API（逐字核对指南）：
 *       ctx.storage.open({ scope:'global', version:1, defaults, validate }) -> Promise<handle>
 *       handle.read() -> Promise<T> ；handle.update(fn) -> Promise<T>
 *   · 存储不可用（老版本 / 自测环境）⇒ 降级为"仅本次会话有效"，只打一条警告。
 * ========================================================================== */
const gpnFeatDefaults = {};
for (const k of Object.keys(FEATURES)) gpnFeatDefaults[k] = FEATURES[k] !== false;

let gpnFeatStore = null;
let gpnFeatSaveTimer = null;

function gpnFeatSnapshot() {
    const o = {};
    for (const k of Object.keys(gpnFeatDefaults)) o[k] = featOn(k);
    return o;
}

function gpnFeatValidate(v) {
    // ★ 宽容校验（实机教训）：原来要求"23 个键全是 boolean"，
    //   只要存档缺一个键（老版本 / 早期键集）就判**整份无效** ⇒ 引擎静默回落到 defaults（全开）。
    //   现在只做形状检查，键的补齐与坏值纠正交给 gpnFeatMigrate。
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** 把任意旧值归一成"完整、键齐全、值为 boolean"的设置表。
 *  逐键合并到 defaults 之上：缺键 ⇒ 用默认值；坏值 ⇒ 用默认值。
 *  （这就是官方说的 migrate："它返回升级后的值，再经 validate 检查"。） */
function gpnFeatNormalize(v) {
    const out = {};
    const src = (v && typeof v === 'object') ? v : {};
    for (const k of Object.keys(gpnFeatDefaults)) {
        out[k] = (typeof src[k] === 'boolean') ? src[k] : (gpnFeatDefaults[k] !== false);
    }
    return out;
}

/** 存储升级钩子：旧结构缺键时补齐（version 从任意旧值升到当前） */
function gpnFeatMigrate(value, fromVersion, toVersion) {
    try {
        const normalized = gpnFeatNormalize(value);
        const missing = Object.keys(gpnFeatDefaults).filter((k) => !value || typeof value[k] !== 'boolean');
        if (missing.length) log('开关持久化：升级存储（补齐 ' + missing.length + ' 个键：' + missing.join('、') + '）');
        return normalized;
    } catch (e) {
        warn('开关持久化：升级出错 ⇒ 用默认值', e);
        return gpnFeatNormalize(null);
    }
}

async function gpnFeatStorageLoad(ctx) {
    try {
        if (!ctx || !ctx.storage || typeof ctx.storage.open !== 'function') {
            warn('开关持久化：拿不到 ctx.storage ⇒ 本次改动只在本次会话有效（不写盘）');
            return false;
        }
        gpnFeatStore = await ctx.storage.open({
            scope: 'global',
            version: 2,                              // ★ 提升到 2：旧存档会走 migrate 补齐缺键
            defaults: Object.assign({}, gpnFeatDefaults),
            validate: gpnFeatValidate,
            migrate: gpnFeatMigrate,                 // ★ 官方 API："增加 version 时用 migrate 处理旧数据"
        });
        const saved = await gpnFeatStore.read();
        // ★ 读回后再逐键兜底一次：缺键/坏值一律回落到默认（避免"某个键凭空变开"，实机踩过）
        const norm = gpnFeatNormalize(saved);
        let applied = 0;
        for (const k of Object.keys(gpnFeatDefaults)) {
            FEATURES_LIVE[k] = norm[k];
            applied++;
        }
        if (FEATURES_LIVE.verboseLog === undefined) FEATURES_LIVE.verboseLog = false;
        const offList = Object.keys(gpnFeatDefaults).filter((k) => !featOn(k) && k !== 'verboseLog');
        log('开关持久化：已从存储读入 ' + applied + ' 项' + (offList.length ? ('（已关闭：' + offList.join('、') + '）') : '（全部开启）'));
        return true;
    } catch (e) {
        warn('开关持久化：读取失败 ⇒ 本次改动只在本次会话有效', e);
        return false;
    }
}

function gpnFeatStorageSaveSoon() {
    if (gpnDisposed) return;                 // 旧运行时不写盘（避免覆盖新运行时的设置）
    if (!gpnFeatStore) return;
    try {
        if (gpnFeatSaveTimer) clearTimeout(gpnFeatSaveTimer);
        gpnFeatSaveTimer = setTimeout(() => {
            gpnFeatSaveTimer = null;
            try {
                const snap = gpnFeatSnapshot();
                Promise.resolve(gpnFeatStore.update(() => snap))
                    .then(() => {
                        const offList = Object.keys(snap).filter((k) => !snap[k] && k !== 'verboseLog');
                        log('开关持久化：已保存' + (offList.length ? ('（已关闭：' + offList.join('、') + '）') : '（全部开启）'));
                    })
                    .catch((e2) => warn('开关持久化：保存失败', e2));
            } catch (e) { warn('开关持久化：保存出错', e); }
        }, 300);
    } catch (e) { warn('开关持久化：定时器出错', e); }
}

function gpnFeatStorageReset() {
    if (gpnDisposed) return;                 // 旧运行时不再改设置
    try {
        for (const k of Object.keys(gpnFeatDefaults)) FEATURES_LIVE[k] = gpnFeatDefaults[k];
        if (gpnFeatStore) {
            const snap = gpnFeatSnapshot();
            Promise.resolve(gpnFeatStore.update(() => snap))
                .then(() => log('开关持久化：已恢复默认并写回存储'))
                .catch((e2) => warn('开关持久化：恢复默认写盘失败', e2));
        } else {
            log('开关持久化：已恢复默认（本次会话；无存储句柄）');
        }
    } catch (e) { warn('开关持久化：恢复默认出错', e); }
}


/** 诊断日志总开关（features.json 的 verboseLog）。注意它在 FEATURES 表里登记为 false ⇒ 默认关。 */
function verboseOn() { return featOn('verboseLog'); }

/** 细分诊断开关：总开关开着就全开；总开关关着时，只有该功能自己的 debugLog 为 true 才打。 */
function dbgOn(flag) { return verboseOn() || flag === true; }

/** 玩家在 features.json 里【显式】把 starfruitFollowMerge 写成 true 了吗？（只给那行黄色提示用） */
let FEATURES_MERGE_EXPLICIT_TRUE = false;

/** 读一个文本文件（Tauri fs 插件）—— 失败返回 null */
function featReadText(path) {
    const w = (typeof window === 'undefined') ? null : window;
    if (!w) return Promise.resolve(null);
    const toText = (v) => {
        try {
            if (v === null || v === undefined) return null;
            if (typeof v === 'string') return v;
            if (typeof TextDecoder !== 'undefined') {
                if (v instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(v));
                if (ArrayBuffer.isView(v)) return new TextDecoder().decode(v);
                if (Array.isArray(v)) return new TextDecoder().decode(new Uint8Array(v));
            }
            return String(v);
        } catch (e) { return null; }
    };
    try {
        const inv = w.__TAURI_INTERNALS__ && w.__TAURI_INTERNALS__.invoke;
        if (typeof inv === 'function') {
            return Promise.resolve(inv('plugin:fs|read_text_file', { path: path })).then(toText, () => null);
        }
        const fs = w.__TAURI_PLUGIN_FS__;
        if (fs && typeof fs.readTextFile === 'function') {
            return Promise.resolve(fs.readTextFile(path)).then(toText, () => null);
        }
    } catch (e) { }
    return Promise.resolve(null);
}

/** 从自己的调用栈里抠出模组文件夹名（形如 .../packs/<名字>/scripts/main.js）
 *  不用 import.meta.url —— 万一加载器不支持 import.meta，那是【语法错误】，
 *  整个模组都不会加载；而读调用栈是纯运行时行为，读不到就返回 null（走硬编码兜底）。 */
function featModName() {
    try {
        const st = String((new Error()).stack || '');
        const m = /[/\\]packs[/\\]([^/\\\n)]+)[/\\]/.exec(st);
        if (m && m[1]) return decodeURIComponent(m[1]);
    } catch (e) { }
    return null;
}

/** 依次尝试候选路径，返回第一个读到的内容 */
function featTryList(list) {
    let i = 0;
    const next = () => {
        if (i >= list.length) return Promise.resolve(null);
        return featReadText(list[i++]).then((t) => (t !== null && t !== undefined ? t : next()));
    };
    return next();
}

/** 加载 features.json；返回 null 表示"按全开处理" */
function featLoad() {
    const w = (typeof window === 'undefined') ? null : window;
    if (!w) return Promise.resolve(null);          // 例如自测环境

    const names = [];
    const mn = featModName();
    if (mn) names.push(mn);
    for (const n of ["Cutemaodie's Tweak Mod", "Cutemaodie's Mod"]) {
        if (names.indexOf(n) === -1) names.push(n);
    }

    const HARD = 'C:\\Users\\86152\\AppData\\Roaming\\com.pvzge.game';

    let rootP;
    try {
        const p = w.__TAURI__ && w.__TAURI__.path;
        if (p && typeof p.appDataDir === 'function') {
            rootP = Promise.resolve(p.appDataDir()).catch(() => HARD);
        }
    } catch (e) { }
    if (!rootP) rootP = Promise.resolve(HARD);

    return rootP.then((root) => {
        const r = String(root || HARD).replace(/[\\/]+$/, '');
        const list = [];
        for (const n of names) list.push(r + '\\gp-next\\packs\\' + n + '\\features.json');
        if (r !== HARD) {
            for (const n of names) list.push(HARD + '\\gp-next\\packs\\' + n + '\\features.json');
        }
        return featTryList(list);
    }).then((txt) => {
        if (txt === null || txt === undefined) {
            warn('读不到 features.json —— 所有调整按【开启】处理');
            return null;
        }
        try {
            const obj = JSON.parse(String(txt).replace(/^\uFEFF/, ''));
            for (const k of Object.keys(FEATURES_LIVE)) {
                if (obj[k] === true || obj[k] === false) FEATURES_LIVE[k] = obj[k];
            }
            FEATURES_MERGE_EXPLICIT_TRUE = (obj.starfruitFollowMerge === true);
            const off = Object.keys(FEATURES_LIVE).filter((k) => !featOn(k) && k !== 'verboseLog');
            log('features.json 已读取 —— ' + (off.length ? ('已关闭：' + off.join('、')) : '全部开启'));
            return obj;
        } catch (e) {
            warn('features.json 解析失败 —— 所有调整按【开启】处理', e);
            return null;
        }
    });
}

/* =========================================================================
 * 配置区 —— 要调数值只改这里
 * =======================================================================*/
/** 【原版值表】"关掉开关时写回什么"的**唯一出处**。
 *  来源：`CTM\原始数据\game-json-0.15.0.zip` 的 `Objects/PlantProps.json`（逐字段核对过）。
 *  为什么要有这张表：开关一旦支持"开/关两种状态"，数据补丁就必须在**关掉时写回原版值**；
 *  若把原版值散落在各处硬编码，极易写错（已经踩过：钢地刺冷却原版是 **5** 秒，曾被误写成 15）。 */
const VANILLA = {
    spikerock: { sunCost: 250, maxSpike: 3, cooldown: 5 },
    // ↓ 全部来自原始数据 `CTM\原始数据\game-json-0.15.0.zip` 的 `Objects/PlantProps.json`
    //   （逐字段核对过；并已与用户手工提供的清单交叉验证）
    //   ⚠️ 注意：这些条目曾在一次 `git checkout e247a7d` 回退中被意外丢掉（导致 VANILLA.nightshade
    //      为 undefined ⇒ 关掉龙葵时 setup 抛异常）。已按原始数据重新补全。
    splitpea: { sunCost: 125, cooldown: 5 },
    nightshade: { sunCost: 75, cooldown: 5 },
    tallnut: { sunCost: 125, cooldown: 20 },
    cabbagepult: { sunCost: 100 },
    kernelpult: { sunCost: 100 },
    starfruit: { sunCost: 150, pinkSunCost: 225, shootingSunCost: 500, shootingCooldown: 5 },
    noctarine: { sunCost: 150, cooldown: 15 },
    dandelion: { sunCost: 275, cooldown: 15 },
    garlic: { sunCost: 50, cooldown: 5, eatDamage: 150 },
    redstinger: { sunCost: 150, tier1: 0.3333333, tier2: 0.2 },
    pepperpult: { sunCost: 200, cooldown: 20 },
    // 孢子菇：原版数值（来自 Objects/PlantProps.json 的 sporeshroom 条目）
    sporeshroom: { sunCost: 150, toughness: 300 },
};

const CFG = {
    chilibean: {
        // true  = 每只啃食者都跑一次完整的 chilibeanFart（音效/粒子/范围眩晕叠 N 遍）
        // false = 第一只跑完整流程（视觉只出现一次），其余静默击杀
        fullFartForEveryEater: true,
    },
    spikerock: {
        sunCost: 200,      // 原 250
        maxSpike: 9,       // 原 3 —— 可承受的「滚动僵尸 / 巨人砸击」次数
        teeth: 3,          // 视觉上一共 3 颗牙
        cooldown: 15,      // 种植冷却秒数（改成 15 秒；原版 5 秒）
    },
    bloomingheart: {
        splashWidthTiles: 3,   // 1x3：以命中目标为中心，同排左右各一格
        // 被带「心蕊 DEBUFF」的僵尸【啃食】时的伤害倍率。
        // 规则：只要僵尸身上 DEBUFF 层数 > 0 就生效；按层不叠乘、封顶（固定值）。
        victimDamageScale: {
            bloominghearts: 0.50,  // 心蕊自己：受到伤害 ×50%
            sweetpotato:    0.75,  // 甜薯：伤害减免 25% → ×75%
            hotdate:        0.75,  // 热辣海枣：伤害减免 25% → ×75%
        },
        debuffLayer: 0.9,      // 单层减防值。与心蕊普攻一致（blooming_heart 的 DefenceRateList = [0.9]）
        debugLog: false,        // 每次减伤打一条日志，用来验证
    },
    sporeshroom: {
        plantType: 'sporeshroom',
        // ---- 数值（用户指定）----
        sunCost: 175,          // 阳光消耗（原版 150；用户 2026/10/16：200 → **175**）
        toughness: 100,        // 血量上限（原版 300；用户 2026/10/16：150 → 100）
        // ---- 亡语（被击败时触发；用户指定）----
        //   伤害 = **跟随孢子菇普攻攻击力**（按 CabbageType 查对应弹道的 Damage）
        //     sporeshroom_spore  -> 50   （1 级普攻）
        //     sporeshroom_spore1 -> 150
        //     sporeshroom_spore2 -> 250
        //   ⚠️ 这 3 个值**只作为兜底**：正常路径是运行期从 ProjectileProps 里读那 3 条弹道的真实 Damage。
        deathDamageByPea: {
            sporeshroom_spore: 50,
            sporeshroom_spore1: 150,
            sporeshroom_spore2: 250,
        },
        deathDamageFallback: 50,   // 读不到弹道数据时的兜底（= 1 级普攻）
        //   ⚠️ 上面两张表存的是**普攻攻击力本身**（数据实测 50 / 150 / 250）；
        //      亡语**实际**伤害 = 它 × `deathDamageScale`（用户 2026/10/16 指定：先 1.25，随后改 **1.35**）。
        deathDamageScale: 1.35,    // ★ 亡语伤害 = 本株普攻攻击力 × 该倍率 ⇒ 67.5 / 202.5 / 337.5
        deathStun: 1.5,            // 亡语附带眩晕秒数（用户指定 2026/10/16：0.75 → 1.5）
        deathRadiusTiles: 3,       // 亡语**伤害/眩晕/特效/障碍物**的横向格数（1 行 × 3 列，以自身格为中心）
        // ★ 2026/10/22 用户指定：**施加 `CarriedSporeShroom` 标记**的范围扩到 **3 行 × 3 列**；
        //    伤害 / 眩晕 / 特效 / 障碍物伤害仍是上面的 1 行 × 3 列（**保持不变**）。
        //    相邻两行里落在同样 3 列范围内的僵尸：**只标记**（不扣血、不眩晕）⇒ 之后吃毒性家族 ×1.5、可被巴豆屁联动识别。
        deathMarkRows: 3,          // 标记范围：行数（以自身行为中心；1 = 原版单行）
        deathMarkCols: 3,          // 标记范围：列数（以自身格为中心）
        // ---- 毒性家族 ×1.5（R6/R7，用户指定；直伤 + Dot 都算）----
        //   判定口径 = `PlantProps[Plant_Type].objdata.Family === 'Poison'`
        //     （数据实测 Poison 家族共 13 株：poisonpeashooter / poisonpeashooter_mgp /
        //       bloominghearts / scaredyshroom / fumeshroom / ailmint / puffshroom /
        //       vamporcini / **chilibean** / marigold_purple / seashroom / **garlic** / sporeshroom）
        //     **减去** garlic / chilibean（用户指定排除；它们**本来就是** Poison 家族）
        //     **加上** gloomshroom / shadowshroom（Family 是 Shadow，靠数据判不出来 ⇒ 显式白名单）
        //   多段叠加 Dot：该帧全部家族 Dot **合计后只 ×1.5 一次**（不是"叠加次数 ×1.5"）
        poisonBonus: 1.5,          // 倍率（图鉴第 2 条特点的文案也从这里现算）
        // ---- 亡语特效（用户指定：暗影豌豆·初档大招子弹的**命中特效**）----
        //   资源取自 resources bundle 的 `projectiles/PeaShadowPF0PRJ`，
        //   读它 `commonShot` 组件上的 `PopParticle`（实机实测值 = "ShadowPeaPF0PAR"）。
        //   ⚠️ 绝不引用用户给的 PTX 贴图；这里只用引擎自己的 prefab。
        // ---- 巴豆屁联动（§3.80，用户 2026-10-20）----
        //   S1 阶段只做**只读探针**：verboseLog 打开时打印气体节点结构/轴向/音效计数，不改任何行为。
        //   S2 做完主体后可以把它设 false（或保留作长期诊断，代价是每只巴豆屁多几行日志）。
        fartRows: 3,           // ★ 眩晕气体覆盖几行（1 = 原版单行，不放大也不下移；以尸体所在行为中心，实际覆盖 = 2×floor(rows/2)+1 ⇒ 偶数也按奇数算）
        fartRowScale: 3,       // ★ 气体节点沿 **Y（行高方向）** 放大的倍数（实机探针：行间位移=(0,-81)、节点 angle=0）
        fartYOffset: -40,      // ★ 气体位置下移量（px）。引擎把气体挂在**僵尸高度**上 ⇒ 原版偏高（像脑袋放屁）；-40 ≈ 半行（81/2）
        fartDelaySec: 2,       // ★ 与原版同拍：chilibeanFart 后多少秒触发扩行（≈ tween 的 2 秒）
        // ⚠️ **改色已放弃**（2026-10-20 用户决定）：DragonBones 节点色是乘算、槽色是包装对象且会被动画写回，
        //    自绘紫气观感不还原 ⇒ 保持原版**绿色**；音量加强也一并放弃（维持原版音量）。
        //    所以这里**没有** fartColor* / fartVolume 这些项，别再试着加回来。
        fartShake: 1,          // ★ 放屁时**屏幕震动**时长：**1 秒**（照抄侏罗纪霸王龙 roar 的 LevelPlay.shakeScreen(1)；
                               //   引擎每 0.2s 一轮递归 ⇒ 1 = 连续抖 5 轮；0 = 关；0.2 = 一轮（流星花流星子弹的默认值））
        fartShakeCD: 0.15,     // ★ 同帧多只屁时只抖一次（秒）
        // ---- 吹退（用户 2026-10-20 定：**沿屁的方向**、1 秒 1 格；飞行僵尸 1 秒 2 格；可叠加；不减速）----
        fartPushTiles: 1,      //   普通僵尸：共吹退几格（1 秒内推完）
        fartPushFlyingTiles: 2,//   飞行僵尸（flying===true，与飓风甘蓝同口径）：共吹退几格
        fartPushDuration: 1,   //   吹退的**总时长**（**固定 1 秒**；叠加不延长时间、只叠加速度）
        fartPushMaxTiles: 8,   //   叠加**总格数上限**（用户 2026-10-20：最多 8 格）
        fartPushBlowStacks: 3, //   ★ 正向屁 + 单次吹退内**命中次数≥3** + 飞行僵尸 ⇒ **吹飞**（出场击杀，0 = 关）
        fartDebugLog: false,   // 每次联动打一条日志（排查用；正式使用保持 false）
        probeFart: false,      // 只读探针（诊断用；正式使用保持 false，排查时再开）
        fxPrjPath: 'projectiles/PeaShadowPF0PRJ',
        fxPropName: 'PopParticle',
        fxEnable: true,
        debugLog: false,           // 每次亡语打一条日志（排查用）
    },
    perfumeshroom: {
        plantType: 'perfumeshroom',
        layers: 6,                                     // 香水火对每只僵尸施加 6 层心蕊 DEBUFF（引擎 damageScale 每层 ×1/0.9）
        fireDuration: 13.5,                            // 香水火持续时间（秒）—— 原版【硬编码 9 秒】在 PerfumeShroomPlant 的攻击载荷里
        // 心蕊普攻子弹在 resources bundle 里的路径 —— 用来取那个减防特效 prefab
        buffPrjPath: 'projectiles/BloomingHeart0PRJ',
        debugLog: false,
    },
    cabbagepult: {
        plantType: 'cabbagepult',
        // ★ 2026/10/22 用户指定：卷心菜投手
        //   ① 普攻 / 大招的卷心菜，**首次命中**（僵尸 / 障碍物 / 被弄臣·三节棍反弹后打中植物）后
        //      **再弹跳 1 格**：方向 = 子弹当时的**前进方向**（正常向右、反弹后向左）；
        //      **不索敌**（固定落点 = 命中点 ± bounceCells 格，**允许落在草坪外**）；
        //   ② 伤害与首弹**相同**（复用同一条弹道类型 ⇒ 40 / 300 / 薄荷 120 天然一致）；
        //   ③ **只弹一次**（第二发不再弹）；炸药桶（ID 17）不触发（与障碍物白名单同口径）；
        //   ④ 同时把**阳光 100 → 125**。
        sunCost: 125,
        bounceCells: 1,
        bounceGravityScale: 0.7,    // ★ 2026/10/22 用户：普攻弹跳**弧线高度 ≈ 0.7 倍**（保持起始高度不变；靠缩放续飞重力实现）
        bounceGravityScalePlantfood: 1, // ★ 2026/10/22 用户：**大招**的弹跳弧高恢复 1 倍（普攻为 0.7 倍）
        blacklistSeconds: 0.5,       // ★ 方案一：首弹命中的目标在 0.5 秒内被检测层排除（同一颗子弹续飞时不会双命中）
          debugLog: false,  // 发射/命中/弹跳诊断日志（排查时再开）
    },
    kernelpult: {
        plantType: 'kernelpult',
        sunCost: 125,                  // ★ 2026/10/22 用户指定：阳光 100 → 125（挂在 kernelpult 开关上）
        // ★ 2026/10/22 用户指定：玉米投手的黄油**落点留下「地面黄油」**（与黄油毛茛同款 TileLiquid `butter`）。
        //   · 普通黄油（30% 替换的那发，弹道 `butter`）：地面黄油 **120 秒**（黄油毛茛普通同为 120）
        //   · 大招黄油（弹道 `butter2`）：地面黄油 **150 秒**（黄油毛茛大招同为 150）
        //   · 地面黄油行为由引擎 `ButterTileLiquid` 决定：本行**最左一只**踩到的非飞行僵尸再被定 **8 秒**，然后黄油消失；
        //   · **伤害/眩晕数值都不改**：黄油仍是 60 伤害 / 8 秒眩晕，大招 butter2 仍是 200 伤害 / 8 秒眩晕。
        tileLiquidType: 'butter',
        tileLiquidDuration: 120,
        tileLiquidDurationPlantfood: 150,
        debugLog: false,
    },
    tallnut: {
        plantType: 'tallnut',
        // 同原始坚果：每次砸击扣 25% 最大血，25% 及以下时再挨一下就死
        // ⇒ 满血能扛住 3 次巨人砸击，第 4 次死
        smashHpFraction: 0.25,
        cooldown: 30,                  // v2.8.2 新增：种植冷却 20 -> 30 秒（引擎字段是 Cooldown）
        debugLog: false,               // 砸击/死亡诊断日志（排查用；正式使用保持 false）
    },
    nightshade: {
        sunCost: 125,             // 原 75
        pierceTargets: 3,         // 一次打中几个（3 = 穿透 2 个；1 = 不穿透）
        shadowOnlyPierce: true,   // 只有「暗影态」发射的弹道才穿透
        knockbackDistance: 0.25,  // 飞天豌豆力度（基础 0.05 / 1 阶 0.15 / 2 阶 0.25）
    },
    turnip: {
        plantType: 'turnip',       // 用 codename 判定，不依赖预制体挂的类名
        // 受伤间隔。注意方向：窗口越长 -> 被挡掉的伤害越多 -> 越肉。
        //
        // 关键分界线是「一帧的时长 dt」（60fps ≈ 0.0167，30fps ≈ 0.033）：
        //   窗口 <= dt  -> 锁在下一帧开始前就解开了，跨帧伤害一点不丢，
        //                  但【同一帧内】的多段伤害仍然只会结算第一段（同帧去重）
        //   窗口 >  dt  -> 会连跨帧的小额伤害一起挡掉，实际 DPS 变成 EatDPS × dt / 窗口
        damageGateSeconds: 0.00175,
    },
    sweetpotato: {
        plantType: 'sweetpotato',
        selfHealPerSecond: 20,         // 每秒自回血（v2.8.2：10 -> 20）
        healReceivedMultiplier: 2,     // 受到的治疗 ×200%
        // 自回血是否也吃上面这个加成。
        //   true  -> 每秒回 20 × 2 = 40 点（当前）
        //   false -> 每秒固定回 20 点
        selfHealAlsoDoubled: true,
        debugLog: false,                // 打开后每次治疗/自回血都会打日志，用来验证加成有没有生效
    },
    starfruit: {                       // 星星果 / 天使星星果 / 流星果
        sunCost: 125,                  //   星星果阳光 150 -> 125
        pinkSunCost: 175,              //   天使星星果阳光（本次调整）
        shootingSunCost: 550,          //   流星果阳光（原版 500，本次 500→550；550 不是原版）
        shootingCooldown: 10,          //   流星果种植冷却（= 原版 10 秒；显式写一遍，防被别的 mod 改掉）
        // ★ 三种星果的【穿透】各拆一份 —— 值 = "一次打中几个目标"，1 = 不穿透（可随时改回）
        //   规则：小数向下取整；< 1（含 0 / 负数 / 写错）一律按 1 处理（永远不出现 0 个名额）
        pierceTargets: 2,              //   星星果：一次打中 2 个（= 穿透 1 个）
        pinkPierceTargets: 2,          //   天使星星果：同上
        shootingPierceTargets: 2,      //   ★ 流星果：打中 2 个（= 穿透 1 个）；1 = 不穿透
        splashRatio: 0.2,              //   星星果 / 天使星星果：溅射 = 该发子弹【实际伤害】的 20%（运行时算）
        splashRatioShooting: 0.4,      //   流星果：溅射单独用 40%（它阳光高，保持强度）
        splashCells: 1,                //   溅射范围：以命中点为中心 1 格
        // ---------------- A2 追击攻击 ----------------
        // 天使星星果 / 流星果 的子弹打中目标（僵尸或障碍物）时，
        // 所有"能打到那个目标"的【基础星星果】立刻补发一轮 5 方向齐射。
        followEnabled: true,           //   追击攻击总开关
        followDamageRatio: 0.50,       //   追击弹伤害 = 基础星星果这一发的伤害 x 50%（运行时算）
                                       //   （v2.8.3：25% -> 40%；本次：40% -> 50%；lv1 = 20 x 50% = 10）
        followPierceBonus: 1,          //   追击弹比【星星果普攻】多打中几个目标：
                                       //   followPierce = 星星果.pierceTargets + 这个值（默认 2+1=3 ⇒ 打中 3 = 穿透 2）
        // 追击弹自己的溅射比例（和 A1 的 splashRatio 分开）：
        //   追击弹溅射 = 追击弹伤害 x followSplashRatio = 攻击 x 50% x 40% = 攻击 x 20%
        followSplashRatio: 0.4,
        followStun: 0.075,             //   追击弹附带 0.075 秒眩晕（引擎是"取最大值"，所以只会刷新不会叠加）
        followAnimSpeed: 2,            //   追击时播的 Shoot 动画倍速（想要完整的开火动作）
        followAnimGuard: 1.0,          //   掐掉"动画自带那一轮齐射"的保护时长（秒）
        // ---- A2 追击「延迟窗口合并」（独立开关 starfruitFollowMerge）----
        //   同一株基础星星果在【延迟窗口】内被多次触发 -> 只补一轮 5 方向齐射；
        //   每颗弹伤害 = followDamageRatio × Σ(各次触发时该株的攻击力)（伤害不缩水）；
        //   穿透名额 = 追击打中数（= 星果打中数 + followPierceBonus，默认 2+1 = 3 个）；不设上限；大招期间不记录并清空已有记录。
        followMergeWindow: 0.1,        //   延迟窗口（秒）；0 = 关闭合并（= 每次触发各补一轮的旧行为）
        followMergeDebugLog: false,    //   打印"并入窗口 / 窗口开火 / 大招丢弃"日志（排查用，默认关）
        followDebugLog: false,
        debugLog: false,
    },
    noctarine: {                       // 暗影油桃
        sunCost: 100,                  //   阳光 150 -> 100
        damageScale: 0.5,              //   数据里 Actions 的爆炸伤害也 ×0.5（例：20 的爆炸伤害会变成 10）
        normalLifespan: 40,            //   毒气时长 20 -> 40（x2）
        shadowLifespan: 50,            //   暗影态毒气时长 25 -> 50（x2）
        normalAttackDamage: 10,        //   毒气伤害 20 -> 10（x0.5）
        shadowAttackDamage: 15,        //   暗影态毒气伤害 30 -> 15（x0.5）
        debugLog: false,
    },
    pepperpult: {                      // 甜椒投手
        sunCost: 225,                  //   阳光 200 -> 225
        packetCooldown: 15,            //   种植冷却 20 -> 15 秒
        burnSeconds: 1,                //   落点灼烧持续 1 秒
        // !! 语义（v1.0.0 纠正）：这 40% 是【单次火焰的总伤害】占攻击力的比例，
        //    不是「每秒 40%」。引擎在有 isDPS 标记时是每帧结算 damage*dt，
        //    所以代码里要先把【总伤害】算出来，再摊到 burnSeconds 上得到每秒值。
        //    （当前 burnSeconds = 1，所以数值上恰好等于"每秒也是 40%"，
        //      但口径必须是"总伤害"，改持续时间时才不会跑偏。）
        burnTotalRatio: 0.4,           //   单次火焰总伤害 = 攻击力 x 40%（运行时算）
        burnCells: 3,                  //   灼烧范围：以落点为中心 3x3
        burnHeight: 15,                //   火焰高度（和柴火藤蔓/火爆辣椒同档）
        // 灼烧要不要让护甲正常吸收（注意：引擎里这个字段的语义是「护甲生效」，是正的）
        //   true  = 不穿甲：先扣护甲，护甲被打穿后【溢出】的那部分才打到本体（和豌豆一样）
        //   false = 穿甲：无视护甲、直接扣本体（原版火爆辣椒/甜薯/香水菇传的就是 false）
        // 引擎里「火焰陷阱地砖」也是用数据里的 ArmorProtection 逐火配置的，
        // 说明这本来就是「每个火焰自己定」的字段。
        burnArmorProtection: true,
        debugLog: false,       //  v2.7.1~2.7.3 开一轮：确认灼烧真的触发、真的掉血、且不穿甲（验证通过后就关）
    },
    zoybeanpod: {                      // 腐尸豆荚
        // 非大招召唤权重（原版：zoybean 50 / armor1 30 / armor2 20）
        // 新增的两种从 zoybean 里扣：50 - 10 - 3 = 37
        // 权重和固定 100 -> 直接就是百分比
        summon: [
            { Weight: 28, Type: 'zoybean' },
            { Weight: 30, Type: 'zoybean_armor1' },
            { Weight: 23, Type: 'zoybean_armor2' },
            { Weight: 13, Type: 'dark_armor4' },          // 城堡头僵尸
            { Weight: 3, Type: 'supernova_gargantuar' },  // 超新星巨尸
            { Weight: 3, Type: 'zoybean_gargantuar' },    // 豆腐巨尸（普通召唤也能出）
        ],
        // 大招：92:8
        plantfood: [
            { Weight: 92, Type: 'zoybean_gargantuar' },
            { Weight: 8, Type: 'supernova_gargantuar' },
        ],
        debugLog: false,
    },
    dandelion: {                       // 蒲公英
        sunCost: 325,                  //   种植阳光：原版数据 275 -> 325
        extraShots: 1,                 //   每次【普攻】额外发射的子弹数
        extraDelay: 0.4,               //   额外子弹延迟（秒）：0.2 -> 0.4
        // ---- 对飞行僵尸 / 指定 BOSS 的加成 ----
        //   ・飞行判据：zombie.flying === true（临时 flying 也算）；BOSS = isBoss
        //   ・按「被这发子弹伤害到的每一只僵尸」逐个判定（直击 + 爆炸/溅射都算）
        flyingDamageScale: 2,          //   飞行僵尸伤害倍率
        flyingStun: 1,                 //   普攻 / 吹风反应弹对飞行僵尸的眩晕（秒）
        plantfoodFlyingStun: 5,        //   大招弹对飞行僵尸的眩晕（秒）
        bossDamageScale: 2,            //   指定 BOSS 的伤害倍率（不给眩晕）
        bossTypes: ['zombossmech_lostcity', 'zombossmech_lostcity2', 'zombossmech_sky'],
        // ---- ⑨ 大招驱离运兵艇（`sky_dropship`，云端堡垒）—— 用户 2026/10/16 指定：等同电离红掌 ----
        //   引擎事实（逐字核对，见设计稿 §1.2）：
        //     · 红掌大招 `foodStrike` = `PlantfoodDamage **1200**` ×（最多）`PlantfoodLightningCount **3**` 的**电伤**，
        //       直接对 `cm.zombiePool` 里的僵尸 `dealDamage`；
        //     · `Zombie.defaultDealDamage` **没有** `isRealZombie` 早退（只挡 invincible）⇒ 运兵艇会掉血；
        //     · 运兵艇 `Toughness` **恰好 1200** ⇒ **一发致死** ⇒ 死亡即"离场"（它掉完小鬼也走 playDie）
        //       ⇒ **剩余小鬼不再掉**（= 用户实机看到的效果）。
        //   ⇒ 我们走**同一条**「伤害→死亡」路（含击杀结算），并保留 'leave'（纯离场）作保险。
        //   ⚠️ 绝不用 `ray` 伤害类型：`defaultDealDamage` 里 `damageType==ray && canPlayAshNow()` ⇒ 化灰，
        //      化灰**不走**常规离场 ⇒ 观感会变。统一用 `physicle`。
        pbDriveDropShip: true,         //   大招是否驱离运兵艇（全屏所有）
        pbDriveMode: 'kill',           //   'kill' = 致死伤害（= 红掌同款，含击杀结算）；'leave' = 只调它自己的 playDie
        pbDriveDelay: 1,               // ★ 延时秒数（用户 2026/10/16：**1 秒**；最初定 1.5，随即改回 1）—— 让空投动画先落地，再把运兵艇赶走；
                                       //   0 = 一开大就立刻驱离（旧行为）
        pbDriveLog: false,             //   每次驱离打一条日志（排查用）
        debugLog: false,
    },
    pushPlant: { skipBlockers: true },   // 被「不可推」的植物挡住时，跳过它继续找空位
    hurrikale: {                       // 飓风甘蓝（全屏寒风）
        plantType: 'hurrikale',
        // ---- ② 其他行推 + 减速 ----
        otherLanePushScale: 0.5,       //   其他行的【推动力度】= 本行的 50%（= 推速减半）
        affectAllLanes: true,          //   作用范围：全部行（false = 只 ±2 行）
        mintScalesOtherLanes: true,    //   薄荷时其他行也跟着 ×2（保持"恰好一半"）
        // ---- ③④ 全屏风（吹飞飞行僵尸 + 天空之城飞船扣血）----
        //   直接置引擎自己的 FrontYard.windy —— 就是三叶草用的那面旗，
        //   所以"吹飞全屏飞行僵尸 / 飞船按 BloverDPS 扣血 / 天空之城推回最右格 / 沙盒正常吹飞"
        //   全部由引擎自己决定，模组不绕过、不额外处理。
        shipWindUseBloverDuration: true,   //   B 方案：全屏风时长借【三叶草】的 BlowDuration×薄荷倍率
        bloverType: 'blover',              //   三叶草的植物别名（用来读数据）
        // ---- ⑤ 其他行的寒风特效 ----
        otherLaneVfx: true,            //   其他行也播同样两个特效（复用植物自己的 prefab）
        // ---- ⑥ 蒲公英联动（其他行）----
        //   原版：飓风甘蓝吹风时只让【它自己那一行】随机最多 4 株蒲公英一起吹。
        //   这里让【其他每一行】也各随机挑最多 N 株一起吹（跟随 affectAllLanes）。
        //   只调植物自己的 blowStart()，子弹数量/落点/动画全由引擎决定，模组不干预。
        otherLaneDandelions: 1,        //   其他每一行最多让几株蒲公英吹；0 = 关闭这条
        debugLog: false,
    },
    phatbeet: {                        // 魔音甜菜（Phat Beet）
        plantType: 'phatbeet',
        sunCost: 150,                  //   阳光消耗（已改回原版 150）
        // ---- ① 普攻眩晕 ----
        normalStun: 0.15,              //   普攻使命中的僵尸眩晕几秒（用户 2026/10/16：0.1 -> 0.15）
        // ---- ①b 普攻也施加「音乐免疫」（用户 2026/10/16 新增）----
        //   与下面 ②③⑤ 是**同一套机制**（gpnJamMask + __gpnJamClearCD）：
        //   普攻命中后，这只僵尸在 N 秒内不吃「魔音舞台（jam）」的任何效果。
        //   ⚠️ 用 Math.max 合并 ⇒ 普攻**绝不会缩短**大招给的 25 秒。
        normalJamClearSeconds: 1.25,   //   普攻命中后的音乐免疫秒数（0 = 关掉这条）
        normalJamFx: true,             // ★ 普攻这 1.25 秒**也铺**⑧命中特效（用户 2026/10/16 要求；纯视觉、零伤害）
                                       //   false = 只给机制、不铺特效（旧行为）
        // ---- ④ 大招眩晕 + 原地向上击起 ----
        plantfoodStun: 5,              //   大招使命中的僵尸眩晕几秒（本次 3 -> 5）
        liftDuration: 0.5,             //   滞空总时长（上抛 + 落回）；必须明显小于 plantfoodStun
        liftHeight: 40,                //   击起高度（像素；一格 = 80）
        bossBlocksLift: true,          //   BOSS 不击起（引擎只挡了部分 BOSS 类，所以显式再挡一道）
        heavyBlocksLift: true,         //   「沉重」不击起（暗物质火龙果的 darkmatter）
        // ---- ②③⑤ 音响僵尸「安抚」+ 音乐（jam）----
        clearPlantDebuff: true,        //   普攻(3x3)/大招(5x5) 解除音响僵尸对植物施加的安抚
        jamClearSeconds: 25,           //   大招让命中僵尸不受音乐影响的时长（本次 16 -> 25）
        // ---- ⑦⑧ 命中特效（hitPar；纯视觉：不 dealDamage、不碰 health）----
        clearFx: true,                 //   ⑦ 普攻/大招解除某株植物的安抚时，在该植物脚下放一次命中特效
        jamFx: true,                   //   ⑧ 大招「解除魔音舞台效果」期间，在被解除的僵尸脚下持续放命中特效
        jamFxInterval: 0,              //   持续特效的间隔（秒）；0 = 自动读动画时长（无缝接续）
        jamFxFallback: 0.3,            //   自动读不到时的兜底间隔（秒）
        jamFxScale: 1,                 //   间隔倍率（>1 更稀、<1 更密）
        jamFxLiftFollow: true,         //   僵尸被击起滞空时特效跟着抬起来；false = 留在地面
        debugLog: false,
    },
    garlic: {                          // 大蒜（不新增图鉴文本）
        plantType: 'garlic',
        eatDamage: 37.5,               // ReceivesDamageWhenEaten：被啃一口扣多少（原 150）
        sunCost: 75,                   // 阳光（原 50）
        cooldown: 15,                  // 种植冷却秒数（原 5）
    },
    snowpea: {                         // 寒冰射手（机制回调：单格范围冰减速 + 概率冰锥）
        plantType: 'snowpea',
        peaType: 'pea_snow',
        spikeAlias: 'pea_snow_spike',
        cloneFrom: 'snowdrop_freeze',
        freezeChance: 0.30,            //   冰锥概率（本次 0.15 -> 0.30；薄荷 ×3 = 90%）
        mintChanceFactor: 3,
        chillDuration: 10,
        freezeDuration: 6,
        splashFreezeDuration: 5,
        goldBg: 'prenium',
    },
    redstinger: {                      // 红针花：承伤倍率 + 左键循环切换形态
        plantType: 'redstinger',
        sunCost: 175,                  //   阳光消耗（原版 150 ⇒ 曾改 200 ⇒ 用户指定改为 **175**）
        tier1: 0.2,                    //   inArea 1（第 4~6 列）承伤倍率（原 0.3333333）= 80% 减伤
        tier2: 0.1,                    //   inArea 2（第 7~9 列）承伤倍率（原 0.2）= 90% 减伤
        knockbackDistance: 0.05,       //   inArea 1 的子弹击退力度（格）—— 走引擎自带的 knockbackDistance（同飞天豌豆/龙葵）
        clickSwitch: true,             //   左键循环切换形态 0 -> 1 -> 2 -> 0（右键在沙盒有冲突，故用左键）
        debugLog: false,
    },
    murkadamia: {                      // 暗影夏威夷果（MurkadamiaNut / 别名 murkadamia）
        plantType: 'murkadamia',
        shadowBodyAlpha: 0.5,          //   暗影状态下本体的透明度（0.5 = 50%；走主渲染器 color.a）
        shieldKeepsOpaque: true,       //   盾牌和本体在同一个渲染器上 ⇒ 盾牌在的时候不做半透明
        hideWhenJellyDown: true,       //   暗影物质被打光（冷却中）才上真隐身；回血后立刻解除
        jellyBaseHp: 2500,             //   原版暗影物质耐久上限的基础值（兜底 + 启动日志展示用）
        jellyBonusHp: 2500,            //   暗影物质耐久上限的固定加成（2500 + 2500 = 5000；永久生效）
        jellyCooldown: 5,              //   暗影物质被打光后的冷却秒数（= 原版值；保留此键便于再调）
        jellyInitialPct: 0.3,          //   暗影物质出现 / 冷却结束时的初始比例（原版 0.6 ⇒ 本次 0.3 = 5000×30% = 1500）
        debugLog: false,
    },
    splitpea: {                        // 裂荚射手（SplitPea）
        plantType: 'splitpea',
        sunCost: 200,                  //   阳光消耗（保持原版 200）
        clickFlip: true,               //   鼠标左键点它 -> 左右翻转（前后豌豆数跟着对调）
        // 图鉴「射速」那行要补的话（中英成对，追加在原文后面）
        extraZh: '。或者向前方两倍，向后方正常',
        extraEn: ' Or double forward, normal backward.',
        debugLog: false,
    },
};

/** 私有标记：只有带这个字段的弹道才会走穿透逻辑（避免误伤原版炮弹） */
const PIERCE_KEY = 'GPNMaxPierce';
/** 私有标记：穿透不看暗影态（星星果系用；暗影龙葵不带这个键，仍旧只在暗影态穿透） */
const PIERCE_ALWAYS_KEY = 'GPNPierceAlways';
/** 私有标记：溅射伤害 = 该发子弹实际伤害 x 这个比例（运行时算，跟随 GP-Next 改的数值） */
const SPLASH_RATIO_KEY = 'GPNSplashRatio';
/** 私有标记：这颗弹道命中/触地后，要在落点铺一片灼烧（甜椒投手用） */
const BURN_RATIO_KEY = 'GPNBurnRatio';
/** 私有标记：这条弹道属于哪一株星星果 —— 'base' / 'pink' / 'shooting'（A2 追击用） */
const STAR_KIND_KEY = 'GPNStarKind';
/** 私有标记：蒲公英弹道种类 —— 'normal'（普攻）/ 'blew'（吹风反应）/ 'pf'（大招），飞行/BOSS 加成用 */
const DANDELION_KIND_KEY = 'GPNDandelionKind';
/** 星星果系每条弹道的伤害（数据补丁时缓存）—— A2「延迟窗口合并」要按【触发时各自的攻击力】累加 */
const GPN_STAR_PRJ_DAMAGE = Object.create(null);

/* =========================================================================
 * 通用工具
 * =======================================================================*/
function log(...a) { console.log('[' + MOD_ID + ']', ...a); }
function warn(...a) { console.warn('[' + MOD_ID + ']', ...a); }

function restore(rec) {
    if (!rec) return;
    if (rec.desc && rec.proto) { Object.defineProperty(rec.proto, rec.name, rec.desc); return; }
    if (!rec.Cls) return;
    // rec.static = true 表示补的是类上的静态方法（例如 CharacterManager.footballmech.pushPlantLeft）
    const target = rec.static ? rec.Cls : rec.Cls.prototype;
    if (!target) return;
    // 原来这个方法不是「自有属性」（是从父类继承来的）→ 还原时应该删掉，别留个同名自有属性
    if (rec.own === false) delete target[rec.name];
    else target[rec.name] = rec.original;
}

/** 植物 codename 标准化：小写 + 去掉非字母数字（心蕊是 bloominghearts 复数，容错用） */
/** ★★ 硬规则（2026/10/21）：**任何按 Plant_Type 判定植物的代码都必须走这里**。
 *  实机日志证明部分关卡把 `Plant_Type` 设成 `RTID(tallnut@PlantTypes)` 形式（不是裸 codename），
 *  裸 `===` 比较会**静默失效**（高坚果扛砸 / 甜薯治疗·自回血 / 白萝卜闸门 / 心蕊减伤 / 孢子菇毒性家族都踩过）。
 *  新写判定时请：`normalizeType(this.Plant_Type) === normalizeType(CFG.x.plantType)`，并补一条 RTID 形式的自检。 */
function normalizeType(t) {
    if (typeof t !== 'string') return '';
    let s = t.trim();
    /* ★ 引擎在**部分关卡**把 `Plant_Type` 设成 RTID 形式（实机日志证过：`RTID(tallnut@PlantTypes)`）
     *   ⇒ 先把里面的 codename 取出来，再做小写/去符号。否则所有按 `Plant_Type` 判定的功能都会静默失效。 */
    const m = /^rtid\(([^@)]+)@/i.exec(s) || /^rtid\(([^@)]+)\)/i.exec(s);
    if (m) s = m[1];
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 打补丁前先登记原方法 + 它是不是自有属性 */
/* ============================================================================
 * 【开关门禁】统一包装器：把"关掉开关 ⇒ 完全不插手"收敛到**这一处**
 *   用法：Cls.prototype.m = gpnGatedBody(original, 'featKey', function () { …补丁体… });
 *   开着 ⇒ 走补丁体；关掉 ⇒ 直接 original.apply ⇒ 与"没打补丁"完全等价
 *   为什么要它：上次用"字符串批量替换"给 40+ 处手插判断 ⇒ 破坏控制流 ⇒ 一堆怪 BUG。
 *   __gpnGated 标记防"setup 跑两次 ⇒ 重复包装"。
 * ========================================================================== */
/* ★ 数据补丁自愈：apply() 返回 false 说明"static 数组还没填充 / 容器还没到位"，每秒重试直到成功。
 *   为什么需要（实机证据）：`PlantProps` 等由 readJsons 填充；实机日志里
 *   `数据已在 readJsons 之后重新应用` 从未出现 ⇒ 我们唯一的那次"补"没发生，
 *   于是 setField 一直空写、数值停留原版（表现为"关掉开关阳光不变"）。
 *   注意：不设硬上限（关卡数据可能是进关卡才加载），但也不会刷屏（只在特定次数打点）。
 */
let gpnDataRetryTimer = null;
let gpnDataRetryCount = 0;
function gpnStartDataPatchRetry(getPatch) {
    if (gpnDataRetryTimer) { try { clearInterval(gpnDataRetryTimer); } catch (e) { } }
    gpnDataRetryTimer = setInterval(() => {
        gpnDataRetryCount++;
        try {
            if (gpnDisposed) { clearInterval(gpnDataRetryTimer); gpnDataRetryTimer = null; return; }
            const dp = getPatch && getPatch();
            if (!dp || typeof dp.apply !== 'function') return;
            const ok = dp.apply();
            if (ok === true) {
                log('数据补丁：自愈成功（第 ' + gpnDataRetryCount + ' 次重试后数据已落到容器）');
                clearInterval(gpnDataRetryTimer); gpnDataRetryTimer = null;
            } else if (gpnDataRetryCount === 10 || gpnDataRetryCount === 60 || gpnDataRetryCount === 300 || gpnDataRetryCount === 600) {
                warn('数据补丁：第 ' + gpnDataRetryCount + ' 次重试仍未成功（容器/数组还没到位）');
            }
        } catch (e) { /* 单次失败不中断 */ }
    }, 1000);
}
const gpnGateStats = { bodies: 0, calls: 0, bypass: 0, reused: 0 };
/* ★ 注册表：保证"同一个原函数只被包装一次"
 *   为什么需要（实测）：setup 跑 N 次时，第 2 次拿到的 original 是"第 1 次包装后的函数"，
 *   于是又包一层 ⇒ 开着开关时**补丁体会被执行 N 次**（原函数仍只 1 次）。
 *   对"只改状态"的补丁（钢地刺的 spikeLeft、甜薯回血、香水菇层数、红针花形态）就可能出怪现象。
 *   而两次 setup 拿到的 o1 **是同一个函数对象** ⇒ 用 WeakMap 按 identity 缓存即可彻底幂等。
 */
const gpnGateRegistry = new WeakMap();
/* ★ 生命周期：模组被停用/重载后置 true。所有"会继续活动"的入口都要检查它，
 *   否则旧运行时会与新运行时并行（实机已复现：开关错乱、保存报 AbortError）。
 *   注意：模块级变量在**同一个模块实例**内共享；GP-NEXT 重新加载会得到新的模块实例，
 *   所以这个标志只用来让"本实例"安静下来，不会影响新实例。 */
let gpnDisposed = false;
let gpnCtx = null;                       // setup 的 ctx（配置界面注册 onDispose 时用）
let gpnDataBox = null;                   // 数据容器（PvZ2ObjectContainer）—— 配置界面打印"数据层现值"用
let gpnPlantsRef = null;                  // 由 setup 登记：plants 模块（引擎 getPlantProps 在这里）

/* ============================================================================
 * ★ 跨实例"活动令牌"（生命周期核心）
 *   背景（实机证据）：GP-NEXT 的「保存并重载」会**重新求值本模块并重跑 setup()**，
 *   但旧实例的 onDispose **从未被调用** ⇒ 两套逻辑并行，面板/点击互相覆盖。
 *   做法：把"当前活动实例"记在一个**跨模块实例共享**的全局对象上；
 *         每个运行期回调都先问"我还是活动实例吗"，不是就立刻静默。
 *   ⚠️ 不能只依赖 onDispose —— 实机证明它不会来。
 * ========================================================================== */
const GPN_ACTIVE_KEY = '__GPN_CTM_ACTIVE_V1__';
/** 跨实例共享的"我方窗体"登记表：键=实例ID，值={ panel, origWin }。
 *  用途：新实例抢占令牌后，把上一个实例**残留的窗体关掉**（否则两个面板叠在同一位置）。
 *  注意窗体会随场景销毁 ⇒ 用之前必须判 isValid。 */
function gpnPanelReg() {
    try {
        const g = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
        if (!g) return null;
        if (!g[GPN_ACTIVE_KEY]) g[GPN_ACTIVE_KEY] = { active: '', retired: Object.create(null), panels: Object.create(null) };
        if (!g[GPN_ACTIVE_KEY].panels) g[GPN_ACTIVE_KEY].panels = Object.create(null);
        return g[GPN_ACTIVE_KEY].panels;
    } catch (e) { return null; }
}
/** 关掉"除我自己以外"所有实例登记过的窗体（新实例启动时调用） */
function gpnCloseStalePanels() {
    let closed = 0;
    try {
        const reg = gpnPanelReg();
        if (!reg) return 0;
        for (const k of Object.keys(reg)) {
            if (k === GPN_INSTANCE_ID) continue;
            try {
                const ent = reg[k];
                if (ent && ent.panel && ent.panel.isValid) { ent.panel.active = false; closed++; }
                delete reg[k];
            } catch (e) { /* 忽略 */ }
        }
        if (closed) log('[CTM] 已关掉上一个实例残留的窗体 ' + closed + ' 个');
    } catch (e) { /* 忽略 */ }
    return closed;
}
function gpnGlobalReg() {
    try {
        const g = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
        if (!g) return null;
        if (!g[GPN_ACTIVE_KEY]) g[GPN_ACTIVE_KEY] = { active: '', seq: 0, retired: Object.create(null), panels: Object.create(null), ensure: null };
        if (g[GPN_ACTIVE_KEY].seq === undefined) g[GPN_ACTIVE_KEY].seq = 0;
        return g[GPN_ACTIVE_KEY];
    } catch (e) { return null; }
}
/** 本实例的代次（每个模块实例一个，抢占令牌时分配） */
let gpnInstanceSeq = 0;
/** 本实例是否仍是"当前活动实例"（被更高代次的实例顶替 ⇒ 过期 ⇒ 一律静默）
 *  判据用**代次比较**而不是"令牌是否相等"：
 *    · 自检会在同一进程内多次加载模块；若用"相等"判定，旧实例的 cleanup 会被误判成过期。
 *    · 只有"存在代次比我更大的实例"才真的说明我被顶替了。 */
function gpnIsActiveInstance() {
    try {
        const r = gpnGlobalReg();
        if (!r) return true;                                   // 拿不到注册表 ⇒ 按活动处理
        if (!r.active || !r.seq) return true;                  // 还没人抢过 ⇒ 我说了算（自检场景）
        return !(gpnInstanceSeq > 0 && r.seq > gpnInstanceSeq);
    } catch (e) { return true; }
}
/** 抢占活动令牌；若发现上一个实例还留着"退役回调"，就地调用它 */
function gpnClaimInstance() {
    try {
        const r = gpnGlobalReg();
        if (!r) return;
        const prev = r.active;
        // ⚠️ **不要**调用 `r.retired[prev]()`：那个闭包改的是**它自己模块实例**的 `gpnDisposed`。
        //    自检会在同一进程内反复加载模块，"上一个实例"的模块级变量可能就属于当前实例
        //    ⇒ 一调用就把自己标成"已销毁"，所有补丁都不装（实测 59 条断言失败）。
        //    令牌赋值本身就够：旧实例的所有回调都会先查 `gpnIsActiveInstance()` 而静默。
        try { delete r.retired[prev]; } catch (e2) { /* 忽略 */ }
        r.active = GPN_INSTANCE_ID;
        r.seq = (r.seq || 0) + 1;                              // ★ 代次递增
        gpnInstanceSeq = r.seq;
        log('[CTM] 活动实例令牌 = ' + GPN_INSTANCE_ID + '（第 ' + gpnInstanceSeq + ' 代，上一个 = ' + (prev || '无') + '）');
    } catch (e) { /* 忽略 */ }
}
/** 本实例马上要让位给别的新实例（由 onDispose 或"被抢占"时调用）：只做必要的自己人清理 */
function gpnRetireSelf() {
    if (gpnDisposed) return;
    gpnDisposed = true;
    try { gpnOnRetire(); } catch (e) { /* 忽略 */ }
}
/** 由配置界面块登记：让位时关掉自己的窗体（避免两个面板叠着） */
let gpnOnRetire = null;

/* ★ 统一取"数据容器"。
 *   ⚠️ 必须兼容三种形态：它是 JSONs 模块里的**类**（typeof === "function"）、也可能是实例/普通对象。
 *   （曾经写成 `typeof box === 'object'` ⇒ 对类永远为假 ⇒ 诊断谎报"无容器"，排查被误导很久。）
 *   判据改成"结构判据"：有 PlantProps / ProjectileProps / PlantAlmanac 任一即可。
 */
function gpnResolveDataBox() {
    const cands = [gpnDataBox, (typeof PvZ2ObjectContainerRef === 'function') ? PvZ2ObjectContainerRef() : null];
    for (const c of cands) {
        if (!c) continue;
        try { if (Array.isArray(c.PlantProps) || Array.isArray(c.ProjectileProps) || Array.isArray(c.PlantAlmanac)) return c; } catch (e) { /* 忽略 */ }
    }
    return gpnDataBox || null;
}
function gpnGatedBody(original, featKey, body) {
    try {
        if (original && typeof original === 'function') {
            if (original.__gpnGated) return original;               // 已经是包装函数 ⇒ 直接用（标记兜底）
            const hit = gpnGateRegistry.get(original);
            if (hit) { gpnGateStats.reused++; return hit; }         // 同一个原函数 ⇒ 复用同一层包装
        }
    } catch (e) { /* 忽略 */ }
    const wrapped = function () {
        gpnGateStats.calls++;
        if (gpnDisposed) { gpnGateStats.bypass++; return original.apply(this, arguments); }   // ★ 旧运行时：不插手
        if (!featOn(featKey)) { gpnGateStats.bypass++; return original.apply(this, arguments); }
        return body.apply(this, arguments);
    };
    try {
        wrapped.__gpnGated = featKey;                               // 标记：供兜底与自检识别
        if (original && typeof original === 'function') gpnGateRegistry.set(original, wrapped);
    } catch (e) { /* 忽略 */ }
    gpnGateStats.bodies++;
    return wrapped;
}

function methodRecord(Cls, name) {
    return {
        Cls,
        name,
        original: Cls.prototype[name],
        own: Object.prototype.hasOwnProperty.call(Cls.prototype, name),
    };
}

/* =========================================================================
 * 1. 数值：运行时改 PlantProps / ProjectileProps
 * =======================================================================*/
/* ★ 鼠标点击去重（修「矿车/格子上一次点击切换两次形态」）
 *   实测（probe-cart-1 探针）一次按下+抬起会走两条链：
 *     A = plantMouseReact ← 格子 onMouseDown（按下时）
 *     B = 格子 onMouseUp 的 delayMouseDownPlantsOnCart.forEach(e => e.onMouseDown(t))（抬起时补发）
 *   引擎本来用 B 来兜「拖车时不算点击」，而我们在 A 里已经切过一次 ⇒ 重复。
 *   ⇒ 只把**补发的那一次**挡掉：阈值 180ms（实测两条链相差 44~103ms）。
 *      这个量级与引擎自己的重复点击护栏一致 —— 引擎在 MouseListener 里也是
 *      每次点击后置 `MouseClickCoolingDown = 2`（约 2 帧 ≈ 66~100ms，按 30~60fps 估）。
 *   ⚠️ 副作用（与引擎那道护栏同性质）：180ms 内的两次独立点击会被并成一次。
 *      正常人手速约 200~300ms ⇒ 绝大多数情况无感；但**很刻意地快速连点**
 *      （间隔 <180ms）会少切一次。要更灵敏就把 GPN_CLICK_DEDUP_MS 调小（如 120，
 *      但要 >103ms，否则挡不住补发那一次）。实测数据：两条链相差 44 / 60 / 83 / 103ms。
 */
const GPN_CLICK_DEDUP_MS = 180;
function gpnClickOnce(self, key) {
    try {
        const now = Date.now();
        const last = self[key] || 0;
        if (now - last < GPN_CLICK_DEDUP_MS) return false;
        self[key] = now;
        return true;
    } catch (e) { return true; }        // 出错就按"允许"处理，绝不因此卡住功能
}

/** 数字 -> 中文（图鉴文本用；0~20 用汉字，其它回落到阿拉伯数字）
 *  为什么到 20：图鉴里有「能承受滚动前行的僵尸 N 次打击」这类句子，
 *  只到 10 会在 11+ 时变成「…11 次打击」那样半文半白。 */
const GPN_ZH_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十'];
/** 穿透/打中数统一钳制：小数向下取整；非有限数或 < 1 ⇒ 1（1 = 不穿透，永远不出现 0） */
function gpnPierceN(v) {
    const n = Math.floor(Number(v));
    return (Number.isFinite(n) && n >= 1) ? n : 1;
}

/** 真正「穿透几个」= 打中数 − 1（最小 0；图鉴 / 日志用） */
function gpnPierceText(v) {
    return Math.max(0, gpnPierceN(v) - 1);
}

/** 追击弹的打中数 = 星星果（基础）的打中数 + followPierceBonus（bonus < 0 / 写错 ⇒ 0） */
function gpnFollowPierce() {
    const b = Math.floor(Number(CFG.starfruit.followPierceBonus));
    return gpnPierceN(CFG.starfruit.pierceTargets) + (Number.isFinite(b) && b > 0 ? b : 0);
}

function gpnZhNum(n) {
    n = Math.round(n);
    return (n >= 0 && n < GPN_ZH_NUM.length) ? GPN_ZH_NUM[n] : String(n);
}

/** 穿透文案专用的中文数字：2 写成「两」（量词习惯：穿透两个目标），其余沿用 gpnZhNum */
function gpnPierceZh(n) {
    return (Math.round(n) === 2) ? '两' : gpnZhNum(n);
}

/* ============================================================================
 * ★ 图鉴文案总览（**纯只读**）
 *   背景：40 处图鉴写入散在 apply() 里，文案是「拼」出来的（含 CFG 现算表达式），
 *         想知道最终长什么样、得手工代值 —— 这个总览把「实际写进去的文案」原样读出来。
 *   特点：**不写任何数据、不加任何原型补丁**；只在被调用时遍历 PlantAlmanac。
 *   用法（F12 Console，随时可用，无需重进游戏）：
 *     gpnAlmDumpAll()              // 只看我们改过的
 *     gpnAlmDumpAll('all')         // 我们改过的 + 其余仅列名
 *     gpnAlmDumpOne('starfruit')   // 只看某一株
 *     gpnAlmOverview()             // 结构化数据（可 copy(gpnAlmOverview()) 取出）
 * ========================================================================== */

/* 图鉴「两态」用的状态（模块级，跨 apply 保留）：
 *   · GPN_ALM_SNAPSHOT_DONE —— 是否已抓过原件快照（只在**第一次** apply 抓，那一刻还没被我们改过）
 *   · GPN_ALM_ORIG          —— [{ alias, od: 原件 objdata 的深拷贝 }]
 *   ⚠ 跨实例（保存并重载）时模块会被重新求值 ⇒ 这两个会重置，而那时数据可能已被旧实例改过；
 *     届时按"当前状态"重新抓快照（会把我们自己的文案当成原件，但那一轮仍能正确两态）。 */
let GPN_ALM_SNAPSHOT_DONE = false;
const GPN_ALM_ORIG = [];
/** objdata 的深拷贝 —— 只处理 JSON 安全值（对象/数组/字符串/数字/布尔/null），
 *  图鉴文案结构就是这么朴素；遇到其它类型退回引用（不影响正确性，只影响"完全还原"）。 */
function gpnAlmDeepClone(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
        const a = new Array(v.length);
        for (let i = 0; i < v.length; i++) a[i] = gpnAlmDeepClone(v[i]);
        return a;
    }
    const o = {};
    for (const k of Object.keys(v)) o[k] = gpnAlmDeepClone(v[k]);
    return o;
}
/** 快照提示：只在 verboseLog 打开时打，且"株数变化"时再打一次（避免刷屏） */
function log_alm_snapshot(n) {
    try {
        if (!verboseOn()) return;
        if (n === GPN_ALM_LAST_SNAP_N) return;
        GPN_ALM_LAST_SNAP_N = n;
        log('【图鉴两态】已抓原件快照：' + n + ' 株（此后每次开关变化都从原件重建，开/关两个方向都即时生效）');
    } catch (e) { /* 只影响这一行日志 */ }
}
let GPN_ALM_LAST_SNAP_N = -1;

/** 我们改过图鉴的植物：**[图鉴 alias, 对应功能开关名]**。
 *  为什么不只是数组：图鉴 alias 与开关名**并不一一对应** ——
 *    · 心蕊：图鉴是复数 `bloominghearts`，开关是 `bloomingheart`；
 *    · 星星果系 3 株：图鉴 alias 各不同，开关**都是** `starfruit`。
 *  这张表既是「哪些算我们改的」的唯一出处，也是给后来人的提醒。 */
const GPN_ALM_CHANGED = [
    ['chilibean', 'chilibean'], ['spikerock', 'spikerock'], ['bloominghearts', 'bloomingheart'],
    ['nightshade', 'nightshade'], ['turnip', 'turnip'], ['sweetpotato', 'sweetpotato'],
    ['tallnut', 'tallnut'], ['perfumeshroom', 'perfumeshroom'],
    ['starfruit', 'starfruit'], ['pinkstarfruit', 'starfruit'], ['shootingstarfruit', 'starfruit'],
    ['noctarine', 'noctarine'], ['dandelion', 'dandelion'], ['pepperpult', 'pepperpult'],
    ['hurrikale', 'hurrikale'], ['phatbeet', 'phatbeet'], ['snowpea', 'snowpea'],
    ['redstinger', 'redstinger'], ['splitpea', 'splitpea'], ['murkadamia', 'murkadamia'],
    ['sporeshroom', 'sporeshroom'],
];

function gpnAlmList() {
    try {
        const C = (typeof gpnResolveDataBox === 'function') ? gpnResolveDataBox() : null;
        return (C && Array.isArray(C.PlantAlmanac)) ? C.PlantAlmanac : null;
    } catch (e) { return null; }
}
/** 取一株的图鉴文本（中/英）—— 只读 */
function gpnAlmTextOf(alias) {
    const AL = gpnAlmList();
    if (!AL) return null;
    let e = null;
    for (const x of AL) { if (x && Array.isArray(x.aliases) && x.aliases.indexOf(alias) !== -1) { e = x; break; } }
    if (!e || !e.objdata) return null;
    const od = e.objdata;
    const grab = (v) => (v && typeof v === 'object')
        ? { zh: String(v.zh || ''), en: String(v.en || '') }
        : { zh: String(v || ''), en: '' };
    const out = { alias: alias, aliases: e.aliases.slice(), intro: null, brief: null, special: [] };
    if (od.Introduction) out.intro = grab(od.Introduction);
    if (od.BriefIntroduction) out.brief = grab(od.BriefIntroduction);
    if (Array.isArray(od.Special)) {
        for (const row of od.Special) { if (row && row.DESCRIPTION) out.special.push(grab(row.DESCRIPTION)); }
    }
    return out;
}
/** 结构化总览 —— 只读。返回 { total, changed:[{alias,feat,on,intro,brief,special}], others:[alias] } */
function gpnAlmOverview() {
    const AL = gpnAlmList();
    if (!AL) return { total: 0, changed: [], others: [], error: '拿不到 PlantAlmanac（数据容器未就绪）' };
    const seen = Object.create(null);
    const changed = [];
    for (const pair of GPN_ALM_CHANGED) {
        const a = pair[0], feat = pair[1];
        const x = gpnAlmTextOf(a);
        if (!x) continue;
        x.feat = feat;
        try { x.on = featOn(feat); } catch (e) { x.on = true; }
        changed.push(x);
        seen[a] = true;
    }
    const others = [];
    for (const e of AL) {
        if (!e || !Array.isArray(e.aliases)) continue;
        const a0 = e.aliases[0];
        if (!a0 || seen[a0]) continue;
        others.push(a0);
    }
    return { total: AL.length, changed: changed, others: others };
}
/** 打印一株的文本（内部共用） */
function gpnAlmPrintOne(x) {
    if (x.intro) { log('   [介绍 zh] ' + x.intro.zh); log('   [介绍 en] ' + x.intro.en); }
    if (x.brief) { log('   [简介 zh] ' + x.brief.zh); log('   [简介 en] ' + x.brief.en); }
    for (let i = 0; i < x.special.length; i++) {
        log('   [特点' + (i + 1) + ' zh] ' + x.special[i].zh);
        log('   [特点' + (i + 1) + ' en] ' + x.special[i].en);
    }
}
/** 打印总览。mode：省略 / 'changed' = 只看我们改过的；'all' = 附带其余仅列名 */
function gpnAlmDumpAll(mode) {
    const wantAll = (mode === 'all');
    const o = gpnAlmOverview();
    if (o.error) { log('【图鉴文案总览】' + o.error); return o; }
    log('【图鉴文案总览】图鉴共 ' + o.total + ' 条 ｜ 我们改过 ' + o.changed.length + ' 株'
        + (wantAll ? (' ｜ 其余 ' + o.others.length + ' 株仅列名') : " ｜（含全部请 gpnAlmDumpAll('all')）"));
    for (const x of o.changed) {
        log('──────── ' + x.alias + '（开关 ' + x.feat + ' = ' + (x.on ? '开' : '关') + '）');
        gpnAlmPrintOne(x);
    }
    if (wantAll) {
        log('──────── 其余 ' + o.others.length + ' 株（未改动，仅列名）');
        log('   ' + o.others.join('、'));
    }
    return o;
}
/** 打印一株 —— 只读；找不到时给出提示 */
function gpnAlmDumpOne(alias) {
    const x = gpnAlmTextOf(alias);
    if (!x) {
        const hint = (alias === 'bloomingheart') ? '（心蕊在图鉴里的 alias 是复数 bloominghearts）' : '';
        log('【图鉴文案总览】找不到 ' + alias + hint);
        return null;
    }
    log('──────── ' + x.alias + '（aliases: ' + x.aliases.join(',') + '）');
    gpnAlmPrintOne(x);
    return x;
}
/* 挂到全局，方便控制台直接调用（只读接口，随手可用） */
try {
    const _g = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : null);
    if (_g) {
        _g.gpnAlmOverview = gpnAlmOverview;
        _g.gpnAlmDumpAll = gpnAlmDumpAll;
        _g.gpnAlmDumpOne = gpnAlmDumpOne;
    }
} catch (e) { /* 忽略 */ }
/* dynamic original value: the "off" branch must READ it, never hardcode it.
 *   Lesson (caught by selftest): I hardcoded phatbeet off=150, but its real original value
 *   can be anything (the mock uses 999 as a sentinel) => hardcoding is simply wrong.
 *   Rule: record it on first read (including "field did not exist"), then always reuse it.
 */
const gpnVanillaMemo = new Map();
function gpnVanilla(listName, alias, field) {
    const mk = listName + "|" + alias + "|" + field;
    if (gpnVanillaMemo.has(mk)) return gpnVanillaMemo.get(mk);
    let val;
    try {
        const Box = (typeof gpnResolveDataBox === "function") ? gpnResolveDataBox() : null;
        const list = Box && Box[listName];
        const hit = Array.isArray(list) ? list.filter((e) => e && Array.isArray(e.aliases) && e.aliases.indexOf(alias) !== -1)[0] : null;
        val = (hit && hit.objdata) ? hit.objdata[field] : undefined;
    } catch (e) { val = undefined; }
    const rec = { had: val !== undefined, value: val };
    gpnVanillaMemo.set(mk, rec);
    return rec;
}
/* restore a field to its recorded original state (delete it if it never existed) */
function gpnRestoreField(listName, alias, field) {
    try {
        const rec = gpnVanilla(listName, alias, field);
        const Box = (typeof gpnResolveDataBox === "function") ? gpnResolveDataBox() : null;
        const list = Box && Box[listName];
        if (!Array.isArray(list)) return false;
        const hits = list.filter((e) => e && Array.isArray(e.aliases) && e.aliases.indexOf(alias) !== -1);
        for (const e of hits) {
            if (!e.objdata) continue;
            if (rec.had) e.objdata[field] = rec.value;
            else { try { delete e.objdata[field]; } catch (e2) { } }
        }
        return true;
    } catch (e) { return false; }
}
function makeDataPatcher(PvZ2ObjectContainer) {
    const undo = [];
    try { gpnDataBox = PvZ2ObjectContainer; } catch (e) { /* 忽略 */ }   // 供配置界面诊断打印

    const track = (objdata, key) => {
        // 同一个字段只记【第一次】的原值：apply() 会被调用多次
        // （立刻一次 + readJsons 之后再一次），重复记会让"还原"还原成补丁后的值。
        for (const r of undo) {
            if (r.objdata === objdata && r.key === key) return;
        }
        undo.push({
            objdata,
            key,
            had: Object.prototype.hasOwnProperty.call(objdata, key),
            old: objdata[key],
        });
    };

    const setField = (listName, alias, key, value) => {
        const Box = (typeof gpnResolveDataBox === 'function') ? gpnResolveDataBox() : PvZ2ObjectContainer;
        const list = Box && Box[listName];
        if (!Array.isArray(list) || !list.length) return false;
        const hits = list.filter((e) => e && Array.isArray(e.aliases) && e.aliases.indexOf(alias) !== -1);
        if (!hits.length) { warn('数据里找不到 ' + listName + '/' + alias); return false; }
        for (const e of hits) {
            if (!e.objdata) e.objdata = {};
            track(e.objdata, key);
            e.objdata[key] = value;
        }
        // ============================================================
        // 图鉴文本（v1.0.0 正式版）
        //   ⚠ 这里的数值一律【从 CFG 现算】，不写死 —— 调参之后图鉴会跟着变，
        //      不会出现"图鉴写 40%、实际改了却是别的值"这类不一致。
        //   ⚠ 跨功能的文案要跟着【另一个】开关走：例如香水菇那条里的"啃食伤害降低"
        //      其实是 bloomingheart 的效果，所以只在 bloomingheart 也开着时才写。
        //   只改 Introduction / BriefIntroduction / Special 三类文字。
        //   Elements 里的 SUNCOST / RECHARGE 【不带数值】，UI 运行时从 PlantProps 读
        //   ⇒ 阳光 / 冷却改了会自动显示，不用动图鉴。
        //   规则：能保留就保留（追加），只有【原话说错了】的才改写。
        // ============================================================

        return true;
    };

    /**
     * ★★ 图鉴文案（**独立函数**：从 setField() 里搬出来的，见开发记录 §3.58）★★
     *   【为什么要搬】原来这 480 多行**被包在 `setField()` 里面**，于是有两个毛病：
     *     ① `setField()` 有两条**提前返回**（列表为空 / 找不到条目）⇒ 一旦命中，
     *        图鉴块**整块不执行** ⇒ 图鉴文案悄悄没写（引擎数据晚到时就会这样）；
     *     ② `apply()` 会调用 `setField()` **二十多次** ⇒ 图鉴块被重复执行二十多遍。
     *   现在它是独立一步：**与 setField 的成败无关**，且每次 apply **只跑一次**。
     *   ⚠️ 调用点在 apply() 里，用 try/catch 包住 —— 图鉴写失败不应连累数据补丁的返回值。
     */
    const applyAlmanacText = () => {
    if (PvZ2ObjectContainer && Array.isArray(PvZ2ObjectContainer.PlantAlmanac)) {
        const AL = PvZ2ObjectContainer.PlantAlmanac;
        // 我们名单里的 alias 集合（只对它们做"写不到就 warn"，避免误报）
        const gpnAlmAliasSet = Object.create(null);
        for (const _p of GPN_ALM_CHANGED) gpnAlmAliasSet[_p[0]] = true;
        // ★ findAl：先精确匹配；失败再试「去尾部 s / 加尾部 s」的**双名兜底**。
        //   ⚠️ 为什么需要兜底：图鉴里的 alias 与别处**并不一一对应** ——
        //      心蕊在图鉴里是复数 `bloominghearts`，而别处（功能开关 / 弹道）是单数 `bloomingheart`。
        //      万一写错，以前是**静默返回 null ⇒ 图鉴悄悄没写**（排查花过很久）；
        //      现在 ① 双名兜底能自动救回来，② 真救不回来时由 warn 报出来（不再是静默失败）。
        const gpnAlmWarned = Object.create(null);
        const gpnAlmWarnMiss = (what, alias) => {
            if (!gpnAlmAliasSet[alias]) return;          // 只提醒"我们名单里的"，避免误报
            if (gpnAlmWarned[alias]) return;             // 每个 alias 只提醒一次（apply 会跑很多遍）
            gpnAlmWarned[alias] = true;
            warn('图鉴：' + what + ' 里找不到 alias「' + alias + '」—— 没写进去（请核对拼写）');
        };
        const findAl = (alias) => {
            for (const e of AL) {
                if (e && Array.isArray(e.aliases) && e.aliases.indexOf(alias) !== -1) return e;
            }
            const alt = (alias.slice(-1) === 's') ? alias.slice(0, -1) : (alias + 's');
            for (const e of AL) {
                if (e && Array.isArray(e.aliases) && e.aliases.indexOf(alt) !== -1) return e;
            }
            return null;
        };
        const setLoc = (holder, field, zh, en) => {
            if (!holder) return false;
            let o = holder[field];
            if (!o || typeof o !== 'object') { track(holder, field); holder[field] = {}; o = holder[field]; }
            if (typeof zh === 'string') { track(o, 'zh'); o.zh = zh; }
            if (typeof en === 'string') { track(o, 'en'); o.en = en; }
            return true;
        };
        const writeIntro = (alias, zh, en) => {
            const e = findAl(alias);
            if (!e) { gpnAlmWarnMiss('介绍(Introduction)', alias); return false; }
            return setLoc(e.objdata, 'Introduction', zh, en);
        };
        const writeBrief = (alias, zh, en) => {
            const e = findAl(alias);
            if (!e) { gpnAlmWarnMiss('简介(BriefIntroduction)', alias); return false; }
            return setLoc(e.objdata, 'BriefIntroduction', zh, en);
        };
        const addSpecial = (alias, zh, en) => {
            const e = findAl(alias);
            if (!e || !e.objdata) { gpnAlmWarnMiss('特点(Special)', alias); return false; }
            const od = e.objdata;
            const list = Array.isArray(od.Special) ? od.Special : null;
            if (list) {
                for (const row of list) {
                    const d = row && row.DESCRIPTION;
                    if (d && d.zh === zh) return true;      // 已经加过（apply 会跑多次）
                }
            }
            track(od, 'Special');
            od.Special = (list || []).concat([{
                NAME: { zh: '特点', en: 'Special' },
                DESCRIPTION: { zh, en },
            }]);
            return true;
        };
        const editSpecial = (alias, needle, zh, en) => {
            const e = findAl(alias);
            if (!e || !e.objdata || !Array.isArray(e.objdata.Special)) return false;
            for (const row of e.objdata.Special) {
                const d = row && row.DESCRIPTION;
                if (!d) continue;
                const hit = (typeof d.zh === 'string'
                        && (d.zh.indexOf(needle) !== -1 || (typeof zh === 'string' && d.zh === zh)))
                    || (typeof d.en === 'string' && d.en.indexOf(needle) !== -1);
                if (!hit) continue;
                if (typeof zh === 'string') { track(d, 'zh'); d.zh = zh; }
                if (typeof en === 'string') { track(d, 'en'); d.en = en; }
                return true;
            }
            warn('图鉴：找不到要改的 Special 行（' + alias + ' / ' + needle + '）');
            return false;
        };
        // 在「含某关键词的那个本地化对象」上【追加】一句。
        //  图鉴文案可能不在 Special / Introduction / BriefIntroduction 里（可能在别的字段的任意深度），
        //  所以这里【递归】找；再找不到就把该植物所有 zh 文案连路径一起打出来（debugLog），便于定位。
        const appendLoc = (alias, needles, zhSuffix, enSuffix) => {
            const e = findAl(alias);
            if (!e || !e.objdata) { warn('图鉴：找不到这个植物的条目（' + alias + '）'); return false; }
            const list = Array.isArray(needles) ? needles : [needles];
            const found = [];       // [{o, path}]
            const walk = (o, path) => {
                if (!o || typeof o !== 'object') return;
                if (typeof o.zh === 'string') found.push({ o: o, path: path || '(root)' });
                if (Array.isArray(o)) {
                    o.forEach((x, i) => walk(x, path + '[' + i + ']'));
                } else {
                    for (const k of Object.keys(o)) walk(o[k], path ? (path + '.' + k) : k);
                }
            };
            walk(e.objdata, '');
            let hit = null, hitNeedle = null;
            for (const nd of list) {                      // 按 given 顺序优先（先找"更像正文"的那句）
                for (const f of found) {
                    if (f.o.zh.indexOf(nd) !== -1) { hit = f; hitNeedle = nd; break; }
                }
                if (hit) break;
            }
            if (!hit) {
                warn('图鉴：' + alias + ' 里找不到含「' + list.join(' / ') + '」的文案，没改');
                if (dbgOn(CFG.splitpea.debugLog)) {
                    // ① 把这个植物自己的所有文案连"路径"打出来
                    log('  图鉴[' + alias + '] 共有 ' + found.length + ' 条中文文案：');
                    for (const f of found) log('    ' + f.path + ' = ' + String(f.o.zh).slice(0, 70));
                    // ② 全表扫一遍：万一这句挂在别的条目/别的表上（只报告，不改）
                    try {
                        const needle0 = list[0];
                        for (const e2 of (AL || [])) {
                            if (!e2 || !e2.objdata) continue;
                            const hits2 = [];
                            const w2 = (o2, p2) => {
                                if (!o2 || typeof o2 !== 'object') return;
                                if (typeof o2.zh === 'string' && o2.zh.indexOf(needle0) !== -1) hits2.push(p2);
                                if (Array.isArray(o2)) o2.forEach((x, i) => w2(x, p2 + '[' + i + ']'));
                                else for (const k of Object.keys(o2)) w2(o2[k], p2 ? (p2 + '.' + k) : k);
                            };
                            w2(e2.objdata, '');
                            for (const p2 of hits2) {
                                log('  别处也有一份：aliases=' + JSON.stringify(e2.aliases) + ' 路径=' + p2);
                            }
                        }
                        const fl = PvZ2ObjectContainer && PvZ2ObjectContainer.PlantFeatures;
                        if (Array.isArray(fl)) {
                            for (const fe of fl) {
                                if (!fe || String(fe.CODENAME || '').toLowerCase() !== String(alias).toLowerCase()) continue;
                                for (const k of Object.keys(fe)) {
                                    const v = fe[k];
                                    if (v && typeof v === 'object' && typeof v.zh === 'string') {
                                        log('  PlantFeatures[' + alias + '].' + k + ' = ' + String(v.zh).slice(0, 70));
                                    }
                                }
                            }
                        }
                    } catch (e) { /* 没有就算了 */ }
                }
                return false;
            }
            const d = hit.o;
            // 【诊断】图鉴追加的"零输出记账"（只在 dump 时输出一次）：
            //   记录"是否真的写进去了 / 写了几次 / 每次写前的当前值前缀"，
            //   用来判断那 50 次重复到底是"apply 被反复调用"还是"我们自己的判据失效"。
            gpnAlmAppendCalls++;
            const _zhBefore = (typeof d.zh === 'string') ? d.zh : '';
            const _zhHitBefore = (typeof zhSuffix === 'string') ? (_zhBefore.indexOf(zhSuffix) !== -1) : null;
            gpnAlmAppendLog.push({
                n: gpnAlmAppendCalls,
                path: hit.path,
                needle: hitNeedle,
                hitBefore: _zhHitBefore,
                lenBefore: _zhBefore.length,
                tail: _zhBefore.slice(-24),
            });
            if (typeof zhSuffix === 'string' && d.zh.indexOf(zhSuffix) === -1) {
                track(d, 'zh'); d.zh = d.zh + zhSuffix;
                gpnAlmAppendWrites++;
                // ★ 只在【真的写入】时打日志，且最多打 5 条（2026/10/10 实机定论：这段代码
                //   每帧/每次 apply 都会被执行，之前"执行一次打一行"⇒ 一局刷出 ~50 行噪音，
                //   但判据是可靠的 —— 文本【不会】被重复追加，用户实机确认图鉴文案正常）。
                if (dbgOn(CFG.splitpea.debugLog) && gpnAlmAppendWrites <= 5) {
                    log('图鉴：' + alias + ' 的「' + hitNeedle + '」在 ' + hit.path + '，已追加（第 '
                        + gpnAlmAppendWrites + ' 次写入；本次是第 ' + gpnAlmAppendCalls + ' 次进入）');
                }
            }
            if (typeof enSuffix === 'string' && typeof d.en === 'string'
                && d.en.indexOf(enSuffix) === -1) {
                track(d, 'en'); d.en = d.en + enSuffix;
            }
            return true;
        };

        // 【诊断】把图鉴追加的记账打出来（唯一输出点；只打前 5 条明细 + 汇总）
        const gpnAlmDump = (why) => {
            try {
                log('图鉴【记账 dump】原因：' + why
                    + '；apply() 累计调用 ' + gpnAlmApplyCalls + ' 次'
                    + '；appendLoc 进入 ' + gpnAlmAppendCalls + ' 次'
                    + '；实际写入 zh ' + gpnAlmAppendWrites + ' 次');
                gpnAlmAppendLog.slice(0, 5).forEach((x) => {
                    log('   #' + x.n + ' path=' + x.path + ' needle=' + x.needle
                        + ' 进入时"已含后缀"=' + x.hitBefore + ' 长度=' + x.lenBefore
                        + ' 尾部="…' + x.tail + '"');
                });
                // ★ 关键验证：现在再读一次那份文案，看"我们写的还在不在"
                //   （若被引擎重载/换对象覆盖掉 ⇒ 判据失效 ⇒ 就是重复追加的根因）
                const arr = (typeof findAl === 'function') ? findAl('splitpea') : null;
                const obj = arr && arr.objdata;
                let readBack = '(取不到)';
                if (obj) {
                    const walk2 = (o) => {
                        if (!o || typeof o !== 'object') return null;
                        if (typeof o.zh === 'string' && o.zh.indexOf('向后方两倍') !== -1) return o;
                        if (Array.isArray(o)) { for (const x of o) { const r2 = walk2(x); if (r2) return r2; } return null; }
                        for (const k of Object.keys(o)) { const r2 = walk2(o[k]); if (r2) return r2; }
                        return null;
                    };
                    const t2 = walk2(obj);
                    if (t2) {
                        const hasIt = (typeof CFG.splitpea.extraZh === 'string') && t2.zh.indexOf(CFG.splitpea.extraZh) !== -1;
                        readBack = '长度 ' + t2.zh.length + '，是否仍含我们追加的后缀=' + hasIt
                            + '，出现次数=' + (t2.zh.split(CFG.splitpea.extraZh).length - 1);
                    } else { readBack = '(找不到含该关键词的文案)'; }
                }
                log('   回读验证（splitpea）：' + readBack);
            } catch (e) { /* 只影响诊断 */ }
        };

        // ★★★ 图鉴文案的「两态」—— 原件快照 + 每次重建（修 config-l31 的 BUG）★★★
        //   【BUG 现象】开着用过 → 再关掉，图鉴文案**不会回到原版**（留在"开着"的样子）。
        //   【根因】下面 19 个写入点全是 `if (featOn(...)) { 写入 }`，**只有"开时写"，没有"关时移除"**
        //          ⇒ 单向闩锁。而"启动时就关着"的实例因为一次都没写过，反而是对的
        //          ⇒ 所以这个 BUG **只在"开着用过再关掉"时暴露**（自检原先也没覆盖这条路径）。
        //   【修法】第一次 apply 抓一份「这 20 株的原件 objdata」快照（此刻还没被我们改过），
        //          之后**每次 apply 都先把正在用的 objdata 还原成原件**，再按当前开关重新写。
        //          ⇒ "开→关"与"关→开"走同一条路，两个方向都对；顺带保证 Special 数组不会累积。
        //   ⚠ 下面 19 个写入点**一行都不用改**（它们只管"开着时怎么写"）。
        if (!GPN_ALM_SNAPSHOT_DONE) {
            for (const _p of GPN_ALM_CHANGED) {
                let _e = null;
                for (const _x of AL) {
                    if (_x && Array.isArray(_x.aliases) && _x.aliases.indexOf(_p[0]) !== -1) { _e = _x; break; }
                }
                if (_e && _e.objdata) GPN_ALM_ORIG.push({ alias: _p[0], od: gpnAlmDeepClone(_e.objdata) });
            }
            GPN_ALM_SNAPSHOT_DONE = true;
            log_alm_snapshot(GPN_ALM_ORIG.length);
        }
        for (const _rec of GPN_ALM_ORIG) {
            let _e = null;
            for (const _x of AL) {
                if (_x && Array.isArray(_x.aliases) && _x.aliases.indexOf(_rec.alias) !== -1) { _e = _x; break; }
            }
            if (!_e) continue;
            if (!_e.objdata) _e.objdata = {};
            const _t = _e.objdata, _o = _rec.od;
            for (const _k of Object.keys(_t)) {
                if (!Object.prototype.hasOwnProperty.call(_o, _k)) delete _t[_k];
            }
            for (const _k of Object.keys(_o)) _t[_k] = gpnAlmDeepClone(_o[_k]);
        }

        // ---- 巴豆（追加"所有啃食者一起倒下"）----
        if (featOn('chilibean')) {
            // Intro 的中文保持原版不动；英文用带补充的那句
            writeIntro('chilibean', null,
                'Chili Beans deliver a crippling bout of gastrointestinal distress. Every zombie that is eating it drops at once.');
            writeBrief('chilibean', '所有正在啃食它的僵尸一起死亡，并释放眩晕气体',
                'Every zombie eating it dies together, and releases stunning gas.');
            editSpecial('chilibean', '吃掉他的僵尸直接死亡',
                '被僵尸吃下后，杀死所有正在啃食它的僵尸，并释放眩晕气体',
                'After being eaten, it kills every zombie that is eating it and releases stunning gas.');
        }
        // ---- 钢地刺（原话写错：三次 / 3 个）----
        if (featOn('spikerock')) {
            const SPK = CFG.spikerock.maxSpike;
            writeBrief('spikerock', '对走过的僵尸造成伤害，并破坏 ' + SPK + ' 个滚动的物体',
                'Damages zombies that walk over it, and destroys ' + SPK + ' rolling objects.');
            editSpecial('spikerock', '能承受滚动前行',
                '能承受滚动前行的僵尸' + gpnZhNum(SPK) + '次打击',
                'Can withstand ' + SPK + ' hits from rolling zombies.');
        }
        // ---- 心蕊（追加 1×3 + 啃食减伤）----
        if (featOn('bloomingheart')) {
            writeIntro('bloominghearts',
                '心蕊向僵尸投掷子弹，使之本格及其同排左右各一格中的所有僵尸防御力下降。',
                'Blooming Hearts throw bullets that lower the defence of zombies in its own tile and the tiles one to either side in the same lane.');
            writeBrief('bloominghearts', '向僵尸投掷子弹，使以命中点为中心 1×3 范围内的僵尸防御力下降',
                'Throws bullets that lower the defence of zombies in a 1×3 area centred on the hit.');
            const VDS = CFG.bloomingheart.victimDamageScale || {};
            const P50 = Math.round((VDS.bloominghearts != null ? VDS.bloominghearts : 0.5) * 100);
            const P75 = Math.round((VDS.sweetpotato != null ? VDS.sweetpotato : 0.75) * 100);
            addSpecial('bloominghearts',
                '被减防的僵尸对这些植物的啃食伤害降低：心蕊 ×' + P50 + '%、甜薯 / 热辣海枣 ×' + P75 + '%',
                'Zombies with this defence reduction deal less chewing damage to these plants: '
                + 'Blooming Heart ×' + P50 + '%, Sweet Potato / Hot Date ×' + P75 + '%.');
        }
        // ---- 暗影龙葵（追加穿透 + 击退）----
        if (featOn('nightshade')) {
            // 穿透文案统一口径：K = 打中数 − 1（= 真·穿透数）；K = 0 ⇒ 不写穿透句
            const NS_K = gpnPierceText(CFG.nightshade.pierceTargets);
            addSpecial('nightshade',
                NS_K >= 1
                    ? '身上有暗影能量时，抛出的叶片可穿透' + gpnPierceZh(NS_K) + '个目标，且会把僵尸轻微击退'
                    : '身上有暗影能量时，抛出的叶片会把僵尸轻微击退',
                NS_K >= 1
                    ? 'When powered by shadow energy, its thrown leaves pierce ' + NS_K
                        + ' targets and slightly knock zombies back.'
                    : 'When powered by shadow energy, its thrown leaves slightly knock zombies back.');
        }
        // ---- 白萝卜（追加受伤间隔）----
        if (featOn('turnip')) {
            addSpecial('turnip', CFG.turnip.damageGateSeconds + ' 秒内只能受到一次伤害',
                'Can only take damage once every ' + CFG.turnip.damageGateSeconds + ' seconds.');
        }
        // ---- 甜薯（追加回血 + 治疗加成）----
        if (featOn('sweetpotato')) {
            const SP_HP = CFG.sweetpotato.selfHealPerSecond;
            const SP_MULT = Math.round(CFG.sweetpotato.healReceivedMultiplier * 100);
            addSpecial('sweetpotato', '每秒回复 ' + SP_HP + ' 点生命，且受到的任何治疗 ×' + SP_MULT + '%',
                'Recovers ' + SP_HP + ' HP per second, and all healing it receives is ×' + SP_MULT + '%.');
        }
        // ---- 高坚果（追加免疫位移 + 抗砸）----
        if (featOn('tallnut')) {
            addSpecial('tallnut', '免疫位移', 'Immune to being moved.');
            const TN_N = Math.max(1, Math.round(1 / CFG.tallnut.smashHpFraction) - 1);
            addSpecial('tallnut', '可承受砸击 ' + TN_N + ' 次', 'Can withstand ' + TN_N + ' smashes.');
        }
        // ---- 香水菇（改现有的「特点」行）----
        if (featOn('perfumeshroom')) {
            // 原有的「特点」行保持原话不动，新增能力单独开一条。
            // !!「啃食伤害降低」其实是 bloomingheart 那个补丁的效果 ——
            //    所以那句话只在 bloomingheart 也开着时才写，否则图鉴会说错。
            let PM_ZH = '使僵尸防御降低';
            let PM_EN = 'Zombies hit have their defence lowered';
            if (featOn('bloomingheart')) {
                PM_ZH += '，且防御降低的僵尸对心蕊、热辣海枣、甜薯造成的啃食伤害降低';
                PM_EN += ', and those zombies deal less chewing damage to Blooming Heart, Hot Date and Sweet Potato';
            }
            addSpecial('perfumeshroom', PM_ZH, PM_EN + '.');
        }
        // ---- 星星果系（追加穿透 / 溅射 / 追击）----
        if (featOn('starfruit')) {
            // Intro 保持原版不动（下面这些说明都改成新增 Special）
            // 穿透文案统一口径：K = 打中数 − 1（= 真·穿透数）；K = 0 ⇒ 不写穿透句
            //   （中文用汉字数字：一个 / 两个…；英文仍用阿拉伯数字）
            const STAR_K = gpnPierceText(CFG.starfruit.pierceTargets);
            const PINK_K = gpnPierceText(CFG.starfruit.pinkPierceTargets);
            const SHOOT_K = gpnPierceText(CFG.starfruit.shootingPierceTargets);
            const pierceZh = (k, splash) => (k >= 1
                ? '子弹可以穿透' + gpnPierceZh(k) + '个目标，并在击中时造成单格' + splash + '溅射伤害'
                : '子弹在击中时造成单格' + splash + '溅射伤害');
            const pierceEn = (k, splash) => (k >= 1
                ? 'Its bullets pierce ' + k + ' target(s) and deal a ' + splash + ' splash on hit.'
                : 'Its bullets deal a ' + splash + ' splash on hit.');
            addSpecial('starfruit', pierceZh(STAR_K, '少量'), pierceEn(STAR_K, 'small'));
            // 追击相关的说明只在"追击开关也开着"时才写
            const ST_FOLLOW = !!CFG.starfruit.followEnabled;
            if (ST_FOLLOW) {
                // 追击弹比【星星果普攻】多打中几个 = followPierceBonus（默认 1）；= 0 ⇒ 不写"额外穿透"
                const FB = gpnFollowPierce() - gpnPierceN(CFG.starfruit.pierceTargets);
                addSpecial('starfruit',
                    FB >= 1
                        ? '追击子弹可额外穿透' + gpnPierceZh(FB)
                            + '个目标，溅射伤害继承比略微提高，且极短时间眩晕目标'
                        : '追击子弹的溅射伤害继承比略微提高，且极短时间眩晕目标',
                    FB >= 1
                        ? 'Follow-up bullets pierce ' + FB
                            + ' extra target(s), inherit a slightly higher splash ratio, and briefly stun the target.'
                        : 'Follow-up bullets inherit a slightly higher splash ratio and briefly stun the target.');
            }
            if (ST_FOLLOW) {
                addSpecial('starfruit', '当索敌范围内的目标被流星果、天使星星果攻击时，进行一次追击',
                    'When a target in its range is attacked by a Shooting Starfruit or Pink Starfruit, it performs a follow-up attack.');
            }
            if (ST_FOLLOW) {
                // 第 3 条：追击子弹的伤害口径（合并开/关两种说法；数值从 CFG 现算）。
                //   这一条会随开关【换文案】⇒ 先把上一次写进去的变体删掉，否则 apply 跑多次时会叠成两条。
                const ST_R = Math.round(CFG.starfruit.followDamageRatio * 100);
                {
                    const alST = findAl('starfruit');
                    if (alST && alST.objdata && Array.isArray(alST.objdata.Special)) {
                        const keep = alST.objdata.Special.filter((row) => {
                            const z = row && row.DESCRIPTION && row.DESCRIPTION.zh;
                            return !(typeof z === 'string'
                                && (z.indexOf('追击子弹伤害×') === 0 || z.indexOf('追击在') === 0));
                        });
                        if (keep.length !== alST.objdata.Special.length) {
                            track(alST.objdata, 'Special');
                            alST.objdata.Special = keep;
                        }
                    }
                }
                if (gpnFollowMergeOn()) {
                    addSpecial('starfruit',
                        '追击在 ' + CFG.starfruit.followMergeWindow + ' 秒内被多次触发时只追一次，每颗弹伤害 = '
                        + ST_R + '% × Σ（各次触发时的攻击力）',
                        'If triggered multiple times within ' + CFG.starfruit.followMergeWindow
                        + ' s, it follows up only once; each bullet deals ' + ST_R
                        + '% × Σ(the attack power at each trigger).');
                } else {
                    addSpecial('starfruit', '追击子弹伤害×' + ST_R + '%',
                        'Follow-up bullets deal ×' + ST_R + '% damage.');
                }
            }
            addSpecial('pinkstarfruit', pierceZh(PINK_K, '少量'), pierceEn(PINK_K, 'small'));
            addSpecial('shootingstarfruit', pierceZh(SHOOT_K, '中等'), pierceEn(SHOOT_K, 'medium'));
        }
        // ---- 暗影油桃（追加削弱说明）----
        if (featOn('noctarine')) {
            const NO_DMG = Math.round(CFG.noctarine.damageScale * 100);
            // 原版毒气时长是 20 秒（数据里的 NormalLifespan），这里换算成"×多少%"
            const NO_DUR = Math.round(CFG.noctarine.normalLifespan / 20 * 100);
            addSpecial('noctarine', '造成伤害仅为攻击力的 ' + NO_DMG + '%，但毒气持续时间×' + NO_DUR + '%',
                'Deals only ' + NO_DMG + '% of its attack power as damage, but its gas lasts ×' + NO_DUR + '% as long.');
        }
        // ---- 蒲公英（原话"一行"→"两颗"）----
        if (featOn('dandelion')) {
            const DN_N = 1 + CFG.dandelion.extraShots;
            writeIntro('dandelion',
                '蒲公英向身前的三行中发射' + (DN_N === 2 ? '两' : gpnZhNum(DN_N)) + '颗爆炸性蒲公英子弹。',
                'Dandelions fire ' + DN_N + ' explosive dandelion bullets into the three lanes in front of them.');
            addSpecial('dandelion', '可击晕飞行僵尸，且对其造成更高伤害',
                'Stuns flying zombies and deals extra damage to them.');
        }
        // ---- 甜椒投手（追加落点灼烧）----
        if (featOn('pepperpult')) {
            // 拆成两条：原文整条太长，图鉴那一行会在「清」字处自动折行、排版错位
            const PP_C = CFG.pepperpult.burnCells;
            addSpecial('pepperpult',
                // 口径：火铺在【子弹的落点】；总伤害按【这一发子弹的伤害】的 burnTotalRatio 算
                '命中后，在落点产生 ' + PP_C + '×' + PP_C + ' 的火，持续 '
                + CFG.pepperpult.burnSeconds + ' 秒。单次火焰总伤害为子弹的 '
                + Math.round(CFG.pepperpult.burnTotalRatio * 100) + '%',
                'On hit, it creates a ' + PP_C + '×' + PP_C + ' fire at the landing spot for '
                + CFG.pepperpult.burnSeconds + ' second(s). The total damage of a single fire equals '
                + Math.round(CFG.pepperpult.burnTotalRatio * 100) + "% of the bullet's damage.");
            addSpecial('pepperpult', '火焰可清零其中植物的冻结进度',
                'The fire also clears the freeze progress of the plants inside it.');
        }
        // ---- 飓风甘蓝（原话"本行"→"全屏"）----
        if (featOn('hurrikale')) {
            writeIntro('hurrikale', '飓风甘蓝利用强风将全屏的僵尸向后推。',
                'Hurrikales push back all zombies on the screen with a chilling wind.');
            writeBrief('hurrikale', '吹出强寒风，推动所有行的僵尸',
                'Blows a strong chilling wind that pushes zombies in every lane.');
            editSpecial('hurrikale', '飞行僵尸', '吹飞全屏所有的飞行僵尸',
                'Blows away every flying zombie on the screen.');
            const HK_SCALE = CFG.hurrikale.otherLanePushScale;
            addSpecial('hurrikale',
                '非本行的推动力度只有本行的' + (HK_SCALE === 0.5 ? '一半' : Math.round(HK_SCALE * 100) + '%'),
                HK_SCALE === 0.5
                    ? 'Pushes zombies outside its own lane with only half the force.'
                    : 'Pushes zombies outside its own lane with only ' + Math.round(HK_SCALE * 100) + '% of the force.');
        }
        // ---- 魔音甜菜（Phat Beet）----
        if (featOn('phatbeet')) {
            // ⚠️ 这两条文案由用户 2026/10/16 亲自给定，**不再带数字** ⇒ 之后调
            //    `normalStun` / `jamClearSeconds` / `normalJamClearSeconds` 时**图鉴不会跟着变**
            //    （这是刻意的，不是漏同步 —— 别当 BUG 修）。
            addSpecial('phatbeet', '攻击可以停顿僵尸，同时干扰僵尸，使音乐暂时无法对其生效',
                'Its attacks can halt zombies and disrupt them, temporarily preventing the Jam Stage effect from affecting them.');
            addSpecial('phatbeet', '可以解除伤害范围内音响僵尸对植物施加的安抚',
                'Removes the soothing effect that Boombox Zombies inflict on plants within its damage range.');
            addSpecial('phatbeet', '大招可以将僵尸震起',
                'Its Plant Food can knock zombies upward.');
        }
        // ---- 寒冰射手：图鉴 Intro / 特点（中英）----
        if (featOn('snowpea')) {
            writeIntro('snowpea',
                '寒冰射手发射寒冰子弹或冰锥，能使僵尸前进变得缓慢或冻结僵尸。',
                'Snow Peas fire frozen peas or icicles that slow or freeze zombies.');
            editSpecial('snowpea', '子弹会对僵尸造成伤害并冰冻',
                '子弹会对僵尸造成伤害并冰冻，并有概率发射冻结僵尸的冰锥',
                'Its peas damage and chill zombies, and it may fire an icicle that freezes them.');
        }
        // ---- 红针花：新增 2 条特点（中英；都挂在本功能的开关下）----
        if (featOn('redstinger')) {
            addSpecial('redstinger', '可以通过鼠标左键点击主动切换形态',
                'You can click it with the left mouse button to switch its form at will.');
            addSpecial('redstinger', '攻击形态火力最强，中间形态攻击可造成微弱击退，并提升一定防御力，防御形态大幅提高防御力',
                'Its attack form has the strongest firepower; its middle form attacks knock enemies back slightly and grant extra defence; its defence form greatly boosts its defence.');
        }
        // ---- 裂荚射手：「射速」那行补一句（左右翻转后也适用）----
        if (featOn('splitpea')) {
            // 先找正文那句（更可靠），再退一步找标题「射速」
            appendLoc('splitpea', ['向后方两倍', '射速'], CFG.splitpea.extraZh, CFG.splitpea.extraEn);
            // 再加一条能主动操作的特点
            addSpecial('splitpea', '可以通过鼠标左键点击进行前后互换',
                'You can click it with the left mouse button to swap its front and back sides.');
        }
        // ---- 暗影夏威夷果：补一条特点（中英）----
        if (featOn('murkadamia')) {
            addSpecial('murkadamia', '被暗影强化时本体获得隐身',
                'While shadow-boosted, its body becomes invisible.');
        }
        // ---- 孢子菇：新增两条特点（用户指定文案，中英）----
        //   ⚠️ 第 2 条文案按用户口径**只提"毒性家族"** —— 但忧郁菇/毒影菇实际也吃加成，
        //      那是用户**特意安排**的，文案保持原样、不要"补全"。
        //   ⚠️ 倍率**从 CFG 现算**（本 MOD 的统一约定：调参 ⇒ 图鉴自动跟着变）。
        if (featOn('sporeshroom')) {
            addSpecial('sporeshroom', '被击败后：对 1 行 × ' + CFG.sporeshroom.deathRadiusTiles + ' 列内的僵尸造成伤害并眩晕；给 ' + CFG.sporeshroom.deathMarkRows + ' × ' + CFG.sporeshroom.deathMarkCols + ' 范围内所有僵尸打上感染标记',
                'When defeated: damages + stuns zombies in a 1x' + CFG.sporeshroom.deathRadiusTiles + ' area, and infects every zombie within a ' + CFG.sporeshroom.deathMarkRows + 'x' + CFG.sporeshroom.deathMarkCols + ' area.');
            addSpecial('sporeshroom', '被孢子菇感染的僵尸受到毒性家族伤害×' + CFG.sporeshroom.poisonBonus,
                'Zombies infected by Spore-shroom take ' + CFG.sporeshroom.poisonBonus
                + 'x damage from the Poison family.');
        }
    }
    };


    const apply = () => {
        // ★ 每次现取容器：PvZ2ObjectContainer 是 JSONs 模块上的类，其 static 数组可能晚于 setup 才被填充。
        const Box = (typeof gpnResolveDataBox === 'function') ? gpnResolveDataBox() : PvZ2ObjectContainer;
        if (!Box) { warn('数据补丁：容器不可用，这次没落下去'); return false; }
        // 【诊断】记账：apply 被调用的次数（临时开关，默认静默；见 gpnAlmTempVerbose）
        gpnAlmApplyCalls++;
        const _almDumpTail = (why) => { try { if (gpnAlmTempVerbose) gpnAlmDump(why); } catch (e) { /* 只影响诊断 */ } };
        // 钢地刺：降价 + 打击次数 3 -> 9
        //  ⚠️【即时生效改造·数据类样板】这里**不再**用 `featOn` 包住赋值，而是"开/关都写"：
        //   开 ⇒ 写我们的值；关 ⇒ 写回原版值（ORIG）。这样开关一改、再调一次 `apply()`
        //   就能立刻改回去（`setField` 就是直接赋值 ⇒ 重复 apply 幂等）。
        //   注意：**已经翻开的卡片 / 已经种下的植物**可能仍用旧值 ⇒ 界面上这类开关要标注
        //   "下次进关卡生效"（官方文档也是这个口径）。
        setField('PlantProps', 'spikerock', 'SunCost', featOn('spikerock') ? CFG.spikerock.sunCost : VANILLA.spikerock.sunCost);
        setField('PlantProps', 'spikerock', 'MaxSpike', featOn('spikerock') ? CFG.spikerock.maxSpike : VANILLA.spikerock.maxSpike);
        setField('PlantProps', 'spikerock', 'Cooldown', featOn('spikerock') ? CFG.spikerock.cooldown : VANILLA.spikerock.cooldown);
        // 暗影龙葵：涨价 —— ★不再用 featOn 包住整段（否则关掉时这段根本不执行 ⇒ 永远不会写回 75）。
        //   写成"每次都跑、开/关都写"的两态形式：apply() 一跑就自动还原。
        setField('PlantProps', 'nightshade', 'SunCost', featOn('nightshade') ? CFG.nightshade.sunCost : VANILLA.nightshade.sunCost);
        // 高坚果：免疫位移。这是原版字段，vanilla 里只有 turnip(白萝卜) 和 gravebuster 开了它。
        // 注意【不要】动 canBeChied()：那个开关是「整体打断气功 + 保护身后」，不是我们要的。
        // 只开这个字段的效果 = 橄榄车/抛掷/舞王推/渔夫钩 全部无效，但气功照常对其它植物生效、
        //                        高坚果自己原地不动（pushPlantLeft 对它的格子返回 false）。
        // 时空黑洞(ChiHole) 走的是 canBeChied()，不看这个字段 ⇒ 高坚果照样被吸走，符合预期。
        // ★ 两态（不再用 featOn 包整段，否则关掉时不会还原）
        // boolean field: write only when ON; when OFF restore the original shape (delete if absent)
        if (featOn('tallnut')) setField('PlantProps', CFG.tallnut.plantType, 'CannotBePushedByFootballMech', true);
        else gpnRestoreField('PlantProps', CFG.tallnut.plantType, 'CannotBePushedByFootballMech');
        setField('PlantProps', CFG.tallnut.plantType, 'Cooldown', featOn('tallnut') ? CFG.tallnut.cooldown : VANILLA.tallnut.cooldown);
        // ---- 卷心菜投手 / 玉米投手：阳光（2026/10/22 用户指定，各自挂自己的开关）----
        setField('PlantProps', 'cabbagepult', 'SunCost',
            featOn('cabbagepult') ? CFG.cabbagepult.sunCost : VANILLA.cabbagepult.sunCost);
        setField('PlantProps', 'kernelpult', 'SunCost',
            featOn('kernelpult') ? CFG.kernelpult.sunCost : VANILLA.kernelpult.sunCost);
        // ---- 玉米投手：黄油落点留下「地面黄油」（2026/10/22 用户指定；**数据层**补丁）----
        //   引擎链路：ProjectileProps.TileLiquid ⇒ 弹道 `pop()` 时 `inLnC.SpawnTileLiquidWithDuration(type, duration)`
        //     ⇒ `ButterTileLiquid`：每次 update 找本行**最左**一只非飞行、可移动、与黄油矩形相交的僵尸
        //       ⇒ `setButter(8, true)`（播黄油音效）⇒ **黄油自身 die()**（一次性）。
        //   engine 侧行为完全照抄黄油毛茛；我们只补数据，不改任何代码路径。
        //   ⚠️ 必须在**第一次写值之前**登记原值：`gpnVanilla` 只认第一次读到的值。
        gpnVanilla('ProjectileProps', 'butter', 'TileLiquid');
        gpnVanilla('ProjectileProps', 'butter2', 'TileLiquid');
        if (featOn('kernelpult')) {
            setField('ProjectileProps', 'butter', 'TileLiquid',
                { Type: CFG.kernelpult.tileLiquidType, Duration: CFG.kernelpult.tileLiquidDuration });
            setField('ProjectileProps', 'butter2', 'TileLiquid',
                { Type: CFG.kernelpult.tileLiquidType, Duration: CFG.kernelpult.tileLiquidDurationPlantfood });
        } else {
            gpnRestoreField('ProjectileProps', 'butter', 'TileLiquid');
            gpnRestoreField('ProjectileProps', 'butter2', 'TileLiquid');
        }

        // 星星果系：阳光/冷却（★两态，挪到包裹外）+ 12 条弹道的穿透/溅射（开=写、关=删）
        setField('PlantProps', 'starfruit', 'SunCost', featOn('starfruit') ? CFG.starfruit.sunCost : VANILLA.starfruit.sunCost);
        setField('PlantProps', 'pinkstarfruit', 'SunCost', featOn('starfruit') ? CFG.starfruit.pinkSunCost : VANILLA.starfruit.pinkSunCost);
        setField('PlantProps', 'shootingstarfruit', 'SunCost', featOn('starfruit') ? CFG.starfruit.shootingSunCost : VANILLA.starfruit.shootingSunCost);
        setField('PlantProps', 'shootingstarfruit', 'Cooldown', featOn('starfruit') ? CFG.starfruit.shootingCooldown : VANILLA.starfruit.shootingCooldown);
        {
            const STAR_PRJ = ['star', 'star1', 'star2', 'star_pf',
                'pinkstar', 'pinkstar1', 'pinkstar2', 'pinkstar_pf',
                'shootingstar', 'shootingstar1', 'shootingstar2', 'shootingstar_pf'];
            const list = PvZ2ObjectContainer.ProjectileProps;
            const onStar = featOn('starfruit');
            if (Array.isArray(list)) {
                for (const e of list) {
                    if (!e || !Array.isArray(e.aliases)) continue;
                    if (!e.aliases.some((a) => STAR_PRJ.indexOf(a) !== -1)) continue;
                    if (!e.objdata) e.objdata = {};
                    const put = (key, value) => { track(e.objdata, key); e.objdata[key] = value; };
                    const putAbsent = (key) => { track(e.objdata, key); try { delete e.objdata[key]; } catch (e2) { /* ignore */ } };
                    if (!onStar) {
                        // ★ 关掉 ⇒ 清掉我们打过的全部标记与溅射条目（原版星果弹道没有这些字段）
                        putAbsent(PIERCE_KEY);
                        putAbsent(PIERCE_ALWAYS_KEY);
                        putAbsent(SPLASH_RATIO_KEY);
                        putAbsent(STAR_KIND_KEY);
                        putAbsent('SplashDamage');
                        continue;
                    }
                    // v2.8.0：标出这条弹道属于哪一株（A2 追击的触发判定要用）
                    const kind = gpnStarKindOf(e.aliases[0]);
                    // v1.0.0：三种星果的穿透各自一份；钳制后 = 1 ⇒ 干脆不打穿透标记
                    //   ⇒ 这条弹道走【原版】detectEnemy（命中即消失），溅射照旧（数据里的 SplashDamage）
                    //   ⚠️ 但 GPNStarKind 必须照写（下一行），否则流星果不再触发 A2 追击
                    const pierceN = gpnPierceN(kind === 'shooting' ? CFG.starfruit.shootingPierceTargets
                        : kind === 'pink' ? CFG.starfruit.pinkPierceTargets : CFG.starfruit.pierceTargets);
                    if (pierceN >= 2) {
                        put(PIERCE_KEY, pierceN);
                        put(PIERCE_ALWAYS_KEY, true);
                    } else {
                        // ★ 1 = 不穿透：连【上一次 apply 留下的】穿透标记也要清掉，
                        //   否则同一次会话里改了 CFG（1 -> 2 -> 1）会残留旧标记。
                        //   track 先记原值，cleanup 时能原样还回去。
                        const putAbsent = (key) => { track(e.objdata, key); delete e.objdata[key]; };
                        putAbsent(PIERCE_KEY);
                        putAbsent(PIERCE_ALWAYS_KEY);
                    }
                    // 流星果的溅射单独用 CFG.splashRatioShooting（默认 40%；星星果 / 天使星星果 是 20%）
                    const ratio = (kind === 'shooting')
                        ? CFG.starfruit.splashRatioShooting : CFG.starfruit.splashRatio;
                    put(SPLASH_RATIO_KEY, ratio);
                    put(STAR_KIND_KEY, kind);
                    // 溅射条目：引擎靠它建出 splashDamages，这里填的是"原版伤害 x 比例"作占位；
                    // 真正的数值在弹道初始化时按 shot.damage 重算（见 makePiercePatch 的 A 段）。
                    const base = Number(e.objdata.Damage) || 0;
                    // 「延迟窗口合并」：把这条弹道的伤害记下来（A2 触发时按"这一株现在这一发的攻击力"累加）
                    for (const a of e.aliases) GPN_STAR_PRJ_DAMAGE[a] = base;
                    put('SplashDamage', [{
                        Damage: base * ratio,
                        Range: { w: CFG.starfruit.splashCells, h: CFG.starfruit.splashCells },
                    }]);
                }
            }
        }
        // ---- 蒲公英：阳光 + 三种弹道标记（飞行/BOSS 加成用）----
        // ★ 阳光两态放到包裹外面（否则关掉时整段不执行 ⇒ 不还原）
        setField('PlantProps', 'dandelion', 'SunCost', featOn('dandelion') ? CFG.dandelion.sunCost : VANILLA.dandelion.sunCost);
        // ★ 弹道标记也两态：关掉时清掉标记（原来是"只在开着时写" ⇒ 关掉后标记残留）
        {
            const DANDELION_KIND = { dandelion: 'normal', dandelion_blew: 'blew', dandelion_pf: 'pf' };
            const dlist = PvZ2ObjectContainer.ProjectileProps;
            const onD = featOn('dandelion');
            if (Array.isArray(dlist)) {
                for (const e of dlist) {
                    if (!e || !Array.isArray(e.aliases)) continue;
                    for (const a of e.aliases) {
                        const kind = DANDELION_KIND[a];
                        if (!kind) continue;
                        if (!e.objdata) e.objdata = {};
                        track(e.objdata, DANDELION_KIND_KEY);
                        if (onD) e.objdata[DANDELION_KIND_KEY] = kind;
                        else { try { delete e.objdata[DANDELION_KIND_KEY]; } catch (e2) { /* ignore */ } }
                    }
                }
            }
        }
        // ---- 魔音甜菜：阳光（改回原版 150）----
        // ★ 两态：魔音甜菜的阳光值恰好 = 原版 150（历史上曾改高再改回），写成两态更安全
        {
            const _v = gpnVanilla('PlantProps', CFG.phatbeet.plantType, 'SunCost');
            setField('PlantProps', CFG.phatbeet.plantType, 'SunCost', featOn('phatbeet') ? CFG.phatbeet.sunCost : _v.value);
        }
        // ---- 大蒜：每口固定伤害 / 阳光 / 冷却（引擎字段就是 ReceivesDamageWhenEaten、Cooldown）----
        // ★ 两态（大蒜：被啃伤害 / 阳光 / 冷却）
        setField('PlantProps', CFG.garlic.plantType, 'ReceivesDamageWhenEaten', featOn('garlic') ? CFG.garlic.eatDamage : VANILLA.garlic.eatDamage);
        setField('PlantProps', CFG.garlic.plantType, 'SunCost', featOn('garlic') ? CFG.garlic.sunCost : VANILLA.garlic.sunCost);
        setField('PlantProps', CFG.garlic.plantType, 'Cooldown', featOn('garlic') ? CFG.garlic.cooldown : VANILLA.garlic.cooldown);
        // ---- 红针花：承伤倍率（越小越肉）+ 半防御半攻击形态的子弹击退 ----
        // ★ 三项两态（承伤倍率 / 阳光）
        setField('PlantProps', CFG.redstinger.plantType, 'DamageScale1', featOn('redstinger') ? CFG.redstinger.tier1 : VANILLA.redstinger.tier1);
        setField('PlantProps', CFG.redstinger.plantType, 'DamageScale2', featOn('redstinger') ? CFG.redstinger.tier2 : VANILLA.redstinger.tier2);
        setField('PlantProps', CFG.redstinger.plantType, 'SunCost', featOn('redstinger') ? CFG.redstinger.sunCost : VANILLA.redstinger.sunCost);
        // ---- 红针花 inArea1 的「子弹击退」：★两态 ----
        //   原版 redstinger_weak 只有 Damage/Size（已核对 Objects/ProjectileProps.json）
        //   ⇒ 开：写三个击退字段；关：**删掉**它们（恢复原版弹道）。
        {
            const plist = PvZ2ObjectContainer.ProjectileProps;
            const onRs = featOn('redstinger');
            if (Array.isArray(plist)) {
                for (const e of plist) {
                    if (!e || !Array.isArray(e.aliases)) continue;
                    if (e.aliases.indexOf('redstinger_weak') === -1) continue;
                    if (!e.objdata) e.objdata = {};
                    const put = (key, value) => { track(e.objdata, key); e.objdata[key] = value; };
                    const putAbsent = (key) => { track(e.objdata, key); try { delete e.objdata[key]; } catch (e2) { /* ignore */ } };
                    if (onRs) {
                        put('KnockbackDistance', CFG.redstinger.knockbackDistance);
                        put('CancelsKnockbackFlying', true);
                        put('CannotInterruptOtherKnockback', true);
                    } else {
                        putAbsent('KnockbackDistance');
                        putAbsent('CancelsKnockbackFlying');
                        putAbsent('CannotInterruptOtherKnockback');
                    }
                }
            }
        }
        // ---- 裂荚射手：阳光【显式写回原版 200】（原注释错写成「200 -> 225」；写一遍防被别的 mod 改掉）----
        setField('PlantProps', CFG.splitpea.plantType, 'SunCost', featOn('splitpea') ? CFG.splitpea.sunCost : VANILLA.splitpea.sunCost);   // ★两态：关掉写回原版 125
        // ---- 寒冰射手：单格范围冰减速 + 概率冰锥（伤害跟随寒冰射手）----
        //  ★ 两态化：开=写数据+建冰锥；关=**删掉**弹道溅射、**移除**克隆冰锥、写回原版两字段。
        //     （原来整块被 featOn 包住 ⇒ 关掉时不执行 ⇒ 冰锥与单格减速都还在。）
        {
            const SP = CFG.snowpea, PC = PvZ2ObjectContainer;   // 容器是 makeDataPatcher 的入参
            const onSP = featOn('snowpea');
            const pea = (PC.ProjectileProps || []).find((x) => x && (x.aliases || []).indexOf(SP.peaType) !== -1);
            const peaDmg = pea && pea.objdata ? pea.objdata.Damage : null;
            const findIdx = (arr, alias) => Array.isArray(arr) ? arr.findIndex((x) => x && (x.aliases || []).indexOf(alias) !== -1) : -1;
            if (onSP) {
                setField('ProjectileProps', SP.peaType, 'SplashDamage',
                    [{ ChillDuration: SP.chillDuration, Range: { w: 1, h: 1 } }]);
                const spike = gpnCloneProjectile(PC, SP.cloneFrom, SP.spikeAlias, (od) => {
                    od.ChillDuration = SP.chillDuration;
                    od.FreezeDuration = SP.freezeDuration;
                    od.SplashDamage = [{ ChillDuration: SP.chillDuration,
                        FreezeDuration: SP.splashFreezeDuration, Range: { w: 1, h: 1 } }];
                    if (peaDmg != null) od.Damage = peaDmg;
                });
                if (spike) {
                    // ★ 双表注册：引擎按别名查 ProjectileTypes，只加 ProjectileProps 会兜底成普通豌豆
                    try {
                        const tl = PC.ProjectileTypes;
                        if (Array.isArray(tl) && !tl.some((x) => (x.aliases || []).indexOf(SP.spikeAlias) !== -1)) {
                            const ts = tl.find((x) => (x.aliases || []).indexOf(SP.cloneFrom) !== -1);
                            if (ts) tl.push({ objclass: ts.objclass, aliases: [SP.spikeAlias],
                                objdata: Object.assign({}, ts.objdata) });
                        }
                    } catch (e) { warn('寒冰射手：ProjectileTypes 注册失败', e); }
                    setField('PlantProps', SP.plantType, 'ChanceToFreeze', SP.freezeChance);
                    setField('PlantProps', SP.plantType, 'PeaFreezeType', SP.spikeAlias);
                } else { warn('寒冰射手：冰锥没建起来，ChanceToFreeze 保持原样'); }
            } else {
                // ---- 关掉：把寒冰射手还原成原版 ----
                try {
                    // ★ 原版 pea_snow 没有 SplashDamage（已核对 Objects/ProjectileProps.json：
                    //    只有 Damage:20 / ChillDuration:10 / IceBlockSize / Size）⇒ 直接删除。
                    //    ⚠️ 不能用 gpnVanilla 取「原值」：首次 apply 时我们已经先写了 SplashDamage，
                    //       那时记录到的就是「我们自己的值」，还原时等于又写回去（实机诊断抓到的 BUG）。
                    const pi = findIdx(PC.ProjectileProps, SP.peaType);
                    if (pi >= 0 && PC.ProjectileProps[pi].objdata) {
                        track(PC.ProjectileProps[pi].objdata, 'SplashDamage');
                        try { delete PC.ProjectileProps[pi].objdata.SplashDamage; } catch (e2) { /* ignore */ }
                    }
                    const si = findIdx(PC.ProjectileProps, SP.spikeAlias);
                    if (si >= 0) PC.ProjectileProps.splice(si, 1);          // 原版没有这个弹道 ⇒ 删掉
                    const ti = findIdx(PC.ProjectileTypes, SP.spikeAlias);
                    if (ti >= 0) PC.ProjectileTypes.splice(ti, 1);
                    // 【诊断】寒冰射手还原后的运行时状态（只在 verboseLog 打开时打印）
                    if (verboseOn()) try {
                        const _dump = (alias) => {
                            const hit = (PC.ProjectileProps || []).filter((x) => x && (x.aliases || []).indexOf(alias) !== -1);
                            if (!hit.length) return alias + '=(无此条目)';
                            return hit.map((x) => {
                                const o = x.objdata || {};
                                const sd = o.SplashDamage;
                                return alias + '[chill=' + (o.ChillDuration === undefined ? '-' : o.ChillDuration)
                                    + ',freeze=' + (o.FreezeDuration === undefined ? '-' : o.FreezeDuration)
                                    + ',splash=' + (sd === undefined ? '无' : (Array.isArray(sd) ? ('有(' + sd.length + ')') : '有(非数组)')) + ']';
                            }).join(' + ');
                        };
                        const _types = (PC.ProjectileTypes || []).filter((x) => x && (x.aliases || []).indexOf(SP.spikeAlias) !== -1).length;
                        const _p = (PC.PlantProps || []).filter((x) => x && (x.aliases || []).indexOf(SP.plantType) !== -1)[0];
                        const _po = (_p && _p.objdata) || {};
                        log('【Q5诊断】' + _dump(SP.peaType) + ' ｜ ' + _dump(SP.spikeAlias) + ' ｜ ' + _dump('pea_snow1') + ' ｜ ' + _dump('pea_snow2')
                            + ' ｜ ProjectileTypes 含' + SP.spikeAlias + '=' + _types + ' 个'
                            + ' ｜ 寒冰射手 ChanceToFreeze=' + _po.ChanceToFreeze + ' PeaFreezeType=' + _po.PeaFreezeType);
                    } catch (eD) { clog('【Q5诊断】出错：' + eD); }
                } catch (eC) { warn('寒冰射手：还原时出错', eC); }
            }
            setField('PlantProps', SP.plantType, 'ChanceToFreeze', onSP ? SP.freezeChance : 0);
            setField('PlantProps', SP.plantType, 'PeaFreezeType', onSP ? SP.spikeAlias : SP.peaType);
        }
        // 甜椒投手：阳光 + 种植冷却 + 灼烧标记
        // ★ 两态：阳光/冷却挪到包裹外（关掉时必须写回原版 200/20）
        setField('PlantProps', 'pepperpult', 'SunCost', featOn('pepperpult') ? CFG.pepperpult.sunCost : VANILLA.pepperpult.sunCost);
        setField('PlantProps', 'pepperpult', 'Cooldown', featOn('pepperpult') ? CFG.pepperpult.packetCooldown : VANILLA.pepperpult.cooldown);
        if (featOn('pepperpult')) {
            // !! v2.8.2 修：真实字段叫 Cooldown，不叫 PacketCooldown ——
            //    之前写错了名字，等于凭空加了个没人读的字段，游戏里冷却一直是 20 秒。
            // 给甜椒弹道打上「落地要灼烧」的私有标记。
            // v2.7.1 修正：运行时 ProjectileProps 用的是【小写对象别名】
            //   pepper / pepper1 / pepper2 / pepper_pf，
            //   而 PepperpultDefault 之类是 ProjectileTypes 那边的【对象类名】。
            //   之前按类名匹配，一条都没打上，所以灼烧从来没生效过。
            //   这里再加一道保险：直接读植物数据的 CabbageType 来推导，免得以后又对不上。
            const PEP_PRJ = ['pepper', 'pepper1', 'pepper2', 'pepper_pf'];
            const want = PEP_PRJ.slice();
            try {
                const pplants = PvZ2ObjectContainer.PlantProps;
                if (Array.isArray(pplants)) {
                    for (const e of pplants) {
                        if (!e || !Array.isArray(e.aliases) || e.aliases.indexOf('pepperpult') === -1) continue;
                        for (const k of ['CabbageType', 'CabbageTypePlantfood']) {
                            const v = e.objdata && e.objdata[k];
                            if (typeof v === 'string' && v && want.indexOf(v) === -1) want.push(v);
                        }
                    }
                }
            } catch (err) { warn('甜椒灼烧：推导弹道别名出错', err); }
            const plist = PvZ2ObjectContainer.ProjectileProps;
            if (Array.isArray(plist)) {
                let pepHit = 0;
                for (const e of plist) {
                    if (!e || !Array.isArray(e.aliases)) continue;
                    if (!e.aliases.some((a) => want.indexOf(a) !== -1)) continue;
                    if (!e.objdata) e.objdata = {};
                    track(e.objdata, BURN_RATIO_KEY);
                    // ★ 两态：开=打标记；关=删掉标记（否则关掉后落地/护盾/障碍仍会铺火）
                    if (featOn('pepperpult')) e.objdata[BURN_RATIO_KEY] = CFG.pepperpult.burnTotalRatio;
                    else { try { delete e.objdata[BURN_RATIO_KEY]; } catch (e2) { /* ignore */ } }
                    pepHit++;
                }
                if (!pepHit) {
                    warn('甜椒灼烧：一条弹道都没匹配上，灼烧不会生效（期望别名：' + want.join(',') + '）');
                }
            }
        }

        // ---- 孢子菇：阳光 150 → 200 / 血量上限 300 → 150（两态，关掉写回原版）----
        //   注意：这两个字段在原版数据里就叫 SunCost / Toughness（见 Objects/PlantProps.json）。
        setField('PlantProps', CFG.sporeshroom.plantType, 'SunCost',
            featOn('sporeshroom') ? CFG.sporeshroom.sunCost : VANILLA.sporeshroom.sunCost);
        setField('PlantProps', CFG.sporeshroom.plantType, 'Toughness',
            featOn('sporeshroom') ? CFG.sporeshroom.toughness : VANILLA.sporeshroom.toughness);

        // 暗影油桃：阳光 + 数据驱动的「爆炸」伤害
        // ★ 阳光两态放到包裹外面
        setField('PlantProps', 'noctarine', 'SunCost', featOn('noctarine') ? CFG.noctarine.sunCost : VANILLA.noctarine.sunCost);
        // ★ 油桃的 Actions 爆炸伤害：**两态**，且原值一律取自 track 的第一次记录。
        //   为什么放在 featOn 外面：关掉开关时也必须还原（原来放在里面 ⇒ 关掉后不还原）。
        //   为什么不用局部变量记原值：第一次 apply 时 track 还没数据，会把"已乘过的值"当原值 ⇒ 连乘。
        {
            const plist = PvZ2ObjectContainer.PlantProps;
            const on = featOn('noctarine');
            if (Array.isArray(plist)) {
                for (const e of plist) {
                    if (!e || !Array.isArray(e.aliases) || e.aliases.indexOf('noctarine') === -1) continue;
                    const acts = e.objdata && e.objdata.Actions;
                    if (!Array.isArray(acts)) continue;
                    for (const act of acts) {
                        if (!act || typeof act.Damage !== 'number' || act.Damage <= 0) continue;
                        track(act, 'Damage');                      // 只在第一次记录原值
                        const rec = undo.find((r) => r.objdata === act && r.key === 'Damage');
                        const baseDmg = (rec && typeof rec.old === 'number') ? rec.old : act.Damage;
                        act.Damage = on ? baseDmg * CFG.noctarine.damageScale : baseDmg;
                    }
                }
            }
        }

        // 龙葵 6 条弹道：穿透标记（+ 地面推的两个辅助字段）
        // 注意：击退【不在这里】—— 它是逐发按暗影态在 _shoot 里设的（见 makeNightShadePatch），
        //       否则非暗影态的子弹也会带击退（v2.4.2 的 BUG）。
        const prjs = PvZ2ObjectContainer.ProjectileProps;
        {
            const onNs = featOn('nightshade');
            if (Array.isArray(prjs) && prjs.length) {
                for (const e of prjs) {
                    if (!e || !Array.isArray(e.aliases)) continue;
                    if (!e.aliases.some((a) => typeof a === 'string' && a.indexOf('nightshade') === 0)) continue;
                    if (!e.objdata) e.objdata = {};
                    const put = (key, value) => { track(e.objdata, key); e.objdata[key] = value; };
                    const putAbsent = (key) => { track(e.objdata, key); try { delete e.objdata[key]; } catch (e2) { /* ignore */ } };
                    if (onNs) {
                        put('CancelsKnockbackFlying', true);          // 与飞天豌豆一致：地面推，不挑飞
                        put('CannotInterruptOtherKnockback', true);   // 与飞天豌豆一致：不打断已有击退
                        // 穿透数同样走统一钳制（小数向下取整 / < 1 ⇒ 1）；1 = 不穿透 ⇒ 干脆不写标记
                        const nsPierce = gpnPierceN(CFG.nightshade.pierceTargets);
                        if (nsPierce >= 2) put(PIERCE_KEY, nsPierce);
                        else putAbsent(PIERCE_KEY);
                    } else {
                        // ★ 关掉 ⇒ 清掉我们打过的字段（原版 nightshade 弹道没有它们）
                        putAbsent('CancelsKnockbackFlying');
                        putAbsent('CannotInterruptOtherKnockback');
                        putAbsent(PIERCE_KEY);
                    }
                }
            }
        }
        // 【诊断】每次 apply 结束都把图鉴追加的记账 dump 一次（内容很小；
        //   排查完把 gpnAlmTempVerbose 改回 false 即静默）
        _almDumpTail('apply() 结束');
        // 【诊断】打印"apply 自己看到的开关"与"它算出来的值"（只在 verboseLog 打开时打印）
        if (verboseOn()) try {
            gpnApplyCount = (gpnApplyCount || 0) + 1;
            const _findSun = (alias) => {
                try {
                    const bx = (typeof gpnResolveDataBox === 'function') ? gpnResolveDataBox() : null;
                    const list = bx && bx.PlantProps;
                    if (!Array.isArray(list)) return '?';
                    const hit = list.filter((e) => e && Array.isArray(e.aliases) && e.aliases.indexOf(alias) !== -1)[0];
                    return (hit && hit.objdata) ? hit.objdata.SunCost : '?';
                } catch (e) { return 'err'; }
            };
            let _engineSun = '?', _sameRef = '?', _typeId = '?';
            try {
                const _PM = (typeof gpnPlantsRef === 'function') ? gpnPlantsRef() : null;
                if (_PM && typeof _PM.getPlantProps === 'function' && typeof CFG !== 'undefined') {
                    _typeId = 'nightshade';   // ★ 修 BUG：CFG.nightshade 没有 plantType 字段（之前传 undefined ⇒ 引擎回退成豌豆射手）
                    const _gp = _PM.getPlantProps(_typeId);
                    if (_gp) {
                        _engineSun = _gp.SunCost;
                        const _bx = (typeof gpnResolveDataBox === 'function') ? gpnResolveDataBox() : null;
                        const _list = _bx && _bx.PlantProps;
                        const _ours = Array.isArray(_list) ? _list.filter((e) => e && Array.isArray(e.aliases) && e.aliases.indexOf('nightshade') !== -1)[0] : null;
                        _sameRef = (_ours && _ours.objdata === _gp) ? '同一个' : '★不是同一个';
                    } else { _engineSun = 'getPlantProps返回空'; }
                } else { _engineSun = '拿不到 getPlantProps'; }
            } catch (eE) { _engineSun = 'err:' + eE; }
            log('[数据补丁·apply] 第' + gpnApplyCount + '次 ｜ 开关: nightshade=' + featOn('nightshade')
                + ' ｜ 我方读到=' + _findSun('nightshade') + ' ｜ 引擎读到=' + _engineSun
                + (function () {
                    try {
                        const _PM2 = (typeof gpnPlantsRef === 'function') ? gpnPlantsRef() : null;
                        if (_PM2 && typeof _PM2.getPlantProps === 'function') {
                            const _gp2 = _PM2.getPlantProps(CFG.nightshade.plantType);
                            return ' ｜ 引擎视角龙葵=' + (_gp2 ? _gp2.SunCost : '空');
                        }
                        return ' ｜ 引擎视角=拿不到 plants';
                    } catch (e) { return ' ｜ 引擎视角=err'; }
                })()
                + ' ｜ 同一对象? ' + _sameRef + ' ｜ 实例=' + GPN_INSTANCE_ID);
        } catch (e) { /* 只影响诊断 */ }
        // ★ 图鉴文案：**独立一步**（原来是寄生在 setField 里 ⇒ setField 提前返回时整块不跑）。
        //   放在数据补丁之后：它只用 PvZ2ObjectContainer + CFG + 开关，不依赖前面算了什么；
        //   而"关掉后还原成原版"靠的是块内的「原件快照 + 每次重建」（见开发记录 §3.54/§3.58）。
        try { applyAlmanacText(); } catch (eAlm) { warn("图鉴文本：这次没落下去", eAlm); }
        return undo.length > 0;
    };

    const revert = () => {
        // 倒序还原（和 cleanup 的补丁还原同理：后记的先撤）
        for (const r of undo.slice().reverse()) {
            if (r.had) r.objdata[r.key] = r.old;
            else delete r.objdata[r.key];
        }
        undo.length = 0;
    };

    // _undoCount：自检用（只读）—— 看"已记录的原值条数"有没有增长。
    //   ⚠ 必须挂在这里：`undo` 是 makeDataPatcher 的**内部变量**，模块级导出闭包看不到它。
    return { apply, revert, _undoCount: () => undo.length };
}

/* =========================================================================
 * 2. 巴豆：单体击杀 -> 群体击杀（原版流程复制 N 份）
 * =======================================================================*/
function makeChiliPatches(ChiliBean, Zombie, ZombiePoison) {
    const recs = [];
    if (!ChiliBean || !ChiliBean.prototype || !Zombie || !Zombie.prototype) {
        warn('跳过巴豆：拿不到 ChiliBean / Zombie');
        return { recs };
    }

    const originals = {
        onEaten: ChiliBean.prototype.specialPlantOnEaten,
        fart: Zombie.prototype.chilibeanFart,
    };

    /** 静默击杀：照原版时间轴（变绿 -> 2s 停下 -> 3s 击杀），但不放屁/不发声/不做范围眩晕 */
    const quietKill = (z) => {
        if (!z || z.dead || z.chilibeanFartTween) return;
        z.chilibeanPoisoning = true;
        if (z.db && z.db.color) { z.db.color.r = 0; z.db.color.g = 255; z.db.color.b = 0; }
        z.chilibeanFartTween = { stop() {} };
        z.scheduleOnce(() => {
            z.chilibeanPoisoning = false;
            z.switching = true;
            z.playIdle();
            if (z.db && z.db.color) { z.db.color.r = 255; z.db.color.g = 255; z.db.color.b = 255; }
        }, 2);
        z.scheduleOnce(() => { z.chilibeanFartTween = null; z.playDie(); }, 3);
    };

    const patchedFart = function (stunDuration, poison) {
        if (!featOn('chilibean')) return originals.fart.call(this, stunDuration, poison);   // 【运行期开关】
        if (this.__gpnQuiet) { quietKill(this); return; }
        return originals.fart.call(this, stunDuration, poison);
    };
    // 包装后的函数存成变量：下面 isImmune 用「是否重写过 chilibeanFart」判天然免疫。
    // ⚠️ 2026/10/20 改：不再用"函数引用相等"判断，改用 `__gpnGated` 标记 —— 因为
    //    孢子菇那边（§3.80 巴豆屁联动）会在这一层**再包一层**，引用比较会把所有僵尸误判成免疫。
    //    任何"我们装上去的包装"都必须带 `__gpnGated`（gpnGatedBody 会写 featKey 字符串，真值即可）。
    const gatedFart = gpnGatedBody(originals.fart, 'chilibean', patchedFart);
    Zombie.prototype.chilibeanFart = gatedFart;   // （gpnGatedBody 已给它打上 __gpnGated = 'chilibean'）
    recs.push({ Cls: Zombie, name: 'chilibeanFart', original: originals.fart });

    /** 对巴豆免疫吗？判据一：**类里自己重写过** chilibeanFart（引擎的原生免疫机制）；判据二：补漏名单 */
    const extraMechRe = /^(kongfu_bronze_strong|kongfu_bronze_chi|kongfu_bronze_chi_without_torch|kongfu_bronze_hook)$/;
    const arbiterRe = /arbiter/i;
    const isImmune = (z) => {
        if (!z || typeof z.chilibeanFart !== 'function') return true;
        if (!z.chilibeanFart.__gpnGated) return true;   // 没被我们包过 ⇒ 类里自己重写 ⇒ 原生免疫
                                                        // （我们包的都带 __gpnGated = featKey 字符串，见 gpnGatedBody）
        const code = z.Zombie_Type || '';
        return extraMechRe.test(code) || arbiterRe.test(code);
    };

    /** ★ 引擎口径的「这一帧能不能行动」——用来排除"被控住、当下没在啃"的僵尸。
     *
     *  为什么不能只看 `isEating`：它只是【动作状态标记】——
     *    `playEat()` 里置 true，`playWalk()` / `playIdle()` 里置 false；
     *    而**冰冻 / 眩晕 / 巴豆毒这些控制效果只让它停住，并不清 `isEating`** ⇒ 被控的僵尸
     *    仍会被算作"正在啃食"，被一起带走（玩家实测的 BUG）。
     *
     *  引擎真正门控啃食的是 `shouldSpeedScale()`：
     *    `Zombie.switchingFalse()` 里 `var e = this.shouldSpeedScale(), i = 0.001 * e; this.detectPlant(i)`
     *    ⇒ **被控时 e = 0 ⇒ 每帧的啃食 dt 就是 0**（所以原版很多 detectPlant 第一句是 `if (0 != t)`）。
     *  它的返回 0 覆盖：freeze（冰冻生菜）/ stunned（眩晕洋葱）/ butterStun / chilibeanPoisoning·chiliStun（巴豆毒）
     *    / iceblocked / sheepend（被羊化）/ 被植物卡住 / 坠落 / 传送…
     *  ⚠️ 而【减速】只乘 0.5（chill / 香水 / 树胶）⇒ 返回 > 0 ⇒ 仍然算"在啃" ✓
     *     —— 所以这里判的是 `> 0`，**不是** `=== 1`。
     *  拿不到这两个方法时返回 true（退回旧行为，不崩、不静默改语义）。 */
    const canAct = (z) => {
        try {
            if (z && typeof z.shouldSpeedScale === 'function') return z.shouldSpeedScale() > 0;
            if (z && typeof z.defaultShouldSpeedScale === 'function') return z.defaultShouldSpeedScale() > 0;
        } catch (err) { warn('巴豆：判定僵尸能不能行动出错', err); }
        return true;
    };

    ChiliBean.prototype.specialPlantOnEaten = gpnGatedBody(originals.onEaten, 'chilibean', function (dmg, zombie, hpBefore, hpAfter) {
        if (!(hpAfter <= 0) || !zombie) return;              // 和原版一致：只有被啃死才触发

        const factor = (this.MintBoosted && this.objdataOwn.MintStunDurationFactor > 0)
            ? this.objdataOwn.MintStunDurationFactor : 1;
        const duration = factor * this.objdataOwn.ChiliStunDuration;
        const poison = (this.MintBoosted && ZombiePoison)
            ? new ZombiePoison(this.objdataOwn.MintPoisonDPS, duration) : null;

        // 先快照名单再调用 —— chilibeanFart 内部会把 isEating 清掉
        const eaters = [];
        const lane = this.inLane;
        const pool = (lane && typeof lane.zombiePool === 'function') ? lane.zombiePool() : null;
        if (pool && this.bodyRec) {
            for (const z of pool.concat()) {
                if (!z || z === zombie || eaters.indexOf(z) !== -1) continue;
                if (typeof z.isAlive !== 'function' || !z.isAlive()) continue;
                if (!z.isEating) continue;
                if (!canAct(z)) continue;                // ★ 被控住（冰冻/眩晕/巴豆毒…）当下没在啃 -> 不带走
                if (!z.bodyRecReal || !z.bodyRecReal.judgeCrossRec(this.bodyRec)) continue;
                if (isImmune(z)) continue;
                eaters.push(z);
            }
        }
        if (!isImmune(zombie)) eaters.unshift(zombie);
        if (!eaters.length) return;

        if (CFG.chilibean.fullFartForEveryEater) {
            for (const z of eaters) z.chilibeanFart(duration, poison);
        } else {
            eaters[0].chilibeanFart(duration, poison);
            for (let i = 1; i < eaters.length; i++) {
                eaters[i].__gpnQuiet = true;
                eaters[i].chilibeanFart(duration, poison);
                eaters[i].__gpnQuiet = false;
            }
        }
    });
    recs.push({ Cls: ChiliBean, name: 'specialPlantOnEaten', original: originals.onEaten });

    return { recs };
}

/* =========================================================================
 * 3. 钢地刺：每承受 N 次打击掉一颗牙
 * =======================================================================*/
function makeSpikerockPatch(SpikerockPlant) {
    if (!SpikerockPlant || !SpikerockPlant.prototype
        || typeof SpikerockPlant.prototype.setSpikeSlot !== 'function') {
        warn('跳过钢地刺：拿不到 setSpikeSlot');
        return null;
    }
    const original = SpikerockPlant.prototype.setSpikeSlot;

    SpikerockPlant.prototype.setSpikeSlot = gpnGatedBody(original, 'spikerock', function (remain) {
        const max = (this._objdataOwn && this._objdataOwn.MaxSpike) || CFG.spikerock.maxSpike;
        if (remain === undefined || remain === null) remain = max;
        remain = Math.ceil(remain);

        const teeth = Math.max(1, CFG.spikerock.teeth);
        const perTooth = Math.max(1, Math.ceil(max / teeth));      // 9 / 3 = 3 次一颗牙
        const stage = remain <= 0 ? 0 : Math.min(teeth, Math.ceil(remain / perTooth));

        // 原版只认 2 / 1 / 0 / 其它（>=3 视作满牙），所以把档位折算回去再调原函数
        const r = original.call(this, stage >= teeth ? max : stage);
        if (remain > 0) this.spikeLeft = remain;                    // 修正回真实剩余次数
        return r;
    });
    return { Cls: SpikerockPlant, name: 'setSpikeSlot', original };
}

/* =========================================================================
 * 4. 心蕊：debuff 由单体改成 1x3
 * =======================================================================*/
function makeBloomingHeartPatch(Shot, Rectangle, Square, CommonShot) {
    if (!Shot || !Shot.prototype || typeof Shot.prototype.beforeZombieHit !== 'function') {
        warn('跳过心蕊：拿不到 beforeZombieHit');
        return null;
    }
    if (!Rectangle || !Square) { warn('跳过心蕊：拿不到 Rectangle / Square'); return null; }
    const deps = { Square, Rectangle };
    const original = Shot.prototype.beforeZombieHit;
    const recs = [];

    Shot.prototype.beforeZombieHit = function (zombie) {
        // 【运行期开关】关掉 ⇒ 只走原版单体命中，不再把 debuff 扩散成 1×3
        if (!featOn('bloomingheart')) return original.call(this, zombie);
        if (!zombie) return original.call(this, zombie);

        // ★★ 场外（最右列更右侧）：`zombie.inLnC` 是全场共用的假格 `LnCRight`（lIndex = -2），
        //    原来以它的 `node` 为中心铺 3 格 ⇒ 判定框会落在场外 ⇒ **范围失效**。
        //    这里改走"按 Y 求行 + 以命中目标为中心"的兜底（与引擎寒冰辣椒同款思路）。
        if (gpnIsOffField(zombie) || gpnIsOffField(this)) {
            gpnOffFieldAreaApply(this, zombie, deps, ['bloom']);
            return original.call(this, zombie);
        }

        if (!zombie.inLnC || !zombie.inLane || typeof zombie.inLane.zombiePool !== 'function') {
            return original.call(this, zombie);
        }
        // 场内：以**命中目标所在格**为中心、同排 3 格宽的判定框
        //   ⚠️ 中心怎么取（踩过坑，按可靠性排序）：
        //     ① **格子中心**（引擎的 `Square.getSquareWorldPosition(l, c, .5, .5)`）—— 最准，
        //        它和僵尸的 bodyRec 是同一套世界坐标（引擎自己的 `getLnCRec` 也用它）；
        //     ② 僵尸自己的 `worldPositionX/Y`；
        //     ③ `zombie.inLnC.node.worldPosition`。
        //   ❌ 不要用 ③ 打头：`LnC.plantPoint` 这个 getter 在 `_plantPoint` 为空时会**退回 `node`**，
        //      而 `node` 未必是格心（自检抓到过：框心跑到 (0,0)，把三格外的僵尸框进来、
        //      相邻格的反而没框到）。
        const zLane = (typeof zombie.lIndex === 'number' && zombie.lIndex >= 0 && zombie.lIndex <= 4)
            ? zombie.lIndex : gpnLaneByY(zombie.worldPositionY, Square);
        const zCol = (typeof zombie.cIndex === 'number' && zombie.cIndex >= 0 && zombie.cIndex <= 8)
            ? zombie.cIndex
            : ((typeof zombie.worldPositionX === 'number' && typeof Square.judgeCIndexReal === 'function')
                ? Square.judgeCIndexReal(zombie.worldPositionX) : -1);
        const recBoxCenter = (function () {
            const z = zombie;
            try {
                if (zLane >= 0 && zLane <= 4 && zCol >= 0 && zCol <= 8
                    && typeof Square.getSquareWorldPosition === 'function') {
                    const v = Square.getSquareWorldPosition(zLane, zCol, 0.5, 0.5);
                    if (v && typeof v.x === 'number' && typeof v.y === 'number') return v;
                }
            } catch (e) { }
            if (typeof z.worldPositionX === 'number' && typeof z.worldPositionY === 'number') {
                return { x: z.worldPositionX, y: z.worldPositionY };
            }
            if (z.worldPosition && typeof z.worldPosition.x === 'number') return z.worldPosition;
            const n = z.inLnC && z.inLnC.node;
            if (n && typeof n.getWorldPosition === 'function') return n.getWorldPosition();
            return (n && n.worldPosition) ? n.worldPosition : null;
        }());
        if (!recBoxCenter) return original.call(this, zombie);
        const rec = Rectangle.createRectangleCenter(
            recBoxCenter,
            Square.SquareWidth * CFG.bloomingheart.splashWidthTiles,
            Square.SquareHeight
        );
        const pool = zombie.inLane.zombiePool();
        for (const z of (pool ? pool.concat() : [])) {
            if (!z || typeof z.isAlive !== 'function' || !z.isAlive()) continue;
            if (z !== zombie && !(z.bodyRecReal && rec.judgeCrossRec(z.bodyRecReal))) continue;
            if (typeof z.pushBloomingHeartDefenceRateList !== 'function') continue;
            z.pushBloomingHeartDefenceRateList(this.DefenceRateList, this.BloomingHeartBuffPar);
        }
        return original.call(this, zombie);
    };
    recs.push({ Cls: Shot, name: 'beforeZombieHit', original });
    return recs;
}

/* ==========================================================================
 * §3.80 巴豆 × 孢子菇 联动 —— **S1 只读探针**（`probeFart` + `verboseLog` 都开才打印）
 *
 *   目的：实机拿 3 组证据，再决定主体怎么写：
 *     P1 **气体节点结构**：是 `ParticleSystem` 还是 `Sprite`？颜色字段在哪（startColor/endColor/color）？
 *     P2 **轴向**：节点 `scale` 的哪个分量对应"屏幕竖直 = 行高方向"（决定放大 3 行时改哪个轴）？
 *     P3 **钩子可靠性**：`chilibeanFart` 调用次数 : `playZombieFart` 调用次数 : 气体节点数 是否 1:1:1
 *
 *   ⚠️ **只打印，绝不改行为**：不碰 scale / color / 音量 / 伤害 / 标记。
 *   ⚠️ 包装 `Zombie.chilibeanFart` 时必须带 `__gpnGated` 标记（featKey 字符串）—— 巴豆补丁里
 *      `z.chilibeanFart !== gatedFart ⇒ 原生免疫` 的判定见 §3 末尾的"身份守卫"；
 *      现在改成 `__gpnGated` 标记（否则多包一层会把所有僵尸误判成巴豆免疫）。
 * ========================================================================== */

/** 颜色对象 → "(r,g,b,a)" */
function gpnProbeColorStr(c) {
    if (!c) return 'null';
    if (typeof c.r === 'number') return '(' + c.r + ',' + c.g + ',' + c.b + ',' + (c.a === undefined ? 255 : c.a) + ')';
    return String(c);
}

/** 组件 → "类名 字段=值 …"（只印我们关心的字段） */
function gpnProbeCompStr(c) {
    if (!c) return '?';
    const nm = c.__classname__ || (c.constructor && c.constructor.name) || '?';
    const parts = [nm];
    for (const k of ['startColor', 'endColor', 'color', 'startSize', 'endSize', 'lifetime',
        'duration', 'emissionRate', 'rateOverTime', 'totalParticles', 'spriteFrame', 'material', 'type']) {
        try {
            if (!(k in c)) continue;
            const v = c[k];
            let s;
            if (k === 'startColor' || k === 'endColor' || k === 'color') s = gpnProbeColorStr(v);
            else if (v && typeof v === 'object') s = (v.name || v._name || v.id || String(v)).slice(0, 32);
            else s = String(v);
            parts.push(k + '=' + s);
        } catch (e) { /* 忽略单项 */ }
    }
    return parts.join(' ');
}

/** 打印一个节点树（最多 3 层、每层最多 6 个孩子） */
function gpnProbeDumpNode(n, depth) {
    try {
        if (!n || depth > 3) return;
        const pad = depth === 0 ? '' : ('    '.repeat(depth - 1) + '└ ');
        const sc = n.scale || {};
        const comps = (n.components || n._components) || [];
        log('[巴豆屁·探针] ' + pad + 'node="' + (n.name || n._name || '?') + '"'
            + ' scale=(' + (sc.x === undefined ? '?' : sc.x) + ',' + (sc.y === undefined ? '?' : sc.y) + ',' + (sc.z === undefined ? '?' : sc.z) + ')'
            + ' angle=' + (n.angle === undefined ? '?' : n.angle)
            + (n.width !== undefined ? (' size=(' + n.width + ',' + n.height + ')') : '')
            + ' comps=' + comps.length);
        for (const c of comps) log('[巴豆屁·探针] ' + pad + '  · ' + gpnProbeCompStr(c));
        const kids = (n.children || n._children) || [];
        for (let i = 0; i < kids.length && i < 6; i++) gpnProbeDumpNode(kids[i], depth + 1);
        if (kids.length > 6) log('[巴豆屁·探针] ' + pad + '  … 还有 ' + (kids.length - 6) + ' 个孩子');
    } catch (e) { warn('巴豆屁·探针·打印节点出错', e); }
}

/** P2：行高方向 = 相邻两行同列格子的世界坐标差（配合节点的 scale/angle 判断该放哪个轴） */
function gpnProbeDumpAxis(Square) {
    try {
        if (!Square) return;
        let s = '[巴豆屁·探针·轴] SquareWidth=' + Square.SquareWidth + ' SquareHeight=' + Square.SquareHeight;
        if (typeof Square.getLnC === 'function') {
            const p0 = Square.getLnC(0, 4).plantPoint.worldPosition;
            const p1 = Square.getLnC(1, 4).plantPoint.worldPosition;
            s += ' ｜ 行0=(' + Math.round(p0.x) + ',' + Math.round(p0.y) + ')';
            s += ' 行1=(' + Math.round(p1.x) + ',' + Math.round(p1.y) + ')';
            s += ' ⇒ 行间位移=(' + Math.round(p1.x - p0.x) + ',' + Math.round(p1.y - p0.y) + ')';
        }
        log(s);
    } catch (e) { warn('巴豆屁·探针·轴向出错', e); }
}

/** 放屁 2.4 秒后扫描"僵尸父节点新增的孩子"（= 气体粒子），打印结构；然后清空一次计数 */
function gpnProbeScanLater(z, state) {
    try {
        if (!z || typeof z.scheduleOnce !== 'function') return;
        const parent = z.node && z.node.parent;
        if (!parent) return;
        const before = ((parent.children || parent._children) || []).slice();
        z.scheduleOnce(function () {
            try {
                const now = ((parent.children || parent._children) || []);
                const added = [];
                for (const n of now) { if (before.indexOf(n) === -1) added.push(n); }
                state.fartNodes += added.length;
                log('[巴豆屁·探针] +2.4s 父节点新增 ' + added.length + ' 个（累计 ' + state.fartNodes
                    + '）｜ 父="' + (parent.name || parent._name || '?') + '"'
                    + ' ｜ chilibeanFart=' + state.calls + ' playZombieFart=' + state.sounds);
                for (const n of added) gpnProbeDumpNode(n, 0);
            } catch (e) { warn('巴豆屁·探针·扫描出错', e); }
        }, 2.4);
    } catch (e) { warn('巴豆屁·探针·调度出错', e); }
}

/* ---- §3.80 跨行补扫 + 视觉改造（S2 主体用；探针与功能共用） ---- */

/** 屏幕震动：调原版 `LevelPlay.shakeScreen(duration)`（流星花/黑暗巨人同款）。
 *  ⚠️ 它依赖"关卡组件单例"（`LevelPlay.component`）⇒ 不在关卡里调用会抛异常，必须 try/catch + 判空。
 *  ⚠️ 同一帧多只屁只抖一次（`CFG.fartShakeCD`），否则连抖会像抽搐。 */
let gpnFartLastShakeAt = 0;
function gpnFartShake(C, levelPlay) {
    try {
        const dur = (typeof C.fartShake === 'number') ? C.fartShake : 1;
        if (!(dur > 0)) return 'off';
        if (!levelPlay || typeof levelPlay.shakeScreen !== 'function') return 'no LevelPlay';
        const cd = (typeof C.fartShakeCD === 'number') ? C.fartShakeCD : 0.15;
        const now = (new Date()).getTime();
        if (now - gpnFartLastShakeAt < cd * 1000) return 'cd';
        let hasComponent = true;
        try { hasComponent = !!levelPlay.component; } catch (e) { hasComponent = false; }
        if (!hasComponent) return 'no component';
        gpnFartLastShakeAt = now;
        levelPlay.shakeScreen(dur);
        return 'ok(' + dur + ')';
    } catch (e) { warn('巴豆屁：屏幕震动出错', e); return 'err'; }
}
/** 给一只"被气体命中"的僵尸**加**吹退距离（可叠加）。
 *  dir：+1 = 沿屁向右推，-1 = 沿屁向左推（反向僵尸的屁朝左）。 */
function gpnFartAddPush(t, dir, SW, C) {
    try {
        if (!t || typeof t.worldPositionX !== 'number') return;
        const flying = (t.flying === true);   // 与飓风甘蓝同口径：瞬时 flying（跳起/坠落也算）
        const tiles = flying
            ? ((typeof C.fartPushFlyingTiles === 'number') ? C.fartPushFlyingTiles : 2)
            : ((typeof C.fartPushTiles === 'number') ? C.fartPushTiles : 1);
        if (!(tiles > 0)) return;
        const sign = (dir < 0 ? -1 : 1);
        /* ★ 用户 2026-10-20 追加：**正向屁 + 单次吹退内命中次数 ≥ fartPushBlowStacks(3) + 飞行僵尸** ⇒ 吹飞。
         *   · 只对 `flying === true`（跳起/坠落也算，同飓风口径）；
         *   · 反向屁永远不吹飞（只推）；
         *   · 吹飞**不要求在场中格**（引擎 blowAway 自己拉 2000px 出场）；
         *   · 尊重引擎的 `specialUnblowable` 豁免（BOSS 等免疫，不硬绕）。 */
        const stacks = ((typeof t.__gpnFartStacks === 'number') ? t.__gpnFartStacks : 0) + 1;
        t.__gpnFartStacks = stacks;
        const needStacks = (typeof C.fartPushBlowStacks === 'number' && C.fartPushBlowStacks > 0) ? C.fartPushBlowStacks : 3;
        if (sign > 0 && flying && stacks >= needStacks && !t.blew && typeof t.blowAway === 'function') {
            /* 吹飞后这只已出场 ⇒ 把推退相关的临时字段清干净（不给池化复用留脏数据） */
            try { t.__gpnFartPush = 0; t.__gpnFartPushTiles = 0; t.__gpnFartStacks = 0; } catch (e) { /* 忽略 */ }
            try { t.blowAway(); } catch (e) { warn('巴豆屁：吹飞出错', e); }
            return;   // 吹飞后不再推退
        }
        /* ★ 叠加的是【速度】不是时间：总格数累加（带上限），但**总时长永远是 `fartPushDuration`(1 秒)**，
         *   速度 = 总格数 / 1 秒 ⇒ 叠得越多推得越快，但都在 1 秒内推完。 */
        const maxT = (typeof C.fartPushMaxTiles === 'number' && C.fartPushMaxTiles > 0) ? C.fartPushMaxTiles : 8;
        let sum = (typeof t.__gpnFartPushTiles === 'number') ? t.__gpnFartPushTiles : 0;
        sum = sum + sign * tiles;
        if (sum > maxT) sum = maxT;
        if (sum < -maxT) sum = -maxT;
        t.__gpnFartPushTiles = sum;
        t.__gpnFartPush = sum * SW;   // 剩余距离（px，带符号）
    } catch (e) { warn('巴豆屁：加吹退距离出错', e); }
}

/** 草坪左右边界（"最左格最左边 / 最右格最右边"）。
 *  ⚠️ 实机反馈"到了最右格右侧还在被推" ⇒ 说明 `FrontYard.lawnRec` 可能取不到(nil)，
 *     所以这里**优先 lawnRec（引擎飓风甘蓝同款），取不到就用格子节点兜底**：
 *     最左格中心 − SW/2、最右格中心 + SW/2。 */
function gpnFartLawnBounds(deps, Square) {
    let cells = null, lawn = null;
    // ① 用格子节点算（**第一优先**）：「最左格中心 − SW/2」「最右格中心 + SW/2」
    try {
        const sq = (deps && deps.Square) || Square;
        const SW = (sq && typeof sq.SquareWidth === 'number') ? sq.SquareWidth : 68;
        if (sq && typeof sq.getSquare === 'function') {
            const c0 = sq.getSquare(0, 0);
            const c8 = sq.getSquare(0, 8);
            const x0 = c0 && c0.worldPosition ? c0.worldPosition.x : null;
            const x8 = c8 && c8.worldPosition ? c8.worldPosition.x : null;
            if (typeof x0 === 'number' && typeof x8 === 'number' && x8 > x0) {
                cells = { x: x0 - SW / 2, y: x8 + SW / 2, src: 'cells' };
            }
        }
    } catch (e) { /* 忽略 */ }
    // ② 引擎同款：FrontYard.lawnRec.prjX()（兜底）
    try {
        const FY = deps && deps.FrontYard;
        const lr = FY && FY.lawnRec;
        if (lr && typeof lr.prjX === 'function') {
            const r = lr.prjX();
            if (r && isFinite(r.x) && isFinite(r.y) && r.y > r.x) lawn = { x: r.x, y: r.y, src: 'lawnRec' };
        }
    } catch (e) { /* 忽略 */ }
    if (cells) { cells.alt = lawn; return cells; }
    if (lawn) { lawn.alt = null; return lawn; }
    return null;
}
let gpnFartBoundsLogged = false;
function gpnFartPushTick(z, dt, C, deps) {
    try {
        const left = z.__gpnFartPush;
        if (!left) return false;
        const SW = (deps && deps.Square && deps.Square.SquareWidth) ? deps.Square.SquareWidth : 68;
        const dur = (typeof C.fartPushDuration === 'number' && C.fartPushDuration > 0) ? C.fartPushDuration : 1;
        const tiles = Math.abs((typeof z.__gpnFartPushTiles === 'number') ? z.__gpnFartPushTiles : (left / SW));
        const speed = Math.max(0.01, tiles) / dur * SW;      // px/秒（叠得越多越快）
        const dir = (left > 0) ? 1 : -1;
        const step = Math.min(Math.abs(left), speed * (dt || 0)) * dir;
        let target = z.worldPositionX + step;
        const rec = gpnFartLawnBounds(deps, (deps && deps.Square));
        if (rec && C && C.fartDebugLog && !gpnFartBoundsLogged) {
            gpnFartBoundsLogged = true;
            try { log('[巴豆屁·边界] 用=' + rec.src + ' ｜ 左=' + Math.round(rec.x) + ' ｜ 右=' + Math.round(rec.y) + ' ｜ lawnRec=' + (rec.alt ? (Math.round(rec.alt.x) + '~' + Math.round(rec.alt.y)) : '无') + ' ｜ 当前x=' + Math.round(z.worldPositionX)); } catch (e) { /* 忽略 */ }
        }
        if (rec) {
            /* ★ 用户 2026-10-20：**只在场中格子内才能吹退**；最多推到「最右格最右边 / 最左格最左边」。
             *   已经在边界外 ⇒ 这一帧结束推退（否则会被"夹回来"形成反向位移）。 */
            if (dir > 0) {
                if (z.worldPositionX >= rec.y - 0.01) { z.__gpnFartPush = 0; z.__gpnFartPushTiles = 0; z.__gpnFartStacks = 0; return true; }
                if (target > rec.y) target = rec.y;
            } else {
                if (z.worldPositionX <= rec.x + 0.01) { z.__gpnFartPush = 0; z.__gpnFartPushTiles = 0; z.__gpnFartStacks = 0; return true; }
                if (target < rec.x) target = rec.x;
            }
        } else {
            /* 拿不到草坪边界（实机 lawnRec 也可能为空）⇒ **保守：直接结束推退**，宁可不推也不把僵尸推出场外 */
            z.__gpnFartPush = 0; z.__gpnFartPushTiles = 0; z.__gpnFartStacks = 0;
            return true;
        }
        const before = z.worldPositionX;
        z.worldPositionX = target;
        z.__gpnFartPush = left - (target - before);
        if (Math.abs(z.__gpnFartPush) < 0.05) { z.__gpnFartPush = 0; z.__gpnFartPushTiles = 0; z.__gpnFartStacks = 0; }
        return true;
    } catch (e) { warn('巴豆屁：吹退出错', e); return false; }
}
/** 跨行补扫：对"尸体所在行的上下各 (rows-1)/2 行"用**与原版相同的方向条件**再扫一遍。
 *  · 邻行：`setChiliStun(t)`（有薄荷毒再 `setPoison`）+ 打 `CarriedSporeShroom`
 *  · 本行：引擎已经眩晕/中毒过了，这里**只补标记**（否则"三行里中间行不感染"很怪）
 *  返回被"邻行新增"处理的数量（探针/日志用）。 */
function gpnFartCrossRows(it, Square, C) {
    let n = 0;
    try {
        const z = it.z, lane = it.lane;
        if (!z || !lane) return n;   // ⚠️ 不要求尸体自己有 setChiliStun（只对【目标】调用）
        const SW = (Square && Square.SquareWidth) ? Square.SquareWidth : 68;
        const o = (z._bodyRec && typeof z._bodyRec.prjX === 'function') ? z._bodyRec.prjX() : null;
        if (!o) return n;
        const rows = Math.max(1, Math.floor(Number(C.fartRows) || 1));
        const half = Math.floor(rows / 2);
        const dir = it.reversed === true;
        const inRange = function (t) {
            try {
                const p = t.bodyRecReal.prjX();
                return dir ? (p.x <= o.y + SW / 2) : (p.y >= o.x - SW / 2);
            } catch (e) { return false; }
        };
        const isDying = function (t) {
            try {
                if (!t || t.dead) return true;
                const at = t.__gpnFartDyingAt;
                return !!(at && ((new Date()).getTime() - at) < 4000);   // 4 秒内视为"正在放屁/刚被巴豆杀"
            } catch (e) { return false; }
        };
        const mark = function (t) { if (t && t.ImmuneToSporeShroom !== true) t.CarriedSporeShroom = true; };
        /* 吹退：沿屁的方向（正向 +X、反向 -X）给"被命中"的僵尸加距离（可叠加） */
        const pushDir = (it.reversed === true) ? -1 : 1;
        const push = function (t) { gpnFartAddPush(t, pushDir, SW, C); };
        // ① 本行：只补标记（引擎已眩晕）
        for (const t of ((lane.zombiePool && lane.zombiePool()) || [])) {
            if (t && t !== z && !isDying(t) && inRange(t)) { mark(t); push(t); }
        }
        // ② 邻行：眩晕 + 毒 + 标记
        const lanes = [];
        let l = lane;
        for (let i = 0; i < half; i++) { l = l && l.UpperLane; if (l) lanes.push(l); }
        l = lane;
        for (let i = 0; i < half; i++) { l = l && l.LowerLane; if (l) lanes.push(l); }
        for (const ln of lanes) {
            for (const t of ((ln && ln.zombiePool && ln.zombiePool()) || [])) {
                if (!t || t === z || isDying(t) || !inRange(t)) continue;
                try { t.setChiliStun(it.t); } catch (e) { /* 忽略单只 */ }
                try { if (it.p && typeof it.p.isValid === 'function' && it.p.isValid()) t.setPoison(it.p.DPS, it.p.duration); } catch (e) { /* 忽略 */ }
                mark(t); push(t); n++;
            }
        }
    } catch (e) { warn('巴豆屁：跨行补扫出错', e); }
    return n;
}

/** 视觉：等引擎把气体节点生成出来（音效之后紧跟着 instantiate）→ 只改 **Y 轴**放大 + 淡紫 tint。
 *  · 探针实测：行间位移 = (0,-81)（纯 Y），节点 `angle=0` ⇒ **Y 就是行高方向** ✓
 *  · ⚠️ 颜色/缩放**不能**依赖全局 `cc`（实机里它是 SystemJS 模块）⇒ 这里：
 *      缩放优先 `node.setScale(x,y,z)`；颜色优先**克隆组件自己的 Color**，其次 `deps.cc.Color`，最后普通对象。
 *  · 全流程打诊断（verboseLog 时），用来判断"没变化"到底卡在哪一步。 */
function gpnFartScheduleVisual(it, C, probeOn, deps) {
    try {
        const parent = it.parent;
        if (!parent) return;
        const ccg = (deps && deps.cc) || ((typeof cc !== 'undefined') ? cc : null);
        const rows = Math.max(1, Math.floor(Number(C.fartRows) || 1));
        /* `fartRows <= 1` ⇒ 就是原版（1 行、不放大、不下移）；放大/下移只对多行生效 */
        const k = (rows > 1) ? (Number(C.fartRowScale) > 0 ? Number(C.fartRowScale) : 3) : 1;
        const off = (rows > 1) ? ((typeof C.fartYOffset === 'number') ? C.fartYOffset : -40) : 0;
        if (k === 1 && off === 0) {
            if (probeOn()) log('[巴豆屁] fartRows=1 ⇒ 保持原版（不放大、不下移）');
            return;
        }
        setTimeout(function () {
            try {
                // 按"引擎挂点锚点"挑气体节点（多只同时放屁也不会挑错）；跳过刚被处理过的
                const now = (new Date()).getTime();
                let node = null, best = 1e18;
                const kids = (parent.children || parent._children) || [];
                for (const n2 of kids) {
                    if (!/fart/i.test(n2.name || '')) continue;
                    if (n2.__gpnFartTouchedAt && (now - n2.__gpnFartTouchedAt) < 800) continue;
                    let d = 0;
                    try {
                        const p = n2.worldPosition || n2.position || {};
                        const dx = (p.x || 0) - (it.hx === null ? 0 : it.hx);
                        const dy = (p.y || 0) - (it.hy === null ? 0 : it.hy);
                        d = dx * dx + dy * dy;
                    } catch (e) { d = 0; }
                    if (d < best) { best = d; node = n2; }
                }
                if (!node) { if (probeOn()) log('[巴豆屁] ⚠️ 30ms 内没找到气体节点（本次跳过视觉改造）'); return; }
                try { node.__gpnFartTouchedAt = now; } catch (e) { /* 忽略 */ }
                /* ③ 层级置顶：引擎挂点时 `setSiblingIndex(僵尸的索引)` ⇒ 同行后生成的僵尸会**盖住气体**
                 *    （用户反馈"气体被僵尸挡住"）。放到该层最上层 ⇒ 气体盖住僵尸。
                 *    池化安全：引擎每次 spawn 都会重设 siblingIndex ⇒ 不会残留。 */
                let zHow = 'none';
                try {
                    if (typeof node.setSiblingIndex === 'function') {
                        const cnt = ((parent.children || parent._children) || []).length;
                        if (cnt > 0) { node.setSiblingIndex(cnt - 1); zHow = 'top(' + (cnt - 1) + ')'; }
                    }
                } catch (e) { warn('巴豆屁：置顶出错', e); }
                /* ① 只沿 Y 放大（让绿色气体铺满 N 行） */
                const sc = node.scale || {};
                const sx = (typeof sc.x === 'number') ? sc.x : 1;
                const sy = (typeof sc.y === 'number') ? sc.y : 1;
                const sz = (typeof sc.z === 'number') ? sc.z : 1;
                let scaleHow = 'none';
                try {
                    if (typeof node.setScale === 'function') { node.setScale(sx, sy * k, sz); scaleHow = 'setScale'; }
                    else if (ccg && ccg.Vec3) { node.scale = new ccg.Vec3(sx, sy * k, sz); scaleHow = 'Vec3'; }
                    else { sc.y = sy * k; node.scale = sc; scaleHow = 'mutate'; }
                } catch (e) { warn('巴豆屁：放大出错', e); }
                /* ② 位置下移：引擎把气体挂在"僵尸高度"上（所以看着像脑袋放屁）⇒ 默认下移半行 */
                let posHow = 'none';
                try {
                    if (typeof node.setPosition === 'function') {
                        const p0 = node.position || {};
                        node.setPosition(p0.x || 0, (p0.y || 0) + off, p0.z || 0);
                        posHow = 'setPosition';
                    }
                } catch (e) { warn('巴豆屁：下移出错', e); }
                if (probeOn()) {
                    const after = node.scale || {};
                    log('[巴豆屁·诊断] 节点="' + (node.name || '?') + '"'
                        + ' ｜ 放大=' + scaleHow + ' ×' + k
                        + ' ｜ 读回 scale=(' + (Math.round((after.x || 0) * 100) / 100) + ',' + (Math.round((after.y || 0) * 100) / 100) + ')'
                        + ' ｜ 下移=' + posHow + ' ' + off + 'px ｜ 层级=' + zHow
                        + ' ｜ 颜色=原版（不处理） ｜ 音量=原版');
                }
            } catch (e) { warn('巴豆屁：视觉改造出错', e); }
        }, 30);
    } catch (e) { warn('巴豆屁：视觉调度出错', e); }
}
function makeFartLinkPatch(Zombie, SoundRescourses, Square, deps) {
    const recs = [];
    const C = CFG && CFG.sporeshroom;
    const probeOn = () => !!(C && C.probeFart) && verboseOn();
    const feat = () => { try { return featOn('sporeshroom'); } catch (e) { return false; } };
    const st = { calls: 0, sounds: 0 };

    // ---- ① 放屁入口：原样调用引擎；若"带标记 + 开关开" ⇒ **本只自己**安排 2 秒后扩行 ----
    if (Zombie && Zombie.prototype && typeof Zombie.prototype.chilibeanFart === 'function') {
        const rec = methodRecord(Zombie, 'chilibeanFart');
        const patched = function (stunDuration, poison) {
            try {
                const marked = this && this.CarriedSporeShroom === true;
                /* ★ 记录"这只正在放屁/即将死亡"：跨行补扫时**跳过所有这种尸体**
                 *   （否则反向屁的气体条件会把"被巴豆击杀的尸体"也一起吹退 —— 用户 2026-10-20 反馈） */
                try { this.__gpnFartDyingAt = (new Date()).getTime(); } catch (e) { /* 忽略 */ }
                const on = feat() && marked;
                if (probeOn()) {
                    st.calls++;
                    log('[巴豆屁·探针] chilibeanFart #' + st.calls
                        + ' ｜ 带标记=' + marked
                        + ' ｜ 行=' + ((this.inLane && this.inLane.LaneIndex !== undefined) ? this.inLane.LaneIndex : '?')
                        + ' ｜ reversed=' + (this.reversed === true)
                        + ' ｜ 眩晕=' + stunDuration + ' ｜ 有毒=' + !!poison
                        + ' ｜ 联动=' + (on ? '是（' + C.fartRows + ' 行·绿屁·打标记）' : '否'));
                }
                if (on) gpnFartScheduleLink(this, stunDuration, poison, Square, C, probeOn, deps);
            } catch (e) { warn('巴豆屁：入口出错', e); }
            return rec.original.apply(this, arguments);
        };
        patched.__gpnGated = 'sporeshroom';   // ★ 身份守卫（见 chilibean 的 isImmune）
        Zombie.prototype.chilibeanFart = patched;
        recs.push(rec);
    }

    // ---- ①b 吹退 tick：借 `dealHurrikale`（引擎每帧对"活着的、在行内"的僵尸都会调它）----
    if (Zombie && Zombie.prototype && typeof Zombie.prototype.dealHurrikale === 'function') {
        const recH = methodRecord(Zombie, 'dealHurrikale');
        Zombie.prototype.dealHurrikale = function (dt) {
            try {
                if (this && this.__gpnFartPush) {
                    if (feat()) {
                        if (gpnFartPushTick(this, dt, C, deps)) return;   // 本帧由我们接管（不调原版）
                    } else {
                        this.__gpnFartPush = 0;                            // 开关被关掉 ⇒ 立即停
                    }
                }
            } catch (e) { warn('巴豆屁：吹退钩子出错', e); }
            return recH.original.apply(this, arguments);
        };
        recs.push(recH);
    }

    // ---- ①c 池化清理：`__gpnFartPush` 是我们自己的字段，复活/回收时必须归零 ----
    if (Zombie && Zombie.prototype && typeof Zombie.prototype.clearBuff === 'function') {
        const recC = methodRecord(Zombie, 'clearBuff');
        Zombie.prototype.clearBuff = function () {
            const r = recC.original.apply(this, arguments);
            try { this.__gpnFartPush = 0; this.__gpnFartPushTiles = 0; this.__gpnFartStacks = 0; this.__gpnFartDyingAt = 0; } catch (e) { /* 忽略 */ }
            return r;
        };
        recs.push(recC);
    }

    // ---- ② 音效：只留探针计数（不接管音量）----
    if (SoundRescourses && SoundRescourses.prototype && typeof SoundRescourses.prototype.playZombieFart === 'function') {
        const rec2 = methodRecord(SoundRescourses, 'playZombieFart');
        SoundRescourses.prototype.playZombieFart = function () {
            /* ⚠️ 只做探针计数：**不再接管音量**（2026-10-20 用户实测 1.5 倍无变化 ⇒ 放弃）。
             *    原因猜测：引擎 `play()` 对同一 clip 有冷却/去重，我们另起一次 1.5 播放会被吞掉。 */
            try {
                if (probeOn()) {
                    st.sounds++;
                    const clip = this && this.zombieFart;
                    log('[巴豆屁·探针·音效] playZombieFart #' + st.sounds
                        + ' ｜ clip=' + (clip && (clip.name || clip._name) ? (clip.name || clip._name) : String(clip))
                        + ' ｜ 音量=原版（已放弃接管）');
                }
            } catch (e) { warn('巴豆屁：音效钩子出错', e); }
            return rec2.original.apply(this, arguments);
        };
        recs.push(rec2);
    }
    return recs;
}
/** 给"这一只"带标记的尸体排一个 2 秒后的扩行 + 视觉改造（每只独立，互不覆盖）。 */
function gpnFartScheduleLink(z, stunDuration, poison, Square, C, probeOn, deps) {
    try {
        const it = {
            z: z, t: stunDuration, p: poison,
            lane: z.inLane || null, reversed: z.reversed === true,
            parent: (z.node && z.node.parent) || null,
            // 引擎挂点用的锚点 = (worldPositionX, worldPositionY + height)：按它找气体节点最准
            hx: (typeof z._worldPositionX === 'number') ? z._worldPositionX : null,
            hy: (typeof z._worldPositionY === 'number') ? (z._worldPositionY + ((typeof z.height === 'number') ? z.height : 0)) : null,
        };
        const delay = (typeof C.fartDelaySec === 'number' && C.fartDelaySec >= 0) ? C.fartDelaySec : 2;
        const fire = function () {
            try {
                if (!it.z || it.z.dead) return;
                // ★ 触发时**复查**：这 2 秒里开关可能被关掉 / MOD 可能被卸载 ⇒ 不能再扩行
                if (typeof gpnDisposed !== 'undefined' && gpnDisposed) return;
                if (typeof featOn === 'function' && !featOn('sporeshroom')) return;
                const added = gpnFartCrossRows(it, Square, C);
                if (probeOn() || (C && C.fartDebugLog)) {
                    log('[巴豆屁] 带标记的屁：邻行新增 ' + added + ' 只（眩晕+标记），共覆盖 ' + C.fartRows + ' 行');
                }
                /* 屏幕震动（只对带标记的三行屁；同帧多只只抖一次） */
                const shake = gpnFartShake(C, deps && deps.LevelPlay);
                if (probeOn() || (C && C.fartDebugLog)) log('[巴豆屁] 震动=' + shake);
                gpnFartScheduleVisual(it, C, probeOn, deps);
            } catch (e) { warn('巴豆屁：定时触发出错', e); }
        };
        if (typeof z.scheduleOnce === 'function') z.scheduleOnce(fire, delay);
        else setTimeout(fire, Math.round(delay * 1000));
    } catch (e) { warn('巴豆屁：安排联动出错', e); }
}
/* =========================================================================
 * 5. 暗影龙葵
 *   5a. _shoot：抄自 0.14.0 的 NightShade._shoot，逻辑等价，额外给弹道打「暗影态」标记
 *   5b. commonShot.objdata setter：把私有字段从原始数据里捞出来
 *   5c. commonShot.detectEnemy：穿透（僵尸侧 + 障碍物 +【被弹反后的植物侧】）
 *
 *   ⚠ 植物侧那一段是必须的：原版 detectEnemyNormal 在 enemyType == plant 时
 *     （= 被小丑 / 三节棍弹反之后）会走 detectPlant() 打植物，
 *     而我们的穿透分支是【整个替换】detectEnemy 的 ⇒ 不自己补上就永远打不到植物。
 * =======================================================================*/

/** 5a. 重写 _shoot —— 原版不返回弹道，所以必须在发射点自己标记 */
function makeNightShadePatch(NightShadePlant, PrjFunctions, Vec2, CharacterType) {
    if (!NightShadePlant || !NightShadePlant.prototype
        || typeof NightShadePlant.prototype._shoot !== 'function') {
        warn('跳过龙葵：拿不到 _shoot');
        return null;
    }
    if (!PrjFunctions || typeof PrjFunctions.shootOnePea !== 'function' || !Vec2 || !CharacterType) {
        warn('跳过龙葵：拿不到 PrjFunctions / Vec2 / CharacterType');
        return null;
    }
    const original = NightShadePlant.prototype._shoot;

    NightShadePlant.prototype._shoot = gpnGatedBody(original, 'nightshade', function (isFood) {
        const self = this;
        // 原版 _shoot 是 async 且没有返回值，这里保持行为一致，只多打一个标记
        return (async () => {
            if (self.leftPRJCount <= 0) return undefined;
            const type = self.fooded
                ? (isFood ? self.prjF_Mega : self.prjF)
                : (isFood ? self.prjS_Mega : self.prjS);
            if (!type) return undefined;

            if (!isFood) self.leftPRJCount--;
            const scale = (self.ShadowPowered && !isFood)
                ? self.objdataOwn.ShadowPoweredDamageScale : 1;

            const shot = await PrjFunctions.shootOnePea(
                type,
                new Vec2(self.peaSpawnPoint.worldPosition.x, self.worldPositionY),
                self.peaSpawnPoint.worldPosition.y - self.worldPositionY,
                self.inLane.prjLayer,
                new Vec2(8, 0),
                CharacterType.zombie,
                self.MintBoosted
            );
            if (shot) {
                shot.damageScale = scale;
                // 暗影态发射的弹道才允许穿透（普攻 / 大招都算，只要是暗影态发的）
                shot.__gpnShadow = !!self.ShadowPowered;
                // ★ 命中特效（那片会飘落的紫叶 = 引擎 commonShot 的 PopParticle）：
                //   这一发只在【最后命中一个目标】时才出叶子。标记只打在暗影龙葵的弹上 ——
                //   星星果 A2 追击弹（__gpnPierceAlways）、原版仙人掌刺都不受影响。
                shot.__gpnFxLastOnly = true;
                // 击退也只在暗影态生效（非暗影态 = 原版：没有击退）
                // 引擎在 commonShot 里提供了现成 setter：this.knockbackDistance = v
                if (typeof shot.setKnockBack === 'function') {
                    shot.setKnockBack(self.ShadowPowered ? CFG.nightshade.knockbackDistance : 0);
                } else if (shot.objdataOwn) {
                    shot.objdataOwn.KnockbackDistance = self.ShadowPowered
                        ? CFG.nightshade.knockbackDistance : 0;
                }
            }
            return shot;
        })();
    });
    return { Cls: NightShadePlant, name: '_shoot', original };
}

/** ★ 这一发要用【哪个矩形】判这个目标 —— 【命中判定】和「已命中名单」的清理必须拿同一个结果。
 *
 *  为什么必须收成一个函数：这两个地方一旦用不同的矩形，就会出问题 ——
 *    · 引擎里植物的 `bodyRec` 在"隐身"时是**空矩形**（PlanternHidden / sheepend / bodyRecHiddenCD / leapTween），
 *      而 `realBodyRec` 才是真判定框；
 *    · 命中判定用 `realBodyRec`、清理却用 `bodyRec` ⇒ 打中的植物**每帧都被从名单里放出去**
 *      ⇒ 下一帧又打它 ⇒ 穿透名额**全砸在同一株身上**（v1.0.0 修的 BUG）。
 *  所以两边统一走这里；将来原版改了语义，两边也会**同时**跟着变，不会再错位。
 *
 *  口径：
 *    · 植物侧（isZombieSide=false）：realBodyRec；处于冰块状态时用 bodyRecForSnowball（与引擎 detectPlant 一致）
 *    · 僵尸侧 / 障碍物（isZombieSide=true）：bodyRec（与我们自己的命中判定一致）
 *    · 兜底：植物侧拿不到前两个时退回 bodyRec（**两边同时退**，绝不在半路临时换另一套矩形）
 */
function gpnTargetRec(shot, t, isZombieSide) {
    if (!t) return null;
    const ok = (r) => (r && typeof r.judgeCrossRec === 'function') ? r : null;
    if (isZombieSide) return ok(t.bodyRec);
    if (shot && shot.iceblockLevel > 0) {
        return ok(t.bodyRecForSnowball) || ok(t.realBodyRec) || ok(t.bodyRec);
    }
    return ok(t.realBodyRec) || ok(t.bodyRec);
}

/** 三种"护盾实体"（引擎里它们**全都是按 ID 认**的：`ZombieBlockers`、`onPlantHit`、三节棍推人、
 *  僵尸黑名单…… 都是按这几个 ID 判断，所以我们也照这个惯例走 —— **不要**用 `isRealZombie`，
 *  那个标志还有好几类别的实体（僵尸机甲零件、食脑者、Zomboss 部件…）共用）：
 *    · future_protector_shield   力场盾僵尸的力场盾 —— 僵尸方（在 `zombiePool`）
 *    · future_infinut_shield     全息坚果【大招】盾 —— 植物方（`hypnotized` ⇒ 在 `hypnoZombiePool`）
 *    · modern_moonflower_shield  月光花【大招】盾 —— 植物方（同上）
 *  原版仙人掌刺（官方穿透弹）打这三种盾时**不消失、继续飞**（因为 `cactusThorn.splat` 被覆写成不 pop），
 *  我们这里把同一口径补回来（唯一差别：我们要扣 1 个穿透名额）。
 *
 *  ⚠️ 保险：`ZombieEnum` 是引擎 `Zombies.ts` 的导出。万一原版**改了 ID 名**（或 `Zombies.ts` 载入失败），
 *  这里会**限流告警一次**（只打一条），提示"护盾会退回被吸收的老口径"，好第一时间发现、同步白名单。 */
let gpnShieldIdWarned = false;
function gpnWarnShieldIdsOnce(ZombieEnum) {
    if (gpnShieldIdWarned) return;
    gpnShieldIdWarned = true;
    warn('护盾判定：拿不到 ZombieEnum 的护盾 ID（future_protector_shield / future_infinut_shield / '
        + 'modern_moonflower_shield）—— 三种护盾会退回「被吸收」的老口径（不崩，只是穿不过去）。'
        + '若原版改过 ID 名，请同步 gpnIsShieldZombie 的白名单。'
        + (ZombieEnum ? '' : '（ZombieEnum 本身没拿到：Zombies.ts 载入失败？）'));
}
function gpnIsShieldZombie(z, ZombieEnum) {
    const idsOk = !!(ZombieEnum
        && ZombieEnum.future_protector_shield != null
        && ZombieEnum.future_infinut_shield != null
        && ZombieEnum.modern_moonflower_shield != null);
    if (!idsOk) { gpnWarnShieldIdsOnce(ZombieEnum); return false; }
    if (!z) return false;
    return z.ID === ZombieEnum.future_protector_shield
        || z.ID === ZombieEnum.future_infinut_shield
        || z.ID === ZombieEnum.modern_moonflower_shield;
}

/** ★ 让这发穿透弹"体面地消亡"：先把引擎可能为 null 的字段补好，再调 pop()，最后兜底。
 *
 *  【为什么要这个】引擎 `commonShot.pop()` 的**最后一步**是
 *      this.ZombieListenersOnPop.forEach(function (e) { e.onCommonShotFinishPoping(w) })
 *  （通知那些"监听这发子弹消亡"的僵尸，例如小丑 / 三节棍弹反时登记的）。
 *  这个列表正常是 `[]`（类构造里就是 `[]`，`initialize()` 里也置 `[]`）—— 但 `initialize()`
 *  是由 `characterOnEnable()` 调的，而引擎 `Character.onEnable` 里写的是
 *  `if (isInGame) { ...; this.disabled || (this.characterOnEnable(), ...) }`
 *  ⇒ **enable 那一刻 `isInGame === false`（或 `disabled` 为真）的子弹会跳过 `initialize()`**，
 *    列表就保持成**预制体反序列化进来的 `null`** ⇒ `forEach` 抛
 *      TypeError: Cannot read properties of null (reading 'forEach')
 *  更糟的是它抛在 pop() 的**最后一步**：伤害 / 粒子 / 音效都已生效，但
 *  `this.fade()` 与 `this.popWaiting = false` 被跳过 ⇒ **子弹不会被标记死亡**，会继续飞、
 *  继续打，直到飞出屏幕（那条路直接调 `fade()`，不经过 pop）。
 *  玩家实测日志里这一条错误刷了 1194 次（1189 条堆栈里就是我们的 `gpnPierceDetect`）。
 *
 *  【我们的做法】语义等价、最小侵入：
 *   ① 调 pop() 前把 null 补成 `[]` —— 空数组 = "没有僵尸需要通知"，正是引擎本意；
 *   ② 整段 try/catch：将来引擎再冒出别的空字段，也至少把子弹 `fade()` 掉、绝不把异常抛给引擎；
 *   ③ pop() 是 async，还要挂 `.catch` —— 否则错误会变成 "Uncaught (in promise)" 刷屏；
 *   ④ 告警限流（5 秒一条），免得一次会话刷几十条。
 */
let gpnPopWarnAt = 0;
let gpnPopDiagAt = 0;
let gpnZoyTableLogged = false;               // 腐尸豆荚召唤表是【静态表】：全程只打一次
let gpnNullWriteTotal = 0;                     // 「有人写 null」被拦下的累计次数（护栏统计）
let gpnNullWriteDetail = 0;                    // 已经打过【详细】日志（含写入者堆栈）的条数
let gpnNullWriteQuiet = false;                 // 是否已经打过「后续不再逐条打印」那句
let gpnSpSelfHealTotal = 0;                    // 裂荚「每帧自愈」把渲染缩放重新翻回来的累计次数（诊断用）
let gpnSpSelfHealSpots = 0;                    // 自愈"待上报"的计数（每 5 秒清零并汇总一行）
let gpnSpSelfHealFirstStack = '';              // 首次复位时的调用栈（只抓一次；用于"是谁把翻转清掉的"）
let gpnSpSelfHealQuiet = false;                // 一次汇总后短暂静音（避免同一帧内连打多行）
let gpnSpSelfHealLastReport = 0;               // 上次汇总的时间戳
// body 缩放纠正（MGP 开大丢翻转的真因修复）的统计
let gpnSpBodyFixTotal = 0;
let gpnSpBodyFixSpots = 0;
let gpnSpBodyFixFirstStack = '';
let gpnSpBodyFixLastReport = 0;
// 【诊断】图鉴追加的零输出记账（默认不输出，只在 dump 时打一次）
let gpnAlmApplyCalls = 0;      // dataPatch.apply() 被调用次数
let gpnAlmAppendCalls = 0;     // appendLoc() 进入次数（= 命中并走到写入分支）
let gpnAlmAppendWrites = 0;    // 其中"判据通过、真的写了 zh"的次数
const gpnAlmAppendLog = [];    // 前若干条明细
// ⚠️【临时诊断开关】排查"图鉴文案重复 50 次"期间置 true ⇒ 每次 apply() 后打一次记账+dump。
//   **2026/10/10 已查清**：那段代码每次 apply 都会执行 ⇒ 日志刷 ~50 行，但判据可靠、文本不重复
//   （用户实机确认图鉴文案正常）⇒ 现改回 false（静默）。要再排查时置回 true 即可。
let gpnAlmTempVerbose = false;
const GPN_NULL_WRITE_DETAIL_MAX = 2;           // 前几条打详细；之后只累计（要全量时把这个数字调大）
/** 现场诊断用：把一个字段"长什么样"压缩成短字符串 */
function gpnShape(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (Array.isArray(v)) return 'array(' + v.length + ')';
    return typeof v;
}

/** 「安全消亡」：自己做引擎 pop() 里**不需要遍历监听列表**的那几步 —— 等价、但**不会撞上那个竞态**。
 *  引擎 pop() 的顺序是：
 *    playParticle / playPopSound → (plantToSpawn / zombieToSpawn / plantHeat / tileLiquid / ProjectileEmissions)
 *    → await onPop(inLnC) → dealZombiesPoint → ZombieListenersOnPop.forEach(通知) → fade → popWaiting=false
 *  我们只有在【没有子子弹、没有监听者、也没有那几个"生成物"】时才走这条路（调用方才判），此时：
 *    · 子子弹循环为空 ⇒ 跳过等价；· forEach 列表为空 ⇒ 跳过等价；· 那几个生成物都没有 ⇒ 跳过等价。
 *  其余步骤（粒子、音效、onPop、dealZombiesPoint、fade、复位）**一步不落**地照做。
 *  `popWaiting` 已经在 pop 流程里（重复调用）时，就不再补粒子/音效（与引擎"跳过到 case 34"一致）。 */
function gpnShotPopSafe(shot) {
    const already = !!shot.popWaiting;
    if (!already) {
        try { if (typeof shot.playParticle === 'function') shot.playParticle(); } catch (e) { }
        try { if (typeof shot.playPopSound === 'function') shot.playPopSound(); } catch (e) { }
    }
    try {                                                            // onPop：水面水花等子类会用到
        if (typeof shot.onPop === 'function') {
            const r = shot.onPop(shot.inLnC);
            if (r && typeof r.then === 'function') r.then(null, () => { });
        }
    } catch (e) { }
    try { if (typeof shot.dealZombiesPoint === 'function') shot.dealZombiesPoint(); } catch (e) { }
    try { if (!shot.dead && typeof shot.fade === 'function') shot.fade(); } catch (e) { }
    try { shot.popWaiting = false; } catch (e) { }
}

/** 这条子弹【能不能】走"安全消亡"（= 引擎 pop() 里除了上面那几步之外没别的事要做）。
 *  任何一项不满足都返回 false ⇒ 老老实实调引擎 pop()（外面还有护栏 + 兜底）。 */
function gpnCanSafePop(shot) {
    if (!shot) return false;
    if (shot.ProjectileEmissions && shot.ProjectileEmissions.length > 0) return false;  // 有子子弹
    if (Array.isArray(shot.ZombieListenersOnPop) && shot.ZombieListenersOnPop.length > 0) return false; // 有监听者
    if (shot.plantToSpawn || shot.zombieToSpawn || shot.plantHeatOnPop) return false;   // 有"生成物"
    if (shot.tileLiquid && shot.tileLiquidDuration > 0) return false;                   // 有地块流体
    return true;
}

/** 这条子弹已经证明"引擎 pop() 用不了" -> 给实例装一个替身 pop：
 *   - 平时走 gpnShotPopSafe（安全消亡）；
 *   - 万一它后来恢复正常、而且**真的有监听者**（列表非空）-> 立刻删掉替身、交回引擎原版（不漏通知）。 */
function gpnInstallStandinPop(shot) {
    if (!shot || shot.__gpnPopStandin) return;
    try {
        Object.defineProperty(shot, 'pop', {
            configurable: true, writable: true,
            value: function () {
                if (Array.isArray(this.ZombieListenersOnPop) && this.ZombieListenersOnPop.length > 0) {
                    try { delete this.pop; } catch (e) { }               // 恢复原型上的引擎 pop
                    return this.pop.apply(this, arguments);
                }
                gpnShotPopSafe(this);
                return Promise.resolve();
            },
        });
        shot.__gpnPopStandin = true;
    } catch (e) { /* 装不上就只能靠调用点跳过 */ }
}

function gpnPopFallback(shot, e) {
    if (shot) {
        try { shot.__gpnPopBroken = true; } catch (e0) { }                // 记住：这条子弹别再调引擎 pop
        gpnInstallStandinPop(shot);
    }
    const now = Date.now();
    if (now - gpnPopWarnAt > 5000) {                 // 限流：同一条 5 秒内最多打一条
        gpnPopWarnAt = now;
        // ★ 诊断行：把"可能是 null 的那几个字段"当场打出来（下次日志一看就知道是哪个）
        let info = '(诊断失败)';
        try {
            info = 'listeners=' + gpnShape(shot.ZombieListenersOnPop)
                 + ' killed=' + gpnShape(shot.killedZombiesOneHit)
                 + ' emissions=' + gpnShape(shot.ProjectileEmissions)
                 + ' popWaiting=' + shot.popWaiting
                 + ' dead=' + shot.dead
                 + ' ID=' + shot.ID
                 + ' repair=' + shot.__gpnRepairHow
                 + ' guard=' + (shot.__gpnGuardArr ? 'yes' : 'no')
                 + ' guardSame=' + (shot.ZombieListenersOnPop === shot.__gpnGuardArr);
        } catch (e2) { /* 尽力而为 */ }
        warn('穿透：子弹消亡（pop）出错，已兜底让子弹消失 | 诊断: ' + info, e);
    }
    try { if (shot && !shot.dead && typeof shot.fade === 'function') shot.fade(); }
    catch (e2) { /* 尽力而为，绝不往外抛 */ }
    try { if (shot) shot.popWaiting = false; }
    catch (e2) { /* 尽力而为 */ }
}

/** 给"监听列表"装**永不返回 null** 的护栏访问器；返回**是否已经能安全调引擎 pop()**（true = 是数组）。
 *  为什么**即使现在是数组也要装**：实测日志显示，这条子弹的字段在我们调 pop() 之前是好的，
 *  但引擎 pop() 内部有 `await`，期间它可能被**子弹池的销毁/回收**顺手清成 `null`
 *  （`NodePools`：同预制体闲置 > 100 颗就整池 `clear()` → `destroy()`；销毁会把可序列化字段清 null）。
 *  装了访问器之后：`set` 只接受数组、**忽略 null/undefined** ⇒ 之后谁再写 null 都不生效。
 *  正常子弹**语义不变**（读到的还是同一个数组，里面的监听者照样会收到通知）。
 *  另外这就是"陷阱"：谁尝试写 null，我们就把**它的调用栈**打出来（限流），用于定位/反馈上游。 */
function gpnFixListenerList(shot) {
    if (!shot) return false;
    const cur = shot.ZombieListenersOnPop;
    if (shot.__gpnGuardArr && cur === shot.__gpnGuardArr) {
        delete shot.__gpnPopBroken;                      // 恢复正常（例如池化复用后又跑过 initialize）
        if (shot.__gpnPopStandin) {                      // 之前装过替身 -> 撤掉，交回引擎原版
            try { delete shot.pop; } catch (e) { }
            shot.__gpnPopStandin = false;
        }
        return true;                                     // 已经护住 -> 什么都不用做
    }
    let arr = Array.isArray(cur) ? cur : [];             // ★ 保留已有监听者（通知不能丢）
    let how = 'none';
    try {
        Object.defineProperty(shot, 'ZombieListenersOnPop', {
            configurable: true, enumerable: true,
            get() { return arr; },
            set(v) {
                if (Array.isArray(v)) { arr = v; return; }
                if (v == null) {                          // ★ 有人想写 null/undefined —— 拦下并记一笔
                    gpnNullWriteTotal += 1;
                    if (gpnNullWriteDetail < GPN_NULL_WRITE_DETAIL_MAX) {
                        gpnNullWriteDetail += 1;
                        let stack = '(拿不到堆栈)';
                        try { stack = String((new Error('listener-list null write')).stack || '').split('\n').slice(1, 6).join(' <- '); } catch (e) { }
                        warn('穿透：有人把监听列表写成 null（已拦下，不影响游戏）| 写入者: ' + stack);
                    } else if (!gpnNullWriteQuiet) {
                        gpnNullWriteQuiet = true;
                        log('穿透：监听列表 null 写入还在继续（累计 ' + gpnNullWriteTotal + ' 次）—— 已全部拦下，后续不再逐条打印');
                    }
                    return;
                }
                arr = v;                                  // 其它类型（理论上不会）照原样接受
            },
        });
        how = 'guard';
    } catch (e) {
        how = 'guard-fail:' + (e && e.message);
        try { shot.ZombieListenersOnPop = arr; how += '/assign'; } catch (e2) { how += '/assign-fail'; }
    }
    if (Array.isArray(shot.ZombieListenersOnPop)) shot.__gpnGuardArr = arr;
    try { shot.__gpnRepairHow = how + '->' + gpnShape(shot.ZombieListenersOnPop); } catch (e) { }
    const ok = Array.isArray(shot.ZombieListenersOnPop);
    if (!ok && Date.now() - gpnPopDiagAt > 5000) {        // 真的护不住（只读/不可配置）才打这条
        gpnPopDiagAt = Date.now();
        let desc = '(拿不到)';
        try {
            const d0 = Object.getOwnPropertyDescriptor(shot, 'ZombieListenersOnPop');
            desc = d0 ? ('w=' + d0.writable + ',c=' + d0.configurable + ',accessor=' + (!!d0.get)) : 'none';
        } catch (e) { }
        warn('穿透：监听列表护不住（改走安全消亡）| repair=' + how + ' desc=' + desc);
    }
    return ok;
}

/** 调引擎 pop() 的安全入口（穿透弹"消亡"统一走这里） */
function gpnSafePop(shot) {
    if (!shot || typeof shot.pop !== 'function') return null;
    if (shot.__gpnPopBroken) {                                            // 已知坏弹：不再碰引擎 pop
        gpnShotPopSafe(shot);
        return null;
    }
    let ok = false;
    try {
        ok = gpnFixListenerList(shot);                                    // ★ 先护住监听列表（即使现在是好的）
        if (!ok) {                                                        // ★ 护不住就绝不调 pop（调了必炸）
            try { shot.__gpnPopBroken = true; } catch (e) { }
            gpnInstallStandinPop(shot);
            gpnShotPopSafe(shot);
            return null;
        }
        if (gpnCanSafePop(shot)) {                                        // ★ 引擎 pop() 没别的事要做 -> 自己做（不撞竞态）
            gpnShotPopSafe(shot);
            return null;
        }
        const r = shot.pop();
        if (r && typeof r.then === 'function') {
            r.then(null, (e) => gpnPopFallback(shot, e));                 // ③ 异步也要接住
        }
        return r;
    } catch (e) {
        gpnPopFallback(shot, e);                                          // ② 别的空字段也兜底
        return null;
    }
}

/** 5b + 5c. 私有字段桥 + 穿透 */
function gpnPierceDetect(shot, dt, maxPierce, CharacterType, ZombieDamageDetails, originalDetect, ZombieEnum) {
    if (!shot.inLane || !shot.detectEnemyOn) return;

    const rec = shot.bodyRec();
    if (!rec) return;

    if (!shot.__gpnPierce) shot.__gpnPierce = { dealt: 0, hit: [] };
    const st = shot.__gpnPierce;

    // (2) 阵营（和引擎一致）：打僵尸用 zombiePool，打植物用 hypnoZombiePool
    const isZombieSide = !CharacterType || shot.enemyType === CharacterType.zombie;

    // (1) 清理：已经不在场上、或已经和判定框分开的，从「已命中」名单里放出去
    //     !! 这里【必须】用 gpnTargetRec（= 和命中判定同一个矩形），否则隐身植物会被反复放出来
    st.hit = st.hit.filter((t) => {
        if (!t || typeof t.isAlive !== 'function' || !t.isAlive()) return false;
        const r = gpnTargetRec(shot, t, isZombieSide);
        return r ? r.judgeCrossRec(rec) : false;
    });

    const pool = isZombieSide ? shot.inLane.zombiePool() : shot.inLane.hypnoZombiePool();

    // (3) 找本帧「最靠前、且这发还没打过」的目标
    const forward = !(shot.linearVelocity && shot.linearVelocity.x < 0);
    let best = null;
    let bestKey = forward ? Infinity : -Infinity;
    for (const z of (pool ? pool : [])) {
        if (!z || st.hit.indexOf(z) !== -1) continue;
        const zr = gpnTargetRec(shot, z, true);          // 僵尸 / 被催眠僵尸：一律 bodyRec
        if (!zr || !zr.judgeCrossRec(rec)) continue;
        const k = zr.prjX().x;
        if (forward ? (k < bestKey) : (k > bestKey)) { best = z; bestKey = k; }
    }

    if (best) {
        // ★ 三种"护盾实体"：当【可穿透的障碍物】处理 —— 这是原版仙人掌刺的口径
        //   （原版 cactusThorn 自己覆写了 `splat` 成"只放音效/粒子、不 pop" ⇒ 打盾不消失、继续飞）。
        //   照同一效果：① 盾吃伤害（照盾自己的口径 = 非直接）② 放溅射
        //              ③ 记入"已命中" ④ 扣 1 个名额（用户要求）后继续飞，名额满才 pop。
        //   双向都生效：正常弹 × 力场盾（僵尸方，zombiePool）
        //             反射弹 × 全息坚果盾 / 月光花盾（植物方，hypnotized ⇒ hypnoZombiePool）
        if (gpnIsShieldZombie(best, ZombieEnum)) {
            shot.dealDamageToZombie(best, false);   // 盾吃伤害（不触发"直伤溅射"，下面显式放）
            shot.onZombieHit(best);
            shot.dealSplashDamage(null, best);
            st.hit.push(best);                      // 同一个盾每发只打一次
            st.dealt++;                             // 扣名额（和墓碑一致）
            if (st.dealt >= maxPierce) return gpnSafePop(shot);      // 打满：pop（引擎自己出一片叶子）
            shot.playPopSound();                                     // 声音：每段都留
            if (!shot.__gpnFxLastOnly) shot.playParticle();          // 叶子：暗影龙葵只在最后一下
            return;
        }
        // 僵尸自检：雨伞 / 小丑 / 护盾 / 铲子等会在这里挡下
        if (typeof best.commonShotPopOnTouch === 'function' && !best.commonShotPopOnTouch(shot)) {
            st.hit.push(best);        // 被挡下也要记住，免得整发卡在这一只身上
            return;
        }
        shot.beforeZombieHit(best);
        // !! 不要在这里自己调 dealSplashDamage —— 引擎的 dealDamageToZombie(z, isDirect=true)
        //    内部已经会调 this.dealSplashDamage(z) 了。再调一次 = 溅射放两遍 = 周围僵尸吃
        //    2 x 50% = 100%（v2.5.0 的 BUG：看起来"溅射完全按子弹原伤害来"）。
        shot.dealDamageToZombie(best, true);
        shot.onZombieHit(best);
        st.dealt++;
        st.hit.push(best);            // <- 每只只打一次
        if (st.dealt >= maxPierce) return gpnSafePop(shot);            // 打满：pop（引擎自己出一片叶子）
        shot.playPopSound();          // 没打满：出声，继续飞（声音每段都留）
        if (!shot.__gpnFxLastOnly) shot.playParticle();   // 叶子：暗影龙葵只在最后一下
        return;
    }

    // (4) 障碍物分支（v2.7.5 起：穿透弹【穿过】障碍物；v2.7.6 起：和僵尸【共用穿透名额】）
    //     墓碑 / 冰块(GridIcecube) / 冲浪板(TombSurfboard) / 冰岩 / 帐篷…… 在引擎里
    //     全都是 Tomb 的子类，都躺在 lane.tombPool() 里。原版是"打中一个就 pop"；
    //     现在改成：打它 + 放溅射，然后【继续往前飞】。
    //     !! 但绝不是无限穿透：障碍物和僵尸【共用同一份名额 maxPierce】——
    //        打中 1 个障碍物就少 1 个名额，名额打满立刻 pop，和打在僵尸身上完全一致。
    if (!(shot.objdataOwn && shot.objdataOwn.IgnoreTombstones)) {
        const tombs = shot.inLane.tombPool(isZombieSide ? 0 : 1);
        for (const e of (tombs ? tombs : [])) {
            const er = gpnTargetRec(shot, e, true);        // 障碍物：bodyRec（和命中判定一致）
            if (!er || !er.judgeCrossRec(rec)) continue;
            if (st.hit.indexOf(e) !== -1) continue;         // 同一个障碍物每发只打一次
            if (typeof e.isAlive === 'function' && !e.isAlive()) continue;
            const dmg = new ZombieDamageDetails(
                shot.damage * shot.damageScale * (shot.havePeaBuff ? 1.5 : 1),
                shot.armorProtection, shot.armorKnockSound, shot.bodyKnockSound,
                null, shot.damageType, true, true);
            e.dealDamage(dmg);
            shot.onTombHit(e);
            shot.dealSplashDamage(null, e);
            st.hit.push(e);
            st.dealt++;                       // 障碍物占 1 个名额（和僵尸一起算）
            if (st.dealt >= maxPierce) return gpnSafePop(shot);
            shot.playPopSound();              // 没打满：出声，继续飞（障碍物这里以前是静音的）
        }
    }

    // (5) 植物侧 —— 【只对"被弹反的弹道"生效】（enemyType 被翻成 plant 的那些）
    //     引擎原版 detectEnemyNormal 在 enemyType == plant 时，最后会调 detectPlant()：
    //         plantPool() -> realBodyRec 判定 -> dealDamageToPlant(plant)
    //         命中就 dealSplashDamage(null, null, plant) + pop()
    //     这里除了"命中即 pop"换成"扣 1 个穿透名额"（其余逐行照抄引擎），别的什么都不改。
    //     !! 这一段就是"暗影龙葵 / 星星果被弹反后打不到植物"的修复：
    //        旧版的穿透分支只找僵尸池 + 障碍物，压根没有植物这一段 ⇒ 弹反后在空池子里空转。
    //     顺带：命中用的是引擎自己的 dealDamageToPlant ⇒ 伞叶 / 无敌 / 推植物那些全自动保留；
    //           plantPool 里本来也没有"被催眠的僵尸"（那些在 hypnoZombiePool，上面已经处理过）。
    if (!isZombieSide) {
        const plants = (typeof shot.inLane.plantPool === 'function') ? shot.inLane.plantPool() : null;
        let target = null;
        let bestKey = forward ? Infinity : -Infinity;
        for (const p of (plants ? plants : [])) {
            if (!p || st.hit.indexOf(p) !== -1) continue;
            if (!(p.eaterDetectable || shot.detectsEaterDetectDisabledPlants)) continue;
            if (shot.targetLocked && p !== shot.targetLocked) continue;
            const pr = gpnTargetRec(shot, p, false);       // 植物：realBodyRec（冰块时 bodyRecForSnowball）
            if (!pr || !pr.judgeCrossRec(rec)) continue;
            const k = pr.prjX().x;
            if (forward ? (k < bestKey) : (k > bestKey)) { target = p; bestKey = k; }
        }
        if (target) {
            // ★ 兜底：植物侧要用引擎自己的 dealDamageToPlant（它内部会走 onCommonshotHit / 伞叶 / 无敌…）。
            //   万一将来原版把它改名或删掉，就【整个回落到原版 detectEnemy】——
            //   保住"能打到植物"（只是没有我们的穿透），并且只告警一次，绝不崩、也不静默失效。
            if (typeof shot.dealDamageToPlant !== 'function') {
                if (originalDetect && !shot.__gpnWarnedNoPlantHit) {
                    shot.__gpnWarnedNoPlantHit = true;
                    warn('穿透：commonShot.dealDamageToPlant 不在了（原版可能改过名）—— 这一发回落到原版 detectEnemy（能打植物，但没有穿透）');
                }
                return originalDetect ? originalDetect.call(shot, dt) : undefined;
            }
            // 引擎 detectPlant 里的伞叶豁免：只有"正在下落 + 旁边有伞叶"才不放溅射
            const umbrella = shot.bodyLinearVelocity < 0
                && typeof target.haveUmbrellaNearby === 'function' && target.haveUmbrellaNearby();
            if (shot.dealDamageToPlant(target)) {
                if (!umbrella) shot.dealSplashDamage(null, null, target);
                st.dealt++;
                st.hit.push(target);           // 同一株植物每发只打一次
                if (st.dealt >= maxPierce) return gpnSafePop(shot);      // 打满：pop（引擎自己出一片叶子）
                shot.playPopSound();           // 没打满：出声，继续飞（声音每段都留）
                if (!shot.__gpnFxLastOnly) shot.playParticle();   // 叶子：暗影龙葵只在最后一下
            }
            return;                            // 被挡下（返回 false）就下一帧再试，与引擎一致
        }
    }
}

function makePiercePatch(CommonShot, CharacterType, ZombieDamageDetails, ZombieEnum) {
    if (!CommonShot || !CommonShot.prototype || typeof CommonShot.prototype.detectEnemy !== 'function') {
        warn('跳过穿透：拿不到 commonShot.detectEnemy');
        return null;
    }
    const recs = [];

    // ---- A 段：私有字段桥 ----
    // 原版 setter 只遍历「弹道 props 实例已有的字段名」，自定义字段会被丢掉。
    // 这里包一层，在过滤发生前从原始数据里把 GPNMaxPierce 捞到实例上。
    const desc = Object.getOwnPropertyDescriptor(CommonShot.prototype, 'objdata');
    if (desc && typeof desc.set === 'function') {
        Object.defineProperty(CommonShot.prototype, 'objdata', {
            configurable: true,
            enumerable: desc.enumerable,
            get: desc.get,
            set: function (raw) {
                this.__gpnPierceMax = (raw && raw[PIERCE_KEY] != null) ? raw[PIERCE_KEY] : 0;
                this.__gpnPierceAlways = !!(raw && raw[PIERCE_ALWAYS_KEY]);
                this.__gpnSplashRatio = (raw && raw[SPLASH_RATIO_KEY] != null) ? raw[SPLASH_RATIO_KEY] : 0;
                this.__gpnBurnRatio = (raw && raw[BURN_RATIO_KEY] != null) ? raw[BURN_RATIO_KEY] : 0;
                this.__gpnBurned = false;   // 池化复用：每发子弹只烧一次
                this.__gpnUmbrellaBlocked = false;  // 池化复用：这一发被伞叶挡下的标记必须复位
                this.__gpnReflectBy = null;         // 池化复用：「是谁反弹的」标记必须复位（弄臣/三节棍）
                this.__gpnStarKind = (raw && raw[STAR_KIND_KEY]) ? String(raw[STAR_KIND_KEY]) : '';
                this.__gpnDandelionKind = (raw && raw[DANDELION_KIND_KEY]) ? String(raw[DANDELION_KIND_KEY]) : '';
                this.__gpnPierce = null;    // 弹道有对象池，穿透状态必须复位
                this.__gpnShadow = false;   // 由 NightShade._shoot 在发射后打上
                this.__gpnFxLastOnly = false;   // 同上（弹道有对象池，必须复位）
                return desc.set.call(this, raw);
            },
        });
        recs.push({ proto: CommonShot.prototype, name: 'objdata', desc });
    } else {
        warn('拿不到 commonShot 的 objdata setter，穿透标记可能无法传入');
    }

    // ---- A2 段：溅射伤害按【该发子弹的实际伤害】现算 ----
    // 不放在 objdata setter 里，是因为那时 shot.damage 可能还没定型（引擎后续才会定稿）。
    // 放在 dealSplashDamage 里则一定是最新值，所以 GP-Next 改了攻击力也能对上。
    if (typeof CommonShot.prototype.dealSplashDamage === 'function') {
        const originalSplash = CommonShot.prototype.dealSplashDamage;
        CommonShot.prototype.dealSplashDamage = function () {
            // 被伞叶 / 回旋镖挡下的那一发：引擎在 pop 前还会调一次溅射 —— 这里直接吞掉，
            // 保证"被挡住 = 一点效果都不产生"（只有我们标记过的甜椒弹会走到这）。
            if (this.__gpnUmbrellaBlocked) return undefined;
            if (this.__gpnSplashRatio > 0 && Array.isArray(this.splashDamages)) {
                const d = (this.damage || 0) * this.__gpnSplashRatio;
                for (const sp of this.splashDamages) sp.splashDamage = d;
            }
            return originalSplash.apply(this, arguments);
        };
        recs.push({ Cls: CommonShot, name: 'dealSplashDamage', original: originalSplash });
    } else {
        warn('拿不到 commonShot.dealSplashDamage，星星果的溅射值不会跟随攻击力');
    }

    // ---- B 段：穿透 ----
    const originalDetect = CommonShot.prototype.detectEnemy;
    CommonShot.prototype.detectEnemy = function (dt) {
        const maxPierce = this.__gpnPierceMax;
        if (!maxPierce) return originalDetect.call(this, dt);              // 其它弹道完全不受影响
        if (CFG.nightshade.shadowOnlyPierce && !this.__gpnShadow && !this.__gpnPierceAlways) {
            // 暗影龙葵的非暗影态：走原版（命中即消失）。
            // 星星果系带 __gpnPierceAlways，不受这条限制。
            return originalDetect.call(this, dt);
        }
        return gpnPierceDetect(this, dt, maxPierce, CharacterType, ZombieDamageDetails, originalDetect, ZombieEnum);
    };
    recs.push({ Cls: CommonShot, name: 'detectEnemy', original: originalDetect });

    return recs;
}

/* =========================================================================
 * 6. 甜薯：受到的治疗 ×N + 每秒自回血
 *    （两个都挂 Plant 基类，用 Plant_Type 判定）
 * =======================================================================*/
function makeSweetPotatoPatch(Plant) {
    if (!Plant || !Plant.prototype) { warn('跳过甜薯：拿不到 Plant 类'); return null; }
    if (typeof Plant.prototype.characterUpdate !== 'function') { warn('跳过甜薯：Plant 上没有 characterUpdate'); return null; }
    if (typeof Plant.prototype.heal !== 'function') { warn('跳过甜薯：Plant 上没有 heal'); return null; }

    const KEY = CFG.sweetpotato.plantType;
    const recUpdate = methodRecord(Plant, 'characterUpdate');
    const recHeal = methodRecord(Plant, 'heal');

    // ---- A. 受到的治疗 ×N ----
    // Plant.heal 是所有治疗的唯一入口（芦荟的 aloeHealingParticle、仙桃的 heal3x3 都走它）。
    // 挂在基类上 + 用 Plant_Type 判定，所以不管甜薯的预制体实际挂哪个类都会命中。
    const KEY_N = normalizeType(KEY);
    Plant.prototype.heal = function (amount) {
        if (!featOn('sweetpotato')) return recHeal.original.apply(this, arguments);   // 【运行期开关】
        /* ★ 用 normalizeType：部分关卡 `Plant_Type` 是 `RTID(sweetpotato@PlantTypes)`（实机日志证过） */
        if (normalizeType(this.Plant_Type) === KEY_N) {
            const mult = CFG.sweetpotato.healReceivedMultiplier;
            if (mult > 0 && mult !== 1 && typeof amount === 'number') amount *= mult;
            if (dbgOn(CFG.sweetpotato.debugLog)) log('甜薯 heal → ' + amount);
        }
        return recHeal.original.call(this, amount);
    };

    // ---- B. 每秒自回血（挂在基类 characterUpdate 上，甜薯没有重写它）----
    Plant.prototype.characterUpdate = function (dt) {
        if (!featOn('sweetpotato')) return recUpdate.original.apply(this, arguments);   // 【运行期开关】
        const r = recUpdate.original.call(this, dt);
        if (normalizeType(this.Plant_Type) === KEY_N && !this.dead) {
            const rate = CFG.sweetpotato.selfHealPerSecond;
            if (rate > 0) {
                // 满血时顺手清零累计（也让对象池复用后的新植物从 0 开始）
                if (this.health >= this.toughness) {
                    this.__gpnRegenAcc = 0;
                } else {
                    this.__gpnRegenAcc = (this.__gpnRegenAcc || 0) + (dt || 0);
                    let guard = 0;
                    while (this.__gpnRegenAcc >= 1 && guard++ < 30) {
                        this.__gpnRegenAcc -= 1;
                        // 吃加成 → 调补丁后的 heal；不吃 → 直接调原版 heal
                        if (CFG.sweetpotato.selfHealAlsoDoubled) {
                            this.heal(rate);
                            if (dbgOn(CFG.sweetpotato.debugLog)) log('甜薯 自回血 +' + rate
                                + ' ×' + CFG.sweetpotato.healReceivedMultiplier);
                        } else {
                            recHeal.original.call(this, rate);
                            if (dbgOn(CFG.sweetpotato.debugLog)) log('甜薯 自回血 +' + rate);
                        }
                    }
                }
            }
        }
        return r;
    };

    return [recUpdate, recHeal];
}

/* =========================================================================
 * 7. 白萝卜：受伤间隔（同一帧内只结算一次伤害）
 *    同样挂在 Plant 基类上，用 Plant_Type 判定。
 * =======================================================================*/
function makeTurnipPatch(Plant) {
    if (!Plant || !Plant.prototype) { warn('跳过白萝卜：拿不到 Plant 类'); return null; }
    const KEY = CFG.turnip.plantType;
    // !! 必须挂在 defaultDealNormalDamage（真正扣 this.health 的那片叶子），
    //    【不能】挂在 dealDamage —— dealDamage 是「按格路由」的：
    //      僵尸咬这一格 -> 某一株的 dealDamage 入口 -> 转发给同格最上层那株的 dealNormalDamage
    //    挂在路由入口 = 给整个格子装闸门，套上南瓜壳/竹篮/藤蔓时会把它们一起限流（旧版的 BUG）。
    //    挂在叶子上 = 只有白萝卜自己的实例命中判定，覆盖层互不影响。
    const rec = methodRecord(Plant, 'defaultDealNormalDamage');
    if (typeof rec.original !== 'function') { warn('跳过白萝卜：Plant 上没有 defaultDealNormalDamage'); return null; }

    const KEY_N = normalizeType(KEY);
    Plant.prototype.defaultDealNormalDamage = function (dmg, type) {
        if (!featOn('turnip')) return rec.original.apply(this, arguments);   // 【运行期开关】
        if (normalizeType(this.Plant_Type) === KEY_N) {   // ★ 兼容 RTID(...) 形式
            if (this.__gpnHitLocked) return this.health;      // 锁没解开：这次伤害整体作废
            this.__gpnHitLocked = true;
            const self = this;
            // 调度器只在一帧开始时跑，所以窗口 <= dt 时等价于「同一帧内只结算一次」
            this.scheduleOnce(function () { self.__gpnHitLocked = false; },
                CFG.turnip.damageGateSeconds);
        }
        return rec.original.call(this, dmg, type);
    };
    return rec;
}

/* =========================================================================
 * 8. 心蕊 DEBUFF -> 对心蕊 / 甜薯 / 热辣海枣的啃食伤害减免
 *    DEBUFF 存在僵尸身上（zombie.BloomingHeartDefenceRateList），是「永久的」：
 *    引擎里那个数组只有构造函数和 push 两处，没有任何计时/清除。
 *    只在【啃食】这一条路上生效（爆炸/火焰类拿不到攻击者引用，做不了）。
 * =======================================================================*/
function makeBloomingHeartVictimPatch(Plant) {
    if (!Plant || !Plant.prototype) { warn('跳过心蕊啃食减伤：拿不到 Plant 类'); return null; }
    if (typeof Plant.prototype.eat !== 'function') { warn('跳过心蕊啃食减伤：Plant 上没有 eat'); return null; }

    const rec = methodRecord(Plant, 'eat');
    const SCALE = Object.create(null);
    for (const k in CFG.bloomingheart.victimDamageScale) {
        SCALE[normalizeType(k)] = CFG.bloomingheart.victimDamageScale[k];
    }

    // 引擎：Plant.eat(dmg, zombie) -> this.dealDamage(dmg, 0)
    Plant.prototype.eat = function (dmg, zombie) {
        // 【运行期开关】关掉 ⇒ 原版啃食
        //   ⚠️ 必须是 `rec.original`（作用域里没有 `original` 这个名字）。
        //   曾写成 `original.call(...)` ⇒ 每次啃食都抛 ReferenceError ⇒ **所有植物无敌**（实机 203 次报错）。
        if (!featOn('bloomingheart')) return rec.original.call(this, dmg, zombie);
        const mult = SCALE[normalizeType(this.Plant_Type)];
        if (mult !== undefined && typeof dmg === 'number' && dmg > 0
            && zombie && zombie.BloomingHeartDefenceRateList
            && zombie.BloomingHeartDefenceRateList.length > 0) {
            dmg *= mult;
            if (dbgOn(CFG.bloomingheart.debugLog)) {
                log('心蕊DEBUFF减伤：' + this.Plant_Type + ' 啃食伤害 x' + mult
                    + '（僵尸 DEBUFF 层数 ' + zombie.BloomingHeartDefenceRateList.length + '）');
            }
        }
        return rec.original.call(this, dmg, zombie);
    };
    return rec;
}

/* =========================================================================
 * 9. 香水菇：香水火持续 13.5 秒（原版 9）+ 对本行僵尸施加 6 层心蕊 DEBUFF（带减防特效）
 *    钩子：PerfumeFire.updateAsJalapenoFire(dt, rect) —— GroundFiresManager 每帧逐火调用。
 *    粒度：（香水火实例 x 僵尸）—— 同一只僵尸被同一片火只施加一次；
 *          再种一次香水菇 = 新的一片火 = 能再叠 6 层。
 *    !! 私有标记，绝不能拿 BloomingHeartDefenceRateList.length 当「已施加」判据，
 *       否则心蕊先命中的僵尸会被整片火跳过。
 * =======================================================================*/
/** 香水菇：把「香水火」的持续时间改成 CFG（原版 9 秒是【硬编码】的）。
 *  引擎事实：PerfumeShroomPlant 的 _objdataOwn 是 JalapenoProps 的子类，构造时写死 `Duration=9`；
 *  它的 explode() 里读 `this._objdataOwn.Duration` 传给 burnFromLnC（决定火铺多久）⇒
 *  我们只要在 explode() 之前把这个字段改掉即可，别的什么都不用碰（不改类、不改数据表）。 */
function makePerfumeDurationPatch(PerfumeShroomPlant) {
    const want = CFG.perfumeshroom.fireDuration;
    if (!(want > 0)) return null;
    if (!PerfumeShroomPlant || !PerfumeShroomPlant.prototype) {
        warn('跳过香水菇火时长：拿不到 PerfumeShroomPlant（香水火保持原版 9 秒）');
        return null;
    }
    if (typeof PerfumeShroomPlant.prototype.explode !== 'function') {
        warn('跳过香水菇火时长：PerfumeShroomPlant 上没有 explode（香水火保持原版 9 秒）');
        return null;
    }
    const rec = methodRecord(PerfumeShroomPlant, 'explode');
    PerfumeShroomPlant.prototype.explode = function () {
        if (!featOn('perfumeshroom')) return rec.original.apply(this, arguments);   // 【运行期开关】
        try {
            if (this._objdataOwn && this._objdataOwn.Duration !== want) this._objdataOwn.Duration = want;
        } catch (e) { /* 拿不到就按原版跑，不影响功能 */ }
        return rec.original.apply(this, arguments);
    };
    return [rec];
}

function makePerfumeShroomPatch(Fire, Square, Zombie, GroundFiresManager, buff) {
    if (!Fire || !Fire.prototype) { warn('跳过香水菇：拿不到 PerfumeFire'); return null; }
    if (typeof Fire.prototype.updateAsJalapenoFire !== 'function') {
        warn('跳过香水菇：PerfumeFire 上没有 updateAsJalapenoFire');
        return null;
    }
    if (!Square || typeof Square.getLane !== 'function') { warn('跳过香水菇：拿不到 Square.getLane'); return null; }

    const recFire = methodRecord(Fire, 'updateAsJalapenoFire');
    const recPush = (Zombie && Zombie.prototype && typeof Zombie.prototype.pushBloomingHeartDefenceRateList === 'function')
        ? methodRecord(Zombie, 'pushBloomingHeartDefenceRateList') : null;
    const baseSetPerfume = (Zombie && Zombie.prototype && typeof Zombie.prototype.setPerfume === 'function')
        ? Zombie.prototype.setPerfume : null;

    const recs = [recFire];
    let fireSeq = 0, applied = 0;

    // ！！一次香水菇会生成【十几片】火：addLaneFire 以中心格为原点、左右各铺 9 格
    //    （split 风格：1 + 9 左 + 9 右 = 最多 19 片），而 GroundFiresManager.update 每帧对
    //    【每一片】火都调一次 updateAsJalapenoFire。所以「已施加」的标记必须按【一次施放】
    //    而不是按【一片火】—— 否则一只僵尸会被 19 片火各叠 7 层 = 95 层，
    //    受伤倍率 (1/0.9)^95 ≈ 23000 倍，一颗豌豆秒一切。（这就是实测到的 BUG）
    //
    //    一次施放 = 一个 jalapenoFire 对象，它创建完所有火之后会调
    //    GroundFiresManager.registerJalapenoFire(jf) 把这一批 groundFires 一起注册进来，
    //    就在这里给这批火打上同一个 cast id。
    if (GroundFiresManager && GroundFiresManager.prototype
        && typeof GroundFiresManager.prototype.registerJalapenoFire === 'function') {
        const recReg = methodRecord(GroundFiresManager, 'registerJalapenoFire');
        GroundFiresManager.prototype.registerJalapenoFire = function (jf) {
            try {
                if (jf) {
                    const id = ++fireSeq;
                    jf.__gpnCastId = id;
                    const fs = jf.groundFires;
                    if (fs && fs.length) {
                        for (let i = 0; i < fs.length; i++) if (fs[i]) fs[i].__gpnCastId = id;
                    }
                }
            } catch (e) { warn('登记香水火批次出错', e); }
            return recReg.original.apply(this, arguments);
        };
        recs.push(recReg);
    } else {
        warn('拿不到 GroundFiresManager.registerJalapenoFire，香水菇会退化成「每片火各叠 '
            + CFG.perfumeshroom.layers + ' 层」（会过强）');
    }

    // 兜底取特效：真实心蕊命中时它会把 prefab 传进来，顺手缓存
    if (recPush) {
        Zombie.prototype.pushBloomingHeartDefenceRateList = function (list, par) {
            if (!featOn('perfumeshroom')) return recPush.original.call(this, list, par);   // 【运行期开关】
            if (par && !buff.par) { buff.par = par; log('减防特效 prefab 已缓存（来自真实心蕊命中）'); }
            return recPush.original.call(this, list, par);
        };
        recs.push(recPush);
    }

    // 「对香水免疫」= 把 setPerfume 覆写成空函数的那几类僵尸
    // （运输机/雪橇车/铜人像/未来护盾/天空电池…）
    const perfumeImmune = (z) => {
        if (!baseSetPerfume) return false;
        try { return typeof z.setPerfume === 'function' && z.setPerfume !== baseSetPerfume; }
        catch (e) { return false; }
    };

    const layerList = [];
    for (let i = 0; i < CFG.perfumeshroom.layers; i++) layerList.push(CFG.bloomingheart.debuffLayer);

    Fire.prototype.updateAsJalapenoFire = function (dt, rect) {
        if (!featOn('perfumeshroom')) return recFire.original.call(this, dt, rect);   // 【运行期开关】
        const r = recFire.original.call(this, dt, rect);
        try {
            if (!this.dead && this.inLnC) {
                const lane = Square.getLane(this.inLnC.lIndex);
                const pool = lane && typeof lane.zombiePool === 'function' ? lane.zombiePool() : null;
                if (pool && pool.length) {
                    // 优先用「一次施放」的 id；万一这片火没赶上注册，就给它自己一个 id（仍然只叠一次）
                    const fid = this.__gpnCastId || (this.__gpnFireId = this.__gpnFireId || ++fireSeq);
                    const arr = pool.concat ? pool.concat() : pool;
                    for (let i = 0; i < arr.length; i++) {
                        const z = arr[i];
                        if (!z || typeof z.pushBloomingHeartDefenceRateList !== 'function') continue;
                        const list = z.BloomingHeartDefenceRateList;
                        // 对象池复用检测：DEBUFF 数组被清空 = 这是新的一条命 -> 丢掉旧的火 id 记录
                        if (z.__gpnFires && list && list.length === 0) z.__gpnFires = null;
                        if (!z.__gpnFires) z.__gpnFires = Object.create(null);
                        if (z.__gpnFires[fid]) continue;
                        if (perfumeImmune(z)) { z.__gpnFires[fid] = true; continue; }
                        z.__gpnFires[fid] = true;
                        z.pushBloomingHeartDefenceRateList(layerList, buff.par || null);
                        applied++;
                        if (dbgOn(CFG.perfumeshroom.debugLog) && (applied === 1 || applied % 25 === 0)) {
                            log('香水火 -> 僵尸施加 ' + CFG.perfumeshroom.layers + ' 层心蕊DEBUFF（累计 '
                                + applied + ' 次，特效' + (buff.par ? '有' : '无') + '）');
                        }
                    }
                }
            }
        } catch (e) { warn('香水火施加 DEBUFF 出错', e); }
        return r;
    };

    return recs;
}

/* =========================================================================
 * 10. 减防特效 prefab：从 resources bundle 按路径取心蕊普攻子弹，
 *     再读它组件上的 BloomingHeartBuffPar。这样【不依赖心蕊出过手】。
 * =======================================================================*/
function findPropInNode(node, prop) {
    if (!node) return null;
    try {
        const comps = node.components || node._components || [];
        for (let i = 0; i < comps.length; i++) {
            const c = comps[i];
            if (c && c[prop]) return c[prop];
        }
        const kids = node.children || node._children || [];
        for (let i = 0; i < kids.length; i++) {
            const r = findPropInNode(kids[i], prop);
            if (r) return r;
        }
    } catch (e) { }
    return null;
}

function loadBloomingHeartBuffPrefab(cc, buff) {
    const mgr = cc && cc.assetManager;
    const Prefab = cc && cc.Prefab;
    if (!mgr || !Prefab) { warn('拿不到 cc.assetManager / cc.Prefab，减防特效会缺失'); return; }

    const path = CFG.perfumeshroom.buffPrjPath;
    const take = (bundle) => {
        try {
            bundle.load(path, Prefab, (err, prefab) => {
                if (err || !prefab) { warn('加载 ' + path + ' 失败：' + (err && err.message)); return; }
                const par = findPropInNode(prefab.data || prefab._data, 'BloomingHeartBuffPar');
                if (par) {
                    buff.par = par;
                    log('减防特效 prefab 已取得：' + (par.name || par._name || '(unnamed)')
                        + '（来自 ' + path + '）');
                } else {
                    warn(path + ' 上没找到 BloomingHeartBuffPar');
                }
            });
        } catch (e) { warn('取减防特效 prefab 出错', e); }
    };

    try {
        const bundles = mgr.bundles;
        let b = null;
        if (bundles) {
            if (typeof bundles.get === 'function') b = bundles.get('resources');
            if (!b && bundles._assets) b = bundles._assets['resources'];
        }
        if (b) { log('resources bundle 已加载，直接取减防特效'); take(b); return; }
        mgr.loadBundle('resources', (err, bundle) => {
            if (err || !bundle) { warn('加载 resources bundle 失败：' + (err && err.message)); return; }
            take(bundle);
        });
    } catch (e) { warn('取减防特效 prefab 出错', e); }
}

/* =========================================================================
 * 11. 高坚果：同原始坚果 —— 每次砸击扣 25% 最大血，能扛住 3 次巨人砸击
 *     TallNut.ts 自己没有 normalSmash，继承自 WallNut.ts 的「一砸就死」版；
 *     原始坚果 PrimalWallNut 就是靠重写 normalSmash 实现「扛 3 次」，直接复用它的逻辑。
 *     挂在 WallNut 基类 + Plant_Type 判定，不会波及坚果/全息坚果/花生等。
 * =======================================================================*/
function makeTallnutPatch(WallNut, PrimalWallNut, TallNutClass) {
    if (!WallNut || !WallNut.prototype) { warn('跳过高坚果：拿不到 WallnutPlant'); return null; }
    if (typeof WallNut.prototype.normalSmash !== 'function') {
        warn('跳过高坚果：WallnutPlant 上没有 normalSmash');
        return null;
    }
    const KEY = normalizeType(CFG.tallnut.plantType);
    const rec = methodRecord(WallNut, 'normalSmash');
    const primal = (PrimalWallNut && PrimalWallNut.prototype
        && typeof PrimalWallNut.prototype.normalSmash === 'function')
        ? PrimalWallNut.prototype.normalSmash : null;
    const dbg = () => !!(CFG.tallnut && CFG.tallnut.debugLog);
    /* ★ 按【类】匹配（`instanceof TallNutPlant`）为主、`Plant_Type` 字符串为辅：
     *   用户反馈"镜面坚果挑战第 4 关高坚果扛砸失效、其他关正常" ⇒ 关卡内可能给的不是 'tallnut' 字符串。 */
    const isTall = function (p) {
        if (!p) return false;
        try { if (TallNutClass && (p instanceof TallNutClass)) return true; } catch (e) { /* 忽略 */ }
        try { return normalizeType(p.Plant_Type) === KEY; } catch (e) { return false; }
    };
    log('[高坚果] 已装 ｜ KEY=' + KEY + ' ｜ primal=' + (primal ? '有' : '无') + ' ｜ TallNut 类=' + (TallNutClass ? '有' : '无'));

    WallNut.prototype.normalSmash = function (attacker) {
        const tall = isTall(this);
        if (dbg()) {
            try {
                const ctor = (this && this.constructor && this.constructor.name) || '?';
                log('[高坚果·砸] type=' + String(this && this.Plant_Type)
                    + ' ｜ cls=' + ctor
                    + ' ｜ 判定=' + (tall ? '高坚果' : '非高坚果')
                    + ' ｜ hp=' + (this && this.health) + '/' + (this && this.toughness)
                    + ' ｜ armor=' + (this && this.armorHealth) + '/' + (this && this.armorToughness)
                    + ' ｜ hurtStage=' + (this && this.hurtStage)
                    + ' ｜ fooding=' + !!(this && this.fooding) + ' ｜ inv=' + !!(this && this.invincible)
                    + ' ｜ 攻击者=' + String(attacker && attacker.Zombie_Type));
            } catch (e) { /* 忽略 */ }
        }
        if (!tall) return rec.original.call(this, attacker);
        if (!featOn('tallnut')) return rec.original.call(this, attacker);   // 【运行期开关】关掉 ⇒ 原版砸击
        if (primal) return primal.call(this, attacker);
        // 兜底内联（PrimalWallNut 没导入成功时）
        if (this.fooding || this.invincible) return;
        if (this.armorHealth > 0) { this.armorHealth = 0; this.foodable = true; this.setArmor(); return; }
        const q = this.toughness * CFG.tallnut.smashHpFraction;
        let hp = this.health;
        while (hp - q > 0) hp -= q;
        this.dealNormalDamage(hp);
    };

    /* 诊断：高坚果真的死亡时打一行（看是不是"砸"这条路杀的） */
    if (typeof WallNut.prototype.die === 'function') {
        const recDie = methodRecord(WallNut, 'die');
        WallNut.prototype.die = function () {
            if (dbg() && isTall(this)) {
                try {
                    log('[高坚果·死] type=' + String(this.Plant_Type) + ' ｜ hp=' + this.health
                        + ' ｜ hp/最大=' + (this.health / this.toughness).toFixed(3)
                        + ' ｜ hurtStage=' + this.hurtStage + ' ｜ armor=' + this.armorHealth);
                } catch (e) { /* 忽略 */ }
            }
            return recDie.original.apply(this, arguments);
        };
        return [rec, recDie];
    }
    return rec;
}
/* =========================================================================
 * 卷心菜投手：子弹**首次命中后再弹一次**（用户 2026/10/22 指定）
 *   · 普攻 / 大招的卷心菜，**首次命中**（僵尸 / 障碍物 / 被弄臣·三节棍反弹后打中植物）后，
 *     向**子弹当时的前进方向**再弹 **1 格**（正常向右、被反弹后向左）；
 *   · **不索敌**：落点 = 命中点 ± bounceCells 格（允许落在草坪外）；
 *   · 伤害与首弹**相同**（复用同一条弹道类型 ⇒ 40 / 300 / 薄荷 120 天然一致）；
 *   · **只弹一次**（第二发的标记 done=true；不会链式）；
 *   · 炸药桶（ID 17）不触发（与 MOD 现有障碍物白名单同口径）；
 *   · 命中特效/音效 = 引擎原生（同一条弹道类型，照样触发）。
 *  实现：
 *   ① 在 `CabbagePultPlant._lobToZombie/_lobToTomb/_lobToPos` 的**返回弹道**上打标记
 *      （只对 Plant_Type 归一化 = cabbagepult 生效 —— 心蕊等也继承这个类，必须按类型排除）；
 *   ② 在 `CommonShot.onZombieHit/onTombHit/onPlantHit` 里查标记 ⇒ 用
 *      `lobOneCabbageOnPos` 生成"固定落点"的第二发，并打 done=true。
 * =======================================================================*/
function makeCabbagePultPatch(CommonShot, deps) {
    const D = deps || {};
    const recs = [];
    if (!CommonShot || !CommonShot.prototype) {
        warn('跳过卷心菜投手：拿不到 commonShot');
        return recs;
    }
    const Pf = D.PrjFunctions;
    const CABBAGE_TYPES = ['cabbage', 'cabbage1', 'cabbage2', 'cabbage_pf'];
    const dbg = function () { try { return !!(CFG.cabbagepult && CFG.cabbagepult.debugLog); } catch (e) { return false; } };

    const markShot = function (p, type) {
        if (!p) return;
        const set = function (prj) {
            if (!prj) return;
            try { prj.__gpnCabbageBounce = { type: type, done: false }; } catch (e) { /* 忽略 */ }
            if (dbg()) log('[卷心菜] 发射：已标记 类型=' + type + ' vx=' + (prj.linearVelocity && prj.linearVelocity.x));
        };
        try {
            if (typeof p.then === 'function') p.then(set, function (e) { if (dbg()) log('[卷心菜] 发射 promise 失败：' + e); });
            else set(p);
        } catch (e) { /* 忽略 */ }
    };

    /* ★ 打标点：PrjFunctions.lobOneCabbageOnPos（_lobTo* 是 async 且不返回弹道；
     *   这里是所有投掷的最终出口、且会返回弹道）。按弹道类型过滤（只有卷心菜用 cabbage*）。 */
    let savedLobPos = null;
    let savedAcc = null;
    if (Pf && typeof Pf.lobOneCabbageOnPos === 'function') {
        savedLobPos = Pf.lobOneCabbageOnPos;
        Pf.lobOneCabbageOnPos = function (type) {
            const p = savedLobPos.apply(this, arguments);
            try {
                if (featOn('cabbagepult') && CABBAGE_TYPES.indexOf(type) !== -1) markShot(p, type);
            } catch (e) { /* 忽略 */ }
            return p;
        };
        recs.push({ restore: function () { try { Pf.lobOneCabbageOnPos = savedLobPos; } catch (e) { /* 忽略 */ } } });
    } else {
        warn('跳过卷心菜投手：拿不到 PrjFunctions.lobOneCabbageOnPos（弹跳无法打标记）');
        return recs;
    }
    if (typeof Pf.lobOneCabbageOnPosAccCS === 'function') savedAcc = Pf.lobOneCabbageOnPosAccCS;
    else warn('卷心菜投手：拿不到 lobOneCabbageOnPosAccCS（将退回"新建弹道"模式，视觉会略硬）');

    /** 命中回调里触发一次"同一颗子弹原地续飞"（AKEE 同款） */
    const bounceFrom = function (shot, target) {
        const st = shot && shot.__gpnCabbageBounce;
        if (!st || st.done || !st.type) return;
        st.done = true;                                  // ★ 先落闸：只会弹一次
        const C = CFG.cabbagepult || {};
        const cells = (typeof C.bounceCells === 'number' && C.bounceCells > 0) ? C.bounceCells : 1;
        const blSec = (typeof C.blacklistSeconds === 'number' && C.blacklistSeconds > 0) ? C.blacklistSeconds : 0.5;
        const Sq = D.Square;
        const SW = (Sq && typeof Sq.SquareWidth === 'number') ? Sq.SquareWidth : 68;
        const Vec2 = D.Vec2;
        if (!Vec2) { warn('卷心菜弹跳：拿不到 Vec2'); return; }
        const lane = shot.inLane || null;
        const vx = (shot.linearVelocity && typeof shot.linearVelocity.x === 'number') ? shot.linearVelocity.x : 0;
        let dir = (vx < -0.001) ? -1 : 1;                 // 被反射后向左飞 ⇒ 向左弹
        if (Math.abs(vx) <= 0.001 && D.CharacterType) dir = (shot.enemyType === D.CharacterType.plant) ? -1 : 1;
        const fromX = (typeof shot.worldPositionX === 'number') ? shot.worldPositionX : 0;
        const targetX = fromX + dir * cells * SW;         // ★ 落点 = 命中点 ± 1 格（允许出草坪）
        const targetY = (lane && typeof lane.floorY === 'number') ? lane.floorY : shot.worldPositionY;
        const layer = (shot.node && shot.node.parent) ? shot.node.parent : (lane && lane.prjLayer);
        const startPos = shot.worldPosition || { x: fromX, y: targetY };   // ★ 起点 = 命中点（原位置，无瞬移）
        const height = Math.max(0, (typeof shot.height === 'number') ? shot.height : 0);   // 起始高度**不变**（保持视觉连续）
        /* ★ 普攻弹道 1/2、大招弹道（cabbage_pf）恢复 1 倍（用户 2026/10/22） */
        const isPF = (st.type === 'cabbage_pf');
        const gScale = isPF
            ? ((typeof C.bounceGravityScalePlantfood === 'number' && C.bounceGravityScalePlantfood > 0) ? C.bounceGravityScalePlantfood : 1)
            : ((typeof C.bounceGravityScale === 'number' && C.bounceGravityScale > 0) ? C.bounceGravityScale : 0.7);
        /* ★ 弹起高度由续飞重力决定（弧峰 ∝ 重力）：重力 ×1/2 ⇒ 弧线高度 ≈ 1/2，飞行时间/落点不变 */
        const grav = ((typeof shot.gravity === 'number' && shot.gravity > 0) ? shot.gravity : 0.4444) * gScale;
        if (dbg()) {
            log('[卷心菜弹跳] 类型=' + st.type + ' 方向=' + (dir > 0 ? '右' : '左')
                + ' 命中x=' + Math.round(fromX) + ' 落点x=' + Math.round(targetX)
                + ' 目标=' + (target && (target.Zombie_Type || target.Plant_Type || target.ID || '?')));
        }
        try {
            if (savedAcc) {
                /* ★ 同一颗子弹续飞：位置/高度/重力/节点全不变（无瞬移），落点 ±1 格 */
                shot.__gpnCabbageSkipPop = true;          // 紧跟其后的引擎 pop() 会被吞掉（不销毁）
                savedAcc.call(Pf, shot, startPos, height, layer,
                    new Vec2(targetX, targetY), grav, shot.enemyType, 60, 0, false);
                shot.targetLocked = null;
                shot.detectEnemyOn = true;
                if (target && blSec > 0) {
                    shot.__gpnCabbageExclude = (shot.__gpnCabbageExclude || []).concat([{ obj: target, until: Date.now() + blSec * 1000 }]);
                }
                if (dbg()) log('[卷心菜弹跳] 同一颗续飞（黑名单 ' + blSec + 's 防双命中）');
            } else {
                /* 兜底：没有 AccCS ⇒ 新建一颗，出生点仍是**命中点**（不是边缘） */
                const p = savedLobPos.call(Pf, st.type, startPos, height, layer,
                    new Vec2(targetX, targetY), grav, shot.enemyType, 60, 0, false, false);
                const done = function (prj) {
                    if (!prj) return;
                    try { prj.__gpnCabbageBounce = { type: st.type, done: true }; } catch (e) { /* 忽略 */ }
                };
                try {
                    if (p && typeof p.then === 'function') p.then(done, function () { });
                    else done(p);
                } catch (e) { /* 忽略 */ }
            }
        } catch (e) {
            try { shot.__gpnCabbageSkipPop = false; } catch (e2) { /* 忽略 */ }
            warn('卷心菜弹跳：续飞/生成第二发出错', e);
        }
    };

    /* ★ pop 拦截：续飞后引擎会立刻 pop()，这里**只吞一次**（并补放命中粒子/音效） */
    const recPop = methodRecord(CommonShot, 'pop');
    CommonShot.prototype.pop = function () {
        try {
            if (this && this.__gpnCabbageSkipPop) {
                this.__gpnCabbageSkipPop = false;
                try { if (typeof this.playParticle === 'function') this.playParticle(); } catch (e) { /* 忽略 */ }
                try { if (typeof this.playPopSound === 'function') this.playPopSound(); } catch (e) { /* 忽略 */ }
                if (dbg()) log('[卷心菜弹跳] 吞掉一次 pop（继续飞）');
                return;
            }
            if (this) this.__gpnCabbageExclude = null;
        } catch (e) { /* 忽略 */ }
        return recPop.original.apply(this, arguments);
    };
    recs.push(recPop);

    /* ★ 检测层黑名单：0.5 秒内不把"刚被首弹命中"的目标算进来（也不会因此 pop） */
    if (typeof CommonShot.prototype.detectEnemyNormal === 'function') {
        const recDetect = methodRecord(CommonShot, 'detectEnemyNormal');
        CommonShot.prototype.detectEnemyNormal = function () {
            let lane = null, excluded = null;
            try {
                const self = this;
                if (featOn('cabbagepult') && self && self.__gpnCabbageExclude && self.__gpnCabbageExclude.length && self.inLane) {
                    const now = Date.now();
                    self.__gpnCabbageExclude = self.__gpnCabbageExclude.filter(function (e) { return e && e.until > now; });
                    const live = [];
                    for (const e of self.__gpnCabbageExclude) live.push(e.obj);
                    if (live.length) { lane = self.inLane; excluded = live; }
                }
            } catch (e) { /* 忽略 */ }
            if (!lane || !excluded) return recDetect.original.apply(this, arguments);
            const saved = {};
            const shadow = function (name) {
                if (typeof lane[name] !== 'function') return;
                saved[name] = lane[name];
                lane[name] = function () {
                    const arr = saved[name].apply(lane, arguments);
                    if (!Array.isArray(arr)) return arr;
                    return arr.filter(function (x) { return excluded.indexOf(x) === -1; });
                };
            };
            try {
                shadow('zombiePool'); shadow('hypnoZombiePool'); shadow('plantPool'); shadow('tombPool');
                return recDetect.original.apply(this, arguments);
            } finally {
                const ks = Object.keys(saved);
                for (let i = 0; i < ks.length; i++) { try { lane[ks[i]] = saved[ks[i]]; } catch (e) { /* 忽略 */ } }
            }
        };
        recs.push(recDetect);
    }

    const wrapHit = function (name) {
        if (typeof CommonShot.prototype[name] !== 'function') return;
        const rec = methodRecord(CommonShot, name);
        CommonShot.prototype[name] = function (target) {
            try {
                if (this && this.__gpnCabbageBounce && dbg()) {
                    log('[卷心菜] 命中回调 ' + name + ' 标记类型=' + this.__gpnCabbageBounce.type
                        + ' done=' + this.__gpnCabbageBounce.done + ' vx=' + (this.linearVelocity && this.linearVelocity.x));
                }
                if (featOn('cabbagepult') && this && this.__gpnCabbageBounce) {
                    /* 炸药桶（ID 17）不触发：与 MOD 现有障碍物白名单同口径 */
                    const skip = (name === 'onTombHit' && target
                        && typeof gpnMeteorTombIsBlacklisted === 'function'
                        && gpnMeteorTombIsBlacklisted(target.ID));
                    if (!skip) bounceFrom(this, target);
                }
            } catch (e) { /* 忽略 */ }
            return rec.original.apply(this, arguments);
        };
        recs.push(rec);
    };
    wrapHit('onZombieHit'); wrapHit('onTombHit'); wrapHit('onPlantHit');
    log('[卷心菜投手] 弹跳补丁已装（命中回调 + pop 拦截 + 检测黑名单，共 ' + recs.length + ' 个钩子）');
    return recs;
}
/* =========================================================================
 * 13. 暗影油桃：毒气时长 x2 / 攻击 x0.5
 *     这几个值在 props 类的【构造函数】里（不是 JSON 数据），所以要在实例上重写。
 *     最稳的时机是 explode() 之前 —— explode() 就是读这些值去生成毒气云的。
 *     注意：Lifespan 同时驱动"3x3 范围植物获得影子 buff"的持续时间，所以影子 buff 也会一起翻倍。
 * =======================================================================*/
/** 毒气云的每跳伤害再钳一道：不管是谁建的云、谁来设的数值，出手时都按 CFG 取。
 *  这样即使 explode() 没被调到（或顺序不对），伤害也一定是我们想要的值。 */
function makeNoctarineGasPatch(Particle) {
    if (!Particle || !Particle.prototype || typeof Particle.prototype._attack !== 'function') {
        warn('跳过暗影油桃毒气钳制：拿不到 _attack');
        return null;
    }
    const rec = methodRecord(Particle, '_attack');
    Particle.prototype._attack = function () {
        // SlowsZombies 是暗影态标记（explode() 里赋的）
        if (!featOn('noctarine')) return rec.original.apply(this, arguments);   // 【运行期开关】关掉 ⇒ 原版毒气伤害
        const v = this.SlowsZombies ? CFG.noctarine.shadowAttackDamage : CFG.noctarine.normalAttackDamage;
        const keep = this.AttackDamage;
        if (v > 0) this.AttackDamage = v;
        try {
            return rec.original.apply(this, arguments);
        } finally {
            this.AttackDamage = keep;
        }
    };
    return rec;
}

function makeNoctarinePatch(NoctarinePlant) {
    if (!NoctarinePlant || !NoctarinePlant.prototype) { warn('跳过暗影油桃：拿不到 NoctarinePlant'); return null; }
    if (typeof NoctarinePlant.prototype.explode !== 'function') { warn('跳过暗影油桃：没有 explode'); return null; }

    const rec = methodRecord(NoctarinePlant, 'explode');
    NoctarinePlant.prototype.explode = gpnGatedBody(rec.original, 'noctarine', function () {
        const od = this.objdataOwn;
        if (od) {
            if (CFG.noctarine.normalLifespan > 0) od.NormalLifespan = CFG.noctarine.normalLifespan;
            if (CFG.noctarine.shadowLifespan > 0) od.ShadowLifespan = CFG.noctarine.shadowLifespan;
            if (CFG.noctarine.normalAttackDamage > 0) od.NormalAttackDamage = CFG.noctarine.normalAttackDamage;
            if (CFG.noctarine.shadowAttackDamage > 0) od.ShadowAttackDamage = CFG.noctarine.shadowAttackDamage;
            if (dbgOn(CFG.noctarine.debugLog)) {
                log('暗影油桃：毒气时长 ' + od.NormalLifespan + '/' + od.ShadowLifespan
                    + ' 秒，每秒伤害 ' + od.NormalAttackDamage + '/' + od.ShadowAttackDamage);
            }
        }
        return rec.original.apply(this, arguments);
    });
    return rec;
}

/* =========================================================================
 * 14. 腐尸豆荚：召唤权重（新增城堡头僵尸 / 超新星巨尸）
 *     权重表不在 JSON 里，在 ZoybeanPodProps 的【构造函数】里，是实例字段：
 *         SummonType        = [{Weight:50,zoybean},{Weight:30,armor1},{Weight:20,armor2}]
 *         SummonTypePlantfood = [{Weight:1, zoybean_gargantuar}]
 *     summon() 每次召唤前会读 this.objdataOwn.SummonType(Plantfood)，所以钩 summon 最稳
 *     （对象池复用也照样生效）。
 * =======================================================================*/
function makeZoybeanPatch(ZoybeanPodPlant) {
    if (!ZoybeanPodPlant || !ZoybeanPodPlant.prototype) { warn('跳过腐尸豆荚：拿不到 ZoybeanPodPlant'); return null; }
    if (typeof ZoybeanPodPlant.prototype.summon !== 'function') { warn('跳过腐尸豆荚：没有 summon'); return null; }

    const rec = methodRecord(ZoybeanPodPlant, 'summon');
    ZoybeanPodPlant.prototype.summon = gpnGatedBody(rec.original, 'zoybeanpod', function () {
        const od = this.objdataOwn;
        if (od) {
            // 每次都重写（不依赖上次的状态，池化复用也安全）
            od.SummonType = CFG.zoybeanpod.summon.map((x) => ({ Weight: x.Weight, Type: x.Type }));
            od.SummonTypePlantfood = CFG.zoybeanpod.plantfood.map((x) => ({ Weight: x.Weight, Type: x.Type }));
            if (!gpnZoyTableLogged && dbgOn(CFG.zoybeanpod.debugLog)) {
                gpnZoyTableLogged = true;
                log('腐尸豆荚召唤表：' + (this.fooding ? '大招' : '普通') + ' -> '
                    + (this.fooding ? od.SummonTypePlantfood : od.SummonType)
                        .map((x) => x.Type + '(' + x.Weight + ')').join(' '));
            }
        }
        return rec.original.apply(this, arguments);
    });
    return rec;
}

/* =========================================================================
 * 15. 蒲公英：索敌优化 + 额外子弹 + 对飞行/BOSS 加成
 *
 *   引擎事实（0.14.0）：
 *     - 三种弹道：dandelion（普攻）/ dandelion_blew（吹风反应）/ dandelion_pf（大招空投）。
 *     - 普攻 "Shoot" -> this._shoot(PeaType, this.getEnemyLane())；
 *       引擎原本的 getEnemyLane 是「把 3 个探测框 shuffle 后取第一个有僵尸/墓碑的」⇒ 随机行。
 *     - detectEnemy() 决定「开不开火」：3 个探测框里有僵尸或墓碑就开火。
 *     - _shoot(pea, off)：只有 |off| == 1 才做跨行抛物线，0 / -2 都是直射。
 *     - blew（吹风恢复期）里 getEnemyLane 直接返回 -2（保留引擎语义）。
 *
 *   本 MOD 的规则：
 *     ① 第一子弹：本行活僵尸 > 相邻行"最靠房子"的活僵尸 > 本行可见障碍
 *                 > 相邻行"最靠房子"的可见障碍 > 不开火。
 *        僵尸优先于障碍；都不比较行号，只比"最靠房子"（x 最小）；并列随机。
 *     ② 第二颗子弹：候选（含本行）里"最靠房子"的活僵尸 > "最靠房子"的可见障碍 > 不发。
 *        延迟 CFG.dandelion.extraDelay（0.4 秒），开火那一刻才重新挑行。
 *     ③ 对飞行僵尸 / 指定 BOSS 的加成：按「被这发子弹伤害到的每一只僵尸」逐个判定
 *        （直击 + 爆炸/溅射都算）：
 *          · flying（z.flying === true，临时 flying 也算）且非 BOSS -> 伤害 ×2 + 眩晕
 *            （普攻/吹风 1 秒、大招 5 秒）
 *          · bossTypes 名单里的 BOSS -> 伤害 ×2、不眩晕
 *          · 其它 BOSS -> 原样（不 ×2、不眩晕）
 * =======================================================================*/

/** 取目标的世界 x（拿不到返回 NaN） */
function gpnTargetX(o) {
    if (!o) return NaN;
    try {
        if (typeof o.worldPositionX === 'number' && isFinite(o.worldPositionX)) return o.worldPositionX;
        if (o.worldPosition && typeof o.worldPosition.x === 'number' && isFinite(o.worldPosition.x)) return o.worldPosition.x;
        if (o.node && o.node.worldPosition && typeof o.node.worldPosition.x === 'number' && isFinite(o.node.worldPosition.x)) return o.node.worldPosition.x;
        if (o.bodyRec && typeof o.bodyRec.prjX === 'function') {
            const r = o.bodyRec.prjX();
            if (r && typeof r.x === 'number' && isFinite(r.x)) return r.x;
        }
    } catch (e) { }
    return NaN;
}

/** 蒲公英：把引擎的 3 个探测框（本行/上行/下行）整理成候选行
 *  僵尸：isAlive() + bodyRecForShooter 与框相交；障碍：isAlive() + 非 hidden/_hidden + bodyRec 相交 */
function gpnDandelionCandidates(plant) {
    const out = [];
    if (!plant || !Array.isArray(plant.detectors)) return out;
    const cur = (typeof plant.lIndex === 'number') ? plant.lIndex : null;
    for (const d of plant.detectors) {
        if (!d || !d.inLane || !d.rec || typeof d.rec.judgeCrossRec !== 'function') continue;
        const lane = d.inLane;
        const li = (typeof lane.LaneIndex === 'number') ? lane.LaneIndex : null;
        const off = (cur != null && li != null) ? (li - cur) : null;
        if (off == null || Math.abs(off) > 1) continue;
        const zombies = [];
        try {
            const zp = (typeof lane.zombiePool === 'function') ? lane.zombiePool() : null;
            if (zp && typeof zp.forEach === 'function') {
                zp.forEach((z) => {
                    if (!z) return;
                    if (typeof z.isAlive === 'function' && !z.isAlive()) return;
                    const body = z.bodyRecForShooter || z.bodyRec;
                    if (!body || !d.rec.judgeCrossRec(body)) return;
                    zombies.push({ z: z, x: gpnTargetX(z) });
                });
            }
        } catch (e) { }
        const tombs = [];
        try {
            let tp = null;
            try { tp = (typeof lane.tombPool === 'function') ? lane.tombPool(0) : null; } catch (e) { tp = null; }
            if (!tp && typeof lane.tombPool === 'function') tp = lane.tombPool();
            if (tp && typeof tp.forEach === 'function') {
                tp.forEach((t) => {
                    if (!t) return;
                    if (t.hidden || t._hidden) return;
                    if (typeof t.isAlive === 'function' && !t.isAlive()) return;
                    if (!t.bodyRec || !d.rec.judgeCrossRec(t.bodyRec)) return;
                    tombs.push({ t: t, x: gpnTargetX(t) });
                });
            }
        } catch (e) { }
        out.push({ off: off, zombies: zombies, tombs: tombs });
    }
    return out;
}

/** 在一组候选行里挑「目标最靠房子」的那一行；并列随机。field = 'zombies' | 'tombs' */
function gpnDandelionLeftmost(cands, field) {
    const items = [];
    for (const c of cands) {
        const arr = c[field] || [];
        for (const it of arr) items.push({ off: c.off, x: it.x });
    }
    if (!items.length) return null;
    let best = Infinity;
    for (const it of items) if (isFinite(it.x) && it.x < best) best = it.x;
    const pool = isFinite(best) ? items.filter((it) => isFinite(it.x) && it.x === best) : items;
    const offs = [];
    for (const it of pool) if (offs.indexOf(it.off) === -1) offs.push(it.off);
    return offs[Math.floor(Math.random() * offs.length)];
}

/** 第一子弹挑行：本行僵尸 > 相邻最靠房子僵尸 > 本行障碍 > 相邻最靠房子障碍 > null（不开火） */
function gpnDandelionPickLaneFirst(plant) {
    const cands = gpnDandelionCandidates(plant);
    if (!cands.length) return null;
    const own = cands.filter((c) => c.off === 0);
    const side = cands.filter((c) => c.off !== 0);
    if (own.some((c) => c.zombies.length)) return 0;
    const z = gpnDandelionLeftmost(side, 'zombies');
    if (z !== null) return z;
    if (own.some((c) => c.tombs.length)) return 0;
    const t = gpnDandelionLeftmost(side, 'tombs');
    if (t !== null) return t;
    return null;
}

/** 第二颗子弹挑行：候选（含本行）最靠房子僵尸 > 最靠房子障碍 > null（不发） */
function gpnDandelionPickLaneExtra(plant) {
    const cands = gpnDandelionCandidates(plant);
    if (!cands.length) return null;
    const z = gpnDandelionLeftmost(cands, 'zombies');
    if (z !== null) return z;
    return gpnDandelionLeftmost(cands, 'tombs');
}

/** 这只僵尸吃这发蒲公英弹的加成：返回 { mult, stun }；不适用返回 null */
function gpnDandelionHitInfo(z, kind) {
    if (!z) return null;
    const type = (z.Zombie_Type != null) ? String(z.Zombie_Type) : '';
    if (CFG.dandelion.bossTypes.indexOf(type) !== -1) {
        return { mult: CFG.dandelion.bossDamageScale, stun: 0 };
    }
    if (z.isBoss) return null;                       // 其它 BOSS：原样（不眩晕）
    if (z.flying === true) {
        return {
            mult: CFG.dandelion.flyingDamageScale,
            stun: (kind === 'pf') ? CFG.dandelion.plantfoodFlyingStun : CFG.dandelion.flyingStun,
        };
    }
    return null;
}

function makeDandelionPatch(DandelionPlant, Square, CommonShot, deps) {
    if (!DandelionPlant || !DandelionPlant.prototype) { warn('跳过蒲公英：拿不到 DandelionPlant'); return null; }
    if (typeof DandelionPlant.prototype.animationListener !== 'function') {
        warn('跳过蒲公英：没有 animationListener');
        return null;
    }
    const out = [];

    // ---- ① 索敌：第一子弹 ----
    if (typeof DandelionPlant.prototype.getEnemyLane === 'function') {
        const recLane = methodRecord(DandelionPlant, 'getEnemyLane');
        DandelionPlant.prototype.getEnemyLane = function () {
            try {
                if (!featOn('dandelion')) return recLane.original.apply(this, arguments);   // 【运行期开关】关掉 ⇒ 原版索敌
                if (this.blew) return -2;                              // 吹风恢复期：保留引擎语义
                if (this.isAirRaidPlant) return recLane.original.apply(this, arguments);
                const off = gpnDandelionPickLaneFirst(this);
                return (off === null) ? -2 : off;
            } catch (e) { warn('蒲公英索敌出错', e); }
            return recLane.original.apply(this, arguments);
        };
        out.push(recLane);
    } else {
        warn('跳过蒲公英索敌：没有 getEnemyLane');
    }

    // ---- ② 开火门：和挑行用同一套过滤（活僵尸 / 可见障碍）----
    if (typeof DandelionPlant.prototype.detectEnemy === 'function') {
        const recDet = methodRecord(DandelionPlant, 'detectEnemy');
        DandelionPlant.prototype.detectEnemy = function () {
            if (!featOn('dandelion')) return recDet.original.apply(this, arguments);   // 【运行期开关】关掉 ⇒ 原版索敌（不再额外一颗子弹）
            try {
                return gpnDandelionCandidates(this).some((c) => c.zombies.length || c.tombs.length);
            } catch (e) { warn('蒲公英索敌出错', e); }
            return recDet.original.apply(this, arguments);
        };
        out.push(recDet);
    }

    // ---- ③ 第二颗子弹：延迟 + 新挑行 + 无候选不发 ----
    const rec = methodRecord(DandelionPlant, 'animationListener');
    DandelionPlant.prototype.animationListener = function (e) {
        const r = rec.original.apply(this, arguments);
        if (!featOn('dandelion')) return r;   // 【运行期开关】关掉 ⇒ 不再多发一颗子弹（这就是它真正的实现处）
        try {
            const n = CFG.dandelion.extraShots;
            if (n > 0 && e && e.name === 'Shoot' && !this.fooding && !this.isAirRaidPlant
                && typeof this._shoot === 'function' && this.objdataOwn) {
                const pea = this.objdataOwn.PeaType;
                if (pea) {
                    const self = this;
                    const fire = () => {
                        if (self.dead) return;
                        const off = gpnDandelionPickLaneExtra(self);
                        if (off === null) return;                       // 没有候选 -> 不发
                        for (let i = 0; i < n; i++) {
                            self._shoot(pea, off);
                            if (dbgOn(CFG.dandelion.debugLog)) log('蒲公英额外子弹：行偏移 ' + off);
                        }
                    };
                    const d = CFG.dandelion.extraDelay;
                    if (d > 0 && typeof this.scheduleOnce === 'function') this.scheduleOnce(fire, d);
                    else fire();
                }
            }
        } catch (err) { warn('蒲公英额外子弹出错', err); }
        return r;
    };
    out.push(rec);

    // ---- ④ 飞行 / 指定 BOSS：伤害 ×2 + 眩晕（按"被这发子弹伤害到的每一只僵尸"判定）----
    if (CommonShot && CommonShot.prototype && typeof CommonShot.prototype.dealDamageToZombie === 'function') {
        const recD = methodRecord(CommonShot, 'dealDamageToZombie');
        CommonShot.prototype.dealDamageToZombie = function (z, isDirect, details, o) {
            // 【运行期开关】关掉 ⇒ 不做"对飞行/BOSS 伤害×2 + 眩晕"（原样走引擎）
            if (!featOn('dandelion')) return recD.original.apply(this, arguments);
            let info = null;
            try {
                if (z && this.__gpnDandelionKind) info = gpnDandelionHitInfo(z, this.__gpnDandelionKind);
            } catch (e) { }
            if (!info) return recD.original.apply(this, arguments);
            if (info.stun > 0) {
                try { if (typeof z.setStun === 'function') z.setStun(info.stun); } catch (e) { }
            }
            const mult = Number(info.mult);
            if (!(mult > 1)) return recD.original.apply(this, arguments);
            const savedDamage = this.damage;
            try {
                if (details && typeof details.splashDamage === 'number') {
                    // 爆炸/溅射：只把【这一个目标】的伤害乘倍（克隆 details，不动原对象）
                    const clone = Object.assign(Object.create(Object.getPrototypeOf(details)), details);
                    clone.splashDamage = details.splashDamage * mult;
                    return recD.original.call(this, z, isDirect, clone, o);
                }
                // 直击（无 details）：引擎内部会 new ZombieDamageDetails(this.damage, ...)
                this.damage = savedDamage * mult;
                return recD.original.apply(this, arguments);
            } finally {
                this.damage = savedDamage;
            }
        };
        out.push(recD);
    } else if (CommonShot) {
        warn('跳过蒲公英加成：commonShot 上没有 dealDamageToZombie');
    }

    // ---- ⑨ 大招：驱离运兵艇（`sky_dropship`，云端堡垒）—— 用户 2026/10/16 指定：等同电离红掌 ----
    //   挂 `specialPlantFood`（**每次大招只调一次**）；不挂 `animationListener` 的 `foodShoot`
    //   （那个事件一次大招触发 3+ 次，会重复执行还要额外去重）。
    if (typeof DandelionPlant.prototype.specialPlantFood === 'function') {
        const recFood = methodRecord(DandelionPlant, 'specialPlantFood');
        DandelionPlant.prototype.specialPlantFood = function () {
            const r = recFood.original.apply(this, arguments);     // ★ 先原样调用（播 Food / 归零计数器）
            if (!featOn('dandelion') || !CFG.dandelion.pbDriveDropShip) return r;   // 【运行期开关】
            const run = function () {
                // 到点时再检查一次：万一这期间模组被卸载/重载，或者开关被关掉 ⇒ 不动手
                try {
                    if (typeof gpnDisposed !== 'undefined' && gpnDisposed) return;
                    if (!featOn('dandelion') || !CFG.dandelion.pbDriveDropShip) return;
                    gpnDandelionDriveDropShips(deps || {});
                } catch (e) { warn('蒲公英：大招驱离运兵艇出错（已忽略）', e); }
            };
            // ★ 延时（用户 2026/10/16：1.5 秒）—— 让"空投落地"的动画先演完，再把运兵艇赶走。
            //   用植物自己的 `scheduleOnce`（引擎原生调度；植物被销毁时它会自动取消）。
            const delay = Number(CFG.dandelion.pbDriveDelay) || 0;
            if (delay > 0) {
                let scheduled = false;
                try {
                    if (typeof this.scheduleOnce === 'function') { this.scheduleOnce(run, delay); scheduled = true; }
                } catch (e) { /* 退化到 setTimeout */ }
                if (!scheduled) { try { setTimeout(run, delay * 1000); } catch (e2) { run(); } }
            } else {
                run();
            }
            return r;
        };
        out.push(recFood);
    } else {
        warn('跳过蒲公英：没有 specialPlantFood（大招驱离运兵艇会失效）');
    }

    return out;
}

/* ==========================================================================
 * 蒲公英大招「驱离运兵艇」(`sky_dropship`) —— 用户 2026/10/16 指定「等同电离红掌」
 *
 *  ★ 红掌的效果在引擎里是什么（逐字核对，见设计稿 §1.2）：
 *      闪电 = `PlantfoodDamage **1200**`（electricity）×（最多）`PlantfoodLightningCount **3**`，
 *      直接对 `cm.zombiePool` 的僵尸 `dealDamage`；而运兵艇 `Toughness **1200**` ⇒ **一发致死**
 *      ⇒ 死亡即"离场"（它掉完小鬼也走 `playDie`）⇒ **剩余小鬼不再掉** = 用户实机看到的现象。
 *    ⇒ 我们走**同一条**「伤害→死亡」路（`pbDriveMode:'kill'`，含击杀结算）；
 *      `pbDriveMode:'leave'` 保留"纯离场"作保险（若实机发现击杀结算影响波次，一行切换）。
 *
 *  ⚠️ 三条硬约束：
 *    · 运兵艇 `bodyRecReal` 是**退化框**（-1e4）⇒ 普通弹道打不到它，**不能靠"打中"触发**；
 *    · 它的 `setStun/setChill/setFreeze/setPoison/setPerfume/dealHurrikale/knockBack*` **全是空函数** ⇒ 绝不碰；
 *    · `damageType` 必须 `physicle`：`ray` + `canPlayAshNow()` ⇒ **化灰**，而化灰不走常规离场 ⇒ 观感会变。
 *
 *  识别：主判据 `Zombie_Type === 'sky_dropship'`（引擎里 `Zombie_Type = objdata.CODENAME`），
 *        次判据 `instanceof SkyDropShipZombie`（模块有导出；导入失败自动跳过）。
 * ========================================================================== */

/** 是不是运兵艇（`sky_dropship`） */
function gpnIsDropShip(z, deps) {
    if (!z || z.dead) return false;
    try {
        const Cls = deps && deps.SkyDropShipZombie;
        if (typeof Cls === 'function' && z instanceof Cls) return true;
    } catch (e) { /* 忽略 */ }
    try { return String(z.Zombie_Type || '') === 'sky_dropship'; } catch (e) { return false; }
}

/** 扫**全场**找运兵艇（不按行 / 不按 x 段过滤），逐只驱离。返回成功次数。 */
function gpnDandelionDriveDropShips(deps) {
    const C = CFG.dandelion;
    const Sq = deps && deps.Square;
    if (!Sq || typeof Sq.getAllLane !== 'function') return 0;
    const lanes = Sq.getAllLane() || [];
    const mode = (C.pbDriveMode === 'leave') ? 'leave' : 'kill';
    const ZDD = deps.ZombieDamageDetails, ZDT = deps.ZombieDamageType;
    const seen = new Set();
    let n = 0;
    for (const lane of lanes) {
        if (!lane) continue;
        const pools = [];
        if (typeof lane.zombiePool === 'function') pools.push(lane.zombiePool());
        if (typeof lane.hypnoZombiePool === 'function') pools.push(lane.hypnoZombiePool());
        for (const pool of pools) {
            for (const z of (pool || [])) {
                if (!z || seen.has(z) || z.__gpnDrivenAway || !gpnIsDropShip(z, deps)) continue;
                seen.add(z);
                z.__gpnDrivenAway = true;
                // ① 先断掉"还会继续掉小鬼"：LeftImp 归 0 后即便再走到 spawn 分支也不会掉
                try { z.LeftImp = 0; } catch (e) { /* 忽略 */ }
                let done = false;
                // ② 'kill'（默认）：走引擎的伤害→死亡 = 红掌同一条路
                if (mode === 'kill' && typeof ZDD === 'function' && typeof z.dealDamage === 'function') {
                    try {
                        const hp = (typeof z.totalHealth === 'function')
                            ? (Number(z.totalHealth()) || 0) : (Number(z.health) || 0);
                        const dt = (ZDT && ZDT.physicle != null) ? ZDT.physicle : undefined;
                        // armorProtection=false ⇒ 不让护甲分流（运兵艇本来没护甲）；physicle ⇒ 不化灰
                        z.dealDamage(new ZDD(hp + 1, false, false, false, null, dt));
                        done = !!z.dead;
                    } catch (e) { /* 退化到 ③ */ }
                }
                // ③ 'leave' 或 kill 没成功：调它自己的离场（引擎"掉完小鬼"那句，实参逐字一致）
                if (!done) {
                    try {
                        const dt = (ZDT && ZDT.physicle != null) ? ZDT.physicle : undefined;
                        z.playDie(false, null, false, dt, false, true, false);
                        done = true;
                    } catch (e2) { warn('蒲公英：运兵艇离场调用出错（已忽略）', e2); }
                }
                if (done) n++;
            }
        }
    }
    if (n && (C.pbDriveLog || C.debugLog)) log('蒲公英大招：驱离运兵艇 ' + n + ' 艘（模式=' + mode + '）');
    return n;
}

/* =========================================================================
 * 16. 甜椒投手：命中目标 / 命中障碍物 / 触地后，在落点铺一片 3x3、1 秒的灼烧
 *
 *    引擎里的"地面火"是分三层用的：
 *      LnC.addGroundFire(duration, height, color, spawnDelay, prefab)
 *          -> 在【这一格】生成一片 GroundFire。prefab 传 null 时会按颜色取默认粒子，
 *             所以不用自己去挖资源。
 *      jalapenoFire { groundFires, damage, duration, isDPS, ... }  <- 一批火 + 伤害
 *      GroundFiresManager.registerJalapenoFire(jf)                <- 注册进去，每帧结算
 *
 *    GroundFiresManager.update 里对每片火都会：
 *        new ZombieDamageDetails(i.damage * (i.isDPS ? dt : 1), ..., 伤害类型 = fire)
 *    也就是说 isDPS = true 时引擎按【每秒】结算，而伤害类型天生就是 fire。
 *    注意：我们配置里的 40% 是【单次火焰总伤害】占攻击力的比例（不是每秒 40%），
 *          所以下面会用 总伤害 / burnSeconds 折算出交给引擎的每秒值。
 *    （正好满足"带 fire"）。
 *
 *    3x3 = 落点所在格子的 get3x3()（9 格各来一片火），合成一个 jalapenoFire。
 *
 *    ★ 两套阵营（照引擎自己的"僵尸方火焰"写法分家）：
 *      · 正常甜椒弹（enemyType == zombie）-> 上面那套【僵尸阵营火】：注册 jalapenoFire 批次，
 *        走 GroundFiresManager 每帧结算（烧僵尸 + 被催眠僵尸，不烧植物）。
 *      · 【被弹反】的甜椒弹（enemyType == plant）-> 【植物阵营火】：不注册批次，
 *        改由 gpnPlantFireAt / gpnTickPlantFires 自己每帧结算（烧植物 + 被催眠僵尸，
 *        绝不碰普通僵尸；照样化冰面 + 清零冻结进度）。见 gpnPepperBurnAt 里的 plantSide。
 * =======================================================================*/
function gpnPepperBurnAt(shot, deps, cellOverride) {    const { Square, SquareType, GroundFireColorEnum, JalapenoFire, GroundFiresManager } = deps;
    if (shot.__gpnBurned) return;
    const dur = CFG.pepperpult.burnSeconds;
    // 私有标记里存的是【总伤害比例】：
    //   先算出这一发火焰的【总伤害】= 攻击力 x 比例，
    //   再摊到持续时间上，得到引擎需要"每秒"结算的值。
    //   ⇒ 不管 burnSeconds 改成几秒，【单次火焰总伤害】始终 = 攻击力 x 比例。
    const total = (shot.damage || 0) * (shot.__gpnBurnRatio || 0);
    if (!(total > 0) || !(dur > 0)) return;
    const dps = total / dur;

    // ★ 阵营：这一发是不是【被弹反】的甜椒弹？
    //   —— 被小丑 / 三节棍弹反后，弹道的 enemyType 会被翻成 plant（目标变成植物），
    //      这时候铺的火也必须是"植物阵营的火"：烧植物、不烧普通僵尸（见 gpnPlantFireAt）。
    //   伤害口径（总伤害 = 攻击力 x 40%、1 秒）和外观（3x3 地面火）两边完全一样。
    const plantSide = !!(deps.CharacterType && shot.enemyType === deps.CharacterType.plant);

    // ★★ 伞叶 / 回旋镖射手 对"被反弹的甜椒弹"的判定（**按弹反来源区分**，2026/10/10 用户口径）：
    //    · **弄臣僵尸**（dark_juggler / birthday_juggler）反弹的 ⇒ **不再算投掷物** ⇒
    //      **不该**被伞叶 / 回旋镖挡下（也就不该被"按位置"弹开）；
    //    · **三节棍僵尸**（abbot_3section_staff）反弹的 ⇒ **仍算投掷物** ⇒ 照旧可被挡（保持原行为）。
    //   两条判定的由来（当初为"补引擎漏判"而加，逐字核对过引擎）：
    //     ① 按位置：子弹落在【注册进 Umbrellas 的伞叶】检测框内 ⇒ 整发被弹开
    //        （只有伞叶会注册，回旋镖不注册 ⇒ 削弱版）；
    //     ② 按植物：由调用方（dealDamageToPlant 钩子）查"目标植物 3×3 内有没有 umbrella()"。
    //   为什么需要 ② 之外的引擎兜底：`Plant.dealDamage` 那条"伞叶吸收"只在【伤害类型 1】时才走
    //   —— 而类型是 `bodyLinearVelocity < 0 ? 1 : 2`（只有"正在下落"才算投掷物）。
    //   ⚠️ 所以"弄臣反弹的弹不被挡"必须【主动】做到：见 gpnPepperEnforceReflect（把它的
    //      bodyLinearVelocity 钉成 0 ⇒ 引擎判不出"下落" ⇒ 不吸收；同时也跳过我们的 ①②）。
    if (plantSide && !(shot.__gpnReflectBy === 'juggler')) {
        const byPos = gpnUmbrellaBlocksByPos(shot, deps.Umbrellas);
        if (byPos || shot.__gpnUmbrellaBlocked) {
            shot.__gpnUmbrellaBlocked = true;
            if (dbgOn(CFG.pepperpult.debugLog)) {
                log('甜椒灼烧【植物阵营】：这一发被' + (byPos ? '伞叶（按位置）' : '伞叶') + '挡下 —— 不产生任何火');
            }
            return;
        }
    }

    // 落点：优先用「被打中的那个障碍物所在的格子」（墓碑/冰块/冲浪板都是一格一物），
    // 其次用子弹当前所在格，最后按坐标查格。
    // ★ 但**场外**要特殊处理（见下）：那时上面的三种都拿不到可用的实体格。
    let cell = (cellOverride && typeof cellOverride.get3x3 === 'function') ? cellOverride : shot.inLnC;
    if (!cell && Square && typeof Square.getLnC === 'function'
        && shot.lIndex >= 0 && shot.cIndex >= 0) {
        cell = Square.getLnC(shot.lIndex, shot.cIndex);
    }

    // ★★ 场外右侧（打的是「最右列更右侧」的目标）：**改成最右列的 3×1**（用户口径 2026/10/14）
    //   为什么不能用原来的 3x3：场外格 `LnCRight` 是**全场共用的假格**，`get3x3()` 拿不到实体格；
    //   而兜底 `gpnBurnCellsByCoord` 里 `shot.lIndex = -2 < 0` ⇒ 直接返回空 ⇒ **一片火都不生成**
    //   （那条「甜椒灼烧：一片火都没生成」的刷屏就是这么来的）。
    //   现在：行号按 **Y 坐标**求（不能用 lIndex）、只在**最右列**铺，行超出草坪的**不铺**。
    const offRight = gpnIsOffFieldRight(cell) || (typeof shot.lIndex === 'number' && shot.lIndex < 0);
    let cells = null;
    if (offRight) {
        const lane = gpnLaneByY(shot.worldPositionY, Square);
        cells = gpnRightmostCells3x1(lane, Square);
        if (!cells.length) warn('甜椒灼烧：打到场外目标，但求不到草坪行（Y=' + shot.worldPositionY + '）⇒ 这次不铺火');
    } else {
        cells = (cell && typeof cell.get3x3 === 'function') ? cell.get3x3() : null;
        if (!cells || !cells.length) cells = gpnBurnCellsByCoord(shot, Square);
    }
    const fires = [];       // 要铺火的格子：
                            //   正常     = 落点格的 get3x3()（9 格）
                            //   场外右侧 = 最右列的 3×1（见上面的 offRight 分支）
                            //   其它拿不到 = 按子弹坐标铺 3x3（gpnBurnCellsByCoord）
    let skipped = 0;
    for (const c of cells) {
        if (!c || typeof c.addGroundFire !== 'function') continue;
        // v2.8.4：天空 / 海盗港湾的海面 不出火（巨浪沙滩的海面照常出火）
        if (!gpnCellCanBurn(c, SquareType)) { skipped++; continue; }
        const f = c.addGroundFire(dur, CFG.pepperpult.burnHeight,
            (GroundFireColorEnum && GroundFireColorEnum.yellow) || 0, 0);
        if (f) fires.push(f);
    }
    if (!fires.length) {
        // ★ 噪音治理（2026/10/14 用户要求）：这两句原来**没有门**，而"打场外目标"每发都会走到这里
        //   ⇒ `verboseLog` 关着也照样刷屏。
        //   现在：**天空/海面关卡属于正常地形**（不是异常）⇒ 降为 verbose 日志；
        //        「一片火都没生成」保留为真警告，但**加去重**（同一帧/同种原因只报一次）。
        if (skipped) {
            if (verboseOn()) log('甜椒灼烧：' + skipped + ' 格是天空/海面（该地形本就不出火）'
                + (offRight ? '，场外目标：本次不铺火' : '，剩下拿不到格子'));
        } else if (gpnWarnOnce('pepperNoFire')) {
            warn('甜椒灼烧：一片火都没生成');
        }
        return;
    }

    // ★ 植物阵营的火：【不注册地面火批次】—— 引擎的批次只有「烧植物 / 烧普通僵尸 /
    //   烧被催眠僵尸」三档，没有"只烧植物、完全不碰僵尸"这一档。
    //   所以照引擎自己的"僵尸方火焰"写法（住持火把僵尸的喷火、埃及探险家的火把）：
    //   火只当外观，伤害由我们每帧自己结算 —— 见 gpnPlantFireAt / gpnTickPlantFires。
    if (plantSide) {
        gpnPlantFireAt(fires, dps, dur);
        shot.__gpnBurned = true;
        if (dbgOn(CFG.pepperpult.debugLog)) {
            log('甜椒灼烧【植物阵营】：落点铺 ' + fires.length + ' 片火 / ' + dur + ' 秒 / '
                + '总伤害 ' + total + '（= 攻击 ' + (shot.damage || 0) + ' x '
                + CFG.pepperpult.burnTotalRatio + '，每秒 ' + dps + '）'
                + (skipped ? '（跳过 ' + skipped + ' 格天空/海面）' : ''));
        }
        return;
    }

    const jf = gpnMakeJalapenoFire(JalapenoFire);
    jf.groundFires = fires;
    jf.damage = dps;
    jf.duration = dur;
    jf.isDPS = true;              // 引擎每帧扣 damage*dt，所以这里给的是"每秒值" dps
    jf.burnsFlying = true;
    jf.plantsIncluded = false;
    // !! 语义是反的：armorProtection = true 才是「护甲正常生效（不穿甲）」，
    //    false 是「无视护甲（穿甲）」。jalapenoFire 类的默认值恰好是 false，
    //    所以 v2.7.2 直接沿用了默认值 → 甜椒的火一直在穿甲。
    //    这里显式按配置来；只动我们自己这一份火批次对象，其他火焰一律不碰。
    jf.armorProtection = CFG.pepperpult.burnArmorProtection;
    jf.hypnoIncluded = 0;
    jf.zombieWhiteList = [];

    const mgr = GroundFiresManager && GroundFiresManager.component;
    if (mgr && typeof mgr.registerJalapenoFire === 'function') {
        mgr.registerJalapenoFire(jf);
    } else {
        // v2.7.0/2.7.1 的「有火没伤害」就是走到这里：火粒子已经铺出去了（上面那步），
        // 但没有任何火批次被注册 ⇒ 每帧结算的伤害一次都不会发生。
        // ★ 噪音治理：这是**环境级异常**（每次都一样），一句话只报一次就够。
        if (gpnWarnOnce('pepperNoMgr')) warn('甜椒灼烧：拿不到 GroundFiresManager.component（火已铺出，但不会有伤害）');
        return;
    }
    shot.__gpnBurned = true;
    if (dbgOn(CFG.pepperpult.debugLog)) {
        log('甜椒灼烧：落点铺 ' + fires.length + ' 片火 / ' + dur + ' 秒 / '
            + '总伤害 ' + total + '（= 攻击 ' + (shot.damage || 0) + ' x '
            + CFG.pepperpult.burnTotalRatio + '，每秒 ' + dps + '）'
            + (skipped ? '（跳过 ' + skipped + ' 格天空/海面）' : ''));
    }
}

/** 这一格能不能铺火。
 *  规则（v2.8.4）：【天空】和【海盗港湾的海面】不铺 —— 正好就是引擎自己的 isSkyOrSea()。
 *  !! 注意【不包括】water：那是【巨浪沙滩】的海面，那边要正常出火。
 *     四个值的来历（引擎里查证过）：
 *       sky   = 1  云端堡垒的天空            -> 不出火
 *       water = 2  巨浪沙滩的海面            -> 【照常出火】（BeachSnorkelZombie 用它判潜水）
 *       sea   = 3  海盗港湾的海面            -> 不出火（栈道是 deck=4，照常出火）
 * 优先用引擎自带方法，拿不到再比枚举，保证跟版本走。 */
function gpnCellCanBurn(cell, SquareType) {
    if (!cell) return false;
    if (typeof cell.isSkyOrSea === 'function') return !cell.isSkyOrSea();
    if (typeof cell.getSquareType === 'function' && SquareType) {
        const t = cell.getSquareType();
        if (SquareType.sky != null && t === SquareType.sky) return false;
        if (SquareType.sea != null && t === SquareType.sea) return false;
    }
    return true;
}

/** 按子弹坐标取 3x3 的格子（用于「落点格拿不到」的场外情况）。
 *  引擎的 addGroundFire 自己对场外格返回 undefined，所以这里不用过滤，
 *  只把拿得到的格子交给它 —— 结果就是「3x3 里场内那部分出火」。 */
function gpnBurnCellsByCoord(shot, Square) {
    const out = [];
    if (!Square || typeof Square.getLnC !== 'function') return out;
    const l = (typeof shot.lIndex === 'number') ? shot.lIndex : -1;
    const c = (typeof shot.cIndex === 'number') ? shot.cIndex : -1;
    if (l < 0 || c < 0) return out;
    for (let dl = -1; dl <= 1; dl++) {
        for (let dc = -1; dc <= 1; dc++) {
            const sq = Square.getLnC(l + dl, c + dc);
            if (sq) out.push(sq);
        }
    }
    return out;
}

/** ★ 场外判定 + 位置修补（修「最右列之外的场外目标，范围效果失效」，2026/10/14 用户报告）

 *  引擎事实（已逐字核对 1.5.5 bundle）：
 *    · `Square.judgeCIndex(x)`：`x > 草坪右边界 + 9*SquareWidth` ⇒ 返回 **9**
 *      （**最右列（cIndex 8）的更右侧** ⇒ cIndex = 9）；左侧场外 ⇒ -1。
 *    · `Square.getLnC(l, c)`：`c === 9` ⇒ 返回 **`LnCRight`** —— 它是**全场唯一一个**格对象，
 *      初始化时被设成 `inLane = getLane(-2)`、**`lIndex = -2`**、`cIndex = 9`。
 *    · 于是**场外**的弹道/僵尸：`inLnC === LnCRight`、**`lIndex === -2`**。
 *    ⚠️ 而引擎的通用范围通道 `defaultDealSplashDamage` 有一道守卫
 *      `if (!(!this.inLane || this.lIndex > 4 || this.lIndex < 0)) { … }`
 *      ⇒ **场外（lIndex = -2）时整段范围效果被跳过**，看起来就像"范围失效、变成单体"。
 *      （`dealSplashDamageForEach` 里还依赖 `inLane.midY` 与 `lIndex`，场外同样拿不到。）
 *  所以场外必须**绕开这条通道**，照原版「寒冰辣椒 `_chillLane`」的模板自己做：
 *    **按 Y 求行（行池）→ 自算判定框 → 直接对僵尸施加效果**。
 */

/** 「同一类警告只报一次」——用于**每次触发都会重复**的警告（避免刷屏）。
 *  与 `verboseOn()` 的区别：这类是**真警告**（有问题、要让人看见），只是不需要重复 N 遍。 */
const GPN_WARN_ONCE = {};
function gpnWarnOnce(key) {
    if (GPN_WARN_ONCE[key]) return false;
    GPN_WARN_ONCE[key] = true;
    return true;
}

/** 判定：`inLnC` 是不是「场外右侧」那个共享假格 */
function gpnIsOffFieldRight(cell) {
    try { return !!cell && cell.cIndex === 9; } catch (e) { return false; }
}

/** 判定：这个弹道/僵尸是不是站在场外（`lIndex < 0` 或 `inLnC` 是场外格） */
function gpnIsOffField(obj) {
    if (!obj) return false;
    try {
        if (typeof obj.lIndex === 'number' && obj.lIndex < 0) return true;
        return gpnIsOffFieldRight(obj.inLnC);
    } catch (e) { return false; }
}

/** 按 Y 坐标求草坪行号（0..4）。
 *  为什么不用 `obj.lIndex`：**场外时它是 -2**；而 `getLane(-2)` 也不是"它所在的那一行"。
 *  行号 = 让 `lane.midY` 最接近 `y` 的那一行。
 *  ⚠️ 用 `Square.getAllLane()`（引擎返回 5 条真实车道的数组）而不是 `getLane(i)`——
 *     两者在引擎里等价，但前者是**一次性数组**、语义更明确（自检里 `getLane(i)` 会被 mock 覆写）。 */
function gpnLaneByY(y, Square) {
    try {
        if (!Square || typeof y !== 'number' || isNaN(y)) return -1;
        let best = -1, bestD = Infinity;
        const arr = (typeof Square.getAllLane === 'function') ? Square.getAllLane() : null;
        const n = (arr && arr.length) ? arr.length : 5;
        for (let i = 0; i < n; i++) {
            const lane = arr ? arr[i] : (typeof Square.getLane === 'function' ? Square.getLane(i) : null);
            if (!lane || typeof lane.midY !== 'number') continue;
            const d = Math.abs(lane.midY - y);
            if (d < bestD) { bestD = d; best = i; }
        }
        return best;
    } catch (e) { return -1; }
}

/** 取第 i 行的行对象（优先 `getLane`，拿不到再退回 `getAllLane`）。 */
function gpnLaneObj(i, Square) {
    try {
        if (!Square) return null;
        let lane = (typeof Square.getLane === 'function') ? Square.getLane(i) : null;
        if (lane && typeof lane.zombiePool === 'function') return lane;
        if (typeof Square.getAllLane === 'function') {
            const arr = Square.getAllLane();
            if (arr && arr[i] && typeof arr[i].zombiePool === 'function') return arr[i];
        }
        return lane || null;
    } catch (e) { return null; }
}

/** 最右列的 3×1 格子（以 `lane` 行为中心、取草坪最右列 cIndex = 8）。
 *  用户口径（2026/10/14）：**行号超出 0..4 时不铺**（只铺场内那两行）。 */
function gpnRightmostCells3x1(lane, Square) {
    const out = [];
    if (!Square || typeof Square.getLnC !== 'function' || typeof lane !== 'number' || lane < 0) return out;
    for (let dl = -1; dl <= 1; dl++) {
        const l = lane + dl;
        if (l < 0 || l > 4) continue;                 // ★ 超出草坪的行不铺
        const sq = Square.getLnC(l, 8);               // ★ 最右列
        if (sq) out.push(sq);
    }
    return out;
}

/** 造一个引擎同款的 jalapenoFire 批次对象。
 *  GroundFiresManager.update 每帧都会读 dealtZombies / dealtTombs / dealtPlants 等字段，
 *  少任何一个都会在结算时抛异常 —— 表现出来就是「有火，但一点伤害都没有」。
 *  拿不到引擎类时用等价普通对象兜底。 */
function gpnMakeJalapenoFire(JalapenoFire) {
    if (typeof JalapenoFire === 'function') {
        try { return new JalapenoFire(); } catch (e) {
            warn('甜椒灼烧：jalapenoFire 构造失败，改用等价普通对象', e);
        }
    } else {
        warn('甜椒灼烧：拿不到 jalapenoFire 类，改用等价普通对象');
    }
    return {
        groundFires: [], recs: [], damage: 1800, duration: 3, armorProtection: false,
        dealtZombies: [], dealtTombs: [], dealtPlants: [], isDPS: false,
        zombieWhiteList: [], hypnoIncluded: 0, plantsIncluded: false, burnsFlying: true,
    };
}

/* ---------------- 伞叶 / 回旋镖射手 的两套判定（照抄引擎） ----------------
 *  引擎里"投掷物被伞叶挡下"其实有两条路，而且强弱不同：
 *
 *  ① 【按植物】`Plant.dealDamage(伤害, 类型 1)` 里那一段：
 *         this.inLnC.get3x3().forEach(cell => cell.plantInSquare?.forEach(p => p.umbrella() && (挡下 = true)));
 *         if (挡下) return;        // 伤害被完全吸收
 *     它查的是【被打的那株植物所在格 3×3 内有没有 umbrella()】，所以
 *     **伞叶和回旋镖射手都算**（两者都实现 isUmbrella() / umbrella()）⇒ 回旋镖的"隐藏机制"就是这条。
 *     !! 引擎只在【伤害类型 1】（= bodyLinearVelocity < 0，正在下落的投掷物）时才走这一段。
 *
 *  ② 【按位置】`Umbrellas.umbrellas` 注册表（CharacterManager 上的全局数组）：
 *         敌人投掷物 / 冲浪板 / 章鱼 / 沙袋 / 墓碑… 落地或出手前会遍历它，
 *         命中就 `owner.umbrella()`（播格挡动画）+ 把投掷物弹开。
 *     **只有伞叶会把自己注册进去**（UmbrellaLeaf.specialPlantOnEnable 里 push 自己的 3×3 检测框），
 *     回旋镖射手完全没碰这个表 ⇒ 它挡不了这类攻击 ⇒ 这就是"削弱版伞叶"的引擎依据。
 * ------------------------------------------------------------------ */

/** ① 按植物：目标植物所在格 3×3 内，只要有植物 umbrella() 返回 true ⇒ 这一下被完全吸收。
 *  注意引擎就是靠调用 `p.umbrella()` 来【播格挡动画 + 音效】的，所以这里照调即可。 */
function gpnUmbrellaAbsorbs(plant) {
    const cell = plant && plant.inLnC;
    if (!cell || typeof cell.get3x3 !== 'function') return false;
    let absorbed = false;
    try {
        cell.get3x3().forEach((c) => {
            if (absorbed || !c || !c.plantInSquare) return;
            for (const p of c.plantInSquare) {
                if (absorbed) break;
                if (p && typeof p.umbrella === 'function' && p.umbrella()) absorbed = true;
            }
        });
    } catch (e) { warn('甜椒灼烧：伞叶（按植物）判定出错', e); }
    return absorbed;
}

/** ② 按位置：子弹当前位置落在【注册进 Umbrellas 的伞叶】检测框内 ⇒ 整发被弹开。
 *  回旋镖射手不在注册表里 ⇒ 这里永远拦不到它（与引擎一致 = 削弱版）。 */
function gpnUmbrellaBlocksByPos(shot, Umbrellas) {
    const list = Umbrellas && Umbrellas.umbrellas;
    if (!list || !list.length || !shot || !shot.node) return false;
    let blocked = false;
    try {
        for (const u of list) {
            if (!u || !u.owner || !u.detector) continue;
            if (typeof u.owner.umbrellable === 'function' && !u.owner.umbrellable()) continue;
            if (typeof u.detector.judgeInRecNode !== 'function') continue;
            if (u.detector.judgeInRecNode(shot.node)) {
                blocked = true;
                if (typeof u.owner.umbrella === 'function') u.owner.umbrella();   // 播格挡动画 + 音效
                break;
            }
        }
    } catch (e) { warn('甜椒灼烧：伞叶（按位置）判定出错', e); }
    return blocked;
}




/* 寒冰射手金卡：把"数据层"改金卡的动作抽成可重复调用的函数（开=金卡，关=还原）
 *  · 数据层 = PlantFeatures[].OBTAINWORLD（引擎卡面 getPlantBGSpriteByObtainWorld 读它）
 *  · 显示层 = Plants.getBGAnm 钩子（运行期现查 featOn('snowpea')）
 *  用户在配置界面切换 snowpea ⇒ 立刻调用本函数（数据立即生效）；卡面在"进入关卡/重开图鉴"重建卡面时随之变化。 */
let gpnSnowPeaGoldApply = null;

/* 【临时诊断】阶段⓪ 可行性验证用的按键处理与"数据补丁引用"（调查结束整段删除） */
let gpnTestToggles = null;
let gpnTestToggles2 = null;
let gpnApplyDataPatch = null;

/* ============================================================================
 * 【修 BUG 的核心】弄臣反弹的甜椒弹 —— 让它"不再算投掷物"
 *
 * 引擎的伞叶吸收只认"投掷物"，而"是不是投掷物"是这么算的（`CommonShot.detectPlant`）：
 *     var n = o.bodyLinearVelocity < 0 && e.haveUmbrellaNearby();
 *     o.dealDamageToPlant(e) && ( n || o.dealSplashDamage(...), o.pop() )
 * 其中 `bodyLinearVelocity` 会被"反弹"改掉（弄臣抛接 / 三节棍翻速度）⇒ 判定飘忽。
 *
 * 用户口径：**弄臣僵尸反弹的弹不再算投掷物** ⇒ 我们把它钉成 `0`：
 *     bodyLinearVelocity = 0  ⇒  `0 < 0` 为假 ⇒ 引擎判定"不是投掷物" ⇒ 伞叶不吸收。
 * 这样：
 *   · 伞叶 / 回旋镖**挡不住**弄臣反弹的甜椒弹（要的效果）；
 *   · **普通**甜椒弹（仍是 zombie 阵营、正常下落）完全不受影响；
 *   · **三节棍**反弹的弹（`__gpnReflectBy === 'staff'`）**照样**是投掷物 ⇒ 可被挡（保持原行为）。
 * ⚠️ 只动这一发的 `bodyLinearVelocity`（它只用于"抛接/下落"的观感与上面那条判定），
 *    不改速度、伤害、火焰、阵营 —— 反弹弹该有的伤害与铺火一律保留。
 * ========================================================================== */
function gpnPepperEnforceReflect(shot) {
    try {
        if (!shot || shot.__gpnReflectBy !== 'juggler') return;
        if (shot.bodyLinearVelocity !== 0) shot.bodyLinearVelocity = 0;
    } catch (e) { /* 绝不影响游戏 */ }
}

/* ---------------- 植物阵营的火（被弹反的甜椒弹专用） ----------------
 *  引擎里的"僵尸方火焰"是怎么写的（逐行核对过 0.14.0 的引擎）：
 *    · 住持火把僵尸 AbbotTorchZombie.detectPlant（喷火）：
 *        rect = 身前 FlameAttackDistance(3) 格宽 -> plant.dealDamage(FireDPS x dt, 3)
 *    · 埃及探险家僵尸 EgyptExplorerZombie.detectPlantWithTorch（手里的火把）：
 *        plant.burn()（那个是【瞬杀】，我们不用）
 *  它们的共同点：【完全不注册 GroundFiresManager】—— 火只当外观，伤害自己每帧结算。
 *  这里照同一套写法做"植物阵营的火"：烧植物 +【被催眠的僵尸】（引擎口径：被催眠僵尸算植物阵营），
 *  绝不碰普通僵尸 ⇒ 被弹反的甜椒弹打出来的火，是"玩家挨打"的火。
 *
 *  另外照抄引擎火批次在每片火格子上顺手做的两件事（= 火焰按默认行为处理冻结进度）：
 *    · cell.iceTile.die()            —— 化掉那一格的冰面
 *    · cell.iceblockPrepareLevel = 0 —— 清零"冻结进度"
 *  只有我们自己这一份火会这么走，引擎自己的火批次一律不碰。
 * ------------------------------------------------------------------ */
const gpnPlantFires = [];

/** 在落点 9 格上登记一份"植物阵营的火"（外观已经在 gpnPepperBurnAt 里铺好了） */
function gpnPlantFireAt(fires, dps, dur) {
    if (!(dps > 0) || !(dur > 0) || !fires || !fires.length) return;
    const cells = [];
    for (const f of fires) {
        if (f && f.inLnC) cells.push(f.inLnC);
    }
    if (!cells.length) return;
    gpnPlantFires.push({ cells: cells, dps: dps, remain: dur });
    if (dbgOn(CFG.pepperpult.debugLog)) {
        log('甜椒灼烧【植物阵营】：登记 ' + cells.length + ' 格 / ' + dps + ' 每秒 / ' + dur + ' 秒');
    }
}

/** 每帧结算：植物阵营的火（挂在 GroundFiresManager.update 之前） */
function gpnTickPlantFires(dt, deps) {
    if (!gpnPlantFires.length || !(dt > 0)) return;
    const { Square, CharacterManager, ZombieDamageDetails, ZombieDamageType } = deps || {};
    const Rect = CharacterManager && CharacterManager.Rectangle;
    const fireType = (ZombieDamageType && ZombieDamageType.fire != null) ? ZombieDamageType.fire : 3;
    const armorProtection = !!CFG.pepperpult.burnArmorProtection;

    for (let i = gpnPlantFires.length - 1; i >= 0; i--) {
        const F = gpnPlantFires[i];
        if (!(F.remain > 0)) { gpnPlantFires.splice(i, 1); continue; }
        F.remain -= dt;
        const oneShot = F.dps * dt;
        if (!(oneShot > 0)) continue;
        for (const cell of F.cells) {
            if (!cell) continue;
            // ---- 引擎火批次顺手做的事：化冰面 + 清零冻结进度 ----
            try {
                if (cell.iceTile && typeof cell.iceTile.die === 'function') cell.iceTile.die();
                cell.iceblockPrepareLevel = 0;
            } catch (e) { /* 单格失败不连累其它格 */ }
            // ---- 植物：照引擎火批次那一行（getAllPlants + dealDamage(每秒值 x dt, 3)）----
            // 3 = 火焰伤害类型；引擎自己在"火焰伤害把植物打到血量归零"时会走 burn()（烧成灰）
            try {
                const plants = (typeof cell.getAllPlants === 'function') ? cell.getAllPlants() : null;
                if (plants) {
                    for (const p of plants) {
                        if (p && typeof p.dealDamage === 'function') p.dealDamage(oneShot, 3);
                    }
                }
            } catch (e) { warn('甜椒灼烧【植物阵营】：烧植物出错', e); }
            // ---- 被催眠的僵尸（引擎口径：算植物阵营）----
            try {
                const lane = cell.inLane;
                const pool = (lane && typeof lane.hypnoZombiePool === 'function') ? lane.hypnoZombiePool() : null;
                if (pool && pool.length) {
                    const rect = (Rect && typeof Rect.createRectangleNodeCenter === 'function' && Square)
                        ? Rect.createRectangleNodeCenter(cell.node, Square.SquareWidth, Square.SquareHeight)
                        : null;
                    const dmg = new ZombieDamageDetails(oneShot, armorProtection, false, false,
                        null, fireType, true, true);
                    for (const z of pool) {
                        if (!z || !z.bodyRecReal) continue;
                        if (rect && (!rect.judgeCrossRec || !rect.judgeCrossRec(z.bodyRecReal))) continue;
                        if (typeof z.dealDamage === 'function') z.dealDamage(dmg);
                    }
                }
            } catch (e) { warn('甜椒灼烧【植物阵营】：烧被催眠僵尸出错', e); }
        }
    }
}

/** 把植物阵营火的结算挂到 GroundFiresManager.update 之前（引擎自己的火也在这个 update 里跑） */
function makePlantFireTickPatch(GroundFiresManager, deps) {
    if (!GroundFiresManager || !GroundFiresManager.prototype
        || typeof GroundFiresManager.prototype.update !== 'function') {
        warn('跳过甜椒灼烧【植物阵营】：拿不到 GroundFiresManager.update（弹反的灼烧不会有伤害）');
        return null;
    }
    const rec = methodRecord(GroundFiresManager, 'update');
    GroundFiresManager.prototype.update = function (dt) {
        try { gpnTickPlantFires(dt, deps); } catch (e) { warn('甜椒灼烧【植物阵营】：结算出错', e); }
        return rec.original.apply(this, arguments);
    };
    return rec;
}

function makePepperBurnPatch(CommonShot, deps) {
    if (!CommonShot || !CommonShot.prototype) { warn('跳过甜椒灼烧：拿不到 commonShot'); return null; }
    gpnPepperDeps = deps;      // ★ 自检/诊断用：把依赖存下来（`_pepperBurnAt` 靠它）
    const recs = [];

    // 命中目标 -> 烧
    if (typeof CommonShot.prototype.dealDamageToZombie === 'function') {
        const rec = methodRecord(CommonShot, 'dealDamageToZombie');
        CommonShot.prototype.dealDamageToZombie = function (z, isDirect) {
            // 【运行期开关】关掉「甜椒投手」⇒ 不再补灼烧（下面那句"反射速度归零"的 BUG 修复保留）
            const _pepOn = featOn('pepperpult');
            gpnPepperEnforceReflect(this);   // 【修 BUG】同上（兜底：任何命中入口都保证已归零）
            const r = rec.original.apply(this, arguments);
            try {
                // isDirect === false 的是溅射伤害，不重复烧
                if (_pepOn && isDirect !== false && this.__gpnBurnRatio > 0) gpnPepperBurnAt(this, deps);
            } catch (e) { warn('甜椒灼烧(命中)出错', e); }
            return r;
        };
        recs.push(rec);
    } else {
        warn('跳过甜椒灼烧：commonShot 上没有 dealDamageToZombie');
    }

    // ---- 【修 BUG】记录"是谁反弹的"：弄臣 vs 三节棍，两者行为要求【不同】 ----
    //   用户口径（2026/10/10 补充）：
    //     · **弄臣僵尸**（`dark_juggler` 及其节日变种 `birthday_juggler`）反弹的子弹
    //       ⇒ **不再算投掷物** ⇒ 不该被伞叶 / 回旋镖射手挡下；
    //     · **三节棍僵尸**（`abbot_3section_staff`）反弹的子弹 ⇒ **仍算投掷物** ⇒ 该被挡（保持现状，不动它）。
    //   为什么必须打标记：**两者在引擎里都只是把 `enemyType` 翻成 `plant`**
    //   （`DarkJesterZombie` / `Abbot3SectionStaffZombie.reverseCSs`），光看阵营分不出来。
    //   两条路径完全不同（逐字核对 1.5.5 bundle）：
    //     · 弄臣：`DarkJesterZombie.commonShotPopOnTouch(shot)` 先把子弹"接住抛接"（返回 false 阻止 pop）；
    //     · 三节棍：`Abbot3SectionStaffZombie.reverseCSs()`（该类独有，无 commonShotPopOnTouch）直接翻速度+阵营。
    //   ⚠️ 两处都是"调用原函数【之后】补一个我们自己的标记"，**不改变引擎任何行为**。
    //   ⚠️ 这两个类是【独立模块】（`chunks:///_virtual/DarkJesterZombie.ts` 等），所以从 setup 的
    //      IMPORTS 里导入后传进来（见 `deps.DarkJesterZombieCls` / `Abbot3SectionStaffCls`）。
    const _gpnSpShort = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    /** 拿一个对象的类名（Cocos 的 cc.js.getClassName；拿不到就返回空串） */
    const _gpnSpClassName = (o) => {
        try {
            const ccg = (typeof cc !== 'undefined' && cc) ? cc : null;
            if (ccg && ccg.js && typeof ccg.js.getClassName === 'function') return String(ccg.js.getClassName(o) || '');
        } catch (e) { /* 忽略 */ }
        try { return (o && o.constructor && o.constructor.name) ? String(o.constructor.name) : ''; } catch (e) { return ''; }
    };
    /**
     * 判定"这一发是被谁反弹的"。
     * ⚠️ 必须**双条件**（2026/10/10 用户指出：弄臣还有**复活节变体**，而它的代号里【没有】juggler）：
     *    · 主判据 = **类名**：`DarkJesterZombie`（弄臣系，含节日/复活节等换装变体）/ `Abbot3SectionStaffZombie`（三节棍）；
     *    · 兜底 = **Zombie_Type 名字**：含 juggler ⇒ 弄臣；含 3section ⇒ 三节棍。
     *   两个都拿不到就返回 null（不打标记 ⇒ 维持引擎原样，宁可漏也不误判）。
     */
    const gpnReflectOwner = (z) => {
        try {
            if (!z) return null;
            const cn = _gpnSpShort(_gpnSpClassName(z));      // 例：'darkjesterzombie' / 'abbot3sectionstaffzombie'
            const tn = _gpnSpShort(z.Zombie_Type);           // 例：'darkjuggler' / 'birthdayjuggler' / 'easter…'
            if (cn.indexOf('darkjester') !== -1 || cn.indexOf('jester') !== -1) return 'juggler';
            if (cn.indexOf('3section') !== -1 || cn.indexOf('abbot3') !== -1) return 'staff';
            if (tn.indexOf('juggler') !== -1) return 'juggler';
            if (tn.indexOf('3section') !== -1) return 'staff';
            return null;
        } catch (e) { return null; }
    };
    const gpnMarkReflect = (shot, owner) => {
        try {
            if (!shot || !owner) return;
            shot.__gpnReflectBy = owner;
        } catch (e) { /* 只影响诊断 */ }
    };
    /** 给一个僵尸类挂"反弹标记钩子"：调用原函数之后，把它碰过的子弹按类名/Zombie_Type 打上 owner */
    const gpnHookReflector = (Cls, methName) => {
        try {
            const P2 = Cls && Cls.prototype;
            if (!P2 || typeof P2[methName] !== 'function') return false;
            const recR = methodRecord(Cls, methName);
            P2[methName] = function () {
                const r = recR.original.apply(this, arguments);
                try {
                    const owner = gpnReflectOwner(this);
                    if (owner) for (let i = 0; i < arguments.length; i++) gpnMarkReflect(arguments[i], owner);
                } catch (e) { /* 只影响诊断 */ }
                return r;
            };
            recs.push(recR);
            return true;
        } catch (e) { return false; }
    };
    (() => {
        const okJ = gpnHookReflector(deps && deps.DarkJesterZombieCls, 'commonShotPopOnTouch');
        gpnHookReflector(deps && deps.Abbot3SectionStaffCls, 'reverseCSs');   // 三节棍：只打标记，行为不变
        // 只在"真的挂不上"时留一条警告（正常游戏不输出）：挂不上 ⇒ 弄臣反弹的弹仍可能被伞叶挡
        if (!okJ) warn('甜椒反弹标记：没能挂上弄臣僵尸的 commonShotPopOnTouch（反弹弹可能仍被伞叶挡）');
    })();

    // 触地 -> 烧（引擎在 hitFloor 里调 specialOnGroundHit）
    if (typeof CommonShot.prototype.specialOnGroundHit === 'function') {
        const rec2 = methodRecord(CommonShot, 'specialOnGroundHit');
        CommonShot.prototype.specialOnGroundHit = function () {
            const r = rec2.original.apply(this, arguments);
            if (!featOn('pepperpult')) return r;   // 【运行期开关】关掉 ⇒ 触地不铺火
            try {
                if (this.__gpnBurnRatio > 0) gpnPepperBurnAt(this, deps);
            } catch (e) { warn('甜椒灼烧(触地)出错', e); }
            return r;
        };
        recs.push(rec2);
    } else {
        warn('跳过甜椒灼烧(触地)：commonShot 上没有 specialOnGroundHit');
    }

    // 落地 -> 烧（第三道保险）
    // 上面的 specialOnGroundHit 是「引擎会调、但子类可以覆写成不调 super」的方法；
    // hitFloor 是引擎真正调用的落地入口，挂在这里就不怕甜椒子弹的类覆写。
    // 三道钩子共用 __gpnBurned 标记，同一发子弹永远只会烧一次。
    if (typeof CommonShot.prototype.hitFloor === 'function') {
        const rec3 = methodRecord(CommonShot, 'hitFloor');
        CommonShot.prototype.hitFloor = function () {
            const r = rec3.original.apply(this, arguments);
            if (!featOn('pepperpult')) return r;   // 【运行期开关】关掉 ⇒ 落地不铺火
            try {
                if (this.__gpnBurnRatio > 0) gpnPepperBurnAt(this, deps);
            } catch (e) { warn('甜椒灼烧(落地)出错', e); }
            return r;
        };
        recs.push(rec3);
    } else {
        warn('跳过甜椒灼烧(落地)：commonShot 上没有 hitFloor');
    }

    // 打中【障碍物】-> 烧（第四道钩子）
    // 墓碑 / 冰块(GridIcecube) / 冲浪板(TombSurfboard) / 冰岩(GlacierBlock) / 帐篷(LostcityTent)……
    // 在引擎里【全都是 Tomb 的子类】，统一走 detectEnemyNormal 的墓碑分支：
    //     p.dealDamage(d), this.onTombHit(p), this.dealSplashDamage(null, p), this.pop()
    // 这条路径不会调 dealDamageToZombie / specialOnGroundHit / hitFloor ——
    // 所以 v2.7.3 之前，子弹打在障碍物上火光有伤害没有、火一片都不铺。
    // onTombHit 是这条路径唯一的钩子点（mod 自己的穿透分支也会调它，所以一并覆盖）。
    if (typeof CommonShot.prototype.onTombHit === 'function') {
        const rec4 = methodRecord(CommonShot, 'onTombHit');
        CommonShot.prototype.onTombHit = function (tomb) {
            // 先把格子取出来：原版在这之前已经 dealDamage 过，障碍物可能已经被打碎
            const cell = tomb && tomb.inLnC;
            const r = rec4.original.apply(this, arguments);
            if (!featOn('pepperpult')) return r;   // 【运行期开关】关掉 ⇒ 打障碍物不铺火
            try {
                if (this.__gpnBurnRatio > 0) gpnPepperBurnAt(this, deps, cell);
            } catch (e) { warn('甜椒灼烧(障碍物)出错', e); }
            return r;
        };
        recs.push(rec4);
    } else {
        warn('跳过甜椒灼烧(障碍物)：commonShot 上没有 onTombHit');
    }

    // 打中【植物】-> 铺"植物阵营的火"（第五道钩子；只对"被弹反"的甜椒弹有意义）
    // 引擎打植物走的是 detectEnemyNormal -> detectPlant -> dealDamageToPlant(plant)，
    // 上面那四条钩子【全在僵尸侧】—— 所以弹反后命中植物时是"有伤害、没火"。
    // 注意：不用在这里判阵营 —— 普通甜椒弹根本走不到这个入口（enemyType 是 zombie），
    //      真正决定"铺哪种火"的是 gpnPepperBurnAt 里的 enemyType 判定。
    //
    // ★ 这里还负责【伞叶 / 回旋镖射手 的"按植物"判定】（见 gpnUmbrellaAbsorbs）：
    //   被弹反的甜椒弹是投掷物 ⇒ 打向被保护植物时应该被完全吸收（原版该有的行为）。
    //   引擎那条判定只在【伤害类型 1】时走，而弹反把 bodyLinearVelocity 取反 ⇒ 类型变成 2 ⇒ 判定被跳过。
    //   所以我们在这里先补一次；被吸收时【不调原函数】= 不打伤害，并且不放火（Q2/Q3 的结论）。
    if (typeof CommonShot.prototype.dealDamageToPlant === 'function') {
        const rec5 = methodRecord(CommonShot, 'dealDamageToPlant');
        CommonShot.prototype.dealDamageToPlant = function (plant) {
            gpnPepperEnforceReflect(this);   // 【修 BUG】弄臣反弹的弹先"去投掷物化"，再让引擎判伞叶（这条始终保留）
            if (!featOn('pepperpult')) return rec5.original.apply(this, arguments);   // 【运行期开关】关掉 ⇒ 不做伞叶/铺火判定
            // 只对【被弹反的投掷物】生效：enemyType 翻成 plant 且带灼烧标记（= 我们的甜椒弹）
            // ⚠️ 但**弄臣僵尸反弹的**不算投掷物 ⇒ 完全不走我们这两条伞叶判定（也不播格挡动画）
            const jugglerReflected = (this.__gpnReflectBy === 'juggler');
            const isLobbedHostile = !jugglerReflected && this.__gpnBurnRatio > 0 && deps.CharacterType
                && this.enemyType === deps.CharacterType.plant;
            if (isLobbedHostile && !this.__gpnUmbrellaBlocked && gpnUmbrellaAbsorbs(plant)) {
                this.__gpnUmbrellaBlocked = true;     // 这一发已被挡下 ⇒ 落地 / 打障碍物也都不会再铺火
                if (dbgOn(CFG.pepperpult.debugLog)) log('甜椒灼烧：这一发被伞叶 / 回旋镖射手挡下（不打伤害、不铺火）');
                return true;                          // 让引擎照常走 pop（原版"被吸收"就是这个走向）
            }
            const r = rec5.original.apply(this, arguments);
            try {
                if (r && this.__gpnBurnRatio > 0 && !this.__gpnUmbrellaBlocked) {
                    // 落点 = 被打中那株植物所在的格子
                    gpnPepperBurnAt(this, deps, plant && plant.inLnC);
                }
            } catch (e) { warn('甜椒灼烧(植物)出错', e); }
            return r;
        };
        recs.push(rec5);
    } else {
        warn('跳过甜椒灼烧(植物)：commonShot 上没有 dealDamageToPlant（弹反的灼烧不会生效）');
    }

    // 被【护盾 / 三节棍 / 冲浪板 / 铲子】吸收 -> 也要铺火（第六道钩子）
    //   `commonShot.splat()` 是引擎里"弹道被吸收"的统一信号（这些单位都在自己的
    //   commonShotPopOnTouch / 挡弹逻辑里调 `shot.splat(this)`），而它们的挡弹回调走的是
    //   `dealDamageToZombie(this, false)`（isDirect=false）—— 上面那条钩子**故意**跳过 false
    //   （那是为了"溅射伤害不重复烧"）。所以单靠上面几条，被护盾吸掉的那一发是**不会铺火**的。
    //   这里补上：被吸收时按【弹道当前格】（= 护盾所在格）铺 3×3，阵营仍由 gpnPepperBurnAt 按
    //   enemyType 判定（普通弹 = 僵尸阵营火；被弹反的弹 = 植物阵营火）。
    if (typeof CommonShot.prototype.splat === 'function') {
        const rec6 = methodRecord(CommonShot, 'splat');
        CommonShot.prototype.splat = function () {
            if (!featOn('pepperpult')) return rec6.original.apply(this, arguments);   // 【运行期开关】关掉 ⇒ 被护盾吸收时也不铺火
            try {
                if (this.__gpnBurnRatio > 0 && !this.__gpnBurned) gpnPepperBurnAt(this, deps);
            } catch (e) { warn('甜椒灼烧(被吸收)出错', e); }
            return rec6.original.apply(this, arguments);
        };
        recs.push(rec6);
    } else {
        warn('跳过甜椒灼烧(被吸收)：commonShot 上没有 splat');
    }

    // 植物阵营火的每帧结算（照住持火把僵尸的"喷火"写法；只有被弹反的弹道会用到）
    const tick = makePlantFireTickPatch(deps && deps.GroundFiresManager, deps);
    if (tick) recs.push(tick);

    return recs;
}

/* =========================================================================
 * 12. 推植物：被「不可推」的植物挡住时跳过它，而不是把植物扔出屏幕
 *
 *    引擎原版 CharacterManager.footballmech.pushPlantLeft / pushPlantRight 的落点搜索：
 *        c = 左邻格; loop {
 *            if (c 放得下) {
 *                if (c 里有植物) 递归把它们往左推;
 *                推不动  ->  把【我们】throwAway()          ← 飞出屏幕
 *                推得动  ->  我们 leapTo(c)
 *            }
 *            c = c.lefter;
 *            if (!c.isInLawn()) 把【我们】throwAway()        ← 左侧真的没空位
 *        }
 *    高坚果免疫位移之后，它就成了那个「推不动」的邻居 —— 于是气功一吸，
 *    它旁边的植物就直接被扔出场外。
 *
 *    改法只有一处：推不动 -> 【跳过这一格继续往左找】，只有左侧真的一个空位都没有才 throwAway。
 *    （选项 B）
 * =======================================================================*/
function makePushSkipPatch(FootballMech) {
    if (!CFG.pushPlant.skipBlockers) { log('推植物修正已按配置关闭'); return null; }
    if (!FootballMech) { warn('跳过推植物修正：拿不到 footballmech'); return null; }

    const recs = [];
    // ★ 先把两个原方法存到类上（必须在包裹之前）—— 供"运行期门禁"原样回退用
    //   注意别写成 __gpn* 之外的名字：引擎/别的 mod 不会用到这种带前缀的键。
    try {
        FootballMech.__gpnOrigLeft = FootballMech.pushPlantLeft;
        FootballMech.__gpnOrigRight = FootballMech.pushPlantRight;
    } catch (e) { /* 忽略 */ }
    const build = (prop, toward, dirSign, awayArgs, orig) => {
        const name = prop === 'lefter' ? 'pushPlantLeft' : 'pushPlantRight';
        if (typeof FootballMech[name] !== 'function') { warn('跳过 ' + name + '：不是函数'); return; }

        FootballMech[name] = function (plant, dmg, dur, cbA, cbB, needSpace) {
            // 【运行期开关】关掉 ⇒ 完全走原版（补丁常驻，行为现查）
            if (!featOn('pushPlantFix') && typeof orig === 'function') return orig.apply(this, arguments);
            if (dmg === undefined) dmg = 0;
            if (dur === undefined) dur = 0.5;
            if (cbA === undefined) cbA = function () { };
            if (cbB === undefined) cbB = function () { };
            if (needSpace === undefined) needSpace = true;
            if (!plant || !plant.plantInLnC) return false;

            const group = plant.plantInLnC.getAllPlants(true, false);
            let canMove = true;
            group.forEach((p) => {
                if (canMove && (p.invincible || p.objdata.CannotBePushedByFootballMech
                    || p.leapDisable() || p.fooding || p.leapTween)) canMove = false;
            });
            // 自己被判为「不可推」-> 原版语义：吃伤害（如果有）然后失败
            if (!canMove) { if (dmg > 0) group[0].dealDamage(dmg, 0); return false; }

            const away = (g) => g.forEach((p) => p.throwAway.apply(p, awayArgs));

            let cell = plant.plantInLnC[toward];
            if (!cell.isInLawn()) { away(group); return true; }

            for (; ;) {
                let fits = true;
                group.forEach((p) => {
                    if (fits && needSpace && !cell.putPlantAvailable(false, p.ID, false)) fits = false;
                });
                if (fits) {
                    const occ = cell.getAllPlants(true, false);
                    let blocked = false;
                    if (occ.length > 0) blocked = !FootballMech[name](occ[0], 0, dur);
                    if (!blocked) {
                        group.forEach((p) => p.leapTo(cell, dur,
                            (p.plantInLnC.cIndex - cell.cIndex === dirSign) ? 0 : 100,
                            true, false, 'linear', cbA, cbB));
                        return true;
                    }
                    // >>> 这里是唯一与原版不同的地方 <<<
                    // blocked：这一格被「不可推」的植物占着 -> 跳过它，继续往这个方向找空位
                }
                cell = cell[toward];
                if (!cell.isInLawn()) { away(group); return true; }
            }
        };
        recs.push({ Cls: FootballMech, name, original: null, own: true, static: true, __marker: name });
    };

    // 先把原方法存下来（必须在包裹之前）
    const origLeft = FootballMech.pushPlantLeft;
    const origRight = FootballMech.pushPlantRight;
    build('lefter', 'lefter', 1, [], origLeft);
    build('righter', 'righter', -1, [false], origRight);
    // 回填 original（build 里为了能在包裹后递归调用，拿的是包裹后的函数；这里补上真正的原版以便还原）
    for (const r of recs) r.original = r.name === 'pushPlantLeft' ? origLeft : origRight;
    return recs;
}

/* =========================================================================
 * setup
 * =======================================================================*/

/* =========================================================================
 * 17. A2 星星果追击攻击
 *
 *   触发：天使星星果 / 流星果 的子弹【打中目标】—— 僵尸或障碍物都算。
 *   响应：所有"能打到那个目标"的【基础星星果】立刻补发一轮 5 方向齐射。
 *         追击弹：打中 3 个目标（= 穿透 2 个）、伤害 = 基础星星果这一发的 50%、溅射 45%、眩晕 0.075 秒。
 *
 *   为什么能精确给每一发打标记：
 *     引擎 PeashooterPlant._shoot(...) 本身是 async，但它 resolve 出来的【就是那颗子弹】，
 *     所以逐发 .then() 打标记即可 —— 不需要"开火窗口 + 计数"那套猜测。
 *
 *   为什么不会变成 10 发：
 *     我们自己发完 5 发后，还要让植物播 Shoot 动画（要完整的开火动作）；
 *     而动画的 Shoot 事件回调 animationListener 里会再调一次 _shootStars()。
 *     所以在播动画前，把【实例上】的 _shootStars 临时掐掉，过一小会儿再还回去
 *     （用 scheduleOnce，植物中途被铲掉也不会漏还原）。
 *
 *   防连锁：追击弹自己标成 'base'，永远不会再触发追击。
 *   大招中不响应：正在放大招的植株（shootCD === Infinity 或有待发大招子弹）跳过。
 * =======================================================================*/

/** 按弹道别名 / PeaType 判断星星果种类：'base' / 'pink' / 'shooting' / '' */
function gpnStarKindOf(v) {
    const s = String(v || '');
    if (s.indexOf('pinkstar') === 0) return 'pink';
    if (s.indexOf('shootingstar') === 0) return 'shooting';
    if (s.indexOf('star') === 0) return 'base';
    return '';
}

/** 基础星星果的 5 个方向（照抄引擎 StarFruit._shootStars 里那张表；格子尺寸运行时读） */
function gpnStarDirs(Square, Vec2) {
    const W = (Square && Square.SquareWidth) || 80;
    const H = (Square && Square.SquareHeight) || 80;
    return [
        new Vec2(-1, 0),
        new Vec2(0, 1),
        new Vec2(0, -1),
        new Vec2(1.732 * W, H),
        new Vec2(1.732 * W, -H),
    ];
}

/** 取"所在行"：植物/僵尸身上的 inLnC.lIndex，或者 inLane.LaneIndex。取不到返回 -1 */
function gpnLaneOf(obj) {
    if (!obj) return -1;
    const sq = obj.inLnC;
    if (sq && typeof sq.lIndex === 'number') return sq.lIndex;
    const lane = obj.inLane;
    if (lane && typeof lane.LaneIndex === 'number') return lane.LaneIndex;
    if (typeof obj.lIndex === 'number') return obj.lIndex;
    return -1;
}

/** 这株星星果能不能打到这个目标（= 引擎 detectEnemy 的"逐目标版"）
 *
 *  引擎 detectEnemy 的关键在于【用哪个池子去配哪个探测框】：
 *      this.inLane.zombiePool() / tombPool()  -> 只用 laneDetector（同行框）
 *      ZombiePool.pool() / TombPool.pool()    -> 只用 sideDetectors（竖直条 + 两条斜向条）
 *  也就是说【同行框从来不和别行的目标做判定】—— 这就是原版"不会因为贴图溢出而打空枪"的原因。
 *  所以这里必须先判"目标与这株同一行"，再拿 laneDetector 去交。
 *
 *  !! 只做"引用引擎自己的矩形 + 相交"，不写死任何几何数字（±2.5 行 / 10 格 / 30° 都不算）。
 *     将来原版修了探测框（比如加长竖直条），这里会自动跟着变。
 */
function gpnStarCanReach(plant, target, bodyRec) {
    if (!plant || !bodyRec || typeof bodyRec.judgeCrossRec !== 'function') return false;
    // ① 同行框：照引擎，只有【同一行】的目标才参与这个判定
    const pl = gpnLaneOf(plant), tl = gpnLaneOf(target);
    if (pl >= 0 && tl >= 0 && pl === tl
        && plant.laneDetector && bodyRec.judgeCrossRec(plant.laneDetector)) return true;
    // ② 竖直条 + 斜向条：这部分引擎本来就用全局池判，任何行都参与
    const sides = plant.sideDetectors;
    if (Array.isArray(sides)) {
        for (const d of sides) {
            if (d && bodyRec.judgeCrossRec(d)) return true;
        }
    }
    return false;
}

/** 给一发追击弹打标记；dmgOverride > 0 时直接用这个【绝对伤害】（"延迟窗口合并"用） */
function gpnTagFollowShot(shot, dmgOverride) {
    if (!shot) return;
    try {
        shot.__gpnPierceMax = gpnFollowPierce();
        shot.__gpnPierceAlways = true;
        shot.__gpnSplashRatio = CFG.starfruit.followSplashRatio;
        shot.__gpnStarKind = 'base';            // 追击弹永不触发追击（防连锁）
        if (typeof shot.setDamage === 'function') {
            const dmg = (dmgOverride > 0)
                ? dmgOverride
                : (shot.damage || 0) * CFG.starfruit.followDamageRatio;
            shot.setDamage(dmg);
        }
        if (typeof shot.setStun === 'function') shot.setStun(CFG.starfruit.followStun);
        shot.__gpnFollowShot = true;
        if (dbgOn(CFG.starfruit.followDebugLog)) {
            log('星星果追击：子弹伤害 ' + shot.damage + '，打中 ' + shot.__gpnPierceMax + ' 个目标');
        }
    } catch (e) { warn('星星果追击：给子弹打标记出错', e); }
}

/** 让一株基础星星果补一轮齐射。
 *  merge = { K, sumAtk } 时按「延迟窗口合并」的伤害口径：
 *    每颗弹伤害 = followDamageRatio × Σ(各次触发时该株的攻击力)；
 *    万一本局拿不到攻击力基数（数据缺失）-> 退化成"这一发基数 × K"，绝不静默少伤害。 */
function gpnStarFollowFire(plant, Square, Vec2, merge) {
    const od = plant && plant._objdataOwn;
    if (!od || !od.PeaType) return false;
    if (typeof plant._shoot !== 'function') return false;
    const mK = (merge && merge.K > 0) ? merge.K : 0;
    const mSum = (merge && merge.sumAtk > 0) ? merge.sumAtk : 0;

    // (1) 自己发这 5 发 —— 这样每一发都能确定性地打上标记
    let fired = 0;
    for (const d of gpnStarDirs(Square, Vec2)) {
        try {
            const p = plant._shoot(false, false, od.PeaType, 11, d);   // 11 = 引擎 _shootStars 的默认速度
            if (p && typeof p.then === 'function') {
                p.then((shot) => {
                    let over = 0;
                    if (mK > 0) {
                        const ratio = CFG.starfruit.followDamageRatio;
                        over = (mSum > 0)
                            ? ratio * mSum
                            : (Number(shot.damage) || 0) * ratio * mK;
                    }
                    gpnTagFollowShot(shot, over);
                }).catch((e) => warn('星星果追击：发射失败', e));
            }
            fired++;
        } catch (e) { warn('星星果追击：发射出错', e); }
    }

    // (2) 动画：只有它【此刻没有在普攻】时才播 —— 普攻动画优先级更高，绝不被追击顶掉。
    //     正在普攻时这一轮追击就"静默补刀"（子弹照发，不动画，也不碰任何动画状态）。
    //     引擎里 this.shooting 的语义正好是"正在播开火动画"：
    //         startShooting() 里置 true，animationOnComplete() 里置 false。
    const ac = plant.anmControl;
    if (plant.shooting !== true && ac && typeof ac.playAnimation === 'function') {
        const hadOwn = Object.prototype.hasOwnProperty.call(plant, '_shootStars');
        const orig = plant._shootStars;
        if (typeof orig === 'function') {
            let restored = false;
            const back = () => {
                if (restored || plant._shootStars === orig) return;
                restored = true;
                if (hadOwn) plant._shootStars = orig;
                else delete plant._shootStars;       // 原本是继承来的 -> 删掉自有属性
            };
            // 动画的 Shoot 事件来了：
            //   这一刻它要是在普攻（shooting === true）—— 那是【普攻】的那一轮，必须放行；
            //   否则就是我们自己这轮的 —— 掐掉（否则当前 5 发会变成 10 发）。
            plant._shootStars = function () {
                const forNormalAttack = this.shooting === true;
                back();
                if (forNormalAttack) return orig.apply(this, arguments);
            };
            // 兜底：动画事件万一不来（被打断/动画被替换），超时也还原
            if (typeof plant.scheduleOnce === 'function') {
                plant.scheduleOnce(back, CFG.starfruit.followAnimGuard);
            } else {
                back();
            }
        }
        ac.playAnimation('Shoot', 1, 0.1, CFG.starfruit.followAnimSpeed);
    }
    return fired > 0;
}

/* =========================================================================
 * A2「延迟窗口合并」（独立开关 starfruitFollowMerge）
 *   每株基础星星果各自一个窗口：窗口内每被触发一次就 K+1、并把【那一刻它的攻击力】累加；
 *   窗口到点只补一轮 5 方向齐射，每颗弹伤害 = followDamageRatio × Σ(各次触发攻击力)。
 *   大招期间：不记录，并且取消已开的窗口 + 清空记录（退出大招后自然恢复）。
 * =======================================================================*/
let gpnFollowWinSeq = 0;
function gpnFollowMergeOn() {
    // ★ 依赖：starfruit 关掉 ⇒ 本项一律视为关闭（不管玩家写 true / false / 把那一行删掉）；
    //   追击总开关关掉同理。这样【唯一入口】就自带依赖，不怕以后重构漏掉。
    return featOn('starfruit')
        && CFG.starfruit.followEnabled
        && CFG.starfruit.followMergeWindow > 0
        && featOn('starfruitFollowMerge');
}
/** 这一株"现在这一发"的攻击力基数（拿不到就返回 0，调用方会退化成"这一发基数 × K"） */
function gpnStarAtkOf(plant) {
    const od = plant && plant._objdataOwn;
    if (!od) return 0;
    const alias = String(od.PeaType || '');
    let basis = (alias && GPN_STAR_PRJ_DAMAGE[alias]) || 0;
    if (!(basis > 0)) basis = Number(od.Damage) || 0;      // 兜底：植物自己的 Damage
    const sc = Number(plant._dmgScale);
    if (basis > 0 && sc > 0 && sc !== 1) basis *= sc;      // 引擎 _shoot 收尾会乘 _dmgScale
    return basis > 0 ? basis : 0;
}
/** 正在放大招？（引擎：specialPlantFood 里把 shootCD 置 Infinity；大招子弹用 _foodLeftPeaCount 倒数） */
function gpnStarIsFooding(p) {
    return !!p && (p.shootCD === Infinity || (p._foodLeftPeaCount || 0) > 0 || p.fooding === true);
}
/** 取消这一株的延迟窗口（令牌作废 -> 到点也不会发；累加记录一并清空） */
function gpnFollowWinCancel(plant) {
    if (plant && plant.__gpnFollowWin) plant.__gpnFollowWin = null;
}
/** 把一次触发并进延迟窗口 */
function gpnFollowWinAccum(plant, deps) {
    const w = CFG.starfruit.followMergeWindow;
    const basis = gpnStarAtkOf(plant);
    let win = plant.__gpnFollowWin;
    if (!win) {
        win = { token: ++gpnFollowWinSeq, K: 0, sumAtk: 0, deps: deps };
        plant.__gpnFollowWin = win;
        if (typeof plant.scheduleOnce === 'function') {
            plant.scheduleOnce(() => gpnFollowWinFire(plant, win), w);
        } else {
            // 没有调度器（老引擎 / 测试桩）：退化成"立刻一轮"，绝不静默丢伤害
            win.K += 1; win.sumAtk += basis;
            plant.__gpnFollowWin = null;
            gpnStarFollowFire(plant, deps.Square, deps.Vec2, win);
            return true;
        }
    }
    win.K += 1;
    win.sumAtk += basis;
    if (dbgOn(CFG.starfruit.followMergeDebugLog)) {
        log('星星果追击：并入延迟窗口 K=' + win.K + '，Σ攻击=' + win.sumAtk + '（窗口 ' + w + ' 秒）');
    }
    return true;
}
/** 延迟窗口到点：验令牌 -> 死亡/大招检查 -> 放一轮 */
function gpnFollowWinFire(plant, win) {
    if (!plant || !win || plant.__gpnFollowWin !== win) return;   // 已被取消 / 已换窗
    plant.__gpnFollowWin = null;
    if (plant.dead) return;                                       // 死亡 / 被铲 -> 丢弃
    if (gpnStarIsFooding(plant)) {                                // 进大招 -> 丢弃（不补发）
        if (dbgOn(CFG.starfruit.followMergeDebugLog)) log('星星果追击：窗口到点但正在放大招 -> 丢弃');
        return;
    }
    if (dbgOn(CFG.starfruit.followMergeDebugLog)) {
        const per = (win.sumAtk > 0) ? (CFG.starfruit.followDamageRatio * win.sumAtk) : 0;
        log('星星果追击：窗口开火 K=' + win.K + '，Σ攻击=' + win.sumAtk
            + '，每发伤害=' + (per > 0 ? per : '按这一发×K（没拿到攻击力基数）')
            + '（穿透 ' + gpnPierceText(gpnFollowPierce()) + ' 个名额）');
    }
    gpnStarFollowFire(plant, win.deps.Square, win.deps.Vec2, win);
}

/** 目标被打中了 -> 找出所有能打到它的基础星星果，各补一轮（或并进延迟窗口） */
function gpnStarFollowAt(shot, target, deps) {
    const { Square, Vec2 } = deps;
    const bodyRec = target && (target.bodyRecForShooter || target.bodyRec);
    if (!bodyRec) return;
    if (!Square || typeof Square.getAllLane !== 'function') return;
    const lanes = Square.getAllLane() || [];
    let n = 0;
    for (const lane of lanes) {
        const pool = (lane && typeof lane.plantPool === 'function') ? lane.plantPool() : null;
        for (const p of (pool || [])) {
            if (!p || p.dead) continue;
            const od = p._objdataOwn;
            if (!od || gpnStarKindOf(od.PeaType) !== 'base') continue;    // 只让【基础星星果】响应
            if (typeof p._shoot !== 'function') continue;
            if (gpnStarIsFooding(p)) {                                     // 大招期间：不记录 + 取消已开的窗口
                gpnFollowWinCancel(p);
                continue;
            }
            if (!gpnStarCanReach(p, target, bodyRec)) continue;            // 打不到这个目标 -> 不响应
            // 保险：引擎自己说"这株什么都看不到"，但逐目标判定说"能打到" ->
            // 说明原版改了 detectEnemy 的判定结构，需要同步一次（调试开关下才查）
            if (dbgOn(CFG.starfruit.followDebugLog) && typeof p.detectEnemy === 'function' && !p.detectEnemy()) {
                warn('星星果追击：引擎说这株看不到东西，但逐目标判定说能打到 —— 可能原版改了探测结构');
            }
            if (gpnFollowMergeOn()) {
                if (gpnFollowWinAccum(p, deps)) n++;                    // 并进延迟窗口（到点统一开火）
            } else if (gpnStarFollowFire(p, Square, Vec2)) {
                n++;                                                    // 旧行为：立刻补一轮
            }
        }
    }
    if (n && CFG.starfruit.followDebugLog) log('星星果追击：' + n + ' 株基础星星果响应');
}

function makeStarFollowPatch(CommonShot, deps) {
    if (!CommonShot || !CommonShot.prototype) { warn('跳过星星果追击：拿不到 commonShot'); return null; }
    const recs = [];
    const isTrigger = (kind) => kind === 'pink' || kind === 'shooting';

    // ---- 「延迟窗口合并」：基础星星果一进大招，立刻取消窗口 + 清空记录（退出大招后自然恢复）----
    const PlantBase = deps && deps.Plant;
    if (PlantBase && PlantBase.prototype && typeof PlantBase.prototype.food === 'function') {
        const recFood = methodRecord(PlantBase, 'food');
        PlantBase.prototype.food = function () {
            const r = recFood.original.apply(this, arguments);
            if (!featOn('starfruit')) return r;   // 【运行期开关】关掉 ⇒ 原版大招（追击不介入）
            try {
                const od = this && this._objdataOwn;
                if (od && gpnStarKindOf(od.PeaType) === 'base'
                    && (this.fooding === true || r !== false)) {
                    gpnFollowWinCancel(this);      // 取消计时（令牌作废）+ 清空记录
                }
            } catch (e) { /* 尽力而为，绝不影响原版 */ }
            return r;
        };
        recs.push(recFood);
    } else {
        warn('星星果追击：拿不到 Plant.food —— 大招改用"触发时 / 到点时"兜底检查（功能不受影响）');
    }

    // 打中僵尸 -> 触发
    if (typeof CommonShot.prototype.dealDamageToZombie === 'function') {
        const rec = methodRecord(CommonShot, 'dealDamageToZombie');
        CommonShot.prototype.dealDamageToZombie = function (z, isDirect) {
            const r = rec.original.apply(this, arguments);
            try {
                // 触发条件（v1.0.0 修缮）：
                //   ① 正常情况：isDirect !== false（isDirect === false 是溅射伤害，不算"命中"）；
                //      ★ 另外：打中【僵尸方的护盾实体（力场盾）】也算一次命中 ⇒ 也触发
                //        （原版力场盾的挡弹回调用的是 isDirect=false，不补这条的话打盾不触发）
                //   ② 而且【只限植物方子弹】（enemyType == zombie）——
                //      被弹反的子弹（enemyType == plant）打"被催眠僵尸 / 植物方护盾"时，
                //      不该反过来替玩家补一轮齐射。
                const plantSideShot = !!(deps.CharacterType && this.enemyType !== deps.CharacterType.zombie);
                const shieldHit = gpnIsShieldZombie(z, deps.ZombieEnum);
                if (!plantSideShot && (isDirect !== false || shieldHit)
                    && CFG.starfruit.followEnabled && isTrigger(this.__gpnStarKind)) {
                    gpnStarFollowAt(this, z, deps);
                }
            } catch (e) { warn('星星果追击(僵尸)出错', e); }
            return r;
        };
        recs.push(rec);
    } else {
        warn('跳过星星果追击：commonShot 上没有 dealDamageToZombie');
    }

    // 打中障碍物 -> 也触发（墓碑 / 冰块 / 冲浪板 / 冰岩 / 帐篷…）
    if (typeof CommonShot.prototype.onTombHit === 'function') {
        const rec2 = methodRecord(CommonShot, 'onTombHit');
        CommonShot.prototype.onTombHit = function (tomb) {
            const r = rec2.original.apply(this, arguments);
            try {
                if (CFG.starfruit.followEnabled && isTrigger(this.__gpnStarKind)) {
                    gpnStarFollowAt(this, tomb, deps);
                }
            } catch (e) { warn('星星果追击(障碍物)出错', e); }
            return r;
        };
        recs.push(rec2);
    } else {
        warn('跳过星星果追击(障碍物)：commonShot 上没有 onTombHit');
    }

    return recs;
}


/* =========================================================================
 * 18. 飓风甘蓝：全屏寒风（其他行推 + 减速，力度 50%）+ 全屏吹飞飞行僵尸
 *
 *   引擎原版（已逐行核对）：
 *     HurrikalePlant.animationListener('push')
 *         -> 本行.setHurrikaleDuration(PushDuration × 薄荷倍率)   // Lane 上的秒数计时器
 *         -> 本行 spawn upperParticle / lowerParticle 两个特效
 *     Zombie.dealHurrikale(dt)                                    // 每帧
 *         -> 只看【自己那一行】的 inLane.hurrikaleBlowing()
 *         -> 飞行僵尸 blowAway()；陆地僵尸 推 2 格/秒（引擎里是硬编码）+ setChill(8)
 *
 *   本模组的扩展（一律"先调原版、再扩写"，原版行为一字不动）：
 *     ② 其他行也 setHurrikaleDuration(同一时长)，并给该行打"力度"标记。
 *        僵尸侧的 hurrikaleBlowing() 是【按行】判定的，所以那几行的僵尸自然会被推 + 减速。
 *        力度 50% = 推速减半：包一层 Zombie.dealHurrikale，把"这一帧被推的距离"乘上力度
 *        （原版推速硬编码，只能这样缩放；【没有标记时 = 原版一字不变】）。
 *     ③④ FrontYard.windy = max(windy, 风时长)
 *        => "全屏吹飞飞行僵尸" 和 "天空之城飞船按 BloverDPS 扣血" 全都交给引擎自己算；
 *           连"天空之城推回最右格 / 沙盒正常吹飞"的差别也自动跟着引擎走（刻意行为，不绕过）。
 *     ⑤ 其他行也 spawn 同样两个特效（位置 = 植物的列 × 该行的中线）。
 *
 *   时长（B 方案）：全屏风用【三叶草】的 BlowDuration × 薄荷倍率，
 *     这样飞船扣血在任意状态下都与三叶草严格一致；其他行的"推动"用飓风甘蓝自己的时长。
 * =======================================================================*/

/** 读三叶草的数据，算"全屏风"该持续多久（B 方案） */
function gpnBloverWindDuration(plant, deps) {
    let blowDur = 3, mintFactor = 3;
    try {
        const list = deps.PlantProps;
        if (Array.isArray(list)) {
            for (const e of list) {
                if (!e || !Array.isArray(e.aliases)) continue;
                if (e.aliases.indexOf(CFG.hurrikale.bloverType) === -1) continue;
                const od = e.objdata || {};
                if (od.BlowDuration > 0) blowDur = od.BlowDuration;
                if (od.MintDurationFactor > 0) mintFactor = od.MintDurationFactor;
                break;
            }
        }
    } catch (e) { warn('飓风甘蓝：读三叶草数据出错', e); }
    const mint = !!(plant && plant.MintBoosted);
    return blowDur * (mint ? mintFactor : 1);
}

/** 在指定行播一组寒风特效（和原版同款：上下两个 prefab） */
function gpnHurrikaleVfx(plant, lane, deps) {
    const { Vec3, instantiatePooly } = deps;
    if (!instantiatePooly || !plant || !lane || !plant.node) return 0;
    const wp = plant.node.worldPosition;
    if (!wp) return 0;
    const pair = [
        { prefab: plant.upperParticle, layer: lane.prjLayer, front: false },
        { prefab: plant.lowerParticle, layer: lane.zombieLayer, front: true },
    ];
    let n = 0;
    for (const it of pair) {
        if (!it.prefab || !it.layer) continue;
        try {
            const node = instantiatePooly(it.prefab);
            if (!node) continue;
            node.parent = it.layer;
            // 原版：a（lower）会 setSiblingIndex(0) 压到最底
            if (it.front && typeof node.setSiblingIndex === 'function') node.setSiblingIndex(0);
            const y = (typeof lane.midY === 'number') ? lane.midY : wp.y;
            node.worldPosition = (Vec3 && typeof Vec3 === 'function') ? new Vec3(wp.x, y, wp.z || 0) : wp;
            if (plant.node.worldScale) node.worldScale = plant.node.worldScale;
            n++;
        } catch (e) { warn('飓风甘蓝：其他行特效出错', e); }
    }
    return n;
}

/** 吹一次"全屏风" */
function gpnHurrikaleBlowAll(plant, deps) {
    const { Square, FrontYard } = deps;
    const od = (plant && plant._objdataOwn) || {};
    const mint = !!(plant && plant.MintBoosted);
    const ownLane = plant ? plant.inLane : null;
    const pushDur = (od.PushDuration > 0 ? od.PushDuration : 3)
        * (mint && CFG.hurrikale.mintScalesOtherLanes && od.MintDurationFactor > 0
            ? od.MintDurationFactor : 1);
    const scale = CFG.hurrikale.otherLanePushScale;
    const lanes = (Square && typeof Square.getAllLane === 'function') ? (Square.getAllLane() || []) : [];
    let other = 0, vfx = 0, skipped = 0;
    for (const lane of lanes) {
        if (!lane || typeof lane.setHurrikaleDuration !== 'function') continue;
        if (lane === ownLane) { lane.__gpnHurrikaleForce = 1; continue; }   // 本行照原版（力度 1）
        if (!CFG.hurrikale.affectAllLanes && ownLane
            && Math.abs((lane.LaneIndex || 0) - (ownLane.LaneIndex || 0)) > 2) { skipped++; continue; }
        lane.setHurrikaleDuration(pushDur);          // 其他行：同一时长 -> 推 + 减速
        lane.__gpnHurrikaleForce = scale;            // 其他行：力度 50%（推速乘数）
        other++;
        if (CFG.hurrikale.otherLaneVfx) vfx += gpnHurrikaleVfx(plant, lane, deps);
    }
    // ③④ 全屏风 —— 全交给引擎（吹飞飞行僵尸 / 飞船扣血 / 天空之城与沙盒的区别）
    let windy = 0;
    if (FrontYard) {
        const d = gpnBloverWindDuration(plant, deps);
        FrontYard.windy = Math.max(FrontYard.windy || 0, d);
        windy = FrontYard.windy;
    } else {
        warn('飓风甘蓝：拿不到 FrontYard —— 全屏吹飞 / 飞船扣血不会生效');
    }
    if (dbgOn(CFG.hurrikale.debugLog)) {
        log('飓风甘蓝：其他行 ' + other + ' 行（推力 ' + scale + '，时长 ' + pushDur + 's）'
            + '，特效 ' + vfx + ' 组，全屏风 ' + windy + 's'
            + (skipped ? '（跳过 ' + skipped + ' 行）' : ''));
    }
    return { other, vfx, wind: windy };
}

function gpnHurrikaleOtherLaneBlow(plant, deps) {
    const n = Math.floor(CFG.hurrikale.otherLaneDandelions || 0);
    if (!(n > 0)) return 0;                                    // 0 = 关闭这条
    const Square = deps && deps.Square;
    if (!plant || !Square || typeof Square.getAllLane !== 'function') return 0;
    const ownLane = plant.inLane;
    const baseBlow = deps.Plant && deps.Plant.prototype && deps.Plant.prototype.blowStart;
    const lanes = Square.getAllLane() || [];
    let total = 0, warned = false;
    for (const lane of lanes) {
        if (!lane || lane === ownLane) continue;               // 本行交给原版那 4 株，不重复处理
        // 跟随作用范围：风只到 ±2 行时，够不到的行不吹
        if (!CFG.hurrikale.affectAllLanes && ownLane
            && Math.abs((lane.LaneIndex || 0) - (ownLane.LaneIndex || 0)) > 2) continue;
        try {
            if (typeof lane.plantPool !== 'function') continue;
            const pool = lane.plantPool();
            if (!pool || !pool.length) continue;
            // 打乱（内联 Fisher-Yates，等价引擎的 ArrayGet.shuffle，省一个 import）
            const arr = Array.prototype.slice.call(pool);
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
            }
            let got = 0;
            for (const p of arr) {
                if (!p || p.dead) continue;
                if (typeof p.blowStart !== 'function') continue;
                if (baseBlow && p.blowStart === baseBlow) continue;   // 不会吹的植物（基类实现）
                if (p.blew || p.fooding) continue;                    // 恢复期中 / 正在放大招
                if (p.blowStart() && ++got >= n) break;               // 每行挑够 n 株就停
            }
            total += got;
        } catch (e) {
            if (!warned) { warned = true; warn('飓风甘蓝：让其他行蒲公英吹时出错', e); }
        }
    }
    if (dbgOn(CFG.hurrikale.debugLog)) log('飓风甘蓝：其他行蒲公英 +' + total + ' 株一起吹');
    return total;
}

function makeHurrikalePatch(HurrikalePlant, Zombie, deps) {
    const recs = [];

    // ---- (1) 吹风那一刻：把风扩到全屏 ----
    if (HurrikalePlant && HurrikalePlant.prototype
        && typeof HurrikalePlant.prototype.animationListener === 'function') {
        const rec = methodRecord(HurrikalePlant, 'animationListener');
        HurrikalePlant.prototype.animationListener = function (evt) {
            if (!featOn('hurrikale')) return rec.original.apply(this, arguments);   // 【运行期开关】关掉 ⇒ 原版飓风
            const r = rec.original.apply(this, arguments);      // ① 原版照跑
            try {
                if (evt && evt.name === 'push') {
                    gpnHurrikaleBlowAll(this, deps);
                    gpnHurrikaleOtherLaneBlow(this, deps);      // 其他行的蒲公英也一起吹
                }
            } catch (e) { warn('飓风甘蓝(全屏风)出错', e); }
            return r;
        };
        recs.push(rec);
    } else {
        warn('跳过飓风甘蓝：拿不到 HurrikalePlant.animationListener');
    }

    // ---- (2) 让"推速"能按行缩放（没有标记 = 原版一字不变）----
    if (Zombie && Zombie.prototype && typeof Zombie.prototype.dealHurrikale === 'function') {
        const rec2 = methodRecord(Zombie, 'dealHurrikale');
        Zombie.prototype.dealHurrikale = function (dt) {
            const lane = this.inLane;
            const force = (lane && lane.__gpnHurrikaleForce) || 1;
            if (force === 1) return rec2.original.apply(this, arguments);   // 无标记 -> 原版
            const before = this.worldPositionX;
            const r = rec2.original.apply(this, arguments);
            try {
                if (lane && typeof lane.hurrikaleBlowing === 'function' && lane.hurrikaleBlowing()) {
                    const d = this.worldPositionX - before;
                    // 把"多推的那部分"按力度退回去（原版推速是硬编码的，这是唯一不复制引擎逻辑的缩放点）
                    if (d > 0) this.worldPositionX = before + d * force;
                }
            } catch (e) { warn('飓风甘蓝(推力缩放)出错', e); }
            return r;
        };
        recs.push(rec2);
    } else {
        warn('跳过飓风甘蓝：拿不到 Zombie.dealHurrikale');
    }

    return recs;
}

/* =========================================================================
 * 19. 魔音甜菜（Phat Beet）
 *
 *   ① 普攻：使命中的僵尸（BOSS 除外）眩晕 normalStun（0.075 秒）
 *   ② 普攻：解除【3x3 索敌框】内植物被音响僵尸施加的「安抚」
 *   ③ 索敌范围内有被安抚的植物时，也会发动普攻（普攻本身只打僵尸/障碍物，不伤植物）
 *   ④ 大招：使命中的僵尸（BOSS 除外）眩晕 plantfoodStun（5 秒）+ 原地向上击起
 *   ⑤ 大招：令命中僵尸 jamClearSeconds（25 秒）内不受「音乐（jam）」影响
 *   ⑥ 大招：解除【5x5】内植物被音响僵尸施加的「安抚」
 *
 *   几个引擎事实（都在 0.14.0 的包里逐条核对过）：
 *   - 音响僵尸的「安抚」= 植物身上的 plant.boomboxCD > 0（+ boomboxPar 粒子）。
 *     Plant.update 里 boomboxCD > 0 且非 ImmuneToBoomBox 时会把动画时间缩放置 0（植物定住）。
 *     ★ 只把 boomboxCD 置 0 是【没用】的：音响僵尸每帧 readHearts() 会把 lovePs 名单里
 *       的植物重新刷成 0.5 —— 所以必须【同时】把这株植物从它的 lovePs 里摘掉。
 *   - 「音乐（jam）」对僵尸只有两处影响：
 *       移速   —— Zombie.defaultShouldSpeedScale 里 switch (FrontYard.getCurrentJam())
 *       特定状态 —— 各八十年代僵尸类的 dancing / isInJam
 *     所以标记期间：调 defaultShouldSpeedScale 时临时把 getCurrentJam 顶成 jam_clear，
 *     并给【这一只】僵尸装 dancing / isInJam 的实例访问器强制 false。
 *     ★ 只作用在本模组标记过的那一只僵尸身上，不改任何原版公式、不动全局音乐。
 *   - 「向上击起」用引擎自己的 leapBy(方向, ?, 时长, 高度)：
 *       方向传 (0,0) => 水平位移 0（原地）；"向上"由内部的 height_depth 上抛回落负责。
 *       它还会自带 setStun(时长 + 0.01)，所以要先 leapBy、再 setStun(plantfoodStun) 覆盖。
 *   - 击起的豁免：BOSS（引擎只在 ZombossMechZombie 等 3 个类里挡了，不能指望）+
 *     「沉重」（暗物质火龙果的 darkmatter）+ 引擎自己的闸门（specialZombieLeapable / 胶水 / 糯米）。
 *     注意横向击退的闸门是 specialZombieKnockbackable，而 defaultLeapBy 在它拦下之后
 *     仍会抬高僵尸 —— 所以"能不能推"和"能不能抬"必须我们自己判。
 * =======================================================================*/

/** 沿原型链找属性描述符（isInJam 这类 getter 可能定义在祖先类上） */
function gpnFindDesc(obj, key) {
    let o = obj;
    while (o) {
        const d = Object.getOwnPropertyDescriptor(o, key);
        if (d) return d;
        o = Object.getPrototypeOf(o);
    }
    return null;
}

/** 屏蔽一只僵尸身上「音乐」的影响（实例级，只影响这一只；标记到期自动恢复）
 *
 *  ★ 关键（踩过的坑）：dancing 在四个八十年代僵尸类里是【带副作用的 getter/setter】——
 *    setter 负责建 / 销毁专属状态的贴图与动画：
 *      EightiesGlitterZombie（闪耀）      -> 建 / 销毁身后的彩虹节点
 *      EightiesBreakDancerZombie（霹雳舞）-> 切专属动画贴图
 *      EightiesMCZombie / EightiesPunkZombie -> 同上
 *    （EightiesGargantuarZombie 用的是纯 getter 的 isInJam，没有生命周期。）
 *    所以【绝不能】用影子字段把这种字段整个接管：引擎想关掉时不会执行它自己的 setter
 *    ⇒ 贴图卡在专属状态；而且死亡清场（playSpecialZombieDieForced 里的 dancing = false）
 *      也被吞掉 ⇒ 彩虹之类【永远不消散】。
 *    正确做法：写入【原样转发给引擎自己的 setter】，只在解除期间把值改写成 false：
 *      · 解除期间：引擎每帧算出的 true 被改写成 false -> 引擎自己回退贴图 / 动画
 *      · 解除期间死亡：false 正常转发 -> 引擎自己清场（彩虹消散）
 *      · 解除到期：值原样转发 -> 由【引擎自己的判定】决定是否恢复
 *        （场上还在播那段魔音舞台效果就恢复，切走了就保持普通）
 *    getter 必须保持【真实值】：引擎 setter 里那句 `if (t != this.dancing)` 一旦被遮成
 *    false 就会短路，贴图反而永远不会被回退。
 */
function gpnJamMask(z) {
    if (!z || z.__gpnJamMasked) return;
    z.__gpnJamMasked = true;
    try {
        if ('dancing' in z) gpnMaskFlag(z, 'dancing');
        if ('isInJam' in z) gpnMaskFlag(z, 'isInJam');
    } catch (e) { warn('魔音甜菜：屏蔽音乐状态出错', e); }
}

/** 把一个标记字段换成「解除期间强制 false」的访问器
 *  ① 带 setter 的访问器（4 个八十年代僵尸类）-> 写入转发给引擎 setter，贴图/动画交给引擎
 *  ② 纯 getter（isInJam）-> 只遮读取，补个空 setter 防严格模式赋值报错
 *  ③ 普通数据字段            -> 影子值，解除期间读出来是 false */
function gpnMaskFlag(z, key) {
    const d = gpnFindDesc(z, key);
    if (!d) return;
    const rawGet = d.get, rawSet = d.set;
    if (typeof rawSet === 'function') {                       // ①
        Object.defineProperty(z, key, {
            configurable: true, enumerable: true,
            get: function () { return rawGet ? rawGet.call(this) : undefined; },
            set: function (v) { rawSet.call(this, (this.__gpnJamClearCD > 0) ? false : v); },
        });
    } else if (typeof rawGet === 'function') {                // ②
        Object.defineProperty(z, key, {
            configurable: true, enumerable: true,
            get: function () { return (this.__gpnJamClearCD > 0) ? false : rawGet.call(this); },
            set: function () {},
        });
    } else {                                                  // ③
        const raw = z[key];
        Object.defineProperty(z, key, {
            configurable: true, enumerable: true,
            get: function () { return (this.__gpnJamClearCD > 0) ? false : this['__gpnRaw_' + key]; },
            set: function (v) { this['__gpnRaw_' + key] = v; },
        });
        z[key] = raw;
    }
}

/** 原地向上击起一只僵尸（BOSS / 沉重 / 引擎闸门都会跳过） */
function gpnLiftZombie(z, deps, noStun) {
    const C = CFG.phatbeet;
    if (!z || typeof z.leapBy !== 'function') return false;
    if (C.bossBlocksLift && z.isBoss) return false;                    // BOSS：显式挡
    if (C.heavyBlocksLift && z.darkmatter > 0) return false;           // 沉重：不击起
    if (typeof z.specialZombieLeapable === 'function' && !z.specialZombieLeapable()) return false;
    if (z.gummed || z.stickyriced) return false;
    const V = deps.Vec2;
    const dir = (typeof V === 'function') ? new V(0, 0) : { x: 0, y: 0 };
    // 第 8 个参数 = leapBy 是否自带眩晕；无敌僵尸要传 false，免得从这儿漏进眩晕
    z.leapBy(dir, true, C.liftDuration, C.liftHeight, true, false, false, !noStun);
    return true;
}

/** 解除一株植物身上的「安抚」。★ 三件事缺一不可（否则下一帧就被刷回来） */
function gpnClearSoothe(p, deps, fx, srcPlant) {
    if (!p || p.dead) return false;
    const od = p.objdataOwn;
    if (od && od.ImmuneToBoomBox) return false;      // 免疫的植物（含魔音甜菜自己）本来就不会被安抚
    let did = false;
    if (p.boomboxCD > 0) { p.boomboxCD = 0; did = true; }
    if (p.boomboxPar) {
        try { if (typeof deps.destroyPooly === 'function') deps.destroyPooly(p.boomboxPar); }
        catch (e) { warn('魔音甜菜：销毁安抚特效出错', e); }
        p.boomboxPar = null;
        did = true;
    }
    const Sq = deps.Square;
    for (const lane of ((Sq && typeof Sq.getAllLane === 'function') ? (Sq.getAllLane() || []) : [])) {
        const zp = (lane && typeof lane.zombiePool === 'function') ? lane.zombiePool() : null;
        for (const z of (zp || [])) {
            const arr = z && z.lovePs;
            if (!Array.isArray(arr)) continue;
            const i = arr.indexOf(p);
            if (i !== -1) { arr.splice(i, 1); did = true; }
        }
    }
    // ★ ⑦ 真的解除掉了 -> 在这株【被安抚的植物】脚下放一次命中特效（纯视觉，不伤植物）
    if (did && fx && CFG.phatbeet.clearFx) {
        try { gpnHitFxSpawn(fx, p, deps, false, srcPlant); }
        catch (e) { warn('魔音甜菜：解除安抚特效出错', e); }
    }
    return did;
}

/** 要检查的行：普攻 = 本行±1；大招 = 本行±2（和引擎 foodAttack 的取法一致） */
function gpnSootheLanes(plant, big) {
    const out = [];
    const l = plant && plant.inLane;
    if (!l) return out;
    out.push(l);
    if (l.UpperLane) out.push(l.UpperLane);
    if (l.LowerLane) out.push(l.LowerLane);
    if (big) {
        if (l.UpperLane && l.UpperLane.UpperLane) out.push(l.UpperLane.UpperLane);
        if (l.LowerLane && l.LowerLane.LowerLane) out.push(l.LowerLane.LowerLane);
    }
    return out;
}

/** 判定框：普攻直接用植物自己的 3x3 索敌框；大招现造 5x5 */
function gpnSootheRect(plant, deps, big) {
    if (!big && plant && plant.detector) return plant.detector;
    const R = deps.Rectangle, cell = plant && plant.inLnC, Sq = deps.Square;
    if (!R || !cell || !cell.node || typeof R.createRectangleNodeCenter !== 'function' || !Sq) return null;
    return R.createRectangleNodeCenter(cell.node, 5 * Sq.SquareWidth, 5 * Sq.SquareHeight);
}

/** 扫范围内植物，inspect 返回 true 就计数 */
function gpnScanPlants(plant, deps, big, inspect) {
    const rect = gpnSootheRect(plant, deps, big);
    if (!rect || typeof rect.judgeCrossRec !== 'function') return 0;
    let n = 0;
    for (const lane of gpnSootheLanes(plant, big)) {
        if (!lane || typeof lane.plantPool !== 'function') continue;
        for (const p of (lane.plantPool() || [])) {
            if (!p || p.dead || !p.bodyRec) continue;
            if (!rect.judgeCrossRec(p.bodyRec)) continue;
            if (inspect(p)) n++;
        }
    }
    return n;
}

/** 「音乐免疫」的倒数（挂在 FrontYard.update 上，每帧一次）
 *  ★ ⑧ 顺手放"持续特效"：解除期间的僵尸，每 gpnJamFxInterval() 秒在它脚下放一个命中特效
 *     —— 僵尸死 / 期间结束就停（下面两处归零就是停止条件）✓ */
function gpnTickJamClear(Square, dt, fx, deps) {
    if (!(dt > 0) || !Square || typeof Square.getAllLane !== 'function') return;
    const C = CFG.phatbeet;
    // ★ ⑧ 持续特效只给"大招那 25 秒"，普攻的 1.25 秒**不铺**（__gpnJamFxOn 只在大招路径点亮）
    const wantFx = !!(C.jamFx && fx && deps && typeof deps.instantiatePooly === 'function');
    const iv = wantFx ? gpnJamFxInterval(fx) : 0;
    for (const lane of (Square.getAllLane() || [])) {
        if (!lane) continue;
        const pools = [];
        if (typeof lane.zombiePool === 'function') pools.push(lane.zombiePool());
        if (typeof lane.hypnoZombiePool === 'function') pools.push(lane.hypnoZombiePool());
        for (const pool of pools) {
            for (const z of (pool || [])) {
                if (!z || !(z.__gpnJamClearCD > 0)) { if (z) { z.__gpnJamFxAcc = 0; z.__gpnJamFxOn = false; } continue; }
                z.__gpnJamClearCD -= dt;
                if (z.dead) { z.__gpnJamClearCD = 0; z.__gpnJamFxAcc = 0; z.__gpnJamFxOn = false; continue; }
                if (wantFx && z.__gpnJamFxOn) {
                    z.__gpnJamFxAcc = (z.__gpnJamFxAcc || 0) + dt;
                    if (z.__gpnJamFxAcc >= iv) {
                        z.__gpnJamFxAcc = 0;
                        gpnHitFxSpawn(fx, z, deps, !C.jamFxLiftFollow);   // 纯特效：只放节点，不碰伤害
                    }
                }
                if (z.__gpnJamClearCD <= 0) { z.__gpnJamClearCD = 0; z.__gpnJamFxAcc = 0; z.__gpnJamFxOn = false; }
            }
        }
    }
}

/* ==========================================================================
 * 魔音甜菜的「命中特效」（hitPar）—— 纯视觉，不造成任何伤害
 *  引擎事实（PhatBeetPlant.playHitOnCharacter）：
 *    var e = instantiatePooly(this.hitPar);
 *    e.parent = target.inLane.prjLayer;
 *    e.worldPosition = target.worldPosition.toVec3();
 *  ⇒ 我们**一模一样**照抄这三行：实例化 -> 挂到【目标所在行的 prjLayer】-> 位置 = 目标脚下。
 *  预制体自带 ParticleSelfdestroy，会在动画的 "die" 帧事件里 NodePools.destroyPooly 回池，
 *  所以放出去的节点都会自己消失，不会残留（引擎自己就是这么用的）✓
 * ========================================================================== */

/** 取目标（僵尸/植物）所在行 */
function gpnFxLane(target) {
    if (!target) return null;
    if (target.inLane) return target.inLane;
    const c = target.inLnC;
    return (c && c.inLane) || null;
}

/** 目标脚下的世界坐标（Vec3）。ground=true 时忽略高度（用行中线：用于"击起时留在地面"） */
function gpnFxPos(target, lane, ground, deps) {
    if (!target) return null;
    let x, y, z = 0, ok = false;
    const wp = target.worldPosition;
    if (wp && typeof wp.x === 'number' && typeof wp.y === 'number') {
        x = wp.x; y = wp.y; z = wp.z || 0; ok = true;
    } else if (typeof target.worldPositionX === 'number') {
        x = target.worldPositionX; y = target.worldPositionY; z = 0; ok = true;
    } else {
        const nwp = target.node && target.node.worldPosition;
        if (nwp && typeof nwp.x === 'number') { x = nwp.x; y = nwp.y; z = nwp.z || 0; ok = true; }
    }
    if (!ok) return null;
    if (ground && lane && typeof lane.midY === 'number') y = lane.midY;
    const V3 = deps && deps.Vec3;
    if (typeof V3 === 'function') {
        try { return new V3(x, y, z); } catch (e) { /* 落到下面的兜底 */ }
    }
    if (!ground && wp && typeof wp.toVec3 === 'function') {
        try { return wp.toVec3(); } catch (e) { /* 落到下面的兜底 */ }
    }
    return { x: x, y: y, z: z };
}

/** 读命中特效的动画时长（秒）。不写死任何数字：
 *  ParticleSelfdestroy.db 就是 ArmatureDisplay，而引擎自己就是用 totalTime 算播放进度的
 *  （lastAnimationState; 进度 = currentTime / totalTime）✓ */
function gpnFxTotalTime(node, deps) {
    if (!node) return 0;
    const comps = [];
    try {
        if (deps && typeof deps.Component === 'function' && typeof node.getComponents === 'function') {
            const all = node.getComponents(deps.Component);
            if (Array.isArray(all)) for (const c of all) comps.push(c);
        }
    } catch (e) { /* 换下面的路子 */ }
    try {
        if (!comps.length && Array.isArray(node.components)) for (const c of node.components) comps.push(c);
    } catch (e) { /* 读不到就算了 */ }
    for (const c of comps) {
        if (!c) continue;
        let db = null;
        try { db = c.db; } catch (e) { /* 不是 ParticleSelfdestroy */ }
        if (!db && typeof c.armature === 'function') db = c;       // 万一直接拿到 ArmatureDisplay
        if (!db || typeof db.armature !== 'function') continue;
        try {
            const arm = db.armature();
            const st = arm && arm.animation && arm.animation.lastAnimationState;
            const t = st && st.totalTime;
            if (t > 0) return t;
        } catch (e) { /* 换下一个组件 */ }
    }
    return 0;
}

/** 持续特效的间隔（秒）：优先手调 -> 自动读动画时长 -> 兜底 */
function gpnJamFxInterval(fx) {
    const C = CFG.phatbeet;
    let iv = (C.jamFxInterval > 0) ? C.jamFxInterval
        : ((fx && fx.dur > 0) ? fx.dur : C.jamFxFallback);
    iv *= (C.jamFxScale > 0) ? C.jamFxScale : 1;
    if (!(iv > 0)) iv = 0.3;
    return Math.max(0.05, iv);
}

/**
 * 命中特效的「资源来源」：
 *   1) 手上有活体（srcPlant，解除安抚那条一定传）-> 直接用它的 hitPar
 *   2) 扫一遍所有车道，任意一株活着的魔音甜菜（有 hitPar 属性的）
 *   3) ★ 缓存：**在魔音甜菜标记僵尸的那一刻就存下来**（那时它必然活着）+ 场景键 + addRef 钉住
 *      —— 这样"魔音甜菜死掉/被铲之后"的持续特效照样放得出来 ✓
 *
 *  ★ 三条硬约束（v1.0.0 的两次教训）：
 *    · 【不能】要求场上有活体 —— 否则魔音甜菜一死，标记僵尸的持续特效就没了（本次修掉的 BUG）；
 *    · 【不能】跨场景用旧资源 —— 换场景时引擎会释放资源，拿旧的 instantiate 会抛
 *      `Cannot read properties of null (reading '_prefab')`（v1.0.0 踩过的坑）；
 *    · 万一还是拿到失效资源 -> gpnHitFxSpawn 里 try/catch 会**清缓存 + 下次重取**，不用大退 ✓
 */
function gpnFxSceneKey(deps) {
    const fy = deps && deps.FrontYard;
    if (fy) {
        if (fy.CurrentLawn) return fy.CurrentLawn;              // 关卡对象/节点：换场景必变
        if (fy.CurrentLawnID != null) return 'id:' + fy.CurrentLawnID;
    }
    const Sq = deps && deps.Square;
    const lanes = (Sq && typeof Sq.getAllLane === 'function') ? (Sq.getAllLane() || []) : null;
    const first = lanes && lanes[0];
    if (first && first.node) return first.node;                  // 兜底：第一条车道的节点
    return null;                                                 // 拿不到 -> 用 null（靠 try/catch 兜底）
}

/** 丢掉缓存（换场景 / 出厂清理 / 资源失效时调）—— 记得 decRef 配平
 *  ★ 只有【我们真的 addRef 成功过】（c.refd）才 decRef：这版游戏里没看到 addRef 的调用点，
 *    万一运行时没有 addRef（或抛错），凭空 decRef 会把【原版还在用】的资源引用扣没 ⇒ 贴图/特效被提前释放 ✗ */
function gpnFxDropCache(fx) {
    const c = fx && fx.cache;
    if (!c) return;
    if (c.refd && c.prefab && typeof c.prefab.decRef === 'function') {
        try { c.prefab.decRef(); } catch (e) { /* 资源可能已经没了，无所谓 */ }
    }
    c.prefab = null;
    c.sceneKey = null;
    c.refd = false;
}

/** 把一份 hitPar 存进缓存（幂等：同一个 prefab 不会重复 addRef） */
function gpnFxCacheHitPar(fx, plant, deps) {
    if (!fx || !plant || !plant.hitPar) return;
    if (!fx.cache) fx.cache = { prefab: null, sceneKey: null, refd: false };
    const c = fx.cache;
    if (c.prefab === plant.hitPar) { c.sceneKey = gpnFxSceneKey(deps); return; }   // 已存过同一个
    gpnFxDropCache(fx);                                          // 换了新的 -> 先把旧的配平
    c.prefab = plant.hitPar;
    c.sceneKey = gpnFxSceneKey(deps);
    c.refd = false;
    if (typeof c.prefab.addRef === 'function') {
        try { c.prefab.addRef(); c.refd = true; } catch (e) { /* 没有引用计数就算了 */ }
    }
    if (dbgOn(CFG.phatbeet.debugLog)) log('魔音甜菜：命中特效资源已缓存（标记时存下，之后不依赖活体）');
}

function gpnMkFreshPrefab(srcPlant, deps, fx) {
    if (srcPlant && !srcPlant.dead && srcPlant.hitPar) {
        gpnFxCacheHitPar(fx, srcPlant, deps);                   // 活体 -> 顺手缓存一份
        return srcPlant.hitPar;
    }
    const Sq = deps && deps.Square;
    if (Sq && typeof Sq.getAllLane === 'function') {
        for (const lane of (Sq.getAllLane() || [])) {
            if (!lane || typeof lane.plantPool !== 'function') continue;
            for (const p of (lane.plantPool() || [])) {
                if (p && !p.dead && p.hitPar) {                 // 有 hitPar 的就是魔音甜菜
                    gpnFxCacheHitPar(fx, p, deps);              // 活体 -> 顺手缓存一份
                    return p.hitPar;
                }
            }
        }
    }
    // ★ 缓存兜底：**场景键一致**才用（换场景必变 ⇒ 绝不会拿旧场景的失效资源）
    const c = fx && fx.cache;
    if (c && c.prefab && c.sceneKey === gpnFxSceneKey(deps)) return c.prefab;
    return null;
}

/** 限流告警：同一条消息 5 秒内最多打一条（免得一次会话刷几十条） */
function gpnFxWarn(fx, msg, e) {
    const now = Date.now();
    if (fx && fx.warnMsg === msg && fx.warnAt && (now - fx.warnAt) < 5000) return;
    if (fx) { fx.warnMsg = msg; fx.warnAt = now; }
    warn(msg, e);
}

/** 在【目标脚下】放一个命中特效；返回节点（拿不到资源/层级时返回 null，绝不抛错）。
 *  srcPlant：可选，优先从它身上取 hitPar（解除安抚那条会传） */
function gpnHitFxSpawn(fx, target, deps, ground, srcPlant) {
    if (!fx || !target) return null;
    const inst = deps && deps.instantiatePooly;
    if (typeof inst !== 'function') return null;
    const prefab = gpnMkFreshPrefab(srcPlant, deps, fx);        // 活体优先，其次缓存（场景键一致才用）
    if (!prefab) {
        fx.prefab = null;
        if (dbgOn(CFG.phatbeet.debugLog)) log('魔音甜菜：取不到命中特效资源（活体和缓存都没有），跳过');
        return null;
    }
    // 拿到活体的 prefab 时，gpnMkFreshPrefab 内部已经顺手存了缓存 ✓
    const lane = gpnFxLane(target);
    let layer = lane && lane.prjLayer;
    if (!layer && deps && deps.Square) layer = deps.Square.electricLineLayer;   // 兜底：和音波同一层
    if (!layer) return null;
    const wp = gpnFxPos(target, lane, ground, deps);
    if (!wp) return null;
    let node = null;
    try {
        node = inst(prefab);
        if (!node) return null;
        node.parent = layer;
        node.worldPosition = wp;
        fx.prefab = prefab;                                     // 记一下（调试/统计用）
    } catch (e) {
        fx.prefab = null;                                       // ★ 失败就丢掉：下次自动重取，不用大退
        gpnFxDropCache(fx);                                     //   连缓存一起丢（可能是失效资源）
        gpnFxWarn(fx, '魔音甜菜：放命中特效出错（资源可能已随场景释放）', e);
        return null;
    }
    if (!(fx.dur > 0)) {                                        // 首次顺手量一下动画时长
        const t = gpnFxTotalTime(node, deps);
        if (t > 0) {
            fx.dur = t;
            if (dbgOn(CFG.phatbeet.debugLog)) log('魔音甜菜：命中特效动画时长 = ' + t + ' 秒（持续特效按它来）');
        }
    }
    return node;
}

function makePhatBeetPatch(PhatBeetPlant, deps) {
    const recs = [];
    const P = PhatBeetPlant && PhatBeetPlant.prototype;
    if (!P) { warn('跳过魔音甜菜：拿不到 PhatBeetPlant'); return null; }
    const C = CFG.phatbeet;
    const Zombie = deps.Zombie, FrontYard = deps.FrontYard;
    const JAM_CLEAR = (deps.JamStyle && deps.JamStyle.jam_clear != null) ? deps.JamStyle.jam_clear : 6;
    // ⑦⑧ 命中特效状态：hitPar 预制体（共享资源，取一次）+ 动画时长（首次用时自动读）
    //   cache = **场景内的资源缓存**：标记僵尸那一刻存下 hitPar + 场景键 + addRef 钉住
    //   ⇒ 魔音甜菜死后持续特效照样放得出来；换场景（场景键不一致）则自动作废 ✓
    const fx = { prefab: null, dur: 0, cache: { prefab: null, sceneKey: null, refd: false } };
    // 卸载模组时把缓存里的引用配平（decRef）
    recs.push({ __onCleanup: function () { gpnFxDropCache(fx); } });

    // ---- (1) 命中那一刻：普攻 0.075s 眩晕 / 大招 2s + 原地击起 + 音乐免疫 ----
    if (typeof P.playHitOnCharacter === 'function') {
        const rec = methodRecord(PhatBeetPlant, 'playHitOnCharacter');
        P.playHitOnCharacter = function (target) {
            const r = rec.original.apply(this, arguments);
            if (!featOn('phatbeet')) return r;   // 【运行期开关】关掉 ⇒ 不做眩晕/击起/解除音乐
            try {
                // ★ 命中特效资源：在这一刻把本株的 hitPar 存进缓存 —— 此刻它**必然活着**，
                //   之后就算它死了/被铲了、被标记僵尸的持续特效也照样放得出来 ✓
                //   （这就是本次修掉的 BUG：以前是"每次现取"，场上没活体就取不到）
                if (C.jamFx || C.clearFx) gpnFxCacheHitPar(fx, this, deps);
                // 只有僵尸有 setStun；障碍物（墓碑/冰块/冲浪板…）没有 -> 天然跳过
                if (target && typeof target.setStun === 'function') {
                    // 无敌（闪耀僵尸专属状态的彩虹 / 仙桃给的）不吃眩晕。注意 leapBy 自带
                    // setStun(时长+0.01)，所以也要把它的自动眩晕关掉，否则会从这儿漏进来。
                    const invin = !!target.invincible;
                    if (this.__gpnFooding) {                          // ---- 大招命中 ----
                        gpnLiftZombie(target, deps, invin);           // 内部会 setStun(时长+0.01)
                        if (!invin && !target.isBoss && C.plantfoodStun > 0) {
                            target.setStun(C.plantfoodStun);         // 覆盖成 plantfoodStun 秒
                        }
                        if (C.jamClearSeconds > 0 && !(C.bossBlocksLift && target.isBoss)) {
                            gpnJamMask(target);
                            target.__gpnJamClearCD = Math.max(target.__gpnJamClearCD || 0, C.jamClearSeconds);
                            target.__gpnJamFxAcc = 0;   // ⑧ 持续特效从这一发之后重新计时（这一发引擎自己已经放过了）
                            target.__gpnJamFxOn = !!C.jamFx;   // ★ 只有大招点亮"铺持续特效"（普攻默认不铺）
                            // 立刻关掉专属状态：写入会经转发访问器走到【引擎自己的 setter】
                            //   -> 贴图/动画当场回退（闪耀僵尸的彩虹立刻消散），不用等下一帧
                            try { if ('dancing' in target) target.dancing = false; } catch (e) {}
                        }
                    } else if (!invin && !target.isBoss && C.normalStun > 0) {   // ---- 普攻命中 ----
                        target.setStun(C.normalStun);
                        // ★ ①b 用户 2026/10/16：**普攻也让目标暂时不受魔音舞台效果影响**（1.25 秒）
                        //   复用同一套屏蔽（gpnJamMask 幂等）＋ 剩余秒数取 max（**不会缩短**大招的 25 秒）
                        if (C.normalJamClearSeconds > 0) {
                            gpnJamMask(target);
                            target.__gpnJamClearCD = Math.max(target.__gpnJamClearCD || 0, C.normalJamClearSeconds);
                            if (C.normalJamFx) target.__gpnJamFxOn = true;   // 默认 false ⇒ 普攻不铺特效
                            try { if ('dancing' in target) target.dancing = false; } catch (e) {}
                        }
                    }
                }
            } catch (e) { warn('魔音甜菜：命中效果出错', e); }
            return r;
        };
        recs.push(rec);
    } else {
        warn('跳过魔音甜菜：没有 playHitOnCharacter（眩晕 / 击起会失效）');
    }

    // ---- (2) 普攻：解除 3x3 内的安抚 ----
    if (C.clearPlantDebuff && typeof P.attack === 'function') {
        const rec = methodRecord(PhatBeetPlant, 'attack');
        P.attack = function () {
            const r = rec.original.apply(this, arguments);
            if (!featOn('phatbeet')) return r;   // 【运行期开关】关掉 ⇒ 不解除安抚
            try {
                const n = gpnScanPlants(this, deps, false, (p) => gpnClearSoothe(p, deps, fx, this));
                if (n && C.debugLog) log('魔音甜菜：普攻解除安抚 ' + n + ' 株');
            } catch (e) { warn('魔音甜菜：普攻解除安抚出错', e); }
            return r;
        };
        recs.push(rec);
    }

    // ---- (3) 大招：标记「正在大招」 + 解除 5x5 内的安抚 ----
    if (typeof P.foodAttack === 'function') {
        const rec = methodRecord(PhatBeetPlant, 'foodAttack');
        P.foodAttack = function () {
            this.__gpnFooding = true;
            let r;
            try { r = rec.original.apply(this, arguments); }
            finally { this.__gpnFooding = false; }
            if (!featOn('phatbeet')) return r;   // 【运行期开关】关掉 ⇒ 大招不解除安抚
            try {
                if (C.clearPlantDebuff) {
                    const n = gpnScanPlants(this, deps, true, (p) => gpnClearSoothe(p, deps, fx, this));
                    if (n && C.debugLog) log('魔音甜菜：大招解除安抚 ' + n + ' 株');
                }
            } catch (e) { warn('魔音甜菜：大招解除安抚出错', e); }
            return r;
        };
        recs.push(rec);
    } else {
        warn('跳过魔音甜菜：没有 foodAttack');
    }

    // ---- (4) 索敌：3x3 内有被安抚的植物 -> 也算「有敌人」（会发动普攻；普攻不伤植物）----
    if (typeof P.detectEnemies === 'function') {
        const rec = methodRecord(PhatBeetPlant, 'detectEnemies');
        P.detectEnemies = function () {
            if (rec.original.apply(this, arguments)) return true;
            if (!featOn('phatbeet')) return false;   // 【运行期开关】关掉 ⇒ 不因"范围内有被安抚植物"而开火
            try {
                return gpnScanPlants(this, deps, false,
                    (p) => !(p.objdataOwn && p.objdataOwn.ImmuneToBoomBox) && p.boomboxCD > 0) > 0;
            } catch (e) { return false; }
        };
        recs.push(rec);
    }

    // ---- (5) 音乐免疫：标记期间这一只僵尸的移速不吃 jam 加成 ----
    if (Zombie && Zombie.prototype && typeof Zombie.prototype.defaultShouldSpeedScale === 'function') {
        const rec = methodRecord(Zombie, 'defaultShouldSpeedScale');
        Zombie.prototype.defaultShouldSpeedScale = function () {
            if (!featOn('phatbeet')) return rec.original.apply(this, arguments);   // 【运行期开关】关掉 ⇒ 无音乐免疫
            if (!(this.__gpnJamClearCD > 0) || !FrontYard
                || typeof FrontYard.getCurrentJam !== 'function') {
                return rec.original.apply(this, arguments);
            }
            // 只在【这一只】算移速的这一瞬间，把当前音乐顶成 jam_clear
            //   -> 原版那三行 jam 乘数自然失效；同步执行、finally 还原，不污染全局
            const orig = FrontYard.getCurrentJam;
            try {
                FrontYard.getCurrentJam = function () { return JAM_CLEAR; };
                return rec.original.apply(this, arguments);
            } finally {
                FrontYard.getCurrentJam = orig;
            }
        };
        recs.push(rec);
    } else {
        warn('跳过魔音甜菜：拿不到 Zombie.defaultShouldSpeedScale（音乐免疫会失效）');
    }

    // ---- (6) 15 秒倒数 ----
    if (FrontYard && FrontYard.prototype && typeof FrontYard.prototype.update === 'function') {
        const rec = methodRecord(FrontYard, 'update');
        FrontYard.prototype.update = function (dt) {
            const r = rec.original.apply(this, arguments);
            try { gpnTickJamClear(deps.Square, dt, fx, deps); }
            catch (e) { warn('魔音甜菜：音乐免疫倒计时出错', e); }
            return r;
        };
        recs.push(rec);
    }

    // ---- (7) 僵尸池化复用：清 buff 时顺手把我们的标记归零 ----
    if (Zombie && Zombie.prototype && typeof Zombie.prototype.clearBuff === 'function') {
        const rec = methodRecord(Zombie, 'clearBuff');
        Zombie.prototype.clearBuff = function () {
            const r = rec.original.apply(this, arguments);
            this.__gpnJamClearCD = 0;
            this.__gpnJamFxAcc = 0;
            this.__gpnJamFxOn = false;
            this.__gpnDancingRaw = undefined;
            this.__gpnDrivenAway = false;   // 池化复用：运兵艇的"已驱离"标记也要清
            return r;
        };
        recs.push(rec);
    }

    return recs;
}

/** 复制一条现成弹道（复用贴图/特效）换别名 + 微调；幂等 */
function gpnCloneProjectile(Container, fromAlias, newAlias, tweak) {
    const list = Container && Container.ProjectileProps;
    if (!Array.isArray(list)) { warn('寒冰射手：拿不到 ProjectileProps'); return null; }
    let src = null, dup = null;
    for (const e of list) {
        const al = (e && e.aliases) || [];
        if (al.indexOf(fromAlias) !== -1) src = e;
        if (al.indexOf(newAlias) !== -1) dup = e;
    }
    if (!src) { warn('寒冰射手：找不到要复用的弹道 ' + fromAlias); return null; }
    if (dup) return dup;
    const od = {};
    Object.keys(src.objdata || {}).forEach((k) => { od[k] = src.objdata[k]; });
    if (tweak) tweak(od);
    const e2 = { objclass: src.objclass, aliases: [newAlias], objdata: od };
    list.push(e2);
    return e2;
}

/** 甜椒落点铺火用到的引擎依赖（`setup()` 里分配，供自检/诊断复用）。
 *  ⚠️ 只是**引用存档**，不改变任何行为。 */
let gpnPepperDeps = null;

/** ★★ 场外范围兜底（修 2026/10/14 用户报告的三个 BUG）★★
 *
 *  问题：**最右列（cIndex 8）的更右侧 = 场外**，那里的格是全场共用的假格 `LnCRight`
 *        （**`lIndex = -2`**、`cIndex = 9`）。引擎的通用范围通道 `SplashDamage` 带一道
 *        `lIndex 必须 0..4` 的守卫 ⇒ **场外时整段范围效果被跳过** ⇒ 只有被直接命中的那一个生效。
 *
 *  本函数绕开那条通道，照原版「寒冰辣椒 `_chillLane`」的模板做：
 *      **按 Y 求行 → 行池（`lane.zombiePool()`）→ 自算判定框 → 直接对僵尸施加效果**
 *
 *  @param shot  命中的那颗弹道（`commonShot` 实例）
 *  @param z     被直接命中的僵尸
 *  @param deps  `{ Square, Rectangle }`（引擎类）
 *  @param kinds 要兜底的效果：`'snow'`（冰减速/冻结，读弹道自身的 `chill`/`freeze`）
 *                              `'bloom'`（心蕊 1×3 减防 DEBUFF，读弹道自身的 `DefenceRateList`）
 *  @returns 是否真的施加了（只为日志用）
 */
function gpnOffFieldAreaApply(shot, z, deps, kinds) {
    if (!shot) return false;
    const Square = deps && deps.Square, Rect = deps && deps.Rectangle;
    if (!Square || !Rect || typeof Square.getLane !== 'function') return false;
    // ① 只有【场外】才兜底：场内一律交给引擎，绝不重复施加
    if (!gpnIsOffField(shot) && !gpnIsOffField(z)) return false;
    // ② 行号：**不能用 lIndex（场外是 -2）**，按 Y 坐标求
    const lane = gpnLaneByY((z && typeof z.worldPositionY === 'number') ? z.worldPositionY : shot.worldPositionY, Square);
    if (lane < 0) return false;
    const laneObj = gpnLaneObj(lane, Square);
    if (!laneObj || typeof laneObj.zombiePool !== 'function') return false;

    const pool = laneObj.zombiePool();
    if (!pool) return false;
    const W = (typeof Square.SquareWidth === 'number') ? Square.SquareWidth : 68;
    const H = (typeof Square.SquareHeight === 'number') ? Square.SquareHeight : 80.77;

    // ★★★ 范围判定框：**以"命中目标"为中心造【唯一一个】框**，再拿它去判行池里每一只。
    //   ❌❌ 绝对不要"以被检查的那只僵尸自己为中心造框"—— 那样 `judgeCrossRec(它自己的 body)`
    //       **必然为真** ⇒ 行池里每一只都会通过 ⇒ **整行僵尸全被挂上 DEBUFF**
    //       （用户实测报的恶性 BUG，就是这个写法造成的）。
    //   中心取法（按可靠性）：命中目标的世界坐标 → 弹道自己的世界坐标 → 最右列格心。
    let cx = null, cy = null;
    try {
        const zz0 = z;
        if (zz0 && typeof zz0.worldPositionX === 'number' && typeof zz0.worldPositionY === 'number') {
            cx = zz0.worldPositionX; cy = zz0.worldPositionY;
        } else if (shot && typeof shot.worldPositionX === 'number' && typeof shot.worldPositionY === 'number') {
            cx = shot.worldPositionX; cy = shot.worldPositionY;
        } else if (typeof Square.getSquareWorldPosition === 'function') {
            const v = Square.getSquareWorldPosition(lane, 8, 0.5, 0.5);
            if (v) { cx = v.x; cy = v.y; }
        }
    } catch (e) { cx = null; }
    if (cx === null || cy === null) return false;

    let rec = null;
    try {
        // 宽 = 2 格（左右各 1 格），高 = 1 格（只在同一行）
        if (typeof Rect.createRectangleCenter === 'function') rec = Rect.createRectangleCenter({ x: cx, y: cy }, W * 2, H);
    } catch (e) { rec = null; }
    if (!rec) return false;

    let applied = 0;
    for (const zz of pool.concat()) {                       // concat()：遍历中可能有人死亡
        if (!zz || typeof zz.isAlive !== 'function' || !zz.isAlive()) continue;
        // 被【直接命中】的那一只一定生效；其余必须**真的落在框里**才算
        let hit = (zz === z);
        if (!hit) {
            const body = zz.bodyRecReal || zz.bodyRec;
            hit = !!(body && rec.judgeCrossRec(body));
        }
        // ★★★ 不在范围内 ⇒ 必须跳过（少了这一句 ⇒ 行池里每只都会吃到 ⇒ 整行全挂）
        if (!hit) continue;

        if (kinds.indexOf('snow') !== -1) {
            const chill = (typeof shot.chill === 'number' && shot.chill > 0) ? shot.chill : 0;
            const freeze = (typeof shot.freeze === 'number' && shot.freeze > 0) ? shot.freeze : 0;
            if (chill > 0 && typeof zz.setChill === 'function') { try { zz.setChill(chill); applied++; } catch (e) { } }
            if (freeze > 0 && typeof zz.setFreeze === 'function') { try { zz.setFreeze(freeze); applied++; } catch (e) { } }
        }
        if (kinds.indexOf('bloom') !== -1) {
            if (typeof zz.pushBloomingHeartDefenceRateList === 'function' && shot.DefenceRateList) {
                try { zz.pushBloomingHeartDefenceRateList(shot.DefenceRateList, shot.BloomingHeartBuffPar); applied++; } catch (e) { }
            }
        }
    }
    if (applied && dbgOn(CFG.pepperpult.debugLog)) {
        log('【场外范围兜底】行=' + lane + ' 框心=(' + cx + ',' + cy + ') 共施加 ' + applied + ' 次（' + kinds.join('/') + '）');
    }
    // ★ 返回**真实施加次数**（不是布尔）：调用方靠它判断"有没有真的生效过"。
    return (shot.__gpnOffFieldApplied = applied);
}


/** 寒冰射手（Snow Pea）：冰锥概率控制
 *  引擎事实：普攻走 get defaultPea(){ Math.random() < ChanceToFreeze ? PeaFreezeType : PeaType }；
 *  而【大招】在 onFoodLeftPeaCountDec 里【显式】传 PeaTypePlantfood ⇒ 绕过 defaultPea ⇒ 永远不出冰锥；
 *  另外 defaultPea 也【不吃薄荷倍率】（那是雪滴花 Butter 那条路径才有）。
 *  所以统一在 _shoot 里处理：
 *    · 大招弹（显式 PeaTypePlantfood）-> 每发独立掷
 *    · 普攻（不传类型）            -> 由我们掷并把类型显式传进去（才吃薄荷 x3）
 *    · 其它调用（已显式传类型）    -> 原样放行 */
function makeSnowPeaFreezePatch(SnowPeaPlant, CommonShot, deps) {
    const recs = [];
    const P = SnowPeaPlant && SnowPeaPlant.prototype;
    if (!P || typeof P._shoot !== 'function') { warn('跳过寒冰射手冰锥：拿不到 SnowPeaPlant._shoot'); return null; }

    // ★★ 场外兜底（修 2026/10/14 用户报告）：寒冰的「单格冰减速 / 冰锥单格冻结」走的是引擎的
    //    `SplashDamage` 通道，而那条通道有 `lIndex 必须 0..4` 的守卫 ⇒ **打场外目标时整段失效**
    //    （表现为"实际为单体"）。这里补一条入场：**只在场外**时自己按"行池 + 判定框"施加
    //    （场内仍交给引擎，绝不重复）。
    //    认领方式：看弹道自身有没有 `chill`/`freeze`（寒冰系弹道才有）⇒ 其它植物的弹不受影响。
    if (CommonShot && CommonShot.prototype && typeof CommonShot.prototype.dealDamageToZombie === 'function') {
        const recD = methodRecord(CommonShot, 'dealDamageToZombie');
        CommonShot.prototype.dealDamageToZombie = function (z, isDirect) {
            const r = recD.original.apply(this, arguments);
            try {
                if (featOn('snowpea') && isDirect !== false && z && !this.__gpnSnowOffField) {
                    const snowish = (typeof this.chill === 'number' && this.chill > 0)
                        || (typeof this.freeze === 'number' && this.freeze > 0);
                    if (snowish && (gpnIsOffField(this) || gpnIsOffField(z))) {
                        this.__gpnSnowOffField = true;      // 一发只兜一次
                        gpnOffFieldAreaApply(this, z, deps, ['snow']);
                    }
                }
            } catch (e) { warn('寒冰射手：场外减速兜底出错', e); }
            return r;
        };
        recs.push(recD);
    } else {
        warn('寒冰射手：拿不到 commonShot.dealDamageToZombie ⇒ 场外目标的单格减速仍会失效');
    }

    const C = CFG.snowpea;
    const rec = methodRecord(SnowPeaPlant, '_shoot');
    P._shoot = function (a0, a1, a2) {
        // ★ 运行期开关：关掉 snowpea ⇒ 冰锥/减速完全不插手（直接走原逻辑）
        if (!featOn('snowpea')) return rec.original.apply(this, arguments);
        try {
            const od = this._objdataOwn;
            if (od && od.PeaType && od.PeaFreezeType) {
                const mint = (this.MintBoosted && C.mintChanceFactor > 0) ? C.mintChanceFactor : 1;
                const chance = Math.min(1, C.freezeChance * mint);
                if (a2 === od.PeaTypePlantfood) {
                    if (Math.random() < chance) {
                        const args = Array.prototype.slice.call(arguments);
                        args[2] = od.PeaFreezeType;
                        return rec.original.apply(this, args);
                    }
                } else if (a2 === undefined) {
                    const args = Array.prototype.slice.call(arguments);
                    args[2] = (Math.random() < chance) ? od.PeaFreezeType : od.PeaType;
                    return rec.original.apply(this, args);
                }
            }
        } catch (e) { warn('寒冰射手：冰锥掷骰出错', e); }
        return rec.original.apply(this, arguments);
    };
    recs.push(rec);
    return recs;
}


/* =========================================================================
 * 流星花（MeteorFlower）：索敌策略
 *
 *  ⚠️ 现状 = **P0（只挂空补丁，行为与原版逐字等价）**。
 *     后续步骤：
 *       P1 第 2 颗流星：去掉"35% 打歪"，改为 50% 密度最高格 / 50% 随机僵尸格
 *       P2 第 1 颗流星：本行最靠左 → 全场最靠左（两级优先；`cIndex` 最小）
 *       P3 第 1/2 颗：可索敌"障碍物 + 敌方护盾"
 *       P4 features.json 开关 `meteorflowerAim`
 *
 *  === 引擎事实（已逐字核对 1.5.5 bundle，见 §开发修订记录）===
 *   · 模块 `chunks:///_virtual/MeteorFlower.ts`，导出 `MeteorFlowerPlant`（`t("MeteorFlowerPlant",...)`）。
 *   · 原版索敌写在 `MeteorFlowerPlant.prototype.detectEnemy`：
 *       只有 `thrownAmount <= 0`（第 1 颗）或 `Math.random() < SecondMeteorMissChance(0.35)`（第 2 颗）
 *       时才去找目标；找目标的规则是【全草坪僵尸池里 cIndex 最大（最靠右）的那只所在格】。
 *     - 僵尸筛选：`isInLawn()`（lIndex 0..4 且 cIndex 0..8）；所在格 `getSquareType()` 必须是
 *       `solid` 或 `deck`。
 *     - 池为空 ⇒ 退化查 `TombPool`（墓碑）。
 *     - 第 2 颗若没选出目标（35% 打歪 / 池空）⇒ `Square.getRandomLnC()` **随机一个草坪格照砸**。
 *   · 投掷入口：
 *       `_throw(pos)`：`pos.worldPosition` 是**格心 Vec3**（`LnC.plantPoint`），落点 = 该格；
 *                     内部 `lobOneCabbageOnPos(..., new Vec2(pos.worldPosition.x - 10*SquareWidth,
 *                     pos.worldPosition.y), 700, this.inLane.prjLayer, pos.worldPosition.toVec2(), ...)`
 *       `_throwAtZombie(z)`：以僵尸世界坐标为目标，走 `lobOneCabbageOnZombie`。
 *     两者着陆后都 `setTileLiquid` 铺熔岩 + `judgeInLnC` + 吓跑同格恐龙。
 *   · 一次点燃期扔 `MeteorCountOnce(2)` 颗，之后 `rest()` 休息 `RestTime(7)` 秒。
 *   · 大招 `specialPlantFood` **不走 detectEnemy**（自己每 0.1s 对草坪内随机僵尸扔 5 颗）。
 *
 *  === 关键辅助事实 ===
 *   · 三种护盾实体（`ZombieEnum.future_protector_shield` / `future_infinut_shield` /
 *     `modern_moonflower_shield`）都是 **`Zombie` 的子类**、`isRealZombie === false`，
 *     并且**会被注册进 `ZombiePool.pool()`**（`registerZombie` 只判 `hypnotized`，不看 isRealZombie）
 *     ⇒ 遍历"真僵尸"时必须把它们排除（本模组已有 `gpnIsShieldZombie` 可复用）。
 *   · 护盾**在哪一方由它自己的 `hypnotized` 决定**（引擎 `turnVelocity` 里就会把植物方的盾杀掉重建）；
 *     `hypnotized === false` ⇒ 僵尸方（可被植物攻击）；`true` ⇒ 植物方（自家，不砸）。
 *   · `LnC.zombieShields` 是护盾的权威容器；`Lane.laneLnCs` / `Square.getAllLnC()` 可列举格子。
 *   · 墓碑（含**冲浪板**）走 `TombPool` / `Lane.tombPool()`，与护盾**不重叠**。
 *     `TombEnum` 共 32 项，其中 6 项**不应当是流星目标**：
 *       kongfu_TNT(17) / planttarget_iceblock(21) / zombietarget_iceblock(22) /
 *       zombietarget_birthday_present(23) / zomboss_iceage_glacier_block(24) / planttarget_squid(25)
 * =======================================================================*/

/* ===== 流星花索敌：模块级纯函数（自检直接单测；补丁本体也调用它们，避免两份实现）=====
 *  deps 需要 `{ Square, ZombieEnum }`。
 *  ⚠️ 全部**只读**输入、不产生副作用、不依赖 this ⇒ 可以被自检用假数据反复调用。 */

/** 对象的所在格（统一走 `inLnC`；**不要**用 `.cIndex/.lIndex` 缓存字段） */
function gpnMeteorCellOf(o) { return (o && o.inLnC) || null; }

/** 真僵尸：`isRealZombie === true` 且**不是**护盾实体 且存活 且**敌方** 且在场内。
 *  ⚠️ 三种护盾是 `Zombie` 的子类、**会混在 `ZombiePool.pool()` 里**，
 *     所以必须用 `gpnIsShieldZombie` 排除（本模组既有函数，按 ID 认）。 */
function gpnMeteorIsRealZombie(z, deps) {
    if (!z || z.isRealZombie !== true) return false;
    const ZombieEnum = deps && deps.ZombieEnum;
    try { if (gpnIsShieldZombie(z, ZombieEnum)) return false; } catch (e) { /* 保持原判 */ }
    if (typeof z.isAlive === 'function' && !z.isAlive()) return false;
    if (z.hypnotized === true) return false;                       // Q11-终：看我方 ⇒ 排除
    const c = gpnMeteorCellOf(z);
    return !!(c && typeof c.isInLawn === 'function' && c.isInLawn());
}

/** 身体中心的 world x（优先 `bodyRecReal`；退化到 `worldPositionX`） */
function gpnMeteorBodyCenterX(z) {
    const r = z && (z.bodyRecReal || z.bodyRec);
    if (r) {
        if (typeof r.prjX === 'function') { try { const p = r.prjX(); if (p && typeof p.x === 'number') return p.x; } catch (e) { } }
        if (typeof r.x === 'number') return r.x;
    }
    return (z && typeof z.worldPositionX === 'number') ? z.worldPositionX : null;
}

/** 把 world x 换算成列号 0..8（优先 `judgeCIndexReal`） */
function gpnMeteorColOfX(x, Square) {
    let c = -1;
    try {
        if (Square && typeof Square.judgeCIndexReal === 'function') c = Square.judgeCIndexReal(x);
        else if (Square && typeof Square.judgeCIndex === 'function') c = Square.judgeCIndex(x);
    } catch (e) { c = -1; }
    if (c < 0 || c > 8) c = Math.max(0, Math.min(8, c));
    return c;
}

/** 收集场上"真僵尸"（P1：只有僵尸；障碍物/护盾是 P3） */
function gpnMeteorCollectZombies(ZombiePool, deps) {
    const out = [];
    try {
        const pool = (ZombiePool && typeof ZombiePool.pool === 'function') ? (ZombiePool.pool() || []) : [];
        for (const z of pool) { if (gpnMeteorIsRealZombie(z, deps)) out.push(z); }
    } catch (e) { /* 出错就返回已收集到的；调用方会退回原版 */ }
    return out;
}

/** ★ 1×3 同排横带密度最高的那一格（并列随机）。
 *  窗口 = 该格 + 左右各一格，**限同一行**（与 `meteor` 的 `w=3,h=1` 伤害范围同构）。
 *  僵尸算在哪一列 = **身体中心**所在列 ⇒ 一只僵尸只贡献给一列，不会重复计数。
 *  @param forbidLanes 可选：排除这些行（**只给自检做"同排隔离"构造性证明用**；
 *                     正常调用不传 ⇒ 行为不变） */
function gpnMeteorPickDensestCell(zombies, deps, forbidLanes) {
    const Square = deps && deps.Square;
    const forbid = forbidLanes || null;
    const byLane = new Map();
    for (const z of (zombies || [])) {
        const c = gpnMeteorCellOf(z); if (!c) continue;
        const bx = gpnMeteorBodyCenterX(z); if (bx === null) continue;
        const col = gpnMeteorColOfX(bx, Square);
        let cnt = byLane.get(c.lIndex);
        if (!cnt) { cnt = new Array(9).fill(0); byLane.set(c.lIndex, cnt); }
        cnt[col]++;
    }
    let best = -1; const ties = [];
    byLane.forEach((cnt, lane) => {
        if (forbid && forbid.indexOf(lane) !== -1) return;
        for (let c = 0; c <= 8; c++) {
            const s = (c > 0 ? cnt[c - 1] : 0) + cnt[c] + (c < 8 ? cnt[c + 1] : 0);
            if (s > best) { best = s; ties.length = 0; ties.push({ lIndex: lane, cIndex: c }); }
            else if (s === best) ties.push({ lIndex: lane, cIndex: c });
        }
    });
    return ties.length ? ties[Math.floor(Math.random() * ties.length)] : null;
}

/** ★ 只返回"最高分"（不随机、不挑格）—— 专用于自检做
 *  **"窗口限同一行"的构造性证明**：若窗口真的限同一行，那么
 *  "只统计行X" 与 "统计所有行" 得到的**该行最大分必须相等**；
 *  一旦跨行累加（3×3 那种错法），两者就不等。
 *  @param forbidLanes 只给自检用；正常调用不传 ⇒ 行为不变 */
function gpnMeteorDensestScore(zombies, deps, forbidLanes) {
    const Square = deps && deps.Square;
    const forbid = forbidLanes || null;
    const byLane = new Map();
    for (const z of (zombies || [])) {
        const c = gpnMeteorCellOf(z); if (!c) continue;
        const bx = gpnMeteorBodyCenterX(z); if (bx === null) continue;
        const col = gpnMeteorColOfX(bx, Square);
        let cnt = byLane.get(c.lIndex);
        if (!cnt) { cnt = new Array(9).fill(0); byLane.set(c.lIndex, cnt); }
        cnt[col]++;
    }
    let best = -1;
    byLane.forEach((cnt, lane) => {
        if (forbid && forbid.indexOf(lane) !== -1) return;
        for (let c = 0; c <= 8; c++) {
            const s = (c > 0 ? cnt[c - 1] : 0) + cnt[c] + (c < 8 ? cnt[c + 1] : 0);
            if (s > best) best = s;
        }
    });
    return best;
}

/** 从"有僵尸的格"里随机一格（同一格多只只算一次） */
function gpnMeteorPickRandomZombieCell(zombies) {
    const cells = [], seen = new Set();
    for (const z of (zombies || [])) {
        const c = gpnMeteorCellOf(z); if (!c) continue;
        const k = c.lIndex + ',' + c.cIndex;
        if (seen.has(k)) continue;
        seen.add(k); cells.push(c);
    }
    return cells.length ? cells[Math.floor(Math.random() * cells.length)] : null;
}

/** ★ 不应当作"障碍物"目标的 Tomb 类型（按 `TombEnum` 的**数值**认，见引擎 `TombEnum`）。
 *
 *  用户口径（2026/10/15 **最终定稿**）：**只排除 1 类** —— 功夫世界的**炸药桶**：
 *      17 `kongfu_TNT`  ← 会爆炸的炸药架（实机截图确认就是它）
 *
 *  其余 **30 项全部算障碍物**（含冲浪板、背包、帐篷、街机、音箱、各世界墓碑、功夫货架、
 *  以及 21/22/23 的冰砖与生日礼物、24 冰河 BOSS 冰川块、25 章鱼）——
 *  用户明确要求"只保留 kongfu_TNT"，故 21~25 都**回到白名单**。
 *
 *  ⚠️ 用**数值**而不是名字：数值最稳，不受导出名变化影响。
 *  📌 历史：2026/10/15 初版曾把 17/21/22/23/24/25 都排除；
 *     用户逐条核对后改成"只排除 17"（冰砖/生日礼物/章鱼/冰川块 都恢复可砸）。 */
const GPN_METEOR_TOMB_BLACK = [17];
/** 判断某个 Tomb 是否属于黑名单（抽出来便于单测；非数字 ID 视为「不在黑名单」）。
 *  ⚠️ `typeof id === 'number'` 是**防御性冗余**：`Array.prototype.indexOf` 用严格相等（`===`），
 *     字符串 `'17'` 本来就不会命中数字 `17` ⇒ 这条守卫去掉也不改变行为
 *     （对应的变异体 r3 是**等价变异体**，已记录，不是漏网）。
 *     保留它是为了将来若把黑名单换成 `Set`/`includes` 之类的写法时仍然安全。 */
function gpnMeteorTombIsBlacklisted(id) {
    return typeof id === 'number' && GPN_METEOR_TOMB_BLACK.indexOf(id) !== -1;
}

/** 取对象的所在格 —— **按类别决定用哪个来源**（2026/10/15 实机教训）。
 *
 *  为什么必须分类（P3 首版就是因此**收不到任何墓碑**）：
 *    · **墓碑/Tomb**：权威是**对象自身的 \`lIndex/cIndex\`** —— 引擎 \`tombPool\` 就是按它过滤的
 *      （\`n.lIndex == t.LaneIndex\`）。而它的 \`inLnC\` 指向的格子，\`lIndex\` **可能还是 -2**
 *      （\`LnC\` 构造默认 -2；网格初始化只给 \`LnCAbstract/LnCLeft/LnCRight/LnCHere/LnCThere\` 赋过值；
 *        \`standardize()\` 也只算 lefter/righter）
 *      ⇒ **拿 \`inLnC.lIndex\` 判范围会把墓碑全判成"场外"而丢弃**。
 *    · **僵尸/护盾**：权威是 **\`inLnC\`** —— 僵尸自身的 \`lIndex\` 由 \`Character.getLaneIndex()\`
 *      从世界坐标算出来，会与 \`inLnC\` 不同步；引擎里 \`a.lIndex == d.inLnC.lIndex\` 这种比较说明
 *      **两套索引并存**，而"在哪一格"应当以 \`inLnC\` 为准。
 *
 *  ⇒ 策略：\`preferOwn === true\`（墓碑）走 **自身字段 → inLnC**；否则（僵尸/护盾）走 **inLnC → 自身**。
 *     两条路径都**要求范围合法**（行 0..4、列 0..8），否则视为"不在草坪"。
 *
 *  @param preferOwn 是否优先用对象自身的 \`lIndex/cIndex\`（墓碑传 true） */
function gpnMeteorCellOfAny(o, preferOwn) {
    if (!o) return null;
    const ok = (l, c) => (typeof l === 'number' && typeof c === 'number'
        && l >= 0 && l <= 4 && c >= 0 && c <= 8);
    const own = () => (ok(o.lIndex, o.cIndex)
        ? { lIndex: o.lIndex, cIndex: o.cIndex, isInLawn: () => true, __via: 'own' } : null);
    const via = () => {
        const c0 = o.inLnC;
        return (c0 && ok(c0.lIndex, c0.cIndex))
            ? { lIndex: c0.lIndex, cIndex: c0.cIndex, isInLawn: () => true, __via: 'inLnC' } : null;
    };
    return preferOwn ? (own() || via()) : (via() || own());
}

/** 收集"障碍物"（各行的 `tombPool(0)` = 非魅惑墓碑；**含冲浪板** —— 它就是墓碑的一种）。
 *  ★ 分行**用 `getAllLane()` 的循环下标**（= 引擎的 `lane.LaneIndex`，权威），
 *    不再依赖墓碑/格子各自的索引字段（两者可能不同源，见 `gpnMeteorCellOfAny` 的说明）。
 *  @returns 实体数组（能取到格的才收） */
function gpnMeteorCollectTombs(Square, laneIndex) {
    const out = [];
    const push = (t) => {
        if (!t || t.ignored) return;
        if (typeof t.isAlive === 'function' && !t.isAlive()) return;
        if (t.hypnotized === true) return;                       // 我方墓碑 ⇒ 不砸
        if (gpnMeteorTombIsBlacklisted(t.ID)) return;
        const c = gpnMeteorCellOfAny(t, true);   // ★ 墓碑：优先用**对象自身**的 lIndex/cIndex
        if (!c) return;
        out.push(t);
    };
    try {
        const lanes = Square.getAllLane() || [];
        for (let i = 0; i < lanes.length; i++) {
            if (typeof laneIndex === 'number' && laneIndex >= 0 && i !== laneIndex) continue;
            const lane = lanes[i];
            if (!lane || typeof lane.tombPool !== 'function') continue;
            let list = null;
            try { list = lane.tombPool(0); } catch (e) { list = null; }   // 0 = 非魅惑（僵尸方）
            if (!list) { try { list = lane.tombPool(); } catch (e2) { list = null; } }
            for (const t of (list || [])) push(t);
        }
    } catch (e) { /* 拿不到就少一类候选，不影响别处 */ }
    return out;
}

/** 收集"**敌方护盾**"（`LnC.zombieShields` 里 `hypnotized === false` 的那些）。
 *
 *  为什么按 `hypnotized` 而不是按 ID：用户口径（2026/10/15）——
 *     **这三种护盾（力场盾 / 全息坚果大招 / 月光花大招）实际上可以属于任一方**
 *     （引擎 `turnVelocity` 里就会把植物方的盾杀掉、再生成一个），
 *     所以判据只能是"这个盾**此刻**在哪一方" ⇒ 我方(`hypnotized === true`)不砸。 */
function gpnMeteorCollectEnemyShields(Square, laneIndex) {
    const out = [];
    const push = (s) => {
        if (!s) return;
        if (typeof s.isAlive === 'function' && !s.isAlive()) return;
        if (s.hypnotized === true) return;                       // 我方护盾 ⇒ 不砸
        const c = s.inLnC;
        if (!c || typeof c.lIndex !== 'number') return;
        if (typeof laneIndex === 'number' && laneIndex >= 0 && c.lIndex !== laneIndex) return;
        if (c.lIndex < 0 || c.lIndex > 4 || c.cIndex < 0 || c.cIndex > 8) return;
        out.push(s);
    };
    try {
        const lnCs = (typeof Square.getAllLnC === 'function') ? (Square.getAllLnC() || []) : [];
        for (const cell of lnCs) {
            for (const s of ((cell && cell.zombieShields) || [])) push(s);
        }
    } catch (e) { /* 同上：拿不到就少一类候选 */ }
    return out;
}

/** 障碍物 ∪ 敌方护盾（`laneIndex` 传 null = 全场） */
function gpnMeteorCollectObstacles(Square, laneIndex) {
    return gpnMeteorCollectTombs(Square, laneIndex)
        .concat(gpnMeteorCollectEnemyShields(Square, laneIndex));
}


/** ★★ 第 1 颗流星的索敌（**P2 → P3**：四级优先，全部取 **`cIndex` 最小 = 最靠左**）。
 *
 *  用户口径（2026/10/15）：
 *    ① **本行**（该株流星花所在行）僵尸里 `cIndex` 最小的那一只；
 *    ② 本行没有 ⇒ **全场**僵尸里 `cIndex` 最小的一只；
 *    ★③ 本行没有僵尸 ⇒ **本行障碍物（墓碑/冲浪板/…）∪ 敌方护盾** 里 `cIndex` 最小的那个；
 *    ★④ 本行也没有 ⇒ **全场障碍物 ∪ 敌方护盾** 里 `cIndex` 最小的那个；
 *    ⑤ 都没有 ⇒ 返回 `null` ⇒ 调用方走**原版兜底**（`Square.getRandomLnC()` 随机草坪格）。
 *  **僵尸整体优先于障碍/护盾**（①②永远先于③④）。
 *  ⚠️ 原版**不索敌障碍/护盾**，也**不区分本行**（它直接取全场僵尸 `cIndex` 最大）；
 *     ⇒ 本模组这四条是**有意的行为变更**。
 *  📌 历史：2026/10/15 先做 P2（最靠右→修正为最靠左），再补 P3 的③④。
 *
 *  @param deps `{ obstacles?: 障碍/护盾实体数组（调用方用 gpnMeteorCollectObstacles 采好）}`
 *              —— 传进来而不是在这里采，是为了**分开单测**（采集 / 选格 各自可测）。
 *  @returns `{zombie, cell, cIndex, kind}` | null（`kind` ∈ zombie/tomb/shield）
 */
function gpnMeteorFirstTarget(laneIndex, zombies, deps) {
    /** 取 `cIndex` **最小**（最靠左）的那个；并列时保留先遇到的那个（由数组顺序决定） */
    const pickMinC = (list, laneFilter) => {
        let best = Infinity, bestObj = null, bestC = null, bestKind = null;
        for (const o of (list || [])) {
            // ★ 类别判定（2026/10/15 修：原来墓碑会被误判成 shield —— 真实墓碑既没有
            //   `__gpnMeteorKind`（那是自检打标）也没有 `isRealZombie`）
            //   顺序：显式标记 → 真僵尸 → 有 inLnC（僵尸/护盾） → 否则算墓碑（靠自身 lIndex/cIndex）
            //   ⚠️ 判据要用 **gpnMeteorCellOfAny**（取可用格索引），**不能**只看 `o.inLnC` 是否存在 ——
            //      实机墓碑也有 `inLnC`，但那个格子的 `lIndex` 是 -2（见 gpnMeteorCellOfAny 的说明）
            //      ⇒ 只判 `inLnC` 会把墓碑误算成 shield（P3b 断言抓到过）。
            const _ownOk = (o && typeof o.lIndex === 'number' && typeof o.cIndex === 'number'
                && o.lIndex >= 0 && o.lIndex <= 4 && o.cIndex >= 0 && o.cIndex <= 8);
            const kind = (o && o.__gpnMeteorKind === 'tomb') ? 'tomb'
                : (o && o.__gpnMeteorKind === 'shield') ? 'shield'
                    : (o && o.isRealZombie === true) ? 'zombie'
                        : _ownOk ? 'tomb'          // 有可用的自身格索引 ⇒ 墓碑
                            : (o && o.inLnC) ? 'shield' : 'tomb';
            const c = gpnMeteorCellOfAny(o, kind === 'tomb');   // ★ 按类别取格
            if (!c) continue;
            if (laneFilter !== null && c.lIndex !== laneFilter) continue;
            // ⚠️ 严格 `<` ⇒ **并列时保留先遇到的**（列表顺序：僵尸 → 墓碑 → 护盾）⇒ **确定性**
            if (c.cIndex < best) { best = c.cIndex; bestObj = o; bestC = c; bestKind = kind; }
        }
        return bestObj ? { zombie: bestObj, cell: bestC, cIndex: best, kind: bestKind } : null;
    };
    // ① 本行僵尸最靠左
    const laneOk = (typeof laneIndex === 'number' && laneIndex >= 0) ? laneIndex : null;
    const inLane = pickMinC(zombies, laneOk);
    if (inLane) return inLane;
    // ② 全场僵尸最靠左
    const anyLane = pickMinC(zombies, null);
    if (anyLane) return anyLane;
    // ★ P3：③ 本行障碍物 ∪ 敌方护盾最靠左 → ④ 全场障碍物 ∪ 敌方护盾最靠左
    const obstacles = (deps && Array.isArray(deps.obstacles)) ? deps.obstacles : [];
    if (obstacles.length > 0) {
        const obLane = pickMinC(obstacles, laneOk);
        if (obLane) return obLane;
        const obAll = pickMinC(obstacles, null);
        if (obAll) return obAll;
    }
    // ⑤ 都没有 ⇒ 交给调用方走原版兜底
    return null;
}


/** ★ 第 2 颗流星的落点：**不再打歪**。
 *    · 场上**有僵尸**：50% ⇒ 1×3 同排横带密度最高的那一格（`gpnMeteorPickDensestCell`）
 *                      50% ⇒ 从"有僵尸的格"里随机一格（`gpnMeteorPickRandomZombieCell`）
 *    ★ 场上**没僵尸但有障碍物/敌方护盾**（P3，用户口径 Q8）：
 *                      从"有障碍/护盾的格"里**随机一格**
 *    · 两者都没有 ⇒ 返回 null ⇒ 调用方落**原版口径的随机草坪格**兜底（不会停在中途）。
 *  @param deps `{ Square, obstacles?: 障碍/护盾实体数组 }` */
function gpnMeteorSecondCell(zombies, deps) {
    if (zombies && zombies.length > 0) {
        return (Math.random() < 0.5)
            ? gpnMeteorPickDensestCell(zombies, deps)
            : gpnMeteorPickRandomZombieCell(zombies);
    }
    // ★ P3：没僵尸 ⇒ 优先砸"障碍物 / 敌方护盾"所在的格（随机一格）
    const obstacles = (deps && Array.isArray(deps.obstacles)) ? deps.obstacles : [];
    if (obstacles.length > 0) return gpnMeteorPickRandomObstacleCell(obstacles);
    return null;
}

/** 从"有障碍/护盾的格"里随机一格（同一格多个只算一次） */
function gpnMeteorPickRandomObstacleCell(list) {
    const cells = [], seen = new Set();
    for (const o of (list || [])) {
        // 这里只服务"障碍格随机"，传 true 即可（自身字段优先后自动退回 inLnC）
        const c = gpnMeteorCellOfAny(o, true);
        if (!c) continue;
        const k = c.lIndex + ',' + c.cIndex;
        if (seen.has(k)) continue;
        seen.add(k); cells.push({ lIndex: c.lIndex, cIndex: c.cIndex });
    }
    return cells.length ? cells[Math.floor(Math.random() * cells.length)] : null;
}


/** ★ 原版口径的"随机草坪格"兜底：`Square.getRandomLnC()`（默认 0..4 行 × 0..8 列均匀随机）。
 *
 *  这是**恢复原版行为** —— 原版 `detectEnemy` 里就有这一句：
 *      `if (this.thrownAmount > 0 && !bestLnC) bestLnC = Square.getRandomLnC();`
 *  我们只是把"没有可选目标"这一小类交还给原版兜底（用户口径 2026/10/15 拍板 B1）。
 *
 *  ⚠️ 为什么必须要有兜底：引擎 `specialPlantUpdate` 里
 *      `this.busy <= 0 && i > 0 ⇒ this.detectEnemy()`
 *    ⇒ 若我们"不投掷也不收尾"，`busy` 会一直是 0 ⇒ **每帧重进** ⇒
 *      `thrownAmount` 卡在 1、`ignited` 永真 ⇒ `rest()` 永不调用 ⇒
 *      **动画永远停在"正在攻击"**（实机 1685 次/局 的日志刷屏 + 卡死）。
 *
 *  @returns `{lIndex, cIndex}` | null（拿不到就返回 null，由调用方收尾） */
function gpnMeteorRandomLawnCell(Square) {
    try {
        if (!Square || typeof Square.getRandomLnC !== 'function') return null;
        const lnC = Square.getRandomLnC();
        if (!lnC || typeof lnC.lIndex !== 'number' || typeof lnC.cIndex !== 'number') return null;
        if (lnC.lIndex < 0 || lnC.lIndex > 4 || lnC.cIndex < 0 || lnC.cIndex > 8) return null;
        return { lIndex: lnC.lIndex, cIndex: lnC.cIndex };
    } catch (e) { return null; }
}

/** ★ 本轮"到此为止"：结束 ignited 循环，让引擎自己接管余下流程。
 *
 *  为什么只需 `rest()`：
 *    `rest()` 会 `busy = +∞`（⇒ `specialPlantUpdate` 不再每帧调 `detectEnemy`）、
 *    `ignited = false`、播 `SummonEnd`；随后引擎自己的
 *    `animationListener("rest")` 会设 `resting = RestTime × _cdScale`，
 *    再经 `resting → 0` 触发 `Recover` → `awaken` → 重新 `igniteStart`。
 *  ⇒ 与"投完第 2 颗后的正常收尾"**调用点完全相同**，是引擎自有机制。
 *  ⚠️ 刻意**不**去写 `resting` 等引擎内部字段（少碰内部状态 = 少风险）。 */
function gpnMeteorCycleBailOut(pl) {
    try { if (pl && typeof pl.rest === 'function') pl.rest(); } catch (e) { /* 收尾失败也不能抛给引擎 */ }
}


/** ★ 引擎"方格类型"里能让流星花点燃的那两种（`SquareTypeEnum.solid` / `.deck`）**的真实数值**。
 *
 *  引擎原文（`MeteorFlowerPlant.specialPlantUpdate`）：
 *      `i != y.solid && i != y.deck || (e = !0)`  ⇒ 只有这两种格上的僵尸才点火。
 *
 *  ⚠️⚠️ **绝不硬编码**：`SquareTypeEnum` 的枚举名在 bundle 里是压缩异名，从字节里挖不出数值；
 *     而且不同 gp-next 版本可能变动。⇒ **运行时用引擎自己导出的 `SquareType` 读一次**，
 *     读不到就把"用到了没校准的数值"这件事记下来、并**放弃**点燃门改造（宁可少一个功能，也不能瞎点火）。
 *
 *  📌 2026/10/15 教训：我一开始凭印象写成 `solid=1 / deck=2`，与自检里的 `solid:0 / deck:4` 冲突
 *     ⇒ 最终改为**完全不依赖枚举**的判据（isInLawn）——见 `gpnMeteorShouldIgnite`。 */
/* ⚠️ 2026/10/15 教训：这里原本想"运行时读 SquareType 枚举来校准 solid/deck"，
 *   但 `Square.ts` **并不导出 SquareType**（它在 `LnC.ts` 里，数值 solid=0/deck=4）
 *   ⇒ `squareMod.SquareType` 恒为 undefined ⇒ 校准必失败 ⇒ **点燃门静默跳过**（实机暴露）。
 *   ⇒ 改为**完全不依赖任何枚举**的判据（见 `gpnMeteorShouldIgnite`）：
 *     「僵尸在草坪格」**或**「场上有可瞄准障碍」——既准确又不怕引擎改枚举。 */
/** ★★ 流星花的"**门**"：有没有**可瞄准的障碍**（墓碑 ∪ 敌方护盾）。
 *
 *  ⚠️ 为什么需要这个（本轮改造的核心，2026/10/15）：
 *    引擎 `MeteorFlowerPlant.specialPlantUpdate` 里的点燃条件**只认僵尸**：
 *        `p.inLawnPool().forEach(t => { var i = t.inLnC?.getSquareType();
 *                                       (i == solid || i == deck) && (e = true); });
 *        e && this.igniteStart();`
 *    ⇒ 没有僵尸时**根本不会点燃** ⇒ 我们的索敌函数（在 `detectEnemy` 里）**永远进不去**
 *      ⇒ 第 1 颗的"障碍级"是**死代码**（用户口径 A：僵尸优先，没僵尸才找障碍）。
 *
 *  ★ 本 MOD 内部先例：**蒲公英**能"主动索敌障碍"，正是因为它把**开火门**也改了
 *    （`makeDandelionPatch` 的补丁②：`detectEnemy` = 活僵尸 **或** 可见障碍）。
 *    这里照同一模式，给流星花补上"障碍也能开门"。
 *
 *  @returns 场上"可瞄准障碍"的个数（墓碑 + 敌方护盾） */
function gpnMeteorHasIgnitableObstacle(Square) {
    try {
        return gpnMeteorCollectTombs(Square, null).length
            + gpnMeteorCollectEnemyShields(Square, null).length;
    } catch (e) { return 0; }
}

/** ★★ 点燃门的**决策**（纯函数，便于单测）：原版这一帧**没有**点燃它，
 *  但我们该不该因为"场上有可瞄准障碍"补一次点燃？
 *
 *  @param deps `{ awakenBefore, awakenAfter, ignited, featOn, hasObstacle }`（都由调用方先算好）
 *  @returns true = 应当补点燃
 *
 *  ⚠️ 为什么抽出来：这段判断曾写在包装里，被"全局校准值"与"测试桩"的时序问题**反复掩盖**
 *     （2026/10/15 排查了很久）。抽成纯函数后，逻辑只依赖入参 ⇒ 可被确定性地单测。 */
function gpnMeteorShouldSupplementIgnite(deps) {
    const d = deps || {};
    return !!(d.featOn === true
        && d.awakenBefore === true          // 原版调用前是待命状态
        && d.awakenAfter === false          // 原版这一帧把它唤醒了（否则不该我们管）
        && d.ignited !== true               // 还没真正点燃
        && d.hasObstacle === true);         // 场上有可瞄准障碍
}




/** ★★ 点燃门判据（**纯函数**，便于单测）：这一帧要不要点燃流星花？
 *
 *  规则（用户口径 A：僵尸优先、没有僵尸才找障碍）：
 *    ① **有僵尸在草坪格** ⇒ 点燃（这也是引擎原版的判据）
 *    ② 否则**场上有可瞄准障碍**（墓碑 ∪ 敌方护盾）⇒ 也点燃（本模组的扩展，照蒲公英模式）
 *    ③ 都没有 ⇒ 不点燃（不空放）
 *
 *  ⚠️ 为什么不用 `SquareTypeEnum.solid/deck` 精确复刻引擎判据：
 *    `SquareType` 不在 `Square.ts` 的导出里（它在 `LnC.ts`，数值 solid=0/deck=4），
 *    取不到就会让整个改造**静默失效**（2026/10/15 实机踩过）。
 *    改用 `isInLawn()`：语义等价（草坪 = 能站僵尸的格），且**不依赖任何枚举**。
 *
 *  @param deps `{ awaken, featOn, zombieInLawn, obstacleCount }`（均由调用方先算好）
 *  @returns true = 应当点燃
 */
function gpnMeteorShouldIgnite(deps) {
    const d = deps || {};
    if (d.featOn !== true) return false;
    if (d.awaken !== true) return false;          // 只在待命状态才点火
    if (d.zombieInLawn === true) return true;     // ① 原版判据
    if (typeof d.obstacleCount === 'number' && d.obstacleCount > 0) return true;  // ② 扩展
    return false;
}


/** ★★ "本轮已点燃"标记（防止重复点火）。
 *
 *  为什么需要（2026/10/15 实机 F12 发现）：
 *    引擎原本只在 `awaken === true` 时才调 `igniteStart()` ⇒ 天然一次；
 *    我们的补点燃是"每帧判断"（`specialPlantUpdate` 每帧都会跑）⇒
 *    在"原版不点火、场上有障碍"的场面里会**连续补点燃**（日志里出现连续 3 行），
 *    而 `igniteStart()` 会 `playAnimation("SummonStart")` ⇒ **召唤动画被反复重启**。
 *  ⇒ 用 WeakSet 记住"本轮已经点燃过"，并在 `rest()` / `recover()`（一轮结束）时清除。
 *  ⚠️ 用 WeakSet（不是普通标记）：不会因为植物被销毁而留下悬挂引用。 */
const gpnMeteorIgnitedSet = new WeakSet();
/** 本轮是否已点燃过（幂等保护） */
function gpnMeteorAlreadyIgnited(pl) {
    try { return !!(pl && gpnMeteorIgnitedSet.has(pl)); } catch (e) { return false; }
}
/** 标记本轮已点燃 */
function gpnMeteorMarkIgnited(pl) {
    try { if (pl) gpnMeteorIgnitedSet.add(pl); } catch (e) { }
}
/** 清除本轮标记（一轮结束时调用） */
function gpnMeteorClearIgnited(pl) {
    try { if (pl) gpnMeteorIgnitedSet.delete(pl); } catch (e) { }
}


/** 场上有没有"在草坪格"的僵尸（用来复刻引擎的点燃判据，且不依赖枚举） */
function gpnMeteorZombieInLawn(Square) {
    try {
        const la = (Square && typeof Square.getAllLane === 'function') ? (Square.getAllLane() || []) : [];
        for (const lane of la) {
            if (!lane) continue;
            try { if (typeof lane.isInLawn === 'function' && !lane.isInLawn()) continue; } catch (e0) { }
            let zp = null;
            try { zp = (typeof lane.zombiePool === 'function') ? (lane.zombiePool() || []) : []; } catch (e1) { zp = []; }
            for (const z of zp) {
                const c = z && z.inLnC;
                if (!c) continue;
                try { if (typeof c.isInLawn === 'function' && c.isInLawn()) return true; } catch (e2) { }
            }
        }
    } catch (e) { }
    return false;
}

/** P1 起步：流星花索敌 —— 第 2 颗流星改为"不再打歪"。
 *
 *  === P1 的行为（相对原版）===
 *    · 第 2 颗**取消** `SecondMeteorMissChance(0.35)` 的打歪判定（原版会随机砸一个草坪格）。
 *    · 改为 50/50：
 *        50% ⇒ **1×3 同排横带密度最高**的那一格（= 这一击能打到最多僵尸的位置）
 *        50% ⇒ 从"**有僵尸的所有格**"里随机一格
 *    · 若场上**没有任何僵尸** ⇒ 本颗**不发射**（与原版"随机砸一格"不同，这是用户口径 Q9）。
 *
 *  === 第 1 颗**仍走原版**（P1 不动它）===
 *    P2 起第 1 颗 = "本行最靠左 → 全场最靠左"（`cIndex` 最小）；P3 再加"障碍物 / 敌方护盾"。
 *    所以本函数里第 1 颗的路径是"整段照抄原版条件与选法"，**逐字等价**。
 *
 *  @param MeteorFlowerPlant 引擎 `MeteorFlower.ts` 导出的植物类
 *  @returns 补丁记录数组（空数组表示没挂上） */
let gpnMeteorLastZombieEnum = null;      // 工厂最近一次收到的 ZombieEnum（**只读记录**，给自检）
function makeMeteorFlowerAimPatch(MeteorFlowerPlant, deps) {
    const recs = [];
    // ★★ 归一化：本工厂的调用方可能传**类**，也可能传**原型**（两种写法都在用）——
    //    2026/10/15 踩过这个坑：点燃门改造用 `methodRecord(P, ...)` 时，
    //    若 P 是原型就会让 `Cls.prototype` 变 undefined ⇒ **改造静默跳过**（实机看不出原因）。
    //    ⇒ 这里统一解析出真正的 prototype，并且**始终用 prototype 做补丁**（不再依赖调用约定）。
    const _maybeCls = MeteorFlowerPlant;
    const P = (_maybeCls && _maybeCls.prototype && typeof _maybeCls.prototype.detectEnemy === 'function')
        ? _maybeCls.prototype                                   // 传的是类
        : ((_maybeCls && typeof _maybeCls.detectEnemy === 'function') ? _maybeCls : null);  // 传的是原型
    const _cls = (_maybeCls && _maybeCls.prototype) ? _maybeCls : { prototype: P };   // 供 methodRecord 用
    try { gpnMeteorLastZombieEnum = (deps && deps.ZombieEnum) || gpnMeteorLastZombieEnum; } catch (e) { }
    if (!P || typeof P.detectEnemy !== 'function') {
        warn('流星花索敌：拿不到 MeteorFlowerPlant 的 detectEnemy'
            + '（MeteorFlower.ts 未载入，或原版改了类名）—— 本功能整体不生效，改为原版行为。');
        return recs;
    }

    const original = P.detectEnemy;
    const D = deps || {};
    // ★ 点燃门改造不再需要任何枚举校准（改用 isInLawn 判据）
    const Square = D.Square, ZombiePool = D.ZombiePool;
    const D2 = { Square: Square, ZombieEnum: D.ZombieEnum };   // 模块级工具需要的依赖

    /** 局部别名（补丁里用着顺手；实现只有一份 = 模块级的那个） */
    const meteorCycleBailOut = (pl, diag, why) => {
        if (diag) { try { log('流星花【第2颗】⇒ 收尾（' + why + '）'); } catch (e0) { } }
        gpnMeteorCycleBailOut(pl);
    };

    // ---- 依赖健全性：任何一个关键依赖缺失 ⇒ 整个功能直通原版（绝不半残运行）----
    const depsOk = !!(Square && typeof Square.getLnC === 'function'
        && typeof Square.getAllLane === 'function'
        && ZombiePool && typeof ZombiePool.pool === 'function');
    if (!depsOk) {
        warn('流星花索敌：依赖不全（Square / ZombiePool）—— 本功能整体不生效，改为原版行为。');
        return recs;
    }

    /** 砸向"某一格"：走原版 `_throw`，入参必须是格子的 `plantPoint`。
     *
     *  ⚠️⚠️ **绝对不要拷贝 `plantPoint`（`Object.assign` / 展开 / clone 都不行）** ——
     *     `LnC.plantPoint` 是个 **getter**：
     *         get() { return this._plantPoint ? this._plantPoint : this.node }
     *     ① 它可能返回 **Cocos `node`**（`_plantPoint` 为空时）；`node.worldPosition` 是 **Vec3**，
     *        **没有 `toVec2()`** ⇒ 引擎 `_throw` 里 `n.worldPosition.toVec2()` 会炸；
     *     ② 拷贝会丢掉 getter / 原型 / 非枚举属性 ⇒ 引擎拿到残缺对象
     *        ⇒ 实机表现 = `TypeError: Cannot read properties of undefined (reading 'x')`
     *          抛在引擎 `_throw` 内部（`lobOneCabbageOnPos` 之前，异步 ⇒ "Uncaught (in promise)"）
     *        ⇒ **投掷流程中断 ⇒ 这一颗流星直接没了**（而 `thrownAmount` 已 ++，日志看着还正常）。
     *     【实机教训 2026/10/15】P1 第 2 颗"消失"就是这个原因。
     *
     *  ⇒ 正确做法：**原样把 `lnC.plantPoint` 传进去**。
     *     给自检用的 `__cell` 标记**直接挂在那个对象上**（引擎不认这个字段，无副作用）。 */
    function throwAtCell(pl, cell) {
        const lnC = Square.getLnC(cell.lIndex, cell.cIndex);
        if (!lnC) return false;
        let pos = null;
        try { pos = lnC.plantPoint; } catch (e) { pos = null; }
        if (!pos) return false;
        // 结构性自检：连 `worldPosition` 都没有 ⇒ 这颗投不出去（例如 plantPoint 回了空 node）
        //   宁可**提前失败**（调用方退回原版），也不要让异常抛进引擎的异步流程里
        let wp = null;
        try { wp = pos.worldPosition; } catch (e) { wp = null; }
        if (!wp || typeof wp.x !== 'number') return false;
        // ⚠️ `__cell` 标记**只在自检实例上写**：实机绝不往引擎对象（可能是共享的 Cocos 节点）写字段。
        //    自检通过 `inst.__gpnMeteorTest = true` 开启。
        if (pl && pl.__gpnMeteorTest === true) {
            try { pos.__cell = cell; } catch (e) { /* 冻住也不影响投掷 */ }
        }
        pl._throw(pos);
        return true;
    }

    // ---- 补丁本体 ----
    const rec = { Cls: MeteorFlowerPlant, name: 'detectEnemy', original };
    P.detectEnemy = function () {
        // 诊断（仅 verboseLog）：把每次索敌的"走位"记下来，用于定位"第 2 颗不见了"
        const _diag = verboseOn();
        const _d3 = () => {
            if (!_diag) return;
            try {
                const raw = (ZombiePool.pool() || []).length;
                log('流星花【索敌】thrownAmount=' + this.thrownAmount
                    + ' inLane=' + !!this.inLane
                    + ' 原始池=' + raw
                    + ' feat=' + featOn('meteorflowerAim'));
            } catch (e) { /* 诊断自身出错不影响逻辑 */ }
        };
        _d3();

        // ★ 运行期开关：关掉 ⇒ 与原版**逐字等价**（直通，不做任何额外判断）
        if (!featOn('meteorflowerAim')) { if (_diag) log('流星花【索敌】⇒ 开关关，直通原版'); return original.apply(this, arguments); }

        try {
            // ⚠️ `_throw` 内部要用 `this.inLane.prjLayer` ⇒ 没有 inLane 时不能接管
            if (!this.inLane) { if (_diag) log('流星花【索敌】⇒ 无 inLane，直通原版'); return original.apply(this, arguments); }

            // —— 第 1 颗：**P2/P3 新索敌**（本行僵尸→全场僵尸→本行障碍/护盾→全场障碍/护盾→原版兜底）——
            if (!(this.thrownAmount > 0)) {
                const _lane = (this.inLane && typeof this.inLane.LaneIndex === 'number') ? this.inLane.LaneIndex : null;
                const _zs1 = gpnMeteorCollectZombies(ZombiePool, D2);
                // ★ P3：障碍 ∪ 敌方护盾。**分开采**，便于诊断把"墓碑数 / 护盾数"分开打
                const _tomb1 = gpnMeteorCollectTombs(Square, null);
                const _shld1 = gpnMeteorCollectEnemyShields(Square, null);
                const _obs1 = _tomb1.concat(_shld1);
                const _t1 = gpnMeteorFirstTarget(_lane, _zs1, { Square: Square, obstacles: _obs1 });
                if (_t1 && _t1.zombie) {
                    // ★ `kind === 'zombie'` ⇒ 走**原版** `_throwAtZombie`（瞄准僵尸世界坐标、带追踪；保留原版手感）
                    //   `kind === 'tomb' / 'shield'` ⇒ 它们没有"可追踪的僵尸坐标"语义 ⇒ 走 `_throw(cell)`（落格心）
                    const _z = _t1.zombie;
                    const _isZ = (_t1.kind === 'zombie');
                    const _ok = _isZ
                        && (typeof _z.worldPositionX === 'number' && typeof _z.worldPositionY === 'number')
                        && (typeof this._throwAtZombie === 'function');
                    if (_diag) {
                        log('流星花【第1颗】本行=' + _lane + ' 真僵尸=' + _zs1.length
                            + ' 墓碑=' + _tomb1.length + ' 护盾=' + _shld1.length
                            + ' ⇒ 目标格=' + _t1.cell.lIndex + ',' + _t1.cell.cIndex + ' 类别=' + _t1.kind
                            + (_ok ? '（走原版 _throwAtZombie）' : '（走 _throw 格心）'));
                    }
                    if (_ok) {
                        this._throwAtZombie(_z);
                        this.thrownAmount++;
                        this.busy = 0.5;
                        const _once1 = (this._objdataOwn && typeof this._objdataOwn.MeteorCountOnce === 'number')
                            ? this._objdataOwn.MeteorCountOnce : 2;
                        if (this.thrownAmount >= _once1) this.rest();
                        return;
                    }
                    // 非僵尸目标（墓碑/护盾），或僵尸缺世界坐标 ⇒ 退到"按格投"
                    if (throwAtCell(this, _t1.cell)) {
                        this.thrownAmount++;
                        this.busy = 0.5;
                        const _once1z = (this._objdataOwn && typeof this._objdataOwn.MeteorCountOnce === 'number')
                            ? this._objdataOwn.MeteorCountOnce : 2;
                        if (this.thrownAmount >= _once1z) this.rest();
                        return;
                    }
                }
                // 没有僵尸目标（或僵尸结构异常）⇒ **原版口径兜底**：随机草坪格
                let _c1 = gpnMeteorRandomLawnCell(Square);
                if (_diag) {
                    log('流星花【第1颗】本行=' + _lane + ' 真僵尸=' + _zs1.length + ' 墓碑=' + _tomb1.length + ' 护盾=' + _shld1.length
                        + ' ⇒ 无目标，兜底随机格=' + (_c1 ? (_c1.lIndex + ',' + _c1.cIndex) : 'null'));
                }
                if (!_c1 || !throwAtCell(this, _c1)) { meteorCycleBailOut(this, _diag, '第1颗兜底失败'); return; }
                this.thrownAmount++;
                this.busy = 0.5;
                const _once1b = (this._objdataOwn && typeof this._objdataOwn.MeteorCountOnce === 'number')
                    ? this._objdataOwn.MeteorCountOnce : 2;
                if (this.thrownAmount >= _once1b) this.rest();
                return;
            }

            // —— 第 2 颗：新策略（不再打歪）——
            //    ⚠️ 逻辑全在**模块级纯函数** `gpnMeteorSecondCell()` 里（便于自检直接单测）
            const _zs = gpnMeteorCollectZombies(ZombiePool, D2);
            const _tomb2 = gpnMeteorCollectTombs(Square, null);
            const _shld2 = gpnMeteorCollectEnemyShields(Square, null);
            const _obs2 = _tomb2.concat(_shld2);
            let cell = gpnMeteorSecondCell(_zs, { Square: Square, obstacles: _obs2 });
            let fellBack = false;

            // ★★【1】任何"没有可选目标"（池空 / 只剩场外僵尸 / 全被筛掉）
            //        ⇒ 按**原版口径**落"全草坪随机一格"（用户口径 2026/10/15 拍板）
            //   ⚠️ 绝不能在这里 `return`：引擎会每帧重调（busy 恒 0）⇒ 死循环 + 动画卡死
            if (!cell) {
                fellBack = true;
                cell = gpnMeteorRandomLawnCell(Square);
            }
            if (_diag) {
                log('流星花【第2颗】真僵尸=' + _zs.length + ' 墓碑=' + _tomb2.length + ' 护盾=' + _shld2.length
                    + ' 选出格=' + (cell ? (cell.lIndex + ',' + cell.cIndex) : 'null')
                    + (fellBack ? '（兜底：随机草坪格）' : ''));
            }

            // ★★【2】兜底也拿不到 ⇒ **收尾**（结束本轮），绝不停在半路
            if (!cell) { meteorCycleBailOut(this, _diag, '连随机格都拿不到'); return; }

            // ★★【3】投出去；结构性失败（plantPoint 无 worldPosition 等）
            //        ⇒ 再试一次随机格，仍失败才收尾（**不回退原版**，避免"我投了一半+原版又投一颗"）
            if (!throwAtCell(this, cell)) {
                const alt = fellBack ? null : gpnMeteorRandomLawnCell(Square);
                if (!alt || !throwAtCell(this, alt)) { meteorCycleBailOut(this, _diag, '投掷结构性失败'); return; }
            }

            // ★ 尾部状态机：逐字照抄原版（thrownAmount++ / busy / rest）
            this.thrownAmount++;
            this.busy = 0.5;
            // `MeteorCountOnce` 是实例的 objdataOwn 字段；原版就在这里读它
            const _once = (this._objdataOwn && typeof this._objdataOwn.MeteorCountOnce === 'number')
                ? this._objdataOwn.MeteorCountOnce : 2;
            if (this.thrownAmount >= _once) this.rest();
        } catch (e) {
            // 意外 ⇒ **收尾**（不再回退原版：那会导致"半投掷 + 原版再投一颗"的怪状态）
            warn('流星花索敌（第2颗）出错，本轮收尾：', e);
            meteorCycleBailOut(this, true, '异常');
        }
    };
    recs.push(rec);

    // ================= ② 点燃门（照本 MOD 蒲公英的模式） =================
    //   引擎的点燃条件**只认僵尸**（僵尸落在 solid/deck 格）⇒ 没僵尸时永不点燃
    //   ⇒ 索敌函数进不去 ⇒ 第 1 颗的"障碍级"是死代码。
    //   ★ 这里**只补**"原版没点燃、但场上存在可瞄准障碍"这一种情形：
    //     · 绝不动原版条件与时机（原版该点燃的仍然点燃）
    //     · 原版已经点燃 ⇒ 我们什么都不做（避免同一帧二次 igniteStart）
    //     · `igniteStart()` 自身有幂等保护（它会把 awaken 置 false）⇒ 不会连开
    if (typeof P.specialPlantUpdate === 'function') {
        let recIgnite = null;
        // ⚠️ 用归一化后的 `_cls`（它保证 `.prototype` 指向真正的 prototype）
        try { recIgnite = methodRecord(_cls, 'specialPlantUpdate'); } catch (e) { recIgnite = null; }
        if (recIgnite && typeof recIgnite.original === 'function') {
            // ★ 包 `rest()` / `recover()`：一轮结束 ⇒ 清掉"本轮已点燃"标记。
            //   ⚠️ 只做"清除标记"这一件事，**不改动原方法任何行为**。
            for (const _mn of ['rest', 'recover']) {
                try {
                    if (typeof P[_mn] === 'function') {
                        const _rec = methodRecord(_cls, _mn);
                        P[_mn] = function () {
                            gpnMeteorClearIgnited(this);
                            return _rec.original.apply(this, arguments);
                        };
                        recs.push(_rec);
                    }
                } catch (e5) { /* 包不上也不影响主体 */ }
            }

            P.specialPlantUpdate = function () {
                const _wasAwaken = (this.awaken === true);           // 原版调用前状态
                const _restingWas = this.resting;                     // 原版调用前 resting
                const r = recIgnite.original.apply(this, arguments); // ★ 原版流程完全不变
                try {
                    // ★ 只在"原版这一帧**没有**点燃它"时考虑补点燃。
                    //   ⚠️ 判据：引擎 `igniteStart()` = `resting = Infinity; awaken = false`
                    //      ⇒ 若原版已点火，`awaken` 也会变 false ⇒ **光看 awaken 会重复点火**
                    //        （2026/10/15 自检场景 A 抓到：igniteStart 被调了 2 次）。
                    //      ⇒ 用 resting 的**跃变**判定："有限值 → Infinity" = 原版刚点过火。
                    //   ⚠️ 必须是**函数**（`_vanillaIgnited()`）：写成值会让 `!x` 永远为 false
                    //      —— 2026/10/15 这个笔误让"补点燃"整段**静默失效**，排查了很久。
                    const _vanillaIgnited = () => isFinite(_restingWas) && (this.resting === Infinity);
                    // ⚠️⚠️ **绝不能再加 `this.awaken === false`**：引擎 igniteStart() 会把 awaken
                    //    置 false，而**原版这一帧若点了火也会置 false** ⇒ 两者无法区分，
                    //    那个条件会把"补点燃"**永远挡住**（自检场景 B 与实机都复现过）。
                    //    唯一可靠判据 = resting 的跃变（有限值 → Infinity）。
                    if (_wasAwaken && !_vanillaIgnited() && this.ignited !== true
                        && !gpnMeteorAlreadyIgnited(this)) {   // ★ 幂等：本轮只点一次
                        const _obs = gpnMeteorHasIgnitableObstacle(Square);
                        if (gpnMeteorShouldIgnite({
                            featOn: featOn('meteorflowerAim'),
                            awaken: true,                 // 我们只在原版刚把它唤醒时才走到这里
                            zombieInLawn: gpnMeteorZombieInLawn(Square),
                            obstacleCount: _obs,
                        })) {
                            gpnMeteorMarkIgnited(this);   // ★ 先标记，避免同一帧内重复
                            this.igniteStart();
                            if (verboseOn()) {
                                log('流星花【点燃】补点燃（障碍=' + _obs + '）');
                            }
                        }
                    }
                } catch (e4) { /* 补点燃失败不影响原版流程 */ }
                return r;
            };
            recs.push(recIgnite);   // ★ push 真实 rec（含 original/own），交给统一的还原逻辑
        } else {
            warn('流星花：拿不到 specialPlantUpdate（点燃门改造跳过 —— 第 1 颗将无法索敌障碍）。');
        }
    } else {
        warn('流星花：没有 specialPlantUpdate（点燃门改造跳过 —— 第 1 颗将无法索敌障碍）。');
    }

    // ★ 明确的"成功"日志（一次性，只在 setup 时打一条）。
    //   ⚠️ 为什么不加 `if (verboseOn())` 门：这条是**接线/版本确认**用的，
    //      性质与 `[CTM] BUILD = ...` 相同 —— 没有它就只能靠"没有告警"反证，
    //      实机排查会很别扭（P0 实机验证时就吃过这个亏）。一行、一次，不会刷屏。
    log('流星花索敌：补丁已挂（第 1 颗 = 本行僵尸→全场僵尸→本行障碍/敌方护盾→全场障碍/敌方护盾，'
        + '全部取 cIndex 最小（最靠左）；第 2 颗 = 50% 密度最高格 / 50% 随机僵尸格，'
        + '无僵尸但有障碍/护盾则从中随机一格，都没有则按原版口径落随机草坪格；'
        + '★ 点燃门已照"蒲公英模式"扩展：原版无僵尸格点火时，若场上有可瞄准障碍也会点燃'
        + '）');
    return recs;
}


/** 红针花（Red Stinger）：左键循环切换形态（0 -> 1 -> 2 -> 0）
 *  引擎事实（已逐条核对）：
 *    · inArea 是【带 setter 的访问器】=> 赋值即自动刷新 待机/随机/射击/死亡 动画 ✓
 *    · 承伤倍率 damageScale() 实时读 inArea（数据 DamageScale0/1/2）✓
 *    · 弹种也在 animationListener 里实时读 inArea（1 档弱弹 / 0 档强弹 / 2 档不索敌）✓
 *    · inArea 的 setter 完全不碰 health ⇒ 切形态【不回血】，血量自然继承 ✓
 *  所以模组只需三件事：① 写 inArea ② 防被"按列自动重算"覆盖 ③ 捕获左键点击 */
function makeRedStingerPatch(RedStingerPlant, deps) {
    const recs = [];
    const P = RedStingerPlant && RedStingerPlant.prototype;
    const cc = deps.cc, R = deps.Rectangle, V2 = deps.Vec2;
    if (!P) { warn('跳过红针花：拿不到 RedStingerPlant'); return null; }
    const C = CFG.redstinger;

    // ---- ① 手动形态不被 specialPlantOnSquareChange 按列覆盖 ----
    if (typeof P.specialPlantOnSquareChange === 'function') {
        const rec = methodRecord(RedStingerPlant, 'specialPlantOnSquareChange');
        P.specialPlantOnSquareChange = function () {
            const r = rec.original.apply(this, arguments);
            // ★ 运行期开关：关掉后不再"锁"手动形态（否则看起来像没关闭）
            if (!featOn('redstinger')) return r;
            try {
                if (this.__gpnFormManual && typeof this.__gpnForm === 'number') this.inArea = this.__gpnForm;
            } catch (e) { warn('红针花：恢复手动形态出错', e); }
            return r;
        };
        recs.push(rec);
    }

    // ---- ② 左键循环切换形态（挂引擎自己的植物鼠标事件）----
    //  引擎事实：草坪 onMouseDown -> plantMouseReact(event) -> 逐个植物 e.onMouseDown(event)，
    //  且只在【手上没拿卡】时才走这条路 ⇒ 不会抢"种植"的左键。
    //  （这版引擎没有 Input.EventType / systemEvent，鼠标只走节点事件，所以不能用 cc.input ✗）
    const baseOnMouseDown = P.onMouseDown;                 // 可能继承自 Plant 基类
    P.onMouseDown = function (ev) {
        // ★ 运行期开关：关掉后完全不干涉形态（补丁常驻、行为现查）
        if (!featOn('redstinger')) {
            try { return (typeof baseOnMouseDown === 'function') ? baseOnMouseDown.apply(this, arguments) : undefined; }
            catch (e) { warn('红针花：原版 onMouseDown 出错', e); return undefined; }
        }
        let r;
        try { if (typeof baseOnMouseDown === 'function') r = baseOnMouseDown.apply(this, arguments); }
        catch (e) { warn('红针花：原版 onMouseDown 出错', e); }
        try {
            if (!CFG.redstinger.clickSwitch) return r;
            if (!ev || typeof ev.getButton !== 'function') return r;
            if (ev.getButton() !== 0) return r;             // 只认左键
            // ★ 一次点击只认一次（引擎在 mouseUp 还会补发一次 onMouseDown ⇒ 否则形态连切两下）
            if (!gpnClickOnce(this, '__gpnRsClickAt')) return r;
            const now = (typeof this.inArea === 'number') ? this.inArea : 0;
            const next = (now + 1) % 3;
            this.__gpnFormManual = true;
            this.__gpnForm = next;
            this.inArea = next;                             // ★ 只写这一个值；不碰 health
            if (dbgOn(CFG.redstinger.debugLog)) log('红针花：形态 ' + now + ' → ' + next
                + '（承伤 ×' + [1, CFG.redstinger.tier1, CFG.redstinger.tier2][next] + '）');
            return true;                                    // 告诉引擎"这次点击我处理了"
        } catch (e) { warn('红针花：左键切换出错', e); }
        return r;
    };
    recs.push({ Cls: RedStingerPlant, name: 'onMouseDown', original: baseOnMouseDown });
    return recs;
}


/* =========================================================================
 * 孢子菇（SporeShroom）—— 亡语 + 数值 + 图鉴
 *
 *  用户需求（2026-10-16 定稿，见 `CTM\设计稿-孢子菇.md`）：
 *    R1 亡语：以自身格为中心的 **1 行 × 3 列**，伤害 = **跟随孢子菇普攻攻击力**（按 CabbageType 查弹道 Damage）
 *    R2 亡语伤害 = **不穿甲**（armorProtection=true）+ **普通物理**（damageType=physicle 0）
 *    R3 亡语对范围内僵尸 **先施加 `CarriedSporeShroom` 标记、再造成伤害**（⇒ 这一发自己吃 ×1.5）
 *    R4 亡语附带 **0.75 秒眩晕**
 *    R5 带标记的僵尸 **非"化灰"死亡 ⇒ 生成一株孢子菇**（照抄引擎 `turnIntoSporeShroom`）
 *    R7 孢子菇**自己也要吃到 ×1.5**（含亡语伤害）—— 由 R3 的"先标记"天然满足
 *    R8 阳光 150 → **200**、血量上限 300 → **150**
 *    R9 图鉴新增**两条特点**（中英）
 *    R10 亡语特效 = 暗影豌豆**初档**大招子弹的**命中特效**（`ShadowPeaPF0PAR`），100% 还原、不依赖场上暗影豌豆
 *    R11 开关 `sporeshroom`（默认开；关掉 = 全部回原版）
 *    R12 分两步：**第一步直伤**（本块）／第二步 Dot 的 ×1.5（后续）
 *
 *  === 引擎事实（逐字核对 1.5.5 bundle + 实机探针，见设计稿 §1/§4.1）===
 *   · 模块 `chunks:///_virtual/SporeShroom.ts` 导出 `SporeShroomPlant`；它**没有**覆盖
 *     `specialPlantOnKilled` / `specialPlantDie` ⇒ 继承 `Plant` 基类的空实现。
 *   · `Plant.die(released, lost, particle, anm, noFoodEnd)` 里调 `this.specialPlantDie(noFoodEnd)`；
 *     被击杀路径另调 `specialPlantOnKilled()`（爆裂坚果就是用这个做亡语）。
 *   · `specialPlantOnKilled` **不含"被铲"**（铲子走 `die(..., noFoodEnd=true)`）—— 用户要求：铲掉不触发 ✓
 *   · 亡语伤害对象：`new ZombieDamageDetails(dmg, true, false, false, null, ZombieDamageType.physicle)`
 *     ⚠️ **绝不能**用 `ray`：`Zombie.defaultDealDamage` 里 `canPlayAshNow() && damageType==ray` ⇒ 化灰，
 *        而化灰路径**不会**走 `playDie` 里的亡语分支 ⇒ 中招僵尸反而生不出孢子菇（自相矛盾）。
 *   · 免疫：`z.ImmuneToSporeShroom`（引擎已封装 getter；僵王等恒 true）。
 *     用户口径：**免疫僵尸照吃伤害、只是不标记**。
 *   · 命中特效：`commonShot.prototype.playParticle` 里的 `n.parent = this.node.parent`
 *     ⇒ 实机观测到父节点 = 车道的 **prjLayer**（`New Node` 通用名，链：`<RowN> < squaresLower < LawnCommon < Canvas < inGameScene`）
 *     ⇒ 现在**亡语显式传"自己那条车道"**（`gpnSporeFxGetParent(null, D, lane)`），特效永远落在本行 prjLayer；
 *       弹道观测到的那个缓存**只作兜底**（§3.71：曾经因为它退化成了唯一来源 ⇒ 偶发一次层不对）。
 *   · 僵尸侧亡语（R5）：照抄 `Zombie.turnIntoSporeShroom`，**在 `playDie` 里加分支**（S3）。
 * =======================================================================*/

/** 特性表里的开关名（同时是图鉴里"我们改过"的开关名） */
const GPN_SPORE_FEAT = 'sporeshroom';

/** 亡语伤害 = **本株普攻攻击力 × `CFG.sporeshroom.deathDamageScale`**。
 *  · 正常路径：运行期从 `ProjectileProps` 里读那 3 条弹道的真实 `Damage`（**不硬编码**，改数据也跟着变）
 *  · 拿不到数据 ⇒ 用 CFG 的兜底表（表里存的是**普攻攻击力** 50/150/250）
 *  · 最后**统一乘倍率**（用户 2026/10/16 指定：先 1.25、随后改 **1.35** ⇒ **67.5 / 202.5 / 337.5**）
 *    ⚠️ 倍率**只在这里乘一次**，各调用点（僵尸 / 障碍物 / 日志）都直接用这个返回值
 *       —— 这样"跟随本株普攻"这条口径就只有一个实现处，不会两处算错。
 *  ⚠️ 记：mark 先于伤害 ⇒ 僵尸那一发还会被 ×1.5 的毒性家族加成再乘一次（= 101.25 / 303.75 / 506.25）；
 *     障碍物没有标记 ⇒ 只吃这里的基础值。 */
function gpnSporeDeathDamage(plant, jsonMod) {
    const C = CFG.sporeshroom;
    const sc = (function () { const v = Number(C.deathDamageScale); return (isFinite(v) && v > 0) ? v : 1; })();
    // ① 本株实际在用的弹药名（`objdataOwn.CabbageType`；拿不到就用原版默认）
    let pea = null;
    try {
        const od = (plant && (plant.objdataOwn || plant._objdataOwn)) || null;
        if (od && typeof od.CabbageType === 'string') pea = od.CabbageType;
    } catch (e) { /* 忽略 */ }
    if (!pea) pea = 'sporeshroom_spore';
    // ② 兜底表
    const fb = (C.deathDamageByPea && C.deathDamageByPea[pea] != null)
        ? C.deathDamageByPea[pea] : C.deathDamageFallback;
    // ③ 真实数据
    try {
        const Ctn = (typeof gpnResolveDataBox === 'function') ? gpnResolveDataBox() : null;
        const prjs = Ctn && Ctn.ProjectileProps;
        if (Array.isArray(prjs)) {
            for (const it of prjs) {
                if (!it || !Array.isArray(it.aliases) || it.aliases.indexOf(pea) === -1) continue;
                const od = it.objdata || {};
                const d = Number(od.Damage);
                if (isFinite(d) && d > 0) return d * sc;      // ★ 真实普攻 × 倍率
                break;
            }
        }
    } catch (e) { /* 忽略 */ }
    return fb * sc;                                          // ★ 兜底普攻 × 倍率
}

/** 取一个"僵尸池"（按类别的通用取法，与流星花改造里用的是同一套判据） */
function gpnSporeLaneOf(plant) {
    try { return (plant && plant.inLane) || null; } catch (e) { return null; }
}

/** ★ 亡语特效（R10）—— 暗影豌豆**初档**大招子弹的**命中特效** prefab。
 *  实机实测（S1/S1b/S1c 探针，见设计稿 §4.1）：
 *    · 只读路径：`resources` bundle → `load('projectiles/PeaShadowPF0PRJ', cc.Prefab)`
 *                → `findPropInNode(prefab.data, 'PopParticle')` ⇒ `cc.Prefab`「ShadowPeaPF0PAR」
 *    · 实例化：`NodePools.instantiatePooly(那个 Prefab)` ⇒ `cc.Node`（实测可用）
 *    · 落点：引擎 `commonShot.playParticle` 里是 `n.parent = this.node.parent`
 *            ⇒ 实机观测到父节点 = 车道的 **prjLayer**（通用名 `New Node`）
 *    · ⚠️ 用户给的那张**参考贴图**（PTX 文件）**仅作参考、绝不引用**，连文件名都不写进源码：
 *      这里只用引擎自己的 prefab。
 *  ★ 状态按**场景键**失效（换场景后旧 prefab / 旧父节点都不能再用，否则抛
 *    `Cannot read properties of null (reading '_prefab')` —— 本工程踩过）。 */
const GPN_SPORE_FX = {
    prefab: null,      // 命中特效 prefab（cc.Prefab）
    refd: false,       // 是否 addRef 过（decRef 要配平）
    sceneKey: null,    // 缓存所属场景
    parent: null,      // 引擎自己用的那个父节点（= 车道 prjLayer）
    parentSceneKey: null,
    loading: false,    // 正在加载中（避免重复发起）
    failLogged: false,
};

/** `NodePools.instantiatePooly` 的模块级引用（setup 里注入；特效播放要用） */
let gpnSporeInstantiateRef = null;

/** 拿 cc（模块级通用取法） */
function gpnSporeCc() {
    try { return (typeof cc !== 'undefined' && cc) ? cc : null; } catch (e) { return null; }
}

/** 丢掉特效缓存（换场景 / 出厂清理时调）—— addRef 过的才 decRef（配平） */
function gpnSporeFxDrop() {
    const S = GPN_SPORE_FX;
    try {
        if (S.refd && S.prefab && typeof S.prefab.decRef === 'function') S.prefab.decRef();
    } catch (e) { /* 资源可能已经没了 */ }
    S.prefab = null; S.refd = false; S.sceneKey = null;
    S.parent = null; S.parentSceneKey = null; S.loading = false;
}

/** 记录"引擎自己用的父节点"（由弹道钩子回填；按场景键存） */
function gpnSporeFxSetParent(parent, deps) {
    if (!parent) return;
    const key = (typeof gpnFxSceneKey === 'function') ? gpnFxSceneKey(deps) : null;
    const S = GPN_SPORE_FX;
    S.parent = parent;
    S.parentSceneKey = key;
}

/** 取父节点：**优先「本株 / 本行所在车道的 prjLayer」**（最准、确定），其次弹道钩子回填的缓存。
 *
 *  ⚠️⚠️ **历史坑（2026/10/16 用户实测：偶发一次"特效被植物贴图盖住"）**：
 *    · 亡语那条路原来是 `gpnSporeFxGetParent(null, D)` —— 传 `plant = null`
 *      ⇒ **"车道 prjLayer"这个分支永远走不到**，只剩"缓存"分支；
 *    · 缓存 = 上一次**弹道命中**时观察到的 `shot.node.parent`。若那一刻的缓存还是**上一关 / 旧帧**的节点，
 *      特效就会落进一个**层不对**的父节点（症状正是"被孢子菇自己的贴图盖住"）；
 *      而**下一发弹道命中会把缓存改回 prjLayer** ⇒ 所以**只偶发一次**、之后又正常 ✓ 与实测完全吻合。
 *    · 缓存校验原本是 `S.parentSceneKey === key`：**两支都是 `null` 时会误判为"同一个场景"**
 *      （`gpnFxSceneKey` 在车道还没就绪时返回 null）⇒ 这里改成 **key 必须非空**才认缓存。
 *
 *  ⇒ 现在：**调用方显式把车道传进来**（`laneOverride`），彻底不依赖缓存；缓存只作为兜底。 */
function gpnSporeFxGetParent(plant, deps, laneOverride) {
    try {
        const lane = laneOverride || (plant && plant.inLane) || null;
        if (lane && lane.prjLayer) return lane.prjLayer;
    } catch (e) { /* 忽略 */ }
    const key = (typeof gpnFxSceneKey === 'function') ? gpnFxSceneKey(deps) : null;
    const S = GPN_SPORE_FX;
    // ★ `key` 必须非空 —— 否则"新旧两支都是 null"会被当成同一场景，把上一关的旧父节点认下来
    if (key && S.parent && S.parentSceneKey === key) return S.parent;
    return null;
}

/** 节点层链（诊断用）：`名字 < 父 < 祖父 …` */
function gpnSporeFxChain(node) {
    const out = [];
    try {
        let n = node, d = 0;
        while (n && d < 4) { out.push(n.name || n._name || '?'); n = n.parent; d++; }
    } catch (e) { /* 忽略 */ }
    return out.join(' < ');
}

/** 把 `Prefab.data` 树里第一个带 `prop` 的组件的该属性挖出来（照抄本 MOD 的 findPropInNode） */
function gpnSporeFindProp(node, prop, depth) {
    if (!node) return null;
    if (depth === undefined) depth = 0;
    if (depth > 8) return null;
    try {
        const comps = node.components || node._components || [];
        for (let i = 0; i < comps.length; i++) {
            const c = comps[i];
            if (c && c[prop]) return c[prop];
        }
        const kids = node.children || node._children || [];
        for (let i = 0; i < kids.length; i++) {
            const r = gpnSporeFindProp(kids[i], prop, depth + 1);
            if (r) return r;
        }
    } catch (e) { /* 忽略 */ }
    return null;
}

/** 确保特效 prefab 已加载（幂等；失败只 warn 一次） */
function gpnSporeFxEnsure(deps) {
    const S = GPN_SPORE_FX;
    const ccg = gpnSporeCc();
    if (!ccg || !ccg.Prefab || !ccg.assetManager) return;
    const key = (typeof gpnFxSceneKey === 'function') ? gpnFxSceneKey(deps) : null;
    if (S.prefab && S.sceneKey === key) return;      // 已就绪
    if (S.loading) return;
    // 换场景了 ⇒ 先丢掉旧的（含 decRef 配平）
    if (S.prefab && S.sceneKey !== key) gpnSporeFxDrop();
    S.loading = true;

    const mgr = ccg.assetManager;
    const take = (bundle) => {
        try {
            bundle.load(CFG.sporeshroom.fxPrjPath, ccg.Prefab, (err, prefab) => {
                S.loading = false;
                if (err || !prefab) {
                    if (!S.failLogged) { S.failLogged = true; warn('孢子菇亡语特效：加载 ' + CFG.sporeshroom.fxPrjPath + ' 失败：' + (err && (err.message || err))); }
                    return;
                }
                try {
                    const data = prefab.data || prefab._data;
                    const par = gpnSporeFindProp(data, CFG.sporeshroom.fxPropName);
                    const el = (par && par.length) ? par[0] : null;
                    if (!el) {
                        if (!S.failLogged) { S.failLogged = true; warn('孢子菇亡语特效：' + CFG.sporeshroom.fxPrjPath + ' 上找不到 ' + CFG.sporeshroom.fxPropName); }
                        return;
                    }
                    S.prefab = el;
                    S.sceneKey = key;
                    S.refd = false;
                    if (typeof el.addRef === 'function') {
                        try { el.addRef(); S.refd = true; } catch (e2) { /* 没引用计数就算了 */ }
                    }
                    log('孢子菇亡语特效：已就绪（' + (el.name || el._name || '?') + '，来自 ' + CFG.sporeshroom.fxPrjPath + '）');
                } catch (e) { warn('孢子菇亡语特效：解析 prefab 出错', e); }
            });
        } catch (e) { S.loading = false; warn('孢子菇亡语特效：取 prefab 出错', e); }
    };

    try {
        const bs = mgr.bundles;
        let b = null;
        if (bs) {
            if (typeof bs.get === 'function') b = bs.get('resources');
            if (!b && bs._assets) b = bs._assets['resources'];
        }
        if (b) { take(b); return; }
        mgr.loadBundle('resources', (err, bundle) => {
            if (err || !bundle) { S.loading = false; warn('孢子菇亡语特效：loadBundle(resources) 失败：' + (err && (err.message || err))); return; }
            take(bundle);
        });
    } catch (e) { S.loading = false; warn('孢子菇亡语特效：取 bundle 出错', e); }
}

/** 在 (x,y) 放一次命中特效；返回节点或 null（绝不抛错） */
function gpnSporeFxSpawn(parent, pos) {
    const S = GPN_SPORE_FX;
    if (!S.prefab || !parent || !pos) return null;
    const inst = gpnSporeInstantiateRef;              // 由 setup 注入（NodePools.instantiatePooly）
    if (typeof inst !== 'function') return null;
    let node = null;
    try {
        const ccg = gpnSporeCc();
        node = inst(S.prefab);
        if (!node) return null;
        node.parent = parent;
        // ★ 保险：把它放到该父节点的**最后一个孩子**（= 同层最上面）。
        //   为什么需要：`instantiatePooly` 从池里取回的节点可能带着**旧的 siblingIndex**；
        //   池化复用 + 同层频繁增删时，会出现"新特效被同层旧元素盖住"（用户 2026/10/16 报过一次偶发）。
        try {
            const kids = parent.children || parent._children;
            if (kids && typeof node.setSiblingIndex === 'function') node.setSiblingIndex(kids.length - 1);
        } catch (e2) { /* 忽略 */ }
        // 诊断（verboseLog 打开时；限流）：把"落进哪个父节点、层链长什么样"记下来，
        // 万一以后再出现"层不对"，这一行就能直接定位（本轮就是缺了它才只能靠推理）。
        try {
            if (typeof gpnPoisonDiag === 'function') {
                gpnPoisonDiag('fx.spawn', (n) => '[孢子菇·特效] 已放：父节点=' + (parent.name || parent._name || '?')
                    + ' ｜ 层链=' + gpnSporeFxChain(parent)
                    + ' ｜ 同层孩子=' + ((parent.children || parent._children || []).length)
                    + ' ｜ 位置=(' + Math.round(pos.x) + ',' + Math.round(pos.y) + ')（第 ' + n + ' 次）');
            }
        } catch (e3) { /* 忽略 */ }
        if (ccg && ccg.v3) node.worldPosition = new ccg.v3(pos.x, pos.y, 0);
        else if (node.worldPosition) { node.worldPosition.x = pos.x; node.worldPosition.y = pos.y; }
        return node;
    } catch (e) {
        // ★ 资源失效（换场景）⇒ 清缓存，下次重取（本工程约定，不要求大退）
        warn('孢子菇亡语特效：播放失败，已清缓存下次重取', e);
        gpnSporeFxDrop();
        return null;
    }
}

/** 「就绪」回调（补丁工厂里用）：有父节点就直接放 */
function gpnSporeFxReady(parent, pos) {
    if (!parent || !pos) return null;
    gpnSporeFxEnsure(null);
    return gpnSporeFxSpawn(parent, pos);
}

/* ---- 弹道钩子：把「引擎自己用的那个特效父节点」记下来（只读观测，不改行为）----
 *  为什么需要：引擎 `commonShot.playParticle` 里是 `n.parent = this.node.parent`；
 *  实机探针（S1c）观测到那个父节点就是**车道的 prjLayer**（通用名 `New Node`，
 *  链：`<RowN> < squaresLower < LawnCommon < Canvas < inGameScene`）。
 *  拿到它之后，孢子菇亡语特效就能落在**和原版一模一样**的层上。
 *  实现：包装 `playParticle` —— **先原样调用原函数**，再顺手缓存 `this.node.parent`。
 *  ⚠️ 绝不改返回值 / 副作用；关掉开关时也不拆（钩子无害，仅一次赋值）。 */
function makeSporeShroomCommonShotHook(CommonShot, deps) {
    const recs = [];
    if (!CommonShot || !CommonShot.prototype || typeof CommonShot.prototype.playParticle !== 'function') {
        warn('孢子菇亡语特效：拿不到 commonShot.playParticle（特效父节点将退化为"车道 prjLayer"直取）');
        return recs;
    }
    const rec = methodRecord(CommonShot, 'playParticle');
    CommonShot.prototype.playParticle = function () {
        const r = rec.original.apply(this, arguments);       // ★ 先原样调用
        try {
            const nd = this && this.node;
            const parent = nd && nd.parent;
            if (parent) gpnSporeFxSetParent(parent, deps);
        } catch (e) { /* 忽略 */ }
        return r;
    };
    recs.push(rec);
    return recs;
}


/**
 * 僵尸侧门禁（R5 的"开关两态"）
 *
 *  ★ 引擎事实（逐字核对）：`Zombie.playDie` 里**本来就有**亡语分支 ——
 *      `t || ( …, this.playSpecialZombieDie(e,s), …, this.CarriedSporeShroom && this.turnIntoSporeShroom("sporeshroom") )`
 *    ⇒ 「带 `CarriedSporeShroom` 的僵尸非化灰死亡 ⇒ 变出一株孢子菇」**原版行为就是如此**
 *      （`turnIntoSporeShroom` 里还会 `playDie(!0,null,!1)` + 缩小 + `particle.sporeShroomSpawn()`
 *        + `SpawnPlantByType('sporeshroom',…)` + `onSpawnedAsSporeShroom()` + `shovelDropSun=!1`）。
 *    ⇒ 我们**不需要重写**它；只需要在**开关关掉时**把它压住（否则"关掉"形同虚设）。
 *
 *  实现：包装 `Zombie.prototype.playDie` —— 只有"开关关 + 身上有标记"时才临时摘掉标记
 *  （**原样调用**之后再还原），其它情况**完全不动**。这样：
 *    · 开 ⇒ 引擎原逻辑照跑（100% 原版手感，含动画/音效/不掉阳光）
 *    · 关 ⇒ 不生成孢子菇；且标记本身也不该再被写（见亡语里的 `if (!featOn(...)) return`）
 */
function makeSporeShroomZombieGate(Zombie, deps) {
    const recs = [];
    if (!Zombie || !Zombie.prototype || typeof Zombie.prototype.playDie !== 'function') {
        warn('孢子菇：拿不到 Zombie.playDie（"关掉开关不生成孢子菇"这一条会失效）');
        return recs;
    }
    const rec = methodRecord(Zombie, 'playDie');
    Zombie.prototype.playDie = function () {
        // ★ 只在"开关关 + 身上有标记"时做手脚；其余一律原样
        let patched = false, saved = false;
        try {
            if (!featOn(GPN_SPORE_FEAT) && this.CarriedSporeShroom === true) {
                saved = true;
                this.CarriedSporeShroom = false;      // 临时摘掉 ⇒ 引擎那段 `&&` 不成立
                patched = true;
            }
        } catch (e) { /* 忽略 */ }
        const r = rec.original.apply(this, arguments);   // ★ 原样调用
        try {
            if (patched && saved) this.CarriedSporeShroom = true;   // 还原（僵尸可能被复用，标记该留着）
        } catch (e) { /* 忽略 */ }
        return r;
    };
    recs.push(rec);
    return recs;
}


/* =========================================================================
 * 孢子菇 ×1.5（R6/R7）—— 「带孢子标记的僵尸，受到毒性家族伤害 ×1.5」
 *  （= 设计稿 §5「第二步」：**直伤 + Dot 一起做完**）
 *
 *  用户需求（2026-10-16 定稿，见 `CTM\设计稿-孢子菇.md` §0 / §6 Q2）：
 *    R6 带 `CarriedSporeShroom` 标记的僵尸，受**毒性家族**伤害 ×1.5（**直击与持续伤害都算**）
 *    R7 孢子菇**自己**的伤害也吃这一份（亡语**先标记、再伤害** ⇒ 天生满足）
 *    多段叠加 Dot：**该帧全部 Dot 合计后只 ×1.5 一次**（不是"叠加次数 ×1.5"）
 *    忧郁菇 gloomshroom / 毒影菇 shadowshroom **额外计入**（Family 是 Shadow，数据判不出来）
 *    大蒜 garlic / 巴豆 chilibean **排除**（⚠️ 它们**本来就是** Poison 家族！）
 *    心蕊 bloominghearts **只算子弹直击**（它的"减防 debuff"本身不结算伤害）
 *
 *  === 引擎事实（逐字核对 1.5.5 bundle；@ = 字符偏移）===
 *   · `Zombie.defaultDealDamage(details)`（@3600436）是**所有僵尸伤害的最终落点**：
 *     它自己只读 `t.damage`；僵尸子类里那些 `dealDamage` 覆写（共 6 处）最后也都调它
 *     ⇒ **在这一点乘倍率 = 一处覆盖「直击 + 溅射 + 非弹道直伤 + Dot」**。
 *   · 乘倍率要**造替身**：用引擎自己的 `ZombieDamageDetails.replaceDamage(newDamage)`
 *     （@486803，它 `new` 一个新对象并带上 armorProtection / damageType / shockRGB 等全部字段）
 *     ⇒ **绝不改原对象**（同一份 details 会被多只僵尸共用，改了会连坐 + 变成 ×1.5^N）。
 *   · `Zombie.dealPoison(dt)`（@3594834）是**所有 Dot 的唯一结算点**：
 *       主毒   = `dealDamage(new ZDD(dt * this.poison.DPS, …))`
 *       叠加毒 = `_poison_stacked` 逐条 `dealDamage(s.replaceDamage(dt * e.DPS))`
 *     ⇒ 进 dealPoison 之前把"属于毒性家族"的那几份毒的 `DPS` 临时 ×1.5，
 *       就等价于"该帧家族 Dot 合计 ×1.5、且**只乘一次**"（线性；绝不会 ×1.5^N）。
 *       `ZombiePoison.DPS` 是**可写数据字段**（@3580907 描述符 `writable:!0`）。
 *   · `Zombie.setPoison(DPS,dur,infect)`（@3594499）**只收数字**、内部 `new ZombiePoison`
 *     ⇒ 来源没法从参数带进来；而 `pushPoisonStacked(obj)`（同处）推的是**同一个对象**
 *     ⇒ 用一个"当前来源算不算毒性家族"的**瞬时标记**给毒对象盖章 `__gpnPoisonFam`，
 *       Dot 结算时按章决定乘不乘（**没盖章 = 不算** ⇒ 巴豆的薄荷毒天然被排除在外）。
 *   · 弹道侧：`commonShot.dealDamageToZombie(e,t,i,o)`（@576376）在**一次同步调用**里做完
 *     "直击 + 溅射 + 上毒（setPoison / pushPoisonStacked）"；`dealSplashDamage`（@565552）
 *     是它的溅射入口，也会被 `onTombHit` 等路径单独调用 ⇒ **两处都要开"来源窗口"**。
 *     `this.carriedSporeShroom = e.CarriesSporeShroom`（@560858）⇒ **孢子菇自己的弹道天然可认**；
 *     其它植物靠**发射时打在弹道上的标记** `shot.__gpnPoisonFam`。
 *   · ⚠️ **S4-1 教训（实机探针）**：绝不能在"弹道命中"处反查"谁打的" —— 实测
 *     `shot.master/owner/plant/srcPlant` 全空、`PrjFunctions.shootOnePea` 的 `this` 是
 *     `PrjFunctions` 自己 ⇒ **标记必须在植物自己的发射入口打**。
 *   · 发射入口的三种形态（逐个实测，**别想当然**）：
 *       ① `PeashooterPlant._shoot`（@2312816）**return 弹道**（`t.abrupt("return",y)`）
 *          ⇒ 直接拿返回值打标。实测继承它且**没有覆盖** `_shoot` 的只有：
 *          `GooPeashooterPlant`（毒液豌豆）/ `PuffShroomPlant`（小喷菇）/
 *          `SeaShroomPlant`（海蘑菇，经 PuffShroom）/ 以及普通豌豆系。
 *       ② `ScaredyShroomPlant._shoot`（@2666366）**不 return 弹道**（`return t.stop()`）
 *          ⇒ 靠"发射期间置 pending + 包 `PrjFunctions.shootOnePea` 读 pending"。
 *       ③ **心蕊 `BloomingHeartPlant` 继承的是 `CabbagePultPlant`（抛投系，不是豌豆系！）**
 *          ⇒ 它的弹道来自 `_lobToZombie` / `_lobToTomb` / `_lobToPos`
 *            （@361288 / @362861 / @362204），同样**不 return** ⇒ 同样走 pending +
 *            `PrjFunctions.lobOneCabbageOnZombie / OnTomb / OnPos`。
 *      pending 之所以成立（已逐个核对）：这三个入口都在**生成器第一步**里同步调用
 *      `PrjFunctions.*`（原文形如 `t.next=6, w.lobOneCabbageOnZombie(…)`），
 *      而我们的包装器是在**被调用的那一瞬间**读 pending ⇒ 不会跨越 await。
 *   · `Plant_Type`（@1930114 `N.Plant_Type = c || I.CODENAME`）是植物实例上的**别名字符串**
 *     ⇒ 家族判定 = `PlantProps[Plant_Type].objdata.Family`。
 *   · ★ **`setPoison(` 在 1.5.5 bundle 里共 16 个调用点** —— 逐条清点过（这是最容易漏 Dot 的地方）：
 *       本 MOD **算**（= 家族来源，要 ×1.5）：
 *         AilMint.specialMintAnimationListener(boost_begin) ｜ commonShot.dealDamageToZombie（弹道自带的毒）
 *         GloomShroom.detectEnemies ｜ goopeaFoodPrj.detectEnemy（**毒液豌豆大招弹**）
 *         GooTileLiquid.specialTileLiquidUpdate（那发大招留下的**黏液地面**；数据 `TileLiquidType="goo"`）
 *         MariGoldPurple._turn ｜ ShadowShroom.specialPlantOnEaten ｜ ShadowShroom.animationListener(foodExplode)
 *         Zombie.dealPoison（传染给邻居）｜ Zombie.copyBuff（把毒复制给另一只）
 *       本 MOD **不算**（每条都有明确理由）：
 *         ChiliBean → Zombie.chilibeanFart（**用户指定：巴豆排除**）
 *         Stunion.animationListener（薄荷毒；眩晕洋葱**不在** Poison 家族）
 *         Dragonbruit._shoot / _shootOnTomb（不在 Poison 家族）
 *         duskSplat.dealSplashDamage（**暗影菇·黄昏投手**系弹道，不在用户名单内）
 *         commonShot.ts @563875 那个 `setPoison(DPS,duration)`（那是**弹道自己的载荷对象**，
 *           不是僵尸侧的 setPoison，名字相同、语义不同）
 * =======================================================================*/

/** 额外白名单：Family 是 Shadow、但用户特意要求也吃 ×1.5（含 `_mgp` 前缀变体） */
const GPN_SPORE_FAM_EXTRA = ['gloomshroom', 'shadowshroom'];
/** 排除表：它们**本来就是** Poison 家族，但用户指定不算 */
const GPN_SPORE_FAM_EXCLUDE = ['garlic', 'chilibean'];

/** 倍率（唯一来源 = CFG；图鉴文案也从它现算） */
function gpnSporeMult() {
    try {
        const v = Number(CFG.sporeshroom.poisonBonus);
        if (isFinite(v) && v > 0) return v;
    } catch (e) { /* 忽略 */ }
    return 1.5;
}

/** 纯函数：别名 + 它的数据 Family ⇒ 算不算"吃 ×1.5 的毒性家族"（自检直接单测） */
function gpnSporeIsPoisonFam(type, family) {
    const t = (type == null) ? '' : String(type);
    if (!t) return family === 'Poison';                    // 拿不到别名就只看数据
    if (GPN_SPORE_FAM_EXCLUDE.indexOf(t) !== -1) return false;
    for (let i = 0; i < GPN_SPORE_FAM_EXTRA.length; i++) {
        const x = GPN_SPORE_FAM_EXTRA[i];
        if (t === x || t.indexOf(x + '_') === 0) return true;
    }
    return family === 'Poison';
}

/** 取植物实例的数据 Family（优先 Plant_Type → PlantProps；再退实例自己的 objdata） */
function gpnSporeFamilyOf(plant) {
    if (!plant) return null;
    try {
        const t = plant.Plant_Type;
        if (typeof t === 'string' && t) {
            /* ★ 兼容 `RTID(xxx@PlantTypes)` 形式：用 normalizeType 比别名 */
            const tKey = normalizeType(t);
            const Box = (typeof gpnResolveDataBox === 'function') ? gpnResolveDataBox() : null;
            const list = Box && Box.PlantProps;
            if (Array.isArray(list)) {
                for (let i = 0; i < list.length; i++) {
                    const e = list[i];
                    if (!e || !Array.isArray(e.aliases)) continue;
                    let hit = false;
                    for (let j = 0; j < e.aliases.length; j++) {
                        const a = e.aliases[j];
                        if (a === t || normalizeType(a) === tKey) { hit = true; break; }
                    }
                    if (!hit) continue;
                    if (e.objdata && e.objdata.Family != null) return e.objdata.Family;
                    break;
                }
            }
        }
    } catch (e) { /* 忽略 */ }
    try {
        const od = plant.objdataOwn || plant.objdata;
        if (od && od.Family != null) return od.Family;
    } catch (e) { /* 忽略 */ }
    return null;
}

/** 植物实例算不算"吃 ×1.5 的毒性家族" */
function gpnSporePlantQualifies(plant) {
    let t = '';
    try { t = (plant && typeof plant.Plant_Type === 'string') ? plant.Plant_Type : ''; } catch (e) { t = ''; }
    const tKey = normalizeType(t);
    if (tKey) {
        const EX = GPN_SPORE_FAM_EXCLUDE.map(normalizeType);
        if (EX.indexOf(tKey) !== -1) return false;
        for (let i = 0; i < GPN_SPORE_FAM_EXTRA.length; i++) {
            const x = normalizeType(GPN_SPORE_FAM_EXTRA[i]);
            if (tKey === x || tKey.indexOf(x) === 0) return true;
        }
    }
    return gpnSporeFamilyOf(plant) === 'Poison';
}

/* 「当前正在结算毒性家族来源」的瞬时窗口 —— 用**计数**而不是布尔（天然的嵌套安全：
 *   dealDamageToZombie 内部还会再调 dealSplashDamage；异常也必须能正确退栈）。 */
let gpnPoisonDmgDepth = 0;      // >0 ⇒ 这期间的伤害算"毒性家族"
let gpnPoisonStampDepth = 0;    // >0 ⇒ 这期间上的毒盖"家族章"
function gpnPoisonCtxEnter(who) {
    gpnPoisonDmgDepth++;
    gpnPoisonStampDepth++;
    gpnPoisonWhoStack.push(gpnPoisonCtxWho);
    if (who) gpnPoisonCtxWho = who;      // 只为诊断：日志里能看出"这份毒是谁上的"
}
function gpnPoisonCtxExit() {
    if (gpnPoisonDmgDepth > 0) gpnPoisonDmgDepth--;
    if (gpnPoisonStampDepth > 0) gpnPoisonStampDepth--;
    if (gpnPoisonWhoStack.length) gpnPoisonCtxWho = gpnPoisonWhoStack.pop();
}
function gpnPoisonDmgActive() { return gpnPoisonDmgDepth > 0; }
function gpnPoisonStampActive() { return gpnPoisonStampDepth > 0; }

/** 当前窗口的"来源标签"（**仅诊断用**；verboseLog 打开时盖章/×1.5 的日志会带上它） */
let gpnPoisonCtxWho = '—';
const gpnPoisonWhoStack = [];

/** 诊断限流：每个 key **前 3 条 + 之后每 50 条一条**（照本 MOD 香水火/护栏的老做法，绝不刷屏） */
const gpnPoisonDiagCount = new Map();
function gpnPoisonDiag(key, makeMsg) {
    if (typeof verboseOn === 'function' && !verboseOn()) return;
    const n = (gpnPoisonDiagCount.get(key) || 0) + 1;
    gpnPoisonDiagCount.set(key, n);
    if (n > 3 && n % 50 !== 0) return;
    try { log(makeMsg(n)); } catch (e) { /* 忽略 */ }
}

/** "发射期间待盖章"的家族标记（null = 当前不在发射窗口；true/false = 这一发算/不算） */
let gpnPoisonShotPending = null;

/** 给"普通对象上的方法"打补丁（methodRecord 只支持类原型；restore 认 `static:true`） */
function objectMethodRecord(obj, name) {
    return {
        Cls: obj, name,
        original: obj[name],
        own: Object.prototype.hasOwnProperty.call(obj, name),
        static: true,
    };
}

/**
 * 孢子菇 ×1.5 补丁工厂（R6/R7）
 * @param {Object} mods 引擎类/对象：Zombie / CommonShot / PrjFunctions / Peashooter /
 *                      ScaredyShroom / CabbagePult / FumeShroom / Vamporcini /
 *                      GloomShroom / ShadowShroom / AilMint / **MariGold（基类）** /
 *                      GooFoodPrj / GooTileLiquid
 *                      ⚠️ **不要**传 `MariGoldPurple`：那个模块**没有导出类**（实测）。
 * @returns {Array} recs（交给上层还原/清理）
 */
function makeSporePoisonBonusPatch(mods) {
    const recs = [];
    const M = mods || {};
    const Zombie = M.Zombie;
    const P = (Cls, name) => (Cls && Cls.prototype && typeof Cls.prototype[name] === 'function');
    /** 安装情况汇总（verboseLog 打开时打一行 —— 实机排查"哪一项没挂上"最快的手段） */
    const installed = [];
    const mark = (label, ok) => { installed.push(label + (ok ? '✓' : '✗')); };

    /* ---------- ① 伤害落点：带标记的僵尸 ×1.5（直击 / 溅射 / 非弹道直伤 / Dot 全覆盖） ---------- */
    if (P(Zombie, 'defaultDealDamage')) {
        const rec = methodRecord(Zombie, 'defaultDealDamage');
        Zombie.prototype.defaultDealDamage = function (d) {
            // 【运行期开关】关掉 ⇒ 逐字回原版
            if (!featOn(GPN_SPORE_FEAT) || !gpnPoisonDmgActive()) return rec.original.apply(this, arguments);
            try {
                if (this && this.CarriedSporeShroom === true && d
                    && typeof d.damage === 'number' && d.damage > 0
                    && typeof d.replaceDamage === 'function') {
                    // ★ 用引擎自己的 replaceDamage 造替身：**不改原对象**（它可能被多只僵尸共用）
                    return rec.original.call(this, d.replaceDamage(d.damage * gpnSporeMult()));
                }
            } catch (e) { /* 出错就退回原逻辑，绝不因此吞伤害或加倍 */ }
            return rec.original.apply(this, arguments);
        };
        recs.push(rec);
        mark('伤害落点', true);
    } else if (Zombie) {
        mark('伤害落点', false);
        warn('跳过孢子菇加成：拿不到 Zombie.defaultDealDamage');
    }

    /* ---------- ② Dot：dealPoison（按"来源章"临时乘 DPS ⇒ 合计一次、绝不 ×1.5^N） ---------- */
    if (P(Zombie, 'dealPoison')) {
        const rec = methodRecord(Zombie, 'dealPoison');
        Zombie.prototype.dealPoison = function () {
            if (!featOn(GPN_SPORE_FEAT) || this.CarriedSporeShroom !== true) return rec.original.apply(this, arguments);
            const saved = [];
            let spread = false;
            let scaledMain = 0, scaledStack = 0, unscaledMain = 0;
            try {
                const p = this.poison;
                if (p && p.DPS > 0) {
                    if (p.__gpnPoisonFam === true) {
                        const before = p.DPS;
                        saved.push([p, before]);
                        p.DPS = before * gpnSporeMult();
                        scaledMain = 1;
                        spread = (p.infective === true);     // 这份毒会传染 ⇒ 邻居那份也该带家族章
                        // ⚠️ 万一 `ZombiePoison.DPS` 在真机上是**只读访问器**，上面那句会**静默失败**
                        //    ⇒ 症状恰好是"毒整帧不加成"、极难查 ⇒ 这里当场验一次（只报一条）。
                        if (!(p.DPS > before)) {
                            gpnPoisonDiag('dot.mutate-fail', () => '[孢子菇·Dot] ⚠️⚠️ 改写 ZombiePoison.DPS **没有生效**'
                                + '（真机上它可能是只读访问器）⇒ Dot 的 ×1.5 会失效；请把这一行发给作者');
                        }
                    } else {
                        unscaledMain = 1;                    // 带标记、但这份毒**没有家族章**（诊断用）
                    }
                }
                const st = this._poison_stacked;
                if (Array.isArray(st)) {
                    for (let i = 0; i < st.length; i++) {
                        const q = st[i];
                        if (q && q.__gpnPoisonFam === true && q.DPS > 0) {
                            const beforeQ = q.DPS;
                            saved.push([q, beforeQ]);
                            q.DPS = beforeQ * gpnSporeMult();
                            scaledStack++;
                            if (!(q.DPS > beforeQ)) {
                                gpnPoisonDiag('dot.mutate-fail-stack', () => '[孢子菇·Dot] ⚠️⚠️ 叠加毒的 DPS 改写**没有生效**'
                                    + '（同上：可能是只读访问器）⇒ 叠加毒不吃 ×1.5');
                            }
                        }
                    }
                }
                // ---- 诊断（verboseLog 打开时；每个 key 前 3 条 + 之后每 50 条）----
                if (scaledMain || scaledStack) {
                    gpnPoisonDiag('dot.ok', (n) => '[孢子菇·Dot] ×1.5 生效：主毒=' + (scaledMain ? '乘' : '—')
                        + ' 叠加=' + scaledStack + ' 份 ｜ 僵尸=' + (this.Zombie_Type || '?') + '（第 ' + n + ' 次）');
                } else if (unscaledMain) {
                    gpnPoisonDiag('dot.no-stamp', (n) => '[孢子菇·Dot] ⚠️ 僵尸带标记、但主毒**没有家族章**：dps='
                        + p.DPS + ' dur=' + p.duration + ' ｜ 僵尸=' + (this.Zombie_Type || '?')
                        + '（= 上毒那一刻不在"家族窗口"里 ⇒ 那条来源没挂钩子/没开窗口）（第 ' + n + ' 次）');
                }
                if (spread) {
                    // ⚠️ 只开"盖章"窗口、**不开"伤害"窗口** —— 否则 Dot 会被乘两次
                    gpnPoisonStampDepth++;
                    try { return rec.original.apply(this, arguments); } finally { gpnPoisonStampDepth--; }
                }
                return rec.original.apply(this, arguments);
            } finally {
                for (let i = 0; i < saved.length; i++) {
                    try { saved[i][0].DPS = saved[i][1]; } catch (e) { /* 忽略 */ }
                }
            }
        };
        recs.push(rec);
        mark('Dot结算', true);
    } else if (Zombie) {
        mark('Dot结算', false);
        warn('跳过孢子菇 Dot 加成：拿不到 Zombie.dealPoison');
    }

    /* ---------- ③ Dot 来源记账：给毒对象盖章（没盖章 = 不算家族） ---------- */
    if (P(Zombie, 'setPoison')) {
        const rec = methodRecord(Zombie, 'setPoison');
        Zombie.prototype.setPoison = function () {
            const r = rec.original.apply(this, arguments);   // 引擎内部 new 出新的 ZombiePoison
            try {
                if (this.poison) {
                    const on = gpnPoisonStampActive();
                    this.poison.__gpnPoisonFam = on;
                    if (on) {
                        gpnPoisonDiag('stamp.on', (n) => '[孢子菇·毒章] 来源=' + gpnPoisonCtxWho
                            + ' dps=' + this.poison.DPS + ' dur=' + this.poison.duration
                            + ' ｜ 僵尸=' + (this.Zombie_Type || '?') + '（第 ' + n + ' 次）');
                    }
                }
            } catch (e) { /* 忽略 */ }
            return r;
        };
        recs.push(rec);
        mark('毒章set', true);
    } else if (Zombie) {
        mark('毒章set', false);
        warn('跳过孢子菇毒章：拿不到 Zombie.setPoison（Dot 将全部不加成）');
    }
    if (P(Zombie, 'pushPoisonStacked')) {
        const rec = methodRecord(Zombie, 'pushPoisonStacked');
        Zombie.prototype.pushPoisonStacked = function (t) {
            // 推的是**同一个毒对象**（引擎原文 `this._poison_stacked.push(t)`）⇒ 章会长期留在它身上
            try {
                if (t) {
                    const on = gpnPoisonStampActive();
                    t.__gpnPoisonFam = on;
                    if (on) {
                        gpnPoisonDiag('stamp.stack', (n) => '[孢子菇·毒章·叠加] 来源=' + gpnPoisonCtxWho
                            + ' dps=' + t.DPS + ' dur=' + t.duration + '（第 ' + n + ' 次）');
                    }
                }
            } catch (e) { /* 忽略 */ }
            return rec.original.apply(this, arguments);
        };
        recs.push(rec);
        mark('毒章叠加', true);
    } else if (Zombie) {
        mark('毒章叠加', false);
    }

    /* ---------- ④ 弹道命中/溅射：开"来源窗口"（上毒 + 直伤都在这个同步窗口里） ---------- */
    const CommonShot = M.CommonShot;
    const shotIsFam = function (shot) {
        try {
            return !!(shot && (shot.__gpnPoisonFam === true || shot.carriedSporeShroom === true));
        } catch (e) { return false; }
    };
    if (CommonShot && CommonShot.prototype) {
        const names = ['dealDamageToZombie', 'dealSplashDamage'];
        for (let i = 0; i < names.length; i++) {
            const nm = names[i];
            if (!P(CommonShot, nm)) continue;
            const rec = methodRecord(CommonShot, nm);
            CommonShot.prototype[nm] = function () {
                if (!featOn(GPN_SPORE_FEAT) || !shotIsFam(this)) return rec.original.apply(this, arguments);
                gpnPoisonCtxEnter('弹道·' + (this.carriedSporeShroom === true ? '孢子菇弹' : '家族弹'));
                try { return rec.original.apply(this, arguments); } finally { gpnPoisonCtxExit(); }
            };
            recs.push(rec);
            mark(nm, true);
        }
    }

    /* ---------- ⑤ 发射时打标：植物入口置 pending，PrjFunctions 那一瞬读走 ---------- */
    //  ⚠️ S4-1 教训：绝不能"命中时反查来源"（弹道上没有主人信息）⇒ 必须在植物入口打标。
    const Prj = M.PrjFunctions;
    const wrapShotEntry = function (Cls, name, label) {
        if (!P(Cls, name)) {
            if (label) warn('跳过孢子菇加成标记：拿不到 ' + label);
            return null;
        }
        const rec = methodRecord(Cls, name);
        const tagPending = function () {
            if (!featOn(GPN_SPORE_FEAT)) return rec.original.apply(this, arguments);
            let fam = false;
            try { fam = gpnSporePlantQualifies(this); } catch (e) { fam = false; }
            gpnPoisonShotPending = fam;
            try { return rec.original.apply(this, arguments); }
            finally { gpnPoisonShotPending = null; }
        };
        Cls.prototype[name] = tagPending;
        return rec;
    };
    // ① 豌豆系（含**毒液豌豆** / 小喷菇 / 海蘑菇）：`_shoot` 会 return 弹道 ⇒ 也可直接用它打标
    if (P(M.Peashooter, '_shoot')) {
        const rec = methodRecord(M.Peashooter, '_shoot');
        M.Peashooter.prototype._shoot = function () {
            if (!featOn(GPN_SPORE_FEAT)) return rec.original.apply(this, arguments);
            let fam = false;
            try { fam = gpnSporePlantQualifies(this); } catch (e) { fam = false; }
            gpnPoisonShotPending = fam;
            let r;
            try { r = rec.original.apply(this, arguments); }
            finally { gpnPoisonShotPending = null; }
            // 引擎自己的返回值就是弹道 ⇒ 顺手打一次标（PrjFunctions 那条路是给"不 return"的植物兜底）
            try {
                if (r && typeof r.then === 'function') {
                    return r.then((shot) => { try { if (shot) shot.__gpnPoisonFam = fam; } catch (e) { /* 忽略 */ } return shot; });
                }
                if (r) r.__gpnPoisonFam = fam;
            } catch (e) { /* 忽略 */ }
            return r;
        };
        recs.push(rec);
        mark('豌豆系_shoot', true);
    } else if (M.Peashooter) {
        mark('豌豆系_shoot', false);
    }
    // ② 胆小菇（自己的 `_shoot`、**不 return 弹道**）
    const recScaredy = wrapShotEntry(M.ScaredyShroom, '_shoot', 'ScaredyShroom._shoot');
    if (recScaredy) recs.push(recScaredy);
    mark('胆小菇_shoot', !!recScaredy);
    // ③ 心蕊（抛投系）：三个抛投入口（同样不 return 弹道）
    let nLob = 0;
    for (const nm of ['_lobToZombie', '_lobToTomb', '_lobToPos']) {
        const r3 = wrapShotEntry(M.CabbagePult, nm, 'CabbagePult.' + nm);
        if (r3) { recs.push(r3); nLob++; }
    }
    mark('抛投系_lobTo(3)', nLob === 3);
    // ④ pending 的读者：`PrjFunctions.*`（**进入时就读** —— 不能放进 .then，那里已经跨过 await 了）
    if (Prj) {
        const tagCb = function (tag) {
            return function (shot) {
                try { if (shot) shot.__gpnPoisonFam = tag; } catch (e) { /* 忽略 */ }
                return shot;
            };
        };
        for (const nm of ['shootOnePea', 'lobOneCabbageOnZombie', 'lobOneCabbageOnTomb', 'lobOneCabbageOnPos']) {
            if (typeof Prj[nm] !== 'function') continue;
            const rec = objectMethodRecord(Prj, nm);
            Prj[nm] = function () {
                const tag = gpnPoisonShotPending;               // ★ 必须在这一瞬读
                const r = rec.original.apply(this, arguments);
                if (tag == null || !r || typeof r.then !== 'function') return r;
                return r.then(tagCb(tag));
            };
            recs.push(rec);
            mark('Prj.' + nm, true);
        }
    } else {
        warn('跳过孢子菇加成标记：拿不到 PrjFunctions（豌豆系仍可用返回值打标）');
    }

    /* ---------- ⑥ 非弹道直伤 / 纯 Dot 的来源窗口 ---------- */
    const ctxWrap = function (Cls, name, label) {
        if (!P(Cls, name)) {
            if (label) warn('跳过孢子菇加成：拿不到 ' + label);
            return null;
        }
        const rec = methodRecord(Cls, name);
        Cls.prototype[name] = function () {
            if (!featOn(GPN_SPORE_FEAT)) return rec.original.apply(this, arguments);
            gpnPoisonCtxEnter(label || name);
            try { return rec.original.apply(this, arguments); } finally { gpnPoisonCtxExit(); }
        };
        return rec;
    };
    const ctxList = [
        [M.FumeShroom, '_shoot', 'FumeShroom._shoot'],                    // 大喷菇：直伤 40（就地 dealDamage）
        [M.Vamporcini, 'absorb', 'Vamporcini.absorb'],                    // 吸血菇：啃咬直伤（就地 dealDamage）
        [M.GloomShroom, 'detectEnemies', 'GloomShroom.detectEnemies'],    // 忧郁菇：3×3 直伤 + setPoison(60,0.1)
        [M.ShadowShroom, 'specialPlantOnEaten', 'ShadowShroom.specialPlantOnEaten'],  // 毒影菇：纯 Dot
        [M.ShadowShroom, 'animationListener', 'ShadowShroom.animationListener'],      // 毒影菇·大招 foodExplode：全场上毒 + 一段毒伤
        [M.AilMint, 'specialMintAnimationListener', 'AilMint.specialMintAnimationListener'], // 毒薄荷：boost_begin 上毒
        // ⚠️ 紫色万寿菊**不能挂它自己的 `_turn`** —— 实测（用户 F12）：`MariGoldPurple.ts` 这个模块
        //    **没有对外导出类**（只做了 `ccclass("MariGoldPurplePlant")` 注册）⇒ 拿不到那个类。
        //    改挂**基类 `MariGoldPlant.specialSunflowerAnimationListener`**（模块 MariGold.ts 有导出 ✓）：
        //    引擎原文 `if("turn"==n.name){ … this._turn(t,e) }` —— 子类**没有覆盖**这个回调，
        //    而 `this._turn` 是**虚调用**，会落到紫色万寿菊自己那份 `_turn` ⇒ 窗口正好罩住它。
        //    （顺带对所有颜色的万寿菊开窗；其它颜色不上毒 ⇒ 无副作用）
        [M.MariGold, 'specialSunflowerAnimationListener', 'MariGold.specialSunflowerAnimationListener'],
        [M.GooFoodPrj, 'detectEnemy', 'goopeaFoodPrj.detectEnemy'],       // 毒液豌豆·大招弹：直伤 + Poison{50,5}
        [M.GooTileLiquid, 'specialTileLiquidUpdate', 'GooTileLiquid.specialTileLiquidUpdate'], // 上面那发大招留下的"黏液地面"（PoisonDPS 50）
    ];
    for (let i = 0; i < ctxList.length; i++) {
        const r6 = ctxWrap(ctxList[i][0], ctxList[i][1], ctxList[i][2]);
        if (r6) recs.push(r6);
        mark(ctxList[i][2], !!r6);
    }

    /* ---------- ⑦ 传染 / 复制增益：让"毒的家族章"跟着走 ---------- */
    //  · `Zombie.copyBuff(src)`（@3618850）会把 src 的毒原样复制给另一只僵尸（`setPoison(t.poison.DPS, …)`）
    //    ⇒ 按 src 那份毒的章决定要不要盖章（否则"被复制的家族毒"会掉章）。
    if (P(Zombie, 'copyBuff')) {
        const rec = methodRecord(Zombie, 'copyBuff');
        Zombie.prototype.copyBuff = function (src) {
            let fam = false;
            try { fam = !!(src && src.poison && src.poison.__gpnPoisonFam === true); } catch (e) { fam = false; }
            if (!fam) return rec.original.apply(this, arguments);
            gpnPoisonStampDepth++;
            try { return rec.original.apply(this, arguments); } finally { gpnPoisonStampDepth--; }
        };
        recs.push(rec);
        mark('copyBuff', true);
    }

    // ★ 安装情况一行汇总（**verboseLog 打开时才有**）—— 实机排查"哪一项没挂上"最快的手段。
    //   本轮就是靠 F12 里那句「跳过孢子菇加成：拿不到 MariGoldPurple._turn」定位到万寿菊的。
    try {
        if (typeof verboseOn === 'function' && verboseOn()) {
            log('[孢子菇×1.5] 钩子安装：' + installed.join(' ｜ '));
        }
    } catch (e) { /* 忽略 */ }

    return recs;
}


/**
 * 孢子菇补丁工厂
 * @param {Function} SporeShroomPlant 引擎的孢子菇植物类
 * @param {Object} deps { cc, nodePools, jsonMod, charMgr, Rect, Vec2, ZombieDamageType, zombiePool }
 * @returns {Array} recs（交给上层做还原/清理）
 */
function makeSporeShroomPatch(SporeShroomPlant, deps) {
    const recs = [];
    if (!SporeShroomPlant || !SporeShroomPlant.prototype) {
        warn('跳过孢子菇：拿不到 SporeShroomPlant');
        return recs;
    }
    const P = SporeShroomPlant.prototype;
    const D = deps || {};
    const C = CFG.sporeshroom;

    /* ---------- 1) 亡语本体（R1~R4 + R10 特效） ---------- */
    if (typeof P.specialPlantOnKilled !== 'function') {
        warn('跳过孢子菇亡语：Plant 基类上没有 specialPlantOnKilled（原版可能改过名）');
    } else {
        const recKilled = methodRecord(SporeShroomPlant, 'specialPlantOnKilled');
        P.specialPlantOnKilled = function () {
            if (!featOn(GPN_SPORE_FEAT)) return recKilled.original.apply(this, arguments);
            let cell = null, node = null;
            try { cell = this.inLnC || null; node = this.node || null; } catch (e) { cell = null; }
            // ★ 先抓住"格子 / 节点 / 世界位置"——scheduleOnce 之后 this 可能已经被清空
            const wp = (function () {
                try {
                    const p = node && node.worldPosition;
                    return (p && isFinite(p.x)) ? { x: p.x, y: p.y } : null;
                } catch (e) { return null; }
            })();
            const lane = gpnSporeLaneOf(this);
            const dmg = gpnSporeDeathDamage(this, D.jsonMod);

            // 把"这一帧的受害者"先算出来（用 Rectangle 判交集；照引擎 explodeCherry3x3 的取框方式）
            const hit = [];
            // ★ 障碍物（墓碑 / 功夫货架 / 冲浪板 / 背包 / 帐篷 / 街机柜 / 音箱 / 冰砖 / 生日礼物 /
            //   冰川块 / 章鱼 ……）—— **用户 2026/10/16 追加**：亡语也要能打障碍物。
            //   口径与流星花**完全同一份白名单**（`gpnMeteorTombIsBlacklisted`：只排除 `kongfu_TNT`=17）。
            //   ⚠️ 障碍物**绝不施加 `CarriedSporeShroom`**（按原版口径）⇒ 它自然也**不吃 ×1.5**
            //      （我们的伤害落点要求"带标记"，天然满足）。
            const tombs = [];
            try {
                const Rect = D.Rectangle;
                const Sq = D.Square;
                const SW = (Sq && typeof Sq.SquareWidth === 'number') ? Sq.SquareWidth : 68;
                const SH = (Sq && typeof Sq.SquareHeight === 'number') ? Sq.SquareHeight : 80.77;
                if (wp && Rect && Rect.createRectangleNodeCenter && node) {
                    const w = (C.deathRadiusTiles > 0 ? C.deathRadiusTiles : 3) * SW;
                    const rect = Rect.createRectangleNodeCenter(node, w, SH);
                    const pool = (lane && typeof lane.zombiePool === 'function') ? (lane.zombiePool() || []) : [];
                    for (const z of pool) {
                        try {
                            if (!z) continue;
                            const br = z.bodyRecReal || z.bodyRec;
                            if (br && rect.judgeCrossRec(br)) hit.push(z);
                        } catch (e) { /* 单只失败忽略 */ }
                    }
                    // 障碍物：`tombPool(0)` = 非魅惑（僵尸方）的墓碑/障碍物；拿不到就退回无参
                    let tp = null;
                    try { if (lane && typeof lane.tombPool === 'function') tp = lane.tombPool(0); } catch (e) { tp = null; }
                    if (!tp && lane && typeof lane.tombPool === 'function') { try { tp = lane.tombPool(); } catch (e2) { tp = null; } }
                    for (const tb of (tp || [])) {
                        try {
                            if (!tb || tb.ignored) continue;
                            if (typeof tb.isAlive === 'function' && !tb.isAlive()) continue;
                            if (gpnMeteorTombIsBlacklisted(tb.ID)) continue;   // 只排除 kongfu_TNT(17)
                            const br = tb.bodyRec || tb.bodyRecReal;           // 障碍物：bodyRec（与 A1 穿透一致）
                            if (br && rect.judgeCrossRec(br)) tombs.push(tb);
                        } catch (e) { /* 单个障碍物失败忽略 */ }
                    }
                }
            } catch (e) { warn('孢子菇亡语：取范围内僵尸/障碍物出错', e); }

            /* ★ 2026/10/22 用户指定：**标记**范围 = 3 行 × 3 列（伤害/眩晕/特效/障碍物伤害仍是 1 行 × 3 列）。
             *   做法：同一个矩形，只把高度改成 `deathMarkRows × SH`（竖着覆盖本行 + 上下各一行）；
             *   池子取「本行 + UpperLane + LowerLane」，按僵尸对象去重（本行那些会同时出现在 hit 里）。
             *   ⚠️ 这些僵尸**只打 `CarriedSporeShroom`**：不眩晕、不扣血（用户口径）。 */
            const markHit = [];
            try {
                const Rect2 = D.Rectangle;
                const Sq2 = D.Square;
                const SW2 = (Sq2 && typeof Sq2.SquareWidth === 'number') ? Sq2.SquareWidth : 68;
                const SH2 = (Sq2 && typeof Sq2.SquareHeight === 'number') ? Sq2.SquareHeight : 80.77;
                const mRows = Math.max(1, Math.floor(Number(C.deathMarkRows) || 1));
                const mCols = Math.max(1, Math.floor(Number(C.deathMarkCols) || 3));
                if (wp && Rect2 && Rect2.createRectangleNodeCenter && node) {
                    const mrect = Rect2.createRectangleNodeCenter(node, mCols * SW2, mRows * SH2);
                    const lanes = [];
                    lanes.push(lane);
                    try { if (lane && lane.UpperLane) lanes.push(lane.UpperLane); } catch (e) { /* 忽略 */ }
                    try { if (lane && lane.LowerLane) lanes.push(lane.LowerLane); } catch (e) { /* 忽略 */ }
                    for (const ln of lanes) {
                        const pool = (ln && typeof ln.zombiePool === 'function') ? (ln.zombiePool() || []) : [];
                        for (const z of pool) {
                            try {
                                if (!z) continue;
                                const br = z.bodyRecReal || z.bodyRec;
                                if (!br || !mrect.judgeCrossRec(br)) continue;
                                let dup = false;
                                for (let k = 0; k < markHit.length; k++) { if (markHit[k] === z) { dup = true; break; } }
                                if (!dup) markHit.push(z);
                            } catch (e) { /* 单只失败忽略 */ }
                        }
                    }
                }
            } catch (e) { warn('孢子菇亡语：取标记范围出错', e); }

            if (dbgOn(C.debugLog)) {
                log('孢子菇【亡语】伤害=' + dmg + ' 命中僵尸=' + hit.length + ' 障碍物=' + tombs.length
                    + ' 标记范围=' + (C.deathMarkRows || 1) + '行×' + (C.deathMarkCols || 3) + '列/' + markHit.length + '只'
                    + ' 格=' + (cell ? (cell.lIndex + ',' + cell.cIndex) : '?')
                    + ' 位置=' + (wp ? ('(' + Math.round(wp.x) + ',' + Math.round(wp.y) + ')') : '?'));
            }

            // ★ 立刻跑（与引擎爆裂坚果一致：`inLnC.scheduleOnce(fn)`）
            const fire = function () {
                // ---- ⓪ 只标记（3 行 × 3 列）：不眩晕、不伤害 ----
                for (const z of markHit) {
                    try {
                        if (!z) continue;
                        if (z.ImmuneToSporeShroom !== true) z.CarriedSporeShroom = true;
                    } catch (e) { /* 单只失败忽略 */ }
                }
                // ---- ① 先标记 + 眩晕（R3/R4）----
                for (const z of hit) {
                    try {
                        if (!z) continue;
                        // 标记：免疫的不标记（用户口径 Q1 = 甲：照吃伤害、只是不标记）
                        if (z.ImmuneToSporeShroom !== true) z.CarriedSporeShroom = true;
                        if (C.deathStun > 0 && typeof z.setStun === 'function') z.setStun(C.deathStun);
                    } catch (e) { /* 单只失败忽略 */ }
                }
                // ---- ② 再造成伤害（不穿甲 + 普通物理）⇒ 吃到 ×1.5（R2/R7）----
                //   ⚠️ 顺序是硬要求：① 先把上面的 `CarriedSporeShroom` 打上，② 这里再开
                //      "来源 = 毒性家族"的窗口 ⇒ 这一发**自己**吃 ×1.5（实测 50/150/250 ⇒ 75/225/375）。
                //      `×1.5` 本身由 `makeSporePoisonBonusPatch` 的 `Zombie.defaultDealDamage` 钩子做，
                //      这里**不要**自己乘（否则会变成 ×2.25）。
                gpnPoisonCtxEnter('孢子菇亡语');
                try {
                    for (const z of hit) {
                        try {
                            if (!z || typeof z.dealDamage !== 'function') continue;
                            const ZDT = D.ZombieDamageType;
                            const details = (typeof D.ZombieDamageDetails === 'function')
                                ? new D.ZombieDamageDetails(dmg, true, false, false, null, ZDT)
                                : null;
                            if (details) z.dealDamage(details);
                            else z.dealDamage(dmg, 0);            // 兜底：老式两参调用（不穿甲由调用方保证不了，仅应急）
                        } catch (e) { /* 单只失败忽略 */ }
                    }
                    // ---- ②b 障碍物（用户 2026/10/16 追加）----
                    //   · **不施加标记、不眩晕**（障碍物按原版口径）⇒ 也因此不吃 ×1.5
                    //   · 伤害走 `tb.dealDamage(details)`：引擎 `Tomb.dealDamage(t)` 读的是
                    //     `t.damage * this.damageScale(t)`（`damageType` 只影响可融化的冰砖），
                    //     与本 MOD 在 A1 穿透里打墓碑**完全同一套**（main.js 的 `e.dealDamage(dmg)`）。
                    for (const tb of tombs) {
                        try {
                            if (!tb || typeof tb.dealDamage !== 'function') continue;
                            const ZDT2 = D.ZombieDamageType;
                            const det2 = (typeof D.ZombieDamageDetails === 'function')
                                ? new D.ZombieDamageDetails(dmg, true, false, false, null, ZDT2)
                                : null;
                            if (det2) tb.dealDamage(det2);
                            else tb.dealDamage(dmg);
                        } catch (e) { /* 单个障碍物失败忽略 */ }
                    }
                } finally { gpnPoisonCtxExit(); }
                // ---- ③ 特效（R10；纯视觉）----
                try {
                    if (C.fxEnable && gpnSporeFxReady) {
                        // ★ 显式把自己那条车道传进去 —— 特效必须落在**本行的 prjLayer**（= 引擎给该行弹道
                        //   命中特效用的同一个层）。**不再依赖"上一次弹道观察到的父节点"缓存**（那个缓存可能
                        //   还是上一关/旧帧的 ⇒ 曾经偶发一次"层不对、被植物贴图盖住"，见 gpnSporeFxGetParent 注释）
                        const parent = gpnSporeFxGetParent(null, D, lane);
                        if (parent) gpnSporeFxReady(parent, wp, D);
                        else if (dbgOn(C.debugLog)) log('孢子菇亡语特效：暂时拿不到父节点（车道 prjLayer / 缓存都没有），本次跳过');
                    }
                } catch (e) { /* 特效失败不影响伤害 */ }
            };
            try {
                if (cell && typeof cell.scheduleOnce === 'function') cell.scheduleOnce(fire);
                else fire();                                   // 兜底：拿不到格子就同步跑
            } catch (e) {
                warn('孢子菇亡语：scheduleOnce 出错，改为同步执行', e);
                try { fire(); } catch (e2) { /* 忽略 */ }
            }
            return recKilled.original.apply(this, arguments);
        };
        recs.push(recKilled);
    }

    return recs;
}


/* ==========================================================================
 * 暗影夏威夷果（MurkadamiaNut）—— 暗影状态下本体隐身
 *  需求（已与用户确认）：
 *    ① 暗影状态：本体【只做视觉隐身】= 透明度 ×50%，判定完全不碰
 *       ⇒ 僵尸照常来啃，但挨打顺序是【暗影物质 → 盾牌 → 本体】⇒ 果冻在，本体一滴血不掉
 *    ② 暗影物质与盾牌【不隐身】
 *    ③ 暗影物质被打光后的冷却期：才上【真隐身】（路灯花同款），回血后立刻解除
 *    ④ 暗影状态下暗影物质耐久上限 + 本体耐久上限（2500 → 5000）
 *  引擎事实（逐条核对过）：
 *    · 「植物变透明」引擎自己就是用【主渲染器 db 的 color.a】做的（出生淡入 = anmControl.db.color
 *      从 (255,255,255,0) 补间到 a:255）⇒ 我们用同一个机制：单写者、不会闪、不会出现双层贴图 ✓
 *    · 影子：followShade() 每帧 shade.color.a = db.color.a × shadeAlphaScale ⇒ 自动跟着半透明 ✓
 *    · 暗影物质是【另一个渲染器 spikesDB】，但 specialPlantUpdateForce 每帧
 *      spikesDB.color = db.color ⇒ 会被带上 ⇒ 我们每帧再把它顶回不透明 ✓
 *    · 盾牌是【同一个主渲染器】上的 SHIELD* 槽位 ⇒ 整台一起淡 ⇒ 所以【盾牌在的时候不做半透明】
 *      （宁可在盾牌那几秒里让本体保持不透明，也不能让盾牌跟着隐身）
 *    · 路灯花大招的「隐身」= PlanternHidden>0 ⇒ bodyRec 变空（僵尸判定失败）
 *      + 材质 uniform planternHidden=1（路灯花那套外观）⇒ 真隐身期间把那个 uniform 压回 0
 *
 *  ⚠️ 走过的弯路（用户实测发现）：一开始想「逐槽改 alpha」（slot._colorTransform + _updateColor()），
 *     结果和引擎自己的槽位显示更新打架 ⇒ 贴图出现**两层**、**一闪一闪**、**那张更透的还不是满血样子**。
 *     ⇒ 已整套换成渲染器颜色方案。
 * ========================================================================== */

/** 暗影态本体半透明：改【主渲染器】color 的 alpha（引擎自己的机制）。quiet=true 不打日志 */
function gpnMkSetBodyVisual(plant, on, deps, quiet) {
    const C = CFG.murkadamia;
    const cc = deps && deps.cc;
    if (!plant || !plant.db) return false;
    const a = on ? Math.max(0, Math.min(255, Math.round(255 * C.shadowBodyAlpha))) : 255;
    try {
        const cur = plant.db.color;
        if (cur && cur.a === a) { plant.__gpnMkVisual = !!on; return true; }    // 已是目标值 -> 不重复写
        const r = cur ? cur.r : 255, g = cur ? cur.g : 255, b = cur ? cur.b : 255;
        plant.db.color = (cc && typeof cc.Color === 'function')
            ? new cc.Color(r, g, b, a)
            : { r: r, g: g, b: b, a: a };
        plant.__gpnMkVisual = !!on;
        if (!quiet && C.debugLog) log('夏威夷果：本体透明度 → ' + Math.round(a / 255 * 100) + '%');
        return true;
    } catch (e) { warn('夏威夷果：改本体透明度出错', e); return false; }
}

/** 暗影物质（果冻）是独立渲染器，但引擎每帧会把 db.color 抄过去 ⇒ 顶回不透明 */
function gpnMkKeepJellyOpaque(plant, deps) {
    const cc = deps && deps.cc;
    if (!plant || !plant.spikesDB) return;
    try {
        const c = plant.spikesDB.color;
        if (c && c.a !== 255) {
            plant.spikesDB.color = (cc && typeof cc.Color === 'function')
                ? new cc.Color(c.r, c.g, c.b, 255)
                : { r: c.r, g: c.g, b: c.b, a: 255 };
        }
    } catch (e) { warn('夏威夷果：护住暗影物质透明度出错', e); }
}

/**
 * 暗影物质的三个数值（**永久生效，不随暗影状态来回切**；幂等）：
 *   · 耐久上限 = 原版基础值 + jellyBonusHp（2500 + 2500 = 5000）
 *   · 冷却秒数 = jellyCooldown（= 原版 5 秒；这个键保留着，方便以后再调）
 *   · 初始比例 = jellyInitialPct（0.6 → 0.3 ⇒ 出现/冷却结束时是 1500）
 * 基础值只在第一次看到时记一次，避免反复加算；`_objdataOwn` 是**每株独立**的 ⇒ 只影响这一株。
 * （回满速度沿用原版 JellyRecoveryHPS 100/秒 ⇒ 打光到回满 = 5 秒冷却 + 25 秒回复 = 30 秒，和改前一样）
 */
function gpnMkJellyTune(plant) {
    const C = CFG.murkadamia;
    const od = plant && (plant._objdataOwn || plant.objdataOwn);
    if (!od) return;
    if (!(plant.__gpnMkBaseJelly > 0)) {
        plant.__gpnMkBaseJelly = (od.JellyToughness > 0) ? od.JellyToughness : (C.jellyBaseHp > 0 ? C.jellyBaseHp : 2500);
    }
    // ★ 两态：开 = 基础 + 加成（2500+2500=5000）/ 0.3；关 = 原版 2500 / 0.6 / 5
    //   （原版值来自 Objects/PlantProps.json，已逐字段核对）
    const onMk = featOn('murkadamia');
    const wantHp = onMk ? (plant.__gpnMkBaseJelly + (C.jellyBonusHp > 0 ? C.jellyBonusHp : 0)) : plant.__gpnMkBaseJelly;
    if (od.JellyToughness !== wantHp) od.JellyToughness = wantHp;
    const wantCd = onMk ? C.jellyCooldown : 5;
    if (wantCd > 0 && od.JellyCooldown !== wantCd) od.JellyCooldown = wantCd;
    const wantPct = onMk ? C.jellyInitialPct : 0.6;
    if (wantPct > 0 && od.JellyInitialPct !== wantPct) od.JellyInitialPct = wantPct;
}

/** 每帧：真隐身窗口 + 半透明保活 */
function gpnMkTick(plant, deps) {
    const C = CFG.murkadamia;
    gpnMkJellyTune(plant);                                    // 三个数值维持住（自愈）
    // ---- ③ 暗影物质被打光（冷却中）→ 真隐身；回血 → 立刻解除 ----
    const want = !!(C.hideWhenJellyDown && plant.ShadowPowered && !plant.dead && !(plant.jelly_health > 0));
    if (want) {
        plant.setPlanternHidden(1);                           // 续期（引擎内部取 max）
        if (!plant.__gpnMkHidden) {
            plant.__gpnMkHidden = true;
            if (dbgOn(C.debugLog)) log('夏威夷果：暗影物质被打光 → 上真隐身（僵尸看不见）');
        }
    } else if (plant.__gpnMkHidden) {
        // 只清我们自己那 1 秒的续期值；路灯花大招给的 3 秒不碰
        if (!(plant.PlanternHidden > 1)) plant.PlanternHidden = 0;
        plant.__gpnMkHidden = false;
        if (dbgOn(C.debugLog)) log('夏威夷果：暗影物质回血 → 解除隐身');
    }
    // ---- ① 本体半透明（盾牌在的时候不做）----
    const wantFade = !!(plant.ShadowPowered && !plant.dead
        && !(C.shieldKeepsOpaque && plant.shield_health > 0));
    const changed = (wantFade !== !!plant.__gpnMkVisual);
    gpnMkSetBodyVisual(plant, wantFade, deps, !changed);      // 值没变时内部直接返回，很便宜
}

function makeMurkadamiaPatch(MurkadamiaNutPlant, deps) {
    const recs = [];
    const P = MurkadamiaNutPlant && MurkadamiaNutPlant.prototype;
    if (!P) { warn('跳过暗影夏威夷果：拿不到 MurkadamiaNutPlant'); return null; }
    const C = CFG.murkadamia;

    // ---- ① 暗影状态切换：先把暗影物质上限算好，再交给原版 ----
    if (typeof P.onShadowPoweredChanged === 'function') {
        const rec = methodRecord(MurkadamiaNutPlant, 'onShadowPoweredChanged');
        P.onShadowPoweredChanged = function () {
            if (!featOn('murkadamia')) { try { return rec.original.apply(this, arguments); } catch (e) { return undefined; } }   // 【运行期开关】
            try { gpnMkJellyTune(this); } catch (e) { warn('夏威夷果：算暗影物质数值出错', e); }
            let r;
            try { r = rec.original.apply(this, arguments); }
            catch (e) { warn('夏威夷果：原版 onShadowPoweredChanged 出错', e); }
            return r;
        };
        recs.push(rec);
    } else {
        warn('跳过暗影夏威夷果：没有 onShadowPoweredChanged（暗影物质上限会失效）');
    }

    // ---- ② 每帧：真隐身窗口 + 本体半透明 ----
    if (typeof P.specialPlantUpdate === 'function') {
        const rec = methodRecord(MurkadamiaNutPlant, 'specialPlantUpdate');
        P.specialPlantUpdate = function () {
            const r = rec.original.apply(this, arguments);
            if (!featOn('murkadamia')) return r;   // 【运行期开关】关掉 ⇒ 不每帧维持数值/隐身/半透明
            try { gpnMkTick(this, deps); }
            catch (e) { warn('夏威夷果：每帧处理出错', e); }
            return r;
        };
        recs.push(rec);
    } else {
        warn('跳过暗影夏威夷果：没有 specialPlantUpdate（真隐身窗口会失效）');
    }

    // ---- ③ 暗影物质：引擎每帧把 db.color 抄过去 ⇒ 跟着顶回不透明 ----
    if (typeof P.specialPlantUpdateForce === 'function') {
        const rec = methodRecord(MurkadamiaNutPlant, 'specialPlantUpdateForce');
        P.specialPlantUpdateForce = function () {
            const r = rec.original.apply(this, arguments);
            if (!featOn('murkadamia')) return r;   // 【运行期开关】
            try { gpnMkKeepJellyOpaque(this, deps); }
            catch (e) { warn('夏威夷果：护住暗影物质透明度出错', e); }
            return r;
        };
        recs.push(rec);
    } else {
        warn('跳过暗影夏威夷果：没有 specialPlantUpdateForce（暗影物质会被一起变透明）');
    }

    // ---- ④ 真隐身期间：把路灯花那套外观的 uniform 压回 0（只这一株）----
    if (typeof P.shouldMaterial === 'function') {
        const rec = methodRecord(MurkadamiaNutPlant, 'shouldMaterial');
        P.shouldMaterial = function () {
            const r = rec.original.apply(this, arguments);
            if (!featOn('murkadamia')) return r;   // 【运行期开关】
            try {
                if (this.__gpnMkHidden && this.material && this.material.passes) {
                    const pass = this.material.passes[0];
                    if (pass && typeof pass.getHandle === 'function' && typeof pass.setUniform === 'function') {
                        const h = pass.getHandle('planternHidden');
                        if (h !== undefined && h !== null) pass.setUniform(h, 0);
                    }
                }
            } catch (e) { warn('夏威夷果：压材质 uniform 出错', e); }
            return r;
        };
        recs.push(rec);
    } else {
        warn('跳过暗影夏威夷果：拿不到 shouldMaterial（真隐身那会儿外观会变成路灯花那套）');
    }

    // ---- ⑤ 池化复用：状态全部复位（否则会带到下一株身上）----
    if (typeof P.specialPlantOnEnable === 'function') {
        const rec = methodRecord(MurkadamiaNutPlant, 'specialPlantOnEnable');
        P.specialPlantOnEnable = function () {
            try {
                this.__gpnMkHidden = false;
                this.__gpnMkVisual = false;
                this.__gpnMkFrame = 0;
                this.PlanternHidden = 0;
            } catch (e) { warn('夏威夷果：复位出错', e); }
            let r;
            try { r = rec.original.apply(this, arguments); }
            catch (e) { warn('夏威夷果：原版 specialPlantOnEnable 出错', e); }
            try {
                gpnMkSetBodyVisual(this, false, deps, true);       // 本体回不透明
                gpnMkKeepJellyOpaque(this, deps);                  // 暗影物质回不透明
            } catch (e) { warn('夏威夷果：复位视觉出错', e); }
            return r;
        };
        recs.push(rec);
    }

    return recs;
}

/* ==========================================================================
 * 裂荚射手（SplitPea）—— 左键左右翻转 + 前后豌豆数对调
 *  需求（已与用户确认）：
 *    ① 鼠标左键点它 → 左右翻转（状态一直保留，移动位置也不变；新种一株默认不翻）
 *    ② 翻转后：前方 1 颗 / 后方 2 颗  ⇄  前方 2 颗 / 后方 1 颗
 *    ③ 大招的前后数量也跟着对调（原版 60 前 + 90 后 → 翻转后 90 前 + 60 后）
 *    ④ 贴图（含装扮 COS* 槽位）、动画、影子一起左右翻转
 *    ⑤ 阳光 200 → 225（数据 patch）；图鉴「射速」那行补一句
 *  引擎事实（逐条核对过）：
 *    · 每次 _shoot() 只发【1 颗】；前方 = 动画事件 ShootR → _shoot()；
 *      后方 = 动画事件 ShootL → _shootBack()（= _shoot() 后把速度 x 取反、位置 -50）
 *    · 所以「后方两颗」不是代码循环，而是 ShootL 动画里连发两个 ShootL 帧事件
 *      （ShootB 同理；播哪支由 detectEnemySplit() 决定：1=只有前 / 2=只有后 / 3=两边都有）
 *      ⇒ 要真对调，必须【同时】改"播哪支动画"和"往哪个方向发"（只改方向会变成 1 颗）
 *    · 大招：两个计数器（PlantfoodPeaCount 60 前 / PlantfoodPeaCountBack 90 后）补间到 0，
 *      前计数器 → onFoodLeftPeaCountDec → _shoot()，后计数器 → _shootBack()
 *      ⇒ 方向一对调，数量自然变成 90 前 / 60 后 ✓（不用单独给大招写逻辑）
 *    · 翻转用引擎自带的 Character.scale：setter 里 node.scale.x = _scale×U×originalScale（x【带符号】）
 *      ⇒ this.scale = -1 就是水平镜像；装扮是同一个 armature 里的 COS* 槽位、动画也在里面 ⇒ 一起翻；
 *        影子在 followShade 里按 this.scale 算 ⇒ 自动跟着翻 ✓
 * ========================================================================== */

/* ==========================================================================
 * 翻转适配（**1.5.5 口径**，2026/10/10 据实机 bundle 逐字核对）
 *
 * 引擎事实（1.5.5 的 SplitPea，已从 `game-main-bundle.js` 抠出原文）：
 *   · `_shoot(o, n, e, i, a, s)`：弹种 e / 速度 i / **方向向量 a** / **发射口节点 s** 都是【参数】
 *     （默认 a = new Vec2(1,0)、s = this.peaSpawnpoint），最终速度 = `a.normalize().multiplyScalar(i)`
 *   · `_shootBack(o,e,a)` = `this._shoot(o, e, a, 8, new d(-1,0), this.peaBackPoint)` ⇒ 后方只是"翻参数"
 *   · `detectEnemySplit()` 返回 **`{Left, Right}` 对象**（不再是 0/1/2/3 数字），
 *     `specialPlantUpdate` 里读 `a.Left || a.Right`，并**动态拼动画名** `"Shoot" + "R"/"L"`
 *   ⇒ 所以本模组的翻转**只要两件事**：
 *     ① 索敌【交给引擎】（它同时给 Left/Right，本来就是对的）
 *     ② 发射时把**方向向量取反**；发射口**不动**（peaSpawnpoint / peaBackPoint 是植物根节点的子节点，
 *        会随 `scale = -1` 一起镜像，世界坐标自动落到翻过来的那一侧）
 * ========================================================================== */

/** 翻转时把方向参数取反（不改发射口）
 *  ⚠️ 关键：`_shoot()` 经常**不带参数**调用（动画帧事件就是 `this._shoot()`），
 *     引擎内部对方向的默认值是 `new Vec2(1, 0)`（朝前）。
 *     ⇒ 传进来的 `a` 是 `undefined/0/null` 时，我们要**补一个朝后**的方向，
 *       而且**必须用引擎自己的 Vec2**（副本类型不匹配可能被下游拒绝）—— 由 `cx` 传进来。
 */
function gpnSpFlipVec(vec, cx) {
    const New = (x) => {
        try { if (cx && typeof cx === 'function') return new cx(x, 0); } catch (e) { /* 忽略 */ }
        return null;
    };
    const make = (x) => {
        try { if (vec && typeof vec.clone === 'function') { const c = vec.clone(); c.x = x; return c; } } catch (e) { /* 忽略 */ }
        return New(x);
    };
    let out = make(-(vec && typeof vec.x === 'number' ? vec.x : 1));
    if (!out) out = { x: -1, y: 0 };          // 极端兜底（引擎的 normalize() 可能不吃普通对象，但不至于崩）
    if (typeof out.y !== 'number') { try { out.y = 0; } catch (e) { /* 忽略 */ } }
    return out;
}


/** 【诊断用】取渲染层实际值（只在 debugLog 打开时调用）
 *  为什么要它：`Character.scale` 是**逻辑值**（我们的翻转写的就是它），而"贴图朝哪边"最终
 *  由 `node.scale` 决定 —— 引擎完全可以只改 `node.scale` 而不经过 setter（那样逻辑值仍是 -1，
 *  但画面已经不翻了）。所以排查"翻转丢失"必须看渲染节点本身。
 */
function gpnSpDiag(plant) {
    const g = (fn, d) => { try { const v = fn(); return (v === undefined || v === null) ? d : v; } catch (e) { return d; } };
    const num = (v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
    const node = plant && plant.node;
    const body = plant && plant.body;
    const par = g(() => (body && body.parent && body.parent.name) || null, null);
    const nodeName = g(() => (node && node.name) || null, null);
    return 'scale=' + num(g(() => plant.scale, '?'))
        + '，node.scale.x=' + num(g(() => node.scale.x, '?'))
        + '，body.scale.x=' + num(g(() => body.scale.x, '?'))
        + '，body.parent=' + (par === null ? '?' : par) + (par === nodeName ? '(=node)' : '')
        + '，body.世界x=' + num(g(() => body.worldPosition.x, '?'))
        + '，本株x=' + num(g(() => plant.worldPositionX, '?'))
        + '，枪口2.世界x=' + num(g(() => (plant.peaSpawnpoint2 && plant.peaSpawnpoint2.worldPosition.x), '无'))
        + '，前口.世界x=' + num(g(() => (plant.peaSpawnpoint && plant.peaSpawnpoint.worldPosition.x), '无'))
        + '，gatlingSlots=' + g(() => (plant.gatlingSlots ? plant.gatlingSlots.length : '无'), '无');
}

function makeSplitPeaPatch(SplitPeaPlant, deps) {
    const recs = [];
    const P = SplitPeaPlant && SplitPeaPlant.prototype;
    if (!P) { warn('跳过裂荚射手：拿不到 SplitPeaPlant'); return null; }
    const C = CFG.splitpea;
    const baseShoot = P._shoot;                 // 继承自 PeashooterPlant；先抓住原版再包
    if (typeof baseShoot !== 'function') { warn('跳过裂荚射手：拿不到 _shoot（对调会失效）'); return null; }
    // 引擎的 Vec2（用来造"取反后的方向"；deps.cc.Vec2 就是引擎那个）
    const Vec2Ctor = (deps && deps.cc && typeof deps.cc.Vec2 === 'function') ? deps.cc.Vec2 : null;
    if (!Vec2Ctor) warn('裂荚射手：拿不到 cc.Vec2（翻转后的方向向量会退化为普通对象）');

    /** 翻转 = 引擎自己的 scale 符号（x 带符号 ⇒ 整株镜像；装扮 / 动画 / 影子都跟着走） */
    const applyFlip = (plant, on) => {
        const before = (typeof plant.scale === 'number') ? plant.scale : '?';
        plant.__gpnSpFlip = !!on;
        try { plant.scale = on ? -1 : 1; }
        catch (e) { warn('裂荚射手：翻转出错', e); }
        if (dbgOn(C.debugLog)) {
            try {
                log('裂荚【翻转】→ ' + (on ? '翻' : '回正') + '：scale ' + before + ' → ' + plant.scale
                    + '，是否 MGP=' + !!plant.isMGP + ' ｜ ' + gpnSpDiag(plant));
            } catch (e) { /* 只影响日志 */ }
        }
    };

    // ---- ① 左键：左右翻转（引擎只在"手上没拿卡"时才调 onMouseDown ⇒ 不抢种植左键）----
    const baseOnMouseDown = P.onMouseDown;      // 可能继承自 Plant 基类
    P.onMouseDown = function (ev) {
        let r;
        try { if (typeof baseOnMouseDown === 'function') r = baseOnMouseDown.apply(this, arguments); }
        catch (e) { warn('裂荚射手：原版 onMouseDown 出错', e); }
        try {
            if (!C.clickFlip) return r;
            if (!featOn('splitpea')) return r;                  // 【运行期开关】关掉 ⇒ 完全不插手（原版行为）
            if (!ev || typeof ev.getButton !== 'function') return r;
            if (ev.getButton() !== 0) return r;                 // 只认左键
            // ★ 一次点击只认一次（引擎在 mouseUp 还会补发一次 onMouseDown ⇒ 否则左右连翻两下）
            if (!gpnClickOnce(this, '__gpnSpClickAt')) return r;
            const next = !this.__gpnSpFlip;
            applyFlip(this, next);
            if (dbgOn(C.debugLog)) {
                log('裂荚射手：' + (next ? '已翻转（前方 2 颗 / 后方 1 颗）' : '已翻回（前方 1 颗 / 后方 2 颗）'));
            }
            return true;                                        // 告诉引擎"这次点击我处理了"
        } catch (e) { warn('裂荚射手：左键翻转出错', e); }
        return r;
    };
    recs.push({ Cls: SplitPeaPlant, name: 'onMouseDown', original: baseOnMouseDown });

    // ---- ② 翻转时把【方向参数】取反（1.5.5 口径：方向 = `_shoot` 的第 5 个参数）----
    //   说明：_shootBack 现在只是 `this._shoot(o,e,a,8,vec(-1,0),this.peaBackPoint)` 的薄封装，
    //   所以【只包 _shoot 一处】即可覆盖前/后两个口（包 _shootBack 会双重调用）。
    //   发射口参数【不动】：peaSpawnpoint / peaBackPoint 是植物根节点子节点，随 scale=-1 一起镜像。
    const recShoot = methodRecord(SplitPeaPlant, '_shoot');
    P._shoot = function (o, n, e, i, a, sp) {
        if (featOn('splitpea') && this.__gpnSpFlip) {   // 【运行期开关】关掉 ⇒ 直接走原版
            const hadDir = !!(a && typeof a.x === 'number');
            const flipped = gpnSpFlipVec(a, Vec2Ctor);       // 参数缺省时也补成"朝后"
            if (dbgOn(C.debugLog)) {
                try {
                    log('裂荚：翻转发射 → 方向 ' + (hadDir ? a.x : '缺省(1)') + ' → '
                        + (flipped && typeof flipped.x === 'number' ? flipped.x : '?')
                        + (hadDir ? '' : '（补方向）') + '，速度=' + i);
                } catch (e2) { /* 只影响日志 */ }
            }
            return recShoot.original.call(this, o, n, e, i, flipped, sp);
        }
        return recShoot.original.apply(this, arguments);
    };
    recs.push(recShoot);

    // ---- ③ 索敌结果也要跟着翻转（**1.5.5：把 {Left,Right} 交换**）----
    //   引擎事实（1.5.5，逐字）：`detectEnemySplit()` 返回的 Left/Right 是【屏幕左右】，
    //   调用处 `specialPlantUpdate` 用它决定播哪支动画：
    //       a.Right ⇒ r = "Shoot"+"R"（原版"前"，1 帧事件 = 1 颗）
    //       a.Left  ⇒ r = "Shoot"+"L"（原版"后"，2 帧事件 = 2 颗）
    //   ⇒ 贴图一翻，屏幕左右与"植物的前后"就对调了。若只翻发射方向（② 那段）而不翻这里，
    //     就会"往对的方向发射，但用的还是原来那支动画/那套前后数量" ⇒ 表现为【索敌没翻】。
    //   ⇒ 因此翻转时把 {Left, Right} 交换；**必须返回对象**（返回数字会让 a.Left/a.Right 变 undefined ⇒ 永不开火）。
    const baseDetect = P.detectEnemySplit;      // 引擎原版；可能不存在（别的植物类型）
    if (typeof baseDetect === 'function') {
        P.detectEnemySplit = function () {
            const r = baseDetect.apply(this, arguments);
            if (!featOn('splitpea')) return r;                  // 【运行期开关】关掉 ⇒ 原样返回
            if (!this.__gpnSpFlip) return r;
            if (!r || typeof r !== 'object') return r;          // 形状不对就原样返回，绝不破坏引擎判读
            const out = { Left: !!r.Right, Right: !!r.Left };    // 屏幕左右 ⇄ 植物前后
            if (dbgOn(C.debugLog)) {
                try {
                    log('裂荚：索敌翻转 → 引擎{Left=' + !!r.Left + ',Right=' + !!r.Right + '} ⇒ 用于动画'
                        + '{Left=' + out.Left + ',Right=' + out.Right + '}');
                } catch (e) { /* 只影响日志 */ }
            }
            return out;
        };
        recs.push({ Cls: SplitPeaPlant, name: 'detectEnemySplit', original: baseDetect });
    } else {
        warn('裂荚射手：引擎没有 detectEnemySplit（翻转后动画前后不会对调）');
    }

    // ---- ④ 移动位置后保持翻转（搬株只换格子，不重初始化）----
    if (typeof P.specialPlantOnSquareChange === 'function') {
        const rec = methodRecord(SplitPeaPlant, 'specialPlantOnSquareChange');
        P.specialPlantOnSquareChange = function (t, o) {
            const r = rec.original.apply(this, arguments);
            try { if (featOn('splitpea') && this.__gpnSpFlip) this.scale = -1; }   // 【运行期开关】
            catch (e) { warn('裂荚射手：移动后保持翻转出错', e); }
            return r;
        };
        recs.push(rec);
    }

    // ---- ⑤ 池化复用：新种一株默认不翻转 ----
    //   ⚠️ 待查（0.15.0 融合植物 splitpea_mgp 的开大丢翻转）：引擎每次 OnEnable 都会调
    //   `specialPlantOnEnable`，而 `Character.onEnable` 会把 node.scale 重置 ⇒ 这个"复位"钩子
    //   有可能在**植物存活期间**被触发，从而把我们的翻转清掉。下面加了诊断日志，先用实机日志确认
    //   （日志只在 CFG.splitpea.debugLog 打开时打，不改任何行为）。
    if (typeof P.specialPlantOnEnable === 'function') {
        const rec = methodRecord(SplitPeaPlant, 'specialPlantOnEnable');
        P.specialPlantOnEnable = function () {
            const wasFlip = !!this.__gpnSpFlip;
            const scaleBefore = (typeof this.scale === 'number') ? this.scale : '?';
            try {
                // 这里始终复位（新种的默认不翻转）；"关掉开关后场上已翻转的株"由
                // characterUpdate / characterLateUpdate 的运行期判断负责摆正（见下）。
                this.__gpnSpFlip = false; this.scale = 1;
            }
            catch (e) { warn('裂荚射手：复位出错', e); }
            if (dbgOn(C.debugLog)) {
                try {
                    log('裂荚【OnEnable 复位】← 引擎调用了 specialPlantOnEnable：'
                        + '原 flip=' + wasFlip + '，scale ' + scaleBefore + ' → ' + this.scale
                        + '，是否 MGP=' + !!this.isMGP + ' ｜ ' + gpnSpDiag(this));
                } catch (e) { /* 只影响日志 */ }
            }
            return rec.original.apply(this, arguments);
        };
        recs.push(rec);
    }

    // ---- ⑥ 诊断（只打日志、不改行为）：开大流程的进出场与缩放 ----
    //   目的：定位"普攻概率开大"后翻转丢在哪一步（引擎的 Plant.food() 会重置 body 缩放，
    //   MGP 的 specialPlantFood 还会 upgrade()/gunup()）。①/②/⑤ 三处日志连起来看顺序即可定论。
    if (typeof P.specialPlantFood === 'function') {
        const recFood = methodRecord(SplitPeaPlant, 'specialPlantFood');
        P.specialPlantFood = function () {
            if (dbgOn(C.debugLog)) {
                try {
                    log('裂荚【开大开始】specialPlantFood：flip=' + !!this.__gpnSpFlip
                        + '，scale=' + this.scale + '，是否 MGP=' + !!this.isMGP
                        + '，upgraded=' + !!this.upgraded + '，gunned=' + !!this.gunned
                        + ' ｜ ' + gpnSpDiag(this));
                } catch (e) { /* 只影响日志 */ }
            }
            return recFood.original.apply(this, arguments);
        };
        recs.push(recFood);
    }
    if (typeof P.specialPlantFoodEnd === 'function') {
        const recFoodEnd = methodRecord(SplitPeaPlant, 'specialPlantFoodEnd');
        P.specialPlantFoodEnd = function () {
            const r = recFoodEnd.original.apply(this, arguments);
            // ★ 修复（2026/10/10 实机 + 日志定位，属"纯视觉层"）：
            //   MGP 开大（`Plant.food()`）会把 `body`（真正画贴图/装扮的骨架子节点）从植物节点上
            //   摘走挂到开大专用层、并在结束时写回 `body.scale = (1,1,1)`；`node.scale` 虽仍是负值，
            //   但骨架的镜像观感被这次"摘走→挂回+改缩放"打乱，表现为【贴图回到未翻转】。
            //   `Character.scale` 的 setter 本身就是"写 node.scale"，所以在这里把翻转【重新写一次】，
            //   强制引擎重算镜像即可（子弹方向/前后数量在 A 型里本来就是对的，不动）。
            if (this.__gpnSpFlip) {
                try { this.scale = -1; } catch (e) { warn('裂荚射手：开大结束重写翻转出错', e); }
            }
            if (dbgOn(C.debugLog)) {
                try {
                    log('裂荚【开大结束】specialPlantFoodEnd：flip=' + !!this.__gpnSpFlip
                        + '，scale=' + this.scale + '，是否 MGP=' + !!this.isMGP
                        + (this.__gpnSpFlip ? '（已重写翻转）' : '') + ' ｜ ' + gpnSpDiag(this));
                } catch (e) { /* 只影响日志 */ }
            }
            return r;
        };
        recs.push(recFoodEnd);
    }

    // ---- ⑦b 【body 缩放自洽纠正】可被"帧内"与"帧末"两处调用 ----
    //   为什么需要两处：`node.scale = x` 这类**直接赋值不会通知引擎重算世界变换**（脏标记/传播时机问题），
    //   所以"值对了、画面没变"是可能发生的。这里统一做三件事：
    //     ① 用 `setScale()`（走 setter、会标脏）而不是直改分量；
    //     ② 主动 `invalidateChildren(...)` 失效子树（把可用的失效入口都试一遍）；
    //     ③ 由 `characterUpdate`（帧内）与 `characterLateUpdate`（帧末）各调一次，
    //        保证"最后一次写"发生在引擎渲染取变换之前。
    const gpnSpFixBodyScale = (plant) => {
        if (!plant || !plant.__gpnSpFlip) return 0;
        const bd = plant.body;
        const bsc = bd && bd.scale;
        if (!bsc || typeof bsc.x !== 'number' || bsc.x === 0) return 0;
        const par = bd.parent || plant.node;
        const parWS = (par && par.worldScale && typeof par.worldScale.x === 'number')
            ? par.worldScale.x
            : ((plant.node && plant.node.worldScale && typeof plant.node.worldScale.x === 'number')
                ? plant.node.worldScale.x : -1);
        // 目标世界符号 = -1（翻转）⇒ 本地期望符号 = sign(父世界) × (-1)
        const wanted = (parWS < 0) ? 1 : -1;
        if (Math.sign(bsc.x) === wanted) return 0;
        const abs = Math.abs(bsc.x);
        const y = (typeof bsc.y === 'number') ? bsc.y : abs;
        const z = (typeof bsc.z === 'number') ? bsc.z : 1;
        try {
            if (typeof bd.setScale === 'function') bd.setScale(abs * wanted, y, z);   // ① setter：会标脏
            else { bsc.x = abs * wanted; }
        } catch (e) { try { bsc.x = abs * wanted; } catch (e2) { return 0; } }
        // ② 主动失效子树（不同版本 API 名不同，挨个试，全部失败就交给 ③ 的帧末写入）
        try {
            if (typeof bd.invalidateChildren === 'function') bd.invalidateChildren(deps && deps.TransformBit ? deps.TransformBit.SCALE : 3);
            else if (typeof bd.markForUpdate === 'function') bd.markForUpdate(deps && deps.TransformBit ? deps.TransformBit.SCALE : 3);
        } catch (e) { /* 只影响诊断 */ }
        // ③ 顺带把父节点的变换也刷一次（保证子节点会跟着重算）
        try { if (par && typeof par.invalidateChildren === 'function') par.invalidateChildren(); } catch (e) { /* 忽略 */ }
        gpnSpBodyFixTotal++;
        gpnSpBodyFixSpots++;
        if (!gpnSpBodyFixFirstStack) {
            try { gpnSpBodyFixFirstStack = String((new Error()).stack || '').split('\n').slice(1, 7).join(' | '); }
            catch (e) { gpnSpBodyFixFirstStack = '(拿不到调用栈)'; }
        }
        return 1;
    };


    //   为什么需要（2026/10/10 实机日志定位，属于帧时序竞态）：
    //     · 引擎 `Character.onEnable` 里有一句 `this.node.scale = new Vec3(d,d,d)`（把渲染缩放复位）；
    //     · 我们的翻转走 `Character.scale` setter（写 `node.scale = _scale × U × originalScale`）；
    //     · 一旦引擎在"我们翻完之后"把 `node.scale` 复位，`_scale` 仍是 -1（逻辑没丢）、
    //       但【画面已经不翻了】；只有下次 setter 被调用才会重新写负值。
    //     · 实测证据：开大流程里 `body.parent` 会被摘走再挂回（`New Node` ⇄ 植物节点），
    //       `body.scale.x` 在结束时被写成 1 ⇒ 这就是竞态发生的窗口。
    //     · 之所以"verboseLog 开=正常、关=复现"：日志开销改变了帧内时序（巧合掩盖了竞态）。
    //   ⇒ 每帧检查一次，便宜（两次属性读）且能"自愈"。只在裂荚类这一层钩，不影响其它植物。
    // ---- ⑦ 【自愈】每帧校正翻转：标记是"翻"的、但渲染节点已回正 ⇒ 立刻写回 -1 ----
    const baseCharUpdate = P.characterUpdate;          // 继承自 Plant；可能不存在
    /** 【运行期开关】关掉 splitpea 时，把"场上已经翻转的株"当场摆正。
     *  只做一次（靠 __gpnSpFlip 标记判断）：复位渲染缩放 + 清掉翻转标记 ⇒ 下一帧不再插手。 */
    const gpnSpUnflip = (plant) => {
        try {
            if (!plant || !plant.__gpnSpFlip) return;
            plant.__gpnSpFlip = false;
            try { plant.scale = 1; } catch (e) { /* 忽略 */ }
        } catch (e) { /* 忽略 */ }
    };
    P.characterUpdate = function (dt) {
        let r;
        if (typeof baseCharUpdate === 'function') r = baseCharUpdate.apply(this, arguments);
        // 【运行期开关】关掉 ⇒ 不插手（只负责把"已翻转的"摆正一次），完全回到原版行为
        if (!featOn('splitpea')) { gpnSpUnflip(this); return r; }
        try {
            if (this.__gpnSpFlip) {
                const cur = this.node && this.node.scale && this.node.scale.x;
                if (typeof cur === 'number' && cur > 0) {
                    // ★ 零开销路径：只计数 + 首帧抓一次调用栈；【不打任何日志】
                    //   （这样一来时序与 verboseLog:false 时完全一致，能复现、又能拿到证据）
                    this.scale = -1;                    // 重新写渲染缩放（自愈）
                    gpnSpSelfHealTotal++;               // 累计（永不归零；自检/诊断用）
                    gpnSpSelfHealSpots++;               // 本次汇总窗口内计数（每 5 秒清零）
                    if (!gpnSpSelfHealFirstStack) {
                        try { gpnSpSelfHealFirstStack = String((new Error()).stack || '').split('\n').slice(1, 7).join(' | '); }
                        catch (e) { gpnSpSelfHealFirstStack = '(拿不到调用栈)'; }
                    }
                    // 汇总：静默攒着，最多每 5 秒打一行（先清再用 ⇒ 只有真的有新增才打一条）
                    if (dt !== -1 && !gpnSpSelfHealQuiet && dbgOn(C.debugLog)) {
                        const now = Date.now();
                        if (now - gpnSpSelfHealLastReport > 5000) {
                            gpnSpSelfHealLastReport = now;
                            const n = gpnSpSelfHealSpots; gpnSpSelfHealSpots = 0;
                            gpnSpSelfHealQuiet = true;
                            log('裂荚【自愈汇总】最近一次统计内自愈 ' + n + ' 次；首次复位的调用栈：' + gpnSpSelfHealFirstStack);
                            setTimeout(() => { gpnSpSelfHealQuiet = false; }, 50);
                        }
                    }
                }
                // ★★ MGP 开大丢翻转的【正确修复】（2026/10/10 由"环形时间线 + 用户肉眼判定 B"定死）
                //   事实链：
                //     · 贴图与发射口的镜像，最终由 **body 的本地缩放符号**决定（骨架自己用的就是它）；
                //     · 开大（`Plant.food()`）会把 body 摘到"开大层"（外层缩放 +1），为了保持世界观感，
                //       引擎把 body 的本地缩放算成 `-0.42`（= 世界 -0.42 ÷ 父 +1）；这时的本地负号是**正确**的；
                //     · 但 body 挂回 node（世界 -0.42）之后，本地缩放**没有重新计算**，仍是 `-0.42`
                //       ⇒ 世界 = (-0.42) × (-0.42) = 正 ⇒ **贴图与发射口双双回到未翻转态**；
                //     · （`body.worldScale` 恒正 —— Cocos 官方论坛已确认"负值会被自动纠正成正数" ⇒ 那条通路是死的。）
                //     · 更深一层：**直接给 `scale.x` 赋值不会通知引擎重算世界变换**（脏标记/传播时机），
                //       所以"值算对了、画面却不更新"完全可能发生 —— 这也是 `verboseLog:true` 时反而正常的原因
                //       （日志开销把帧拉长，引擎的变换传播恰好落在我们写入之后）。
                //   ⇒ 修法：维持自洽式符号，并**主动通知引擎**（setScale + invalidateChildren），
                //     且在 **characterUpdate（帧内）与 characterLateUpdate（帧末）各写一次**。
                gpnSpFixBodyScale(this);
                if (dt !== -1 && dbgOn(C.debugLog) && (Date.now() - gpnSpBodyFixLastReport > 5000)) {
                    gpnSpBodyFixLastReport = Date.now();
                    const n2 = gpnSpBodyFixSpots; gpnSpBodyFixSpots = 0;
                    log('裂荚【body 缩放纠正】最近一次统计内修正 ' + n2 + ' 次'
                        + '；累计 ' + gpnSpBodyFixTotal + ' 次；首次调用栈：' + gpnSpBodyFixFirstStack);
                }
            }
        } catch (e) { warn('裂荚射手：每帧自愈出错', e); }
        return r;
    };
    recs.push({ Cls: SplitPeaPlant, name: 'characterUpdate', original: baseCharUpdate });
    // 帧末兜底：`Character.lateUpdate` → `characterLateUpdate`。这次写入发生在引擎渲染取变换之前，
    //   保证"最后一次写"是我们写的（哪怕引擎在帧内又把它改回去了）。
    const baseCharLate = P.characterLateUpdate;
    P.characterLateUpdate = function (dt) {
        let r;
        if (typeof baseCharLate === 'function') r = baseCharLate.apply(this, arguments);
        // 【运行期开关】关掉 ⇒ 帧末也不插手（同样只把"已翻转的"摆正一次）
        if (!featOn('splitpea')) { gpnSpUnflip(this); return r; }
        try { gpnSpFixBodyScale(this); }
        catch (e) { warn('裂荚射手：帧末自愈出错', e); }
        return r;
    };
    recs.push({ Cls: SplitPeaPlant, name: 'characterLateUpdate', original: baseCharLate });
    // 自检探针（仅供 mock 单测调用；dt 传 -1 ⇒ 不刷日志。游戏里不会被调用）
    P.__gpnSpSelfHealTick = function () { return P.characterUpdate.call(this, -1); };
    P.__gpnSpSelfHealLateTick = function () { return P.characterLateUpdate.call(this, -1); };

    return recs;
}

export default {
    // 给自检脚本用（GP-Next 会忽略多余字段）
    _config: CFG,
    _vanilla: VANILLA,                 // 同上：原版值表（"关掉开关时写回什么"的唯一出处）
    _features: FEATURES,               // 同上：自检用来核对开关表
    _featSet: featSet,                 // ★ 配置界面写入开关的入口（自检用来验证"即时生效"）
    _featOn: featOn,                   // 运行期判定
    _featDefaults: gpnFeatDefaults,     // 同上：出厂默认
    _featSnapshot: gpnFeatSnapshot,     // 同上：当前开关快照
    _featReset: gpnFeatStorageReset,    // 同上：恢复默认
    _gateStats: gpnGateStats,           // 同上：门禁包装计数（自检用）
    // ⚠ 必须用**函数**形式：`gpnApplyDataPatch` 要到 setup 里（L6140 附近）才被赋值，
    //    这里直接写变量名会把此刻的 `null` 快照走 ⇒ 导出的永远是 null（自检拿不到，白测）。
    _applyDataPatch: () => gpnApplyDataPatch,   // 同上：数据补丁（自检用来验证两态）
    _gatedBody: gpnGatedBody,            // 同上：门禁包装器本体（自检用）
    _followMergeOn: gpnFollowMergeOn,   // 同上：合并开关的依赖判定（纯查询，便于单测）
    _pierceN: gpnPierceN,              // 同上：穿透数钳制（小数/负数 → 1）
    _followPierce: gpnFollowPierce,    // 同上：追击弹的打中数（= 星果打中数 + bonus）
    _almOverview: gpnAlmOverview,      // 同上：图鉴文案总览（只读；自检核对 alias 配对）
    _almTextOf: gpnAlmTextOf,          // 同上：取一株的图鉴文本（只读）
    _ALM_CHANGED: GPN_ALM_CHANGED,     // 同上：[图鉴 alias, 功能开关名] 名单（自检守卫用）
    _zhNum: gpnZhNum,                  // 同上：中文数字（0~20 汉字，超出回落阿拉伯）
    // 场外范围兜底（修 2026/10/14 三个 BUG）—— 工具/纯函数，自检直接单测
    _isOffField: gpnIsOffField,                 // 判定：这个弹道/僵尸是否在场外（lIndex<0 或 inLnC.cIndex==9）
    _isOffFieldRight: gpnIsOffFieldRight,       // 判定：这个格是不是「场外右侧」那个共享假格
    _laneByY: gpnLaneByY,                       // 按 Y 坐标求草坪行号（0..4）
    _rightmostCells3x1: gpnRightmostCells3x1,   // 最右列的 3×1 格子（行超出草坪的不铺）
    _offFieldAreaApply: gpnOffFieldAreaApply,   // 场外范围兜底（行池 + 判定框 + 直接施加）
    _pepperBurnAt: (shot, d) => gpnPepperBurnAt(shot, d),   // 甜椒落点铺火（自检核对"场外 ⇒ 最右列 3×1"）
    _pepperDeps: () => gpnPepperDeps,           // 上面那个函数需要的引擎依赖（setup 时填好）
    // 流星花索敌（P0~）—— 工厂本体 + 纯函数，自检直接单测
    _meteorAimPatch: makeMeteorFlowerAimPatch,  // 流星花：索敌补丁工厂
    // 孢子菇（亡语 + 数值 + 图鉴）
    _sporePatch: makeSporeShroomPatch,          // 孢子菇：补丁工厂
    _sporeZombieGate: makeSporeShroomZombieGate,// 孢子菇：僵尸侧门禁工厂
    _sporeCommonShotHook: makeSporeShroomCommonShotHook, // 孢子菇：特效父节点观测钩子
    _sporeDeathDamage: gpnSporeDeathDamage,     // ★ 亡语伤害取值（按 CabbageType 查弹道 Damage）
    _sporeFxDrop: gpnSporeFxDrop,               // 特效缓存清理（自检核对"换场景要丢缓存"）
    _sporeFxGetParent: gpnSporeFxGetParent,     // ★ 特效父节点（自检核对"优先本行 prjLayer、key 为空不认缓存"）
    _sporeFxSetParent: gpnSporeFxSetParent,     // 埋缓存（自检用）
    _sporeFxChain: gpnSporeFxChain,             // 节点层链（诊断；自检保证不抛错）
    // ---- 蒲公英大招「驱离运兵艇」（§3.74）----
    _isDropShip: gpnIsDropShip,                 // 运兵艇判定（Zombie_Type 主判据 / instanceof 次判据）
    _dandelionDrive: gpnDandelionDriveDropShips,// 全屏扫池 + 逐只驱离（返回成功次数）
    _sporeFindProp: gpnSporeFindProp,           // prefab 属性挖掘（照抄本 MOD 的 findPropInNode）
    _sporeCfg: () => CFG.sporeshroom,
    _cabbageCfg: () => CFG.cabbagepult,
    _cabbagePultPatch: makeCabbagePultPatch,           // 孢子菇配置（自检核对数值）
    // 孢子菇 ×1.5（R6/R7：毒性家族伤害加成）—— 工厂 + 纯函数/工具，自检直接单测
    _sporePoisonPatch: makeSporePoisonBonusPatch,   // ×1.5 补丁工厂
    _sporeMult: gpnSporeMult,                       // 倍率（从 CFG 现算）
    _sporeIsPoisonFam: gpnSporeIsPoisonFam,         // 别名 + Family ⇒ 算不算（纯函数）
    _sporeFamilyOf: gpnSporeFamilyOf,               // Plant_Type → PlantProps.Family
    _sporePlantQualifies: gpnSporePlantQualifies,   // 植物实例 ⇒ 算不算
    _sporeFamExtra: GPN_SPORE_FAM_EXTRA,            // 额外白名单（忧郁菇 / 毒影菇）
    _sporeFamExclude: GPN_SPORE_FAM_EXCLUDE,        // 排除表（大蒜 / 巴豆）
    _sporePoisonCtxEnter: gpnPoisonCtxEnter,        // "来源 = 毒性家族"窗口（自检用）
    _sporePoisonCtxExit: gpnPoisonCtxExit,
    _sporePoisonDmgActive: gpnPoisonDmgActive,
    _sporePoisonStampActive: gpnPoisonStampActive,
    _meteorIsRealZombie: gpnMeteorIsRealZombie, // 真僵尸判定（排除护盾/被魅惑/非场内）
    _meteorCollectZombies: gpnMeteorCollectZombies,
    _meteorFirstTarget: gpnMeteorFirstTarget,   // ★ 第 1 颗索敌（本行最靠左 → 全场最靠左 → 障碍/护盾 → 兜底）
    _meteorTombBlack: GPN_METEOR_TOMB_BLACK,    // ★ 不当障碍物的 Tomb（**只有** kongfu_TNT=17）
    _meteorTombIsBlacklisted: gpnMeteorTombIsBlacklisted,  // 黑名单判定（自检单测）
    _meteorCollectTombs: gpnMeteorCollectTombs,             // 障碍物采集（含冲浪板；剔黑名单/我方/死亡）
    _meteorCollectEnemyShields: gpnMeteorCollectEnemyShields, // 敌方护盾采集（按 hypnotized 判阵营）
    _meteorCollectObstacles: gpnMeteorCollectObstacles,     // 上面两者合并
    _meteorDensestCell: gpnMeteorPickDensestCell,   // ★ 1×3 同排横带密度最高格（并列随机）
    _meteorDensestScore: gpnMeteorDensestScore,     // ★ 只返回最高分（自检做「同排隔离」构造性证明）
    _meteorRandomZombieCell: gpnMeteorPickRandomZombieCell,
    _meteorSecondCell: gpnMeteorSecondCell,     // ★ 第 2 颗落点（50/50；无目标 ⇒ null ⇒ 调用方走随机格兜底）
    _meteorRandomLawnCell: gpnMeteorRandomLawnCell, // ★ 原版口径的"随机草坪格"兜底
    _meteorShouldIgnite: gpnMeteorShouldIgnite,             // ★ 点燃门判据（纯函数）
    _meteorZombieInLawn: gpnMeteorZombieInLawn,             // 场上有没有草坪格僵尸
    _meteorAlreadyIgnited: gpnMeteorAlreadyIgnited,             // ★ 本轮是否已点燃（幂等）
    _meteorMarkIgnited: gpnMeteorMarkIgnited,                   // 标记（自检用）
    _meteorClearIgnited: gpnMeteorClearIgnited,                 // 清除标记
    _meteorHasIgnitableObstacle: gpnMeteorHasIgnitableObstacle, // ★ 点燃门：有没有可瞄准障碍
    _meteorShouldSupplementIgnite: gpnMeteorShouldSupplementIgnite, // ★ 补点燃决策（纯函数）
    _meteorCycleBailOut: gpnMeteorCycleBailOut,     // ★ 本轮收尾（= 调引擎 rest()），防"每帧死循环+动画卡死"
    _meteorShieldEnum: () => gpnMeteorLastZombieEnum,   // 工厂收到的 ZombieEnum（自检单测护盾判定用）
    _gpnNullWriteStats: () => ({ total: gpnNullWriteTotal, detail: gpnNullWriteDetail, quiet: gpnNullWriteQuiet }),  // 同上：护栏降噪统计
    _gpnSpSelfHealTotal: () => gpnSpSelfHealTotal,   // 同上：裂荚每帧自愈的累计次数（自检核对）
    _gpnSpSelfHealState: () => ({ total: gpnSpSelfHealTotal, spots: gpnSpSelfHealSpots, stack: gpnSpSelfHealFirstStack }),  // 诊断用
    _gpnSpBodyFixState: () => ({ total: gpnSpBodyFixTotal, spots: gpnSpBodyFixSpots, stack: gpnSpBodyFixFirstStack }),  // 诊断用：body 缩放纠正统计
    _gpnSpBodyFixReset: () => { gpnSpBodyFixTotal = 0; gpnSpBodyFixSpots = 0; gpnSpBodyFixFirstStack = ''; },          // 自检用来清零
    _gpnSpSelfHealReset: () => { gpnSpSelfHealTotal = 0; gpnSpSelfHealSpots = 0; gpnSpSelfHealFirstStack = ''; },          // 自检用来清零
    _gpnNullWriteReset: () => { gpnNullWriteTotal = 0; gpnNullWriteDetail = 0; gpnNullWriteQuiet = false; },  // 同上：自检用来把统计清零
    _starCanReach: gpnStarCanReach,   // 追击的"能不能打到"判定（纯函数，便于单测）
    id: MOD_ID,
    name: "Cutemaodie's Tweak Mod",
    version: MOD_VERSION,
    author: 'CuteMaodie',
    description: '23 项可逐项开关的杂项调整：巴豆 / 钢地刺 / 心蕊 / 暗影龙葵 / 星星果系 / 寒冰射手 / 红针花 / 暗影夏威夷果 / 裂荚射手 等；含穿透与溅射、A2 追击、毒气、召唤权重、落点灼烧。',

    setup(ctx) {
        try { gpnCtx = ctx; } catch (e) { /* 忽略 */ }   // 供配置界面/生命周期使用
        // ★★ 第一件事：抢占"活动实例令牌"（旧实例若还在，就地让它退役）
        //    为什么必须在最前面：GP-NEXT 重载会重跑 setup，而旧实例的 onDispose 不会来
        //    ⇒ 必须由新实例主动把旧的按住，否则两套逻辑并行（实机表现：面板点不开、开关错乱）。
        // 让位时的自己人清理：关掉本实例的窗体（否则新旧两个面板会叠在同一位置）
        try {
            gpnOnRetire = function () {
                try {
                    const reg = gpnPanelReg();
                    const ent = reg && reg[GPN_INSTANCE_ID];
                    if (ent && ent.panel && ent.panel.isValid) ent.panel.active = false;
                    if (reg) delete reg[GPN_INSTANCE_ID];
                } catch (e0) { /* 忽略 */ }
            };
        } catch (eOn) { /* 忽略 */ }
        try { gpnClaimInstance(); } catch (eC) { /* 忽略 */ }
        // ★ 抢占令牌后立刻关掉上一个实例残留的窗体（实机：重载后两个面板会叠着）
        try { gpnCloseStalePanels(); } catch (eSp) { /* 忽略 */ }
        // ★ onDispose 也提到最前面注册（原来在面板块内，面板安装一旦抛错就永远注册不上）
        try {
            const RT0 = ctx && ctx.runtime;
            if (RT0 && typeof RT0.onDispose === 'function') {
                RT0.onDispose(() => { try { gpnRetireSelf(); } catch (e0) { /* 忽略 */ } }, '实例退役');
            }
        } catch (eR0) { /* 忽略 */ }
        try {
            const all = (typeof window !== 'undefined' && window && window.__gpnInstances) ? window.__gpnInstances : [];
        } catch (e) { /* 忽略 */ }
        const IMPORTS = [
            'chunks:///_virtual/JSONs.ts',            // 0
            'chunks:///_virtual/Zombie.ts',           // 1
            'chunks:///_virtual/ChiliBean.ts',        // 2
            'chunks:///_virtual/Spikerock.ts',        // 3
            'chunks:///_virtual/bloomingheartShot.ts',// 4
            'chunks:///_virtual/commonShot.ts',       // 5
            'chunks:///_virtual/Plant.ts',            // 6
            'chunks:///_virtual/CharacterManager.ts', // 7
            'chunks:///_virtual/Square.ts',           // 8
            'chunks:///_virtual/Character.ts',        // 9
            'chunks:///_virtual/NightShade.ts',       // 10
            'chunks:///_virtual/Projectiles.ts',      // 11
            'cc',                                     // 12
            'chunks:///_virtual/PerfumeFire.ts',      // 13
            'chunks:///_virtual/WallNut.ts',          // 14
            'chunks:///_virtual/PrimalWallNut.ts',    // 15
            'chunks:///_virtual/GroundFiresManager.ts',// 16
            'chunks:///_virtual/Noctarine.ts',        // 17
            'chunks:///_virtual/noctarineBuffParticle.ts', // 18
            'chunks:///_virtual/ZoybeanPod.ts',       // 19
            'chunks:///_virtual/Dandelion.ts',        // 20
            'chunks:///_virtual/Jalapeno.ts',         // 21
            'chunks:///_virtual/GroundFire.ts',       // 22
            'chunks:///_virtual/NodePools.ts',        // 23
            'chunks:///_virtual/FrontYard.ts',        // 24
            'chunks:///_virtual/Hurrikale.ts',        // 25
            'chunks:///_virtual/PhatBeet.ts',         // 26
            'chunks:///_virtual/Cards.ts',            // 27
            'chunks:///_virtual/Plants.ts',            // 28
            'chunks:///_virtual/SnowPea.ts',           // 29
            'chunks:///_virtual/RedStinger.ts',        // 30
            'chunks:///_virtual/MurkadamiaNut.ts',    // 31
            'chunks:///_virtual/SplitPea.ts',         // 32
            'chunks:///_virtual/Zombies.ts',          // 33（ZombieEnum：三种护盾实体按 ID 认）
            'chunks:///_virtual/PerfumeShroom.ts',     // 34（香水菇本体：把香水火时长 9 → 13.5 秒）
            'chunks:///_virtual/DarkJesterZombie.ts',  // 35（弄臣僵尸：反弹甜椒弹时打"来源=弄臣"标记）
            'chunks:///_virtual/Abbot3SectionStaffZombie.ts', // 36（三节棍僵尸：只打"来源=三节棍"标记，行为不变）
            'chunks:///_virtual/MeteorFlower.ts',      // 37（流星花：索敌策略重写 —— 第1颗本行优先/可索障碍与护盾、第2颗不再打歪）
            'chunks:///_virtual/SporeShroom.ts',       // 38（孢子菇：亡语 1×3 伤害+感染+眩晕 / 阳光200 / 血量150 / 图鉴两条特点）
            // ↓ 39~47：孢子菇 ×1.5（R6/R7）—— 毒性家族伤害加成要在**植物自己的发射/伤害入口**
            //   打标或开窗口（S4-1 实测：命中时无法反查来源）。这些模块**追加在末尾、不动旧索引**。
            'chunks:///_virtual/Peashooter.ts',        // 39（豌豆系 _shoot：毒液豌豆/小喷菇/海蘑菇共用；它 return 弹道）
            'chunks:///_virtual/ScaredyShroom.ts',     // 40（胆小菇：自己的 _shoot，**不** return 弹道 ⇒ 走 pending）
            'chunks:///_virtual/CabbagePult.ts',       // 41（⚠️ 心蕊继承的是抛投系！_lobToZombie/_lobToTomb/_lobToPos）
            'chunks:///_virtual/FumeShroom.ts',        // 42（大喷菇：_shoot 里就地 3×1 直伤）
            'chunks:///_virtual/Vamporcini.ts',        // 43（吸血菇：absorb 就地直伤 + 回血）
            'chunks:///_virtual/GloomShroom.ts',       // 44（忧郁菇：detectEnemies 3×3 直伤 + 暗影强化时的 setPoison）
            'chunks:///_virtual/ShadowShroom.ts',      // 45（毒影菇：specialPlantOnEaten 上纯 Dot）
            'chunks:///_virtual/AilMint.ts',           // 46（毒薄荷：specialMintAnimationListener 的 boost_begin 上毒）
            'chunks:///_virtual/MariGold.ts',          // 47（万寿菊**基类**：`specialSunflowerAnimationListener` 里虚调 `this._turn`
                                                       //     ⇒ 紫色万寿菊的子类没覆盖这个回调，窗口正好罩住它自己那份 `_turn`。
                                                       //     ⚠️ 不要改挂 `MariGoldPurple.ts`：那个模块**没有对外导出类**（实机 F12 证过））
            'chunks:///_virtual/goopeaFoodPrj.ts',     // 48（毒液豌豆·**大招弹**：detectEnemy 里直伤 + Poison{50,5}）
            'chunks:///_virtual/GooTileLiquid.ts',     // 49（上面那发大招留下的"黏液地面"：PoisonDPS 50 / goo）
            'chunks:///_virtual/SkyDropShipZombie.ts', // 50（运兵艇 `sky_dropship`：蒲公英大招「驱离」要按类精确判定；
                                                       //     ⚠️ 它是"非真僵尸"：判定框退化、眩晕/冰冻/毒/击退全是空函数，
                                                       //     唯一干净的出口就是它自己的 `playDie`（离场））
            'chunks:///_virtual/SoundRescourses.ts',   // 51（音效资源：巴豆屁的 `playZombieFart` 在这里；
                                                       //     音量 = `play(clip, volume)` 的第 2 个参数 ⇒ 150% 就是传 1.5）
            'chunks:///_virtual/levelController.ts',   // 52（`LevelPlay.shakeScreen(duration)`：**屏幕震动**的原版入口，
                                                       //     流星花的流星子弹 / 黑暗巨人攻击都是调它；幅度固定 ±5px、0.2s 一轮）
            'chunks:///_virtual/TallNut.ts',           // 53（高坚果类 `TallNutPlant`：**按类匹配**比按 `Plant_Type` 字符串稳；
                                                       //     ⚠️ `TallNut` 自己没覆盖 normalSmash，继承 WallNut 的「一砸就死」）
        ];

        // 先读 features.json（读不到就按全开处理），再加载模块
        return featLoad()
            .then(() => gpnFeatStorageLoad(ctx))
            .then(() => Promise.all(IMPORTS.map((m) => System.import(m).catch((e) => {
            warn('模块载入失败 ' + m, e);
            return {};
        })))).then((mods) => {
            const jsonMod = mods[0], zombieMod = mods[1], chiliMod = mods[2],
                spikerockMod = mods[3], bloomMod = mods[4], shotMod = mods[5],
                plantMod = mods[6], charMgrMod = mods[7], squareMod = mods[8],
                characterMod = mods[9], nightMod = mods[10], prjMod = mods[11],
                ccMod = mods[12], perfumeMod = mods[13], wallNutMod = mods[14],
                primalMod = mods[15], gfmMod = mods[16], noctarineMod = mods[17],
                gasMod = mods[18], zoybeanMod = mods[19], dandelionMod = mods[20],
                jalapenoMod = mods[21], groundFireMod = mods[22],
                nodePoolsMod = mods[23], frontYardMod = mods[24], hurrikaleMod = mods[25],
                phatbeetMod = mods[26], cardsMod = mods[27], plantsMod = mods[28], snowPeaMod = mods[29],
                redStingerMod = mods[30], murkadamiaMod = mods[31], splitPeaMod = mods[32],
                zombiesMod = mods[33], perfumeShroomMod = mods[34],
            darkJesterMod = mods[35], abbot3Mod = mods[36],
                meteorMod = mods[37], sporeMod = mods[38],
                peashooterMod = mods[39], scaredyMod = mods[40], cabbagePultMod = mods[41],
                fumeShroomMod = mods[42], vamporciniMod = mods[43], gloomShroomMod = mods[44],
                shadowShroomMod = mods[45], ailMintMod = mods[46], mariGoldMod = mods[47],
                gooFoodMod = mods[48], gooTileMod = mods[49],
                skyShipMod = mods[50], soundMod = mods[51], levelMod = mods[52], tallnutMod = mods[53];

            const recs = [];
            /** 心蕊减防特效 prefab 的缓存（香水菇要用） */
            const buffCache = { par: null };

            // ---- 1. 数值 ----
            if (jsonMod.PvZ2ObjectContainer) {
                try { PvZ2ObjectContainerRef = () => jsonMod.PvZ2ObjectContainer; } catch (e) { /* 忽略 */ }
                try { gpnPlantsRef = () => (plantsMod && plantsMod.plants) || null; } catch (e) { /* 忽略 */ }
                const dataPatch = makeDataPatcher(jsonMod.PvZ2ObjectContainer);
                const firstOk = dataPatch.apply();
                if (firstOk !== true) gpnStartDataPatchRetry(() => gpnApplyDataPatch);
                gpnApplyDataPatch = dataPatch;   // 【临时诊断】交给"即时生效"验证按键（按 2 重新 apply）

                // 保证在游戏数据加载完成后再落一次，避免被 readJsons 覆盖
                const JSONsCls = jsonMod.JSONs;
                if (JSONsCls && JSONsCls.prototype && typeof JSONsCls.prototype.readJsons === 'function') {
                    const origRead = JSONsCls.prototype.readJsons;
                    JSONsCls.prototype.readJsons = function () {
                        return Promise.resolve(origRead.apply(this, arguments)).then((r) => {
                            dataPatch.apply();
                            log('数据已在 readJsons 之后重新应用');
                            return r;
                        });
                    };
                    recs.push({ Cls: JSONsCls, name: 'readJsons', original: origRead });
                } else {
                    // 拿不到 readJsons 就退化为轮询，直到数据到位
                    let tries = 0;
                    const poll = () => {
                        if (dataPatch.apply() || ++tries > 40) return;
                        setTimeout(poll, 500);
                    };
                    poll();
                }
                recs.push({ __dataPatch: dataPatch });
            } else {
                warn('拿不到 PvZ2ObjectContainer，数值改动未生效');
            }





            // ---- 1d. 配置界面（入口行挂在原版设置窗底部；点它打开我们自己的窗体）----
            //   ⚠️ 本块是【整体重写版】：早期用"字符串打补丁"往旧代码里反复插入小补丁，导致层级/顺序反复出错
            //      （曾出现：建行途中触发刷新、refresh 块被插到错层级、let 缩进 0 等）。现改为：
            //        · 所有行对象存进一个数组 entries[{key,label,master,row,sprite,labelNode}]；
            //        · **任何点击 ⇒ 改开关值 ⇒ renderAll() 全量重画**（颜色 / 文字 / 置灰一次算清）；
            //        · 结构扁平、无嵌套陷阱，便于后续维护与排错。
            //   实测事实（全部已在本项目验证过，勿再改）
            //     · 原版设置窗用 node.active 开关 ⇒ 必须挂它的 onEnable 才能在"打开时"插入口行；
            //     · 原版实测行尺寸 968x140；内容区 1916.4x1440（两列）；滚动视口 1916.4x840；
            //     · 组件识别不能比类名字符串 ⇒ 按属性特征（clickEvents / string / spriteFrame）；
            //     · Graphics 不可用（Error 3804）；新建节点必须"先入树再加 UITransform/Label"；
            //     · Sprite.color 染色、Label.string 改字、node.on(touch-end) 点击 —— 均可用。
            //   开关状态表现：**整行染色**（绿=开 / 红=关；与原版二态项一致）+ 右侧「开/关」小字；
            //             主子联动：**父关 ⇒ 子行整行变灰**（不可点）。
            try {
                const gpnCfgV = 'v28';
                let origWin = null;          // 原版设置窗节点
                let panel = null;            // 我们的窗体（克隆原版外壳）
                let panelRowsBox = null;     // 我们窗体的 elements
                let entryTemplate = null;    // 原版 KeyBinds 行（模板）
                let rowW = 968, rowH = 140;  // 实测行尺寸
                let contentW = 1916.4;
                const entries = [];          // 行对象数组（唯一数据源）
                let hooked = false, lastWinActive = false, missLog = 0, hookedScene = '';
                const GREEN = ccColor(20, 255, 0, 255);
                const RED = ccColor(255, 0, 0, 255);
                const GREY = ccColor(110, 104, 98, 255);
                const GREY_TXT = ccColor(255, 255, 255, 255);
                const INFO = [
                    { key: 'chilibean', label: '巴豆' },
                    { key: 'spikerock', label: '钢地刺' },
                    { key: 'bloomingheart', label: '心蕊' },
                    { key: 'nightshade', label: '暗影龙葵' },
                    { key: 'turnip', label: '白萝卜' },
                    { key: 'sweetpotato', label: '甜薯' },
                    { key: 'tallnut', label: '高坚果' },
                    { key: 'perfumeshroom', label: '香水菇' },
                    { key: 'starfruit', label: '星星果系' },
                    { key: 'starfruitFollowMerge', label: '　└ 追击合并', master: 'starfruit' },
                    { key: 'noctarine', label: '暗影油桃' },
                    { key: 'zoybeanpod', label: '腐尸豆荚' },
                    { key: 'dandelion', label: '蒲公英' },
                    { key: 'pepperpult', label: '甜椒投手' },
                    { key: 'hurrikale', label: '飓风甘蓝' },
                    { key: 'cabbagepult', label: '卷心菜投手' },
                    { key: 'kernelpult', label: '玉米投手' },
                    { key: 'phatbeet', label: '魔音甜菜' },
                    { key: 'garlic', label: '大蒜' },
                    { key: 'snowpea', label: '寒冰射手' },
                    { key: 'redstinger', label: '红针花' },
                    { key: 'murkadamia', label: '暗影夏威夷果' },
                    { key: 'splitpea', label: '裂荚射手' },
                    { key: 'meteorflowerAim', label: '流星花' },     // ★ 2026/10/15 补：曾经漏登记 ⇒ 界面上看不到、也切不了
                    { key: 'sporeshroom', label: '孢子菇' },          // ★ 2026/10/16 新增：亡语 + 数值 + 图鉴两条特点
                    //   （顺序与 FEATURES 略有不同是**有意的**：玩家视角下「推植物修复」更适合排在末尾）
                    { key: 'pushPlantFix', label: '推植物修复' },
                    { key: 'verboseLog', label: '诊断日志' },
                ];

                /* ---------- 小工具（全部只用实测可用的 API） ---------- */
                function ccColor(r, g, b, a) {
                    try { const ccg = (typeof cc !== 'undefined' && cc) ? cc : null; return ccg.color(r, g, b, a); }
                    catch (e) { return { r: r, g: g, b: b, a: a }; }
                }
                function ccNode() { const ccg = (typeof cc !== 'undefined' && cc) ? cc : null; return ccg; }
                function clog(s) { try { log('【配置界面·' + gpnCfgV + '】' + s); } catch (e) { /* 忽略 */ } }
                function findDeep(n, want, depth) {
                    try {
                        if (!n || depth > 8) return null;
                        if (String(n.name || '') === want) return n;
                        const ks = n.children || [];
                        for (let i = 0; i < ks.length; i++) { const r = findDeep(ks[i], want, depth + 1); if (r) return r; }
                    } catch (e) { /* 忽略 */ }
                    return null;
                }
                function clearClicks(n) {
                    let c = 0;
                    try { for (const x of (n.components || [])) { if (x && Array.isArray(x.clickEvents)) { c += x.clickEvents.length; x.clickEvents.length = 0; } } } catch (e) { /* 忽略 */ }
                    (n.children || []).forEach((k) => { c += clearClicks(k); });
                    return c;
                }
                function setText(n, str) {
                    let c = 0;
                    try { for (const x of (n.components || [])) { if (x && typeof x.string === 'string' && x.string !== '') { x.string = str; c++; } } } catch (e) { /* 忽略 */ }
                    (n.children || []).forEach((k) => { c += setText(k, str); });
                    return c;
                }
                function sizeOf(n) { try { const x = (n.components || []).find((y) => y && y.contentSize); return x ? x.contentSize : null; } catch (e) { return null; } }
                function setSize(n, w, h) { try { const x = (n.components || []).find((y) => y && y.setContentSize); if (x) { x.setContentSize(w, h); return true; } } catch (e) { /* 忽略 */ } return false; }
                function setRightAlign(n, right) {
    try {
        const u = (n.components || []).find((y) => y && typeof y.anchorX === 'number');
        if (u) u.anchorX = right ? 1 : 0;
    } catch (e) { /* 忽略 */ }
}
function findSprite(n) {
                    try { for (const x of (n.components || [])) { if (x && x.spriteFrame !== undefined && x.color !== undefined) return x; } } catch (e) { /* 忽略 */ }
                    try { for (const x of (n.components || [])) { if (x && x.color !== undefined) return x; } } catch (e2) { /* 兜底 */ }
                    return null;
                }
                function killChildren(n, keepTip) {
                    (n.children || []).slice().forEach((c2) => {
                        const nm = String(c2.name || '');
                        if (keepTip && nm.indexOf('ToolTip') === 0) return;
                        try { c2.active = false; } catch (e1) { /* 忽略 */ }
                        try { c2.removeFromParent(); } catch (e2) { /* 忽略 */ }
                        try { c2.destroy(); } catch (e3) { /* 忽略 */ }
                    });
                }
                function noWidget(n) { try { for (const c of (n.components || [])) { if (c && c.isAlignLeft !== undefined) c.enabled = false; } } catch (e) { /* 忽略 */ } }

                /* ---------- 入口行：克隆原版 KeyBinds 行（只留文字 + 蓝色齿轮） ---------- */
                function buildEntryRow(ccg) {
                    const row = ccg.instantiate(entryTemplate);
                    row.name = 'gpnConfigRow';
                    killChildren(row, true);                  // 只留 ToolTip（行名）
                    // 【v22】按用户要求：入口行**不放蓝色齿轮**（只留「配置界面」文字，整行可点）。
                    //   说明：原版那颗齿轮在 website 节点里，点击是"打开键位说明网页"，容易让玩家误解，
                    //   所以干脆不放。若将来想加回来：从 entryTemplate 里 clone 名为 website 的子节点挂到这里即可。
                    clearClicks(row);
                    setText(findDeep(row, 'ToolTip', 0) || row, '配置界面');
                    // ★ 蓝色齿轮 = 「恢复默认」（用户要求：单击即执行，不二次确认）
                    try {
                        const webTpl = (entryTemplate.children || []).find((k) => String((k && k.name) || '').indexOf('website') === 0);
                        if (webTpl) {
                            const gear = ccg.instantiate(webTpl);
                            gear.name = 'gpnResetGear';
                            clearClicks(gear);                       // 去掉原版"打开网页"的事件
                            let gearLock = 0;
                            gear.on('touch-end', (ev) => {
                                try {
                                    if (gpnDisposed) return;                       // 旧运行时不响应
                                    const now = Date.now();
                                    if (now - gearLock < 500) return;
                                    gearLock = now;
                                    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();   // 别连带打开面板
                                    gpnFeatStorageReset();                   // 恢复默认 + 写回存储
                                    renderAll();                             // 界面立刻刷新
                                    clog('已点击齿轮：恢复默认（开关已重置并写回存储）');
                                } catch (e) { warn('【配置界面】恢复默认出错', e); }
                            });
                            row.addChild(gear);
                            if (verboseOn()) clog('入口行：已加入恢复默认齿轮');
                        } else { clog('入口行：模板里找不到 website 节点，齿轮未加入'); }
                    } catch (eG) { clog('入口行齿轮处理失败：' + eG); }
                    let locked = 0;
                    // ★★ 把"打开面板"抽成具名函数并登记到全局注册表，行点击改为**派发**。
                    //    为什么：入口行可能由**旧实例**插进【同一个窗口对象】（诊断日志已证实），
                    //    那行的处理器绑定旧实例（它的 panel/origWin 是旧的）⇒ 点了没反应。
                    //    现在点击时**现查**当前活动实例的实现 ⇒ 无论这行谁插的都能打开。
                    function openPanel() {
                        try {
                            if (gpnDisposed) return;                       // 旧运行时不响应
                            const now = Date.now();
                            if (now - locked < 400) return;
                            locked = now;
                            if (panel && panel.active === true) return;   // 已经开着
                            if (!buildPanel(ccg)) return;
                            if (origWin) origWin.active = false;
                            panel.active = true;
                            clog('已打开配置窗体（入口行被点击）');
                        } catch (e) { warn('【配置界面】打开出错', e); }
                    }
                    try { const _rgo = gpnGlobalReg(); if (_rgo) _rgo.open = openPanel; } catch (eO) { /* 忽略 */ }
                    row.on('touch-end', () => {
                        try {
                            const _rgp = gpnGlobalReg();
                            if (_rgp && typeof _rgp.open === 'function') { _rgp.open(); return; }
                            openPanel();
                        } catch (e) { warn('【配置界面】打开出错', e); }
                    });
                    return row;
                }

                /* ---------- render：唯一的状态画法（颜色 + 文字 + 置灰） ---------- */
                function renderAll() {
                    entries.forEach((e, i) => {
                        try {
                            const on = featOn(e.key);
                            const blocked = !!(e.master && !featOn(e.master));
                            if (e.sprite) e.sprite.color = blocked ? GREY : (on ? GREEN : RED);
                            if (e.labelNode) {
                                if (blocked) { setText(e.labelNode, '关'); setRightAlign(e.labelNode, true); }
                                else { setRightAlign(e.labelNode, false); setText(e.labelNode, on ? '开' : '关'); }
                            }
                            if (e.hint) { try { for (const c of (e.hint.components || [])) { if (c && c.color !== undefined) c.color = blocked ? ccColor(210, 200, 190, 255) : ccColor(120, 110, 100, 255); } } catch (eHC) { } }
                            if (i < 3) if (verboseOn()) clog('render ' + e.key + ' ｜ 自身=' + on + ' 置灰=' + blocked + ' 颜色=' + (blocked ? '灰' : (on ? '绿' : '红')));
                        } catch (err) { if (verboseOn()) clog('render 出错 ' + e.key + '：' + err); }
                    });
                }

                /* ---------- 刷新已建卡片的阳光显示（数值类开关即时生效的关键） ---------- */
                //  数据（objdata.SunCost）我们早就改了；但已建卡片把阳光缓存在 _SUNCOST 里，
                //  必须按引擎自己的惯用法「自赋值」一次，才会同时更新缓存与价格文字。
                function gpnRefreshCardSunCost() {
                    // ★ 探测版：先"看清卡片组件长什么样"，再做引擎同款刷新（SUNCOST 自赋值）。
                    //   上次的实现按"typeof c._SUNCOST === number"去找，找到 0 个 —— 说明特征选错了，
                    //   所以这次把**所有可疑组件**都打印出来（节点名/属性键/ID/值），用证据改。
                    let found = 0, done = 0;
                    const shapes = [];
                    try {
                        const ccg = ccNode();
                        const scene = ccg && ccg.director && ccg.director.getScene ? ccg.director.getScene() : null;
                        if (!scene) { if (verboseOn()) clog('卡片探测：拿不到场景'); return; }
                        const seen = [];
                        const walk = (node, depth) => {
                            if (!node || depth > 14 || seen.length > 6000) return;
                            seen.push(node);
                            try {
                                for (const c of (node.components || [])) {
                                    if (!c) continue;
                                    let keys = [];
                                    try { keys = Object.keys(c); } catch (e) { keys = []; }
                                    const hasSun = keys.indexOf('_SUNCOST') !== -1;
                                    const hasPrice = keys.indexOf('_priceLB') !== -1;
                                    const hasPF = keys.indexOf('PF') !== -1;
                                    if (!hasSun && !hasPrice && !hasPF) continue;
                                    found++;
                                    if (shapes.length < 12) {
                                        shapes.push(String(node.name || '?') + '[' + (hasSun ? 'S' : '-') + (hasPrice ? 'P' : '-') + (hasPF ? 'F' : '-') + ']'
                                            + ' id=' + (c.ID !== undefined ? c.ID : '?')
                                            + ' sun=' + (c._SUNCOST !== undefined ? c._SUNCOST : '?'));
                                    }
                                    // 引擎同款刷新：自赋值 ⇒ setter 同时更新缓存与价格文字
                                    try { if (hasSun) { c.SUNCOST = c.SUNCOST; done++; } } catch (e) { /* 忽略 */ }
                                }
                            } catch (e) { /* 忽略 */ }
                            for (const kk of (node.children || [])) walk(kk, depth + 1);
                        };
                        walk(scene, 0);
                        if (verboseOn()) clog('卡片探测：命中组件 ' + found + ' 个、刷新成功 ' + done + ' 个 ｜ 样本: ' + (shapes.length ? shapes.join(' , ') : '(无)'));
                    } catch (e) { if (verboseOn()) clog('卡片探测出错：' + e); }
                }

                /* ---------- 建窗体（克隆原版外壳；行在打开时懒建） ---------- */
                function buildPanel(ccg) {
                    try {
                        if (panel && panel.isValid) return panel;
                        // ★ 跨场景重建：清空旧行数据（否则 buildRows 会因为 entries 非空而跳过 ⇒ 新窗体会是空的）
                        if (entries.length) if (verboseOn()) clog('重建面板：清空旧行数据 ' + entries.length + ' 行');
                        entries.length = 0;
                        panelRowsBox = null;
                        const clone = ccg.instantiate(origWin);
                        clone.name = 'gpnConfigWindow';
                        try { for (const c of (clone.components || []).slice()) { if (c && c.node === clone) { try { c.destroy(); } catch (e0) { /* 忽略 */ } } } } catch (e1) { /* 忽略 */ }
                        const cleared = clearClicks(clone);
                        const titleNode = findDeep(clone, 'Title', 0);
                        const titleN = titleNode ? setText(titleNode, '模组设置') : 0;
                        panelRowsBox = findDeep(clone, 'elements', 0);
                        // 量原版行尺寸（清空前，从第一行读）
                        if (panelRowsBox) {
                            const first = (panelRowsBox.children || [])[0];
                            const cs0 = first ? sizeOf(first) : null;
                            if (cs0) { rowW = Math.round(cs0.width); rowH = Math.round(cs0.height); }
                            const csBox = sizeOf(panelRowsBox);
                            if (csBox) contentW = csBox.width;
                            killChildren(panelRowsBox, false);         // 清空原版 20 行
                            try { const lay = (panelRowsBox.components || []).find((c) => c && c.type !== undefined && c.resizeMode !== undefined); if (lay) lay.enabled = false; } catch (e2) { /* 忽略 */ }
                        }
                        // 关闭按钮：自己绑（原版事件已清）
                        const exitNode = findDeep(clone, 'buttonExit', 0);
                        if (exitNode) {
                            const closeIt = () => { try { clone.active = false; if (origWin) origWin.active = true; clog('已关闭配置窗体'); } catch (e) { /* 忽略 */ } };
                            try { exitNode.on('touch-end', closeIt); } catch (e3) { /* 忽略 */ }
                            (exitNode.children || []).forEach((k) => { try { k.on('touch-end', closeIt); } catch (e4) { /* 忽略 */ } });
                        }
                        clone.active = false;
                        origWin.parent.addChild(clone);
                        panel = clone;
                        // ★ 登记到跨实例共享表（新实例启动时能关掉它）
                        try {
                            const reg = gpnPanelReg();
                            if (reg) reg[GPN_INSTANCE_ID] = { panel: clone, origWin: origWin };
                        } catch (eReg) { /* 忽略 */ }
                        if (verboseOn()) clog('窗体已建：组件清理 / 清点击 ' + cleared + ' 处 / 标题改写 ' + titleN + ' 处 / 行尺寸 ' + rowW + 'x' + rowH);
                        // ★ 建窗体后立即建行（此前是"懒建"，但懒建的触发条件在面板刚建时不成立 ⇒ 行一直没建）
                        buildRows(ccg);
                        if (verboseOn()) clog('建窗体后立即建行：entries=' + entries.length + ' ｜ rowsBox=' + (panelRowsBox ? panelRowsBox.name : '无'));
                        return clone;
                    } catch (e) { warn('【配置界面】建窗体出错', e); return null; }
                }

                /* ---------- 建 23 行（打开窗体时懒建一次） ---------- */
                function buildRows(ccg) {
                    try {
                        if (!panelRowsBox || entries.length) { clog('buildRows 跳过：rowsBox=' + !!panelRowsBox + ' 已有行=' + entries.length); return; }
                        const cols = 2;
                        const cw = Math.max(320, Math.floor(contentW / cols) - 10);
                        const ch = rowH || 140;
                        // 分组标题
                        try {
                            const hdr = ccg.instantiate(entryTemplate);
                            hdr.name = 'gpnGroupHeader';
                            killChildren(hdr, true);
                            clearClicks(hdr);
                            noWidget(hdr);
                            setText(findDeep(hdr, 'ToolTip', 0) || hdr, '【植物】');
                            setSize(hdr, cw * cols, Math.max(60, Math.floor(ch * 0.6)));
                            hdr.setPosition(0, 0);
                            hdr.active = false;                     // 先不显示，等统一摆位
                            panelRowsBox.addChild(hdr);
                        } catch (eH) { clog('造分组标题失败：' + eH); }
                        // 23 行
                        INFO.forEach((it) => {
                            try {
                                const row = ccg.instantiate(entryTemplate);
                                row.name = 'gpnRow_' + it.key;
                                killChildren(row, true);
                                clearClicks(row);
                                noWidget(row);
                                setSize(row, cw, ch);
                                setText(findDeep(row, 'ToolTip', 0) || row, it.label);
                                // ★ 括号小字（照原版"最大帧率"那行的小字样式）：目前只有"诊断日志"需要
                                //   ⚠ 原文案是「(需重新启动游戏)」—— **已过期**：本模组的开关（含诊断日志）
                                //     都是**点一下立刻生效**（切换处理器里紧接着就 renderAll + apply 数据补丁），
                                //     所以改成说明它"只影响日志、不影响游戏"。
                                let hintNode = null;
                                if (it.key === 'verboseLog') {
                                    try {
                                        const tip2 = findDeep(row, 'ToolTip', 0);
                                        if (tip2) {
                                            const h = ccg.instantiate(tip2);
                                            h.name = 'gpnHint';
                                            noWidget(h);
                                            for (const c of (h.components || [])) {
                                                if (c && typeof c.string === 'string') {
                                                    c.string = '(仅影响日志)';
                                                    try { c.fontSize = Math.max(18, Math.round((c.fontSize || 32) * 0.5)); } catch (eF) { }
                                                    try { c.lineHeight = Math.max(20, Math.round((c.lineHeight || 36) * 0.5)); } catch (eL2) { }
                                                    try { c.color = ccColor(120, 110, 100, 255); } catch (eC) { }
                                                }
                                                if (c && c.isAlignLeft !== undefined) c.enabled = false;
                                            }
                                            row.addChild(h);
                                            const rowCs = sizeOf(row);
                                            h.setPosition(Math.floor((rowCs ? rowCs.width : 948) / 2) - 150, -(ch / 2) + 26);
                                            hintNode = h;
                                        }
                                    } catch (eH2) { clog('小字添加失败：' + eH2); }
                                }
                                // 状态小字：克隆 ToolTip，放到行内右侧
                                let stateLab = null;
                                try {
                                    const tip = findDeep(row, 'ToolTip', 0);
                                    if (tip) {
                                        const st = ccg.instantiate(tip);
                                        st.name = 'gpnState';
                                        noWidget(st);
                                        row.addChild(st);
                                        st.setPosition(Math.floor(cw / 2) - 70, 0);
                                        stateLab = st;
                                    }
                                } catch (eS) { /* 忽略 */ }
                                const e = { key: it.key, label: it.label, master: it.master || null, masterLabel: null, row: row, sprite: findSprite(row), labelNode: stateLab, hint: hintNode };
                                entries.push(e);
                                let lock = 0;
                                row.on('touch-end', () => {
                                    try {
                                        if (gpnDisposed) return;                       // 旧运行时不响应
                                        const now = Date.now();
                                        if (now - lock < 300) return;
                                        lock = now;
                                        if (e.master && !featOn(e.master)) { clog('已拦下：' + e.key + ' 需先开启 ' + (e.master || '')); return; }
                                        const next = !featOn(e.key);
                                        featSet(e.key, next);
                                        renderAll();                                   // ★ 全量重画（父变 ⇒ 子立刻变灰）
                                        try { if (gpnApplyDataPatch && typeof gpnApplyDataPatch.apply === 'function') gpnApplyDataPatch.apply(); } catch (eA) { /* 忽略 */ }
                                        try { gpnRefreshCardSunCost(); } catch (eB) { /* 忽略 */ }   // 数值类：刷新已建卡片的阳光显示
                                        clog('切换：' + e.label + '(' + e.key + ') ⇒ ' + (next ? '开' : '关'));
                                    } catch (err) { warn('【配置界面】切换出错', err); }
                                });
                                row.active = false;                        // 先不显示，等统一摆位
                                panelRowsBox.addChild(row);
                            } catch (eR) { clog('造行失败 ' + it.key + '：' + eR); }
                        });
                        // 补上父名字（用于"需先开启XXX"文案）
                        entries.forEach((e) => { if (e.master) { const m = entries.find((x) => x.key === e.master); e.masterLabel = m ? m.label : e.master; } });
                        // 统一摆位（标题 + 23 行）
                        let idx = 0;
                        (panelRowsBox.children || []).forEach((k) => {
                            try {
                                if (k.name === 'gpnGroupHeader') {
                                    k.setPosition(0, -Math.floor((Math.max(60, Math.floor(ch * 0.6))) / 2));
                                    k.active = true;
                                    return;
                                }
                                const col = idx % cols, r = Math.floor(idx / cols);
                                const hdrH = Math.max(60, Math.floor(ch * 0.6));
                                k.setPosition(-Math.floor(contentW / 2) + Math.floor(cw / 2) + col * cw, -(hdrH) - (ch / 2) - r * ch);
                                k.active = true;
                                idx++;
                            } catch (eP) { /* 忽略 */ }
                        });
                        const perCol = Math.max(1, Math.ceil(idx / cols));
                        const needH = Math.max(1440, Math.max(60, Math.floor(ch * 0.6)) + perCol * ch + ch);
                        setSize(panelRowsBox, contentW, needH);
                        if (panelRowsBox.updateLayout) panelRowsBox.updateLayout();
                        if (verboseOn()) clog('已铺 ' + idx + ' 行（2 列，行宽 ' + cw + '，行高 ' + ch + '，内容区高度 ' + needH + '）');
                        // 【诊断】确认每行真的找到了 sprite 与状态 Label（避免"看着像改了、其实没改到"）
                        entries.slice(0, 4).forEach((e) => {
                            try {
                                if (verboseOn()) clog('  行自检 ' + e.key + ' ｜ sprite=' + (e.sprite ? '有' : '无')
                                    + ' ｜ 状态Label=' + (e.labelNode ? '有' : '无')
                                    + (e.sprite ? (' ｜ 当前色=' + e.sprite.color.r + ',' + e.sprite.color.g + ',' + e.sprite.color.b) : ''));
                            } catch (eD) { /* 忽略 */ }
                        });
                        renderAll();
                    } catch (e) { warn('【配置界面】建行出错', e); }
                }

                /* ---------- 找原版设置窗 & 挂 onEnable（打开时确保入口行存在） ---------- */
                function ensureEntry() {
    try {
        // ★ 过期实例不插手（双保险：注册表已被新实例覆盖时，旧闭包即使被调到也不改界面）
        if (typeof gpnIsActiveInstance === 'function' && !gpnIsActiveInstance()) return;
        if (!origWin || origWin.active === false) { lastWinActive = false; return; }
        if (lastWinActive) return;
        lastWinActive = true;
        const ccg = ccNode();
        if (!ccg) return;
        const box = findDeep(origWin, 'elements', 0);
        if (!box) { if (missLog++ < 3) clog('找不到原版 elements'); return; }
        // 不跨场景缓存模板：每次都从"当前窗口"的 elements 里取（旧场景销毁后缓存会失效，曾崩在这里）
        const kids = box.children || [];
        const tpl = kids.find((k) => String((k && k.name) || '') === 'KeyBinds') || kids[kids.length - 1];
        if (!tpl) { if (missLog++ < 3) clog('当前设置窗里找不到模板行（kids=' + kids.length + '）'); return; }
        entryTemplate = tpl;
        const _oldRow = kids.filter((k) => k && k.name === 'gpnConfigRow');
        if (_oldRow.length) {
            // ★ 关键：这行若是**别的实例**插的，它的点击处理器绑的是旧实例（点了没反应，诊断已证实）
            //   ⇒ 删掉它、用本实例重插一行，让行的处理器与窗体都归当前活动实例。
            let owner = null;
            try { const _rgr = gpnGlobalReg(); owner = _rgr && _rgr.rowOwner; } catch (eRo) { /* 忽略 */ }
            if (owner && owner !== GPN_INSTANCE_ID) {
                clog('入口行属于旧实例(' + owner + ') ⇒ 删除并重建（本实例=' + GPN_INSTANCE_ID + '）');
                for (const _r of _oldRow) {
                    try { _r.removeFromParent(); } catch (eRm) { try { _r.destroy(); } catch (eRd) { /* 忽略 */ } }
                }
                if (box.updateLayout) box.updateLayout();
            } else {
                if (panel && panel.active === true) buildRows(ccg);
                return;
            }
        }
        const er = buildEntryRow(ccg);
        box.addChild(er);
        try { const _rgs = gpnGlobalReg(); if (_rgs) _rgs.rowOwner = GPN_INSTANCE_ID; } catch (eRso) { /* 忽略 */ }
        if (box.updateLayout) box.updateLayout();
        clog('入口行已插入（模板=' + tpl.name + '，场景=' + sceneName() + '）');
    } catch (e) { warn('【配置界面】插入入口行出错', e); }
}

function sceneName() {
    try {
        const ccg = ccNode();
        const sc = ccg && ccg.director && ccg.director.getScene ? ccg.director.getScene() : null;
        return sc ? String(sc.name || '?') : '?';
    } catch (e) { return '?'; }
}
function hookWin() {
    try {
        // ★★ 第一件事：把"本实例的入口行加载器"登记到**全局注册表**。
        //    为什么必须放在最前面（实机证据 config-l24）：
        //      下面有提前返回 `if (hooked && origWin && origWin.isValid) return true;`，
        //      而 GP-NEXT「保存并重载」后新实例的 hookedScene 恰好已是 mainScene、
        //      origWin 又是**同一个** SettingWindow 节点（场景没销毁）⇒ 新实例**每次都从这里返回**，
        //      于是"登记"那段永远不执行 ⇒ 注册表里留的是**旧实例的闭包**
        //      ⇒ 原型上的派发器调用旧闭包（旧闭包带"过期实例不插手"守卫）⇒ 什么都不做
        //      ⇒ 入口行插不进去（必须进关卡再退出才能恢复）。
        try {
            const _rg = gpnGlobalReg();
            if (_rg) _rg.ensure = function () { try { return ensureEntry.apply(this, arguments); } catch (e) { /* 忽略 */ } };
        } catch (eRg0) { /* 忽略 */ }
        // 每个场景各有自己的 SettingWindow 组件，必须按场景重新挂钩
        //（曾经只挂启动时那一个，导致世界地图的设置窗没有入口行）
        const cur = sceneName();
        if (cur !== hookedScene) {
            hooked = false; origWin = null; lastWinActive = false; hookedScene = cur;
            clog('场景变化，重新查找设置窗（当前场景=' + cur + '）');
        }
        if (hooked && origWin && origWin.isValid) return true;
        hooked = false; origWin = null;
        const ccg = ccNode();
        const dir = ccg && ccg.director;
        const scene = dir && dir.getScene ? dir.getScene() : null;
        if (!scene) return false;
        let comp = null;
        const walk = (n2) => {
            if (!n2 || comp) return;
            try { for (const c of (n2.components || [])) { const cn = String((c && (c.__classname__ || (c.constructor && c.constructor.name))) || ''); if (cn === 'SettingWindow') { comp = c; return; } } } catch (e) { }
            (n2.children || []).forEach(walk);
        };
        walk(scene);
        if (!comp) return false;
        origWin = comp.node;
        const proto = Object.getPrototypeOf(comp);
        const origOn = proto.onEnable;
        if (typeof origOn !== 'function') { clog('原型没有 onEnable'); return false; }
        // ★ 关键修复：挂钩必须是【派发器】，每次调用都问"当前活动实例是谁"。
        //   旧写法 `if (!proto.__gpnCfgHooked)` 把标记挂在**引擎原型**上（重载后依然存在），
        //   新实例于是跳过挂钩 ⇒ 生效的仍是旧实例的闭包（操作旧的 origWin/panel）⇒ 点击无效。
        //   派发器只写一次，但里面每次都取"当前活动实例刚登记的 ensureEntry"。
        {
            // 注：本实例 ensureEntry 的**登记已挪到 hookWin() 最前面**（每次调用都执行，
            //     不会被下面的提前 return 跳过）。这里只保留"装派发器"这一件事。
            if (!proto.__gpnCfgHooked) {
                proto.__gpnCfgHooked = true;
                proto.onEnable = function () {
                    const r = origOn.apply(this, arguments);
                    try {
                        // ★ 现查"当前活动实例"登记的 ensureEntry（旧实例的已被新实例覆盖）
                        const _rg2 = gpnGlobalReg();
                        const cur = _rg2 && _rg2.ensure;
                        if (typeof cur === 'function') setTimeout(cur, 300);
                    } catch (e) { }
                    return r;
                };
            }
        }
        hooked = true;
        clog('已挂上设置窗 onEnable（场景=' + cur + '）');
        return true;
    } catch (e) { warn('【配置界面】挂钩出错', e); return false; }
}

let ticks = 0;
                let gpnCfgTimer = null;
                let gpnLastScene = '';
                gpnCfgTimer = setInterval(() => {
                    try {
                        if (gpnDisposed) { clearInterval(gpnCfgTimer); return; }
                        // ★ 切场景 ⇒ 重新把数据补丁落一遍。
                        //   为什么（实机证据）：暗影龙葵关掉后，进关卡/沙盒里阳光仍是 125（我们的值），
                        //   而 apply() 内部诊断显示它看到的开关已经是 false ⇒ 说明游戏在进关卡时会重新
                        //   加载/重置数据，把启动时写下去的值覆盖掉了（readJsons 钩子实测没触发）。
                        //   钢地刺能生效、龙葵不能，差别就在"关卡是否重新读它"。
                        try {
                            const _sc = sceneName();
                            if (_sc && _sc !== gpnLastScene) {
                                gpnLastScene = _sc;
                                if (gpnApplyDataPatch && typeof gpnApplyDataPatch.apply === 'function') {
                                    const _ok = gpnApplyDataPatch.apply();
                                    clog('切场景(' + _sc + ')后重新落地数据补丁：' + _ok);
                                }
                            }
                        } catch (eS) { /* 只影响这一项 */ }
                        if (!hookWin()) { ticks++; return; }
                        // 兜底轮询：入口行可能被原版窗体重建而丢失
                        ensureEntry();
                        // 窗体开着且行还没建 ⇒ 补建
                        if (panel && panel.active === true && !entries.length && panelRowsBox) buildRows(ccNode());
                    } catch (e) { /* 忽略 */ }
                }, 1000);
                clog('已就绪（版本 ' + gpnCfgV + '：入口行=配置界面+蓝齿轮；点它打开配置窗体）');
                // ★ 注册官方生命周期清理：GP-NEXT「保存并重载」会 dispose 本运行时的 ctx，
                //   届时必须让本实例安静下来（停轮询 / 停存盘 / 停响应点击），
                //   否则旧实例会与新实例并行 —— 实机表现为「改一个开关、另一个也跟着变」。
                try {
                    const RT = gpnCtx && gpnCtx.runtime;
                    if (RT && typeof RT.onDispose === 'function') {
                        RT.onDispose(() => {
                            if (gpnDisposed) return;
                            gpnDisposed = true;
                            try { if (gpnCfgTimer) clearInterval(gpnCfgTimer); } catch (e) { /* 忽略 */ }
                            try { entries.length = 0; panelRowsBox = null; } catch (e) { /* 忽略 */ }
                            try { if (panel && panel.isValid) panel.active = false; } catch (e) { /* 忽略 */ }
                            try { clog('收到 onDispose：本实例已停止活动'); } catch (e) { /* 忽略 */ }
                        }, '配置界面');
                    } else { clog('ctx.runtime.onDispose 不可用 ⇒ 仅靠 setup 返回值清理'); }
                } catch (eR) { clog('注册 onDispose 失败：' + eR); }
            } catch (e) { warn('【配置界面】安装失败', e); }
            // ---- 2. 巴豆 ----
            {
                const chili = makeChiliPatches(chiliMod.ChiliBean, zombieMod.Zombie, zombieMod.ZombiePoison);
                recs.push(...chili.recs);
            }

            // ---- 2b. 巴豆屁联动（§3.80）：**S1 只读探针**（probeFart + verboseLog 都开才打印）----
            {
                const fp = makeFartLinkPatch(zombieMod.Zombie, soundMod && soundMod.SoundRescourses,
                    squareMod.Square, { Square: squareMod.Square, cc: ccMod, LevelPlay: levelMod && levelMod.LevelPlay, FrontYard: frontYardMod && frontYardMod.FrontYard });
                if (fp) recs.push(...fp);
            }

            // ---- 3. 钢地刺 ----
            {
                const spy = makeSpikerockPatch(spikerockMod.SpikerockPlant);
                if (spy) recs.push(spy);
            }

            // ---- 4. 心蕊 ----
            {
                const bloom = makeBloomingHeartPatch(bloomMod.bloomingheartShot,
                    charMgrMod.Rectangle, squareMod.Square, shotMod.commonShot);
                if (bloom) recs.push(...bloom);
            }

            // ---- 5. 暗影龙葵：先重写 _shoot 打标记，再装穿透 ----
            {
                const night = makeNightShadePatch(nightMod.NightShadePlant,
                    prjMod.PrjFunctions, ccMod.Vec2, characterMod.CharacterType);
                if (night) recs.push(night);

            }

            // 私有字段桥 / 溅射 / 穿透都长在 commonShot 上：
            // 暗影龙葵、星星果、甜椒投手任意一个开着就得装（各自靠私有标记判定，互不干扰）
            {
                const pierce = makePiercePatch(shotMod.commonShot,
                    characterMod.CharacterType, charMgrMod.ZombieDamageDetails,
                    zombiesMod && zombiesMod.ZombieEnum);
                if (pierce) recs.push(...pierce);
            }

            // ---- 18. 飓风甘蓝：全屏寒风 ----
            {
                const hur = makeHurrikalePatch(hurrikaleMod && hurrikaleMod.HurrikalePlant,
                    zombieMod && zombieMod.Zombie, {
                        Square: squareMod.Square,
                        Vec3: ccMod.Vec3,
                        instantiatePooly: nodePoolsMod && nodePoolsMod.instantiatePooly,
                        FrontYard: frontYardMod && frontYardMod.FrontYard,
                        PlantProps: jsonMod.PvZ2ObjectContainer && jsonMod.PvZ2ObjectContainer.PlantProps,
                        Plant: plantMod && plantMod.Plant,     // 用来判"这株植物会不会吹"
                    });
                if (hur) recs.push(...hur);
            }

            // ---- 19. 魔音甜菜 ----
            {
                const pb = makePhatBeetPatch(phatbeetMod && phatbeetMod.PhatBeetPlant, {
                    Square: squareMod.Square,
                    Rectangle: charMgrMod.Rectangle,
                    Vec2: ccMod.Vec2,
                    Zombie: zombieMod && zombieMod.Zombie,
                    FrontYard: frontYardMod && frontYardMod.FrontYard,
                    JamStyle: frontYardMod && frontYardMod.JamStyle,
                    destroyPooly: nodePoolsMod && nodePoolsMod.destroyPooly,
                    instantiatePooly: nodePoolsMod && nodePoolsMod.instantiatePooly,
                    Vec3: ccMod && ccMod.Vec3,
                    Component: ccMod && ccMod.Component,
                });
                if (pb) recs.push(...pb);
            }
            // ---- 22. 寒冰射手：冰锥（普攻 + 大招每发独立掷，薄荷 x3）----
            // ⚠️【即时生效改造】不再用 featOn 包住安装：补丁常驻，行为在钩子里运行期现查
            {
                const spf = makeSnowPeaFreezePatch(snowPeaMod && snowPeaMod.SnowPeaPlant,
                    shotMod && shotMod.commonShot,
                    { Square: squareMod.Square, Rectangle: charMgrMod.Rectangle, Vec2: ccMod.Vec2 });
                if (spf) recs.push(...spf);
            }
            // ---- 22b. 流星花：索敌策略（P0 只挂空补丁，行为与原版一致）----
            {
                const mf = makeMeteorFlowerAimPatch(meteorMod && meteorMod.MeteorFlowerPlant, {
                    Square: squareMod.Square, Rectangle: charMgrMod.Rectangle, Vec2: ccMod.Vec2,
                    // ⚠️ `ZombiePool` / `TombPool` 是 **CharacterManager.ts** 的导出（不是 Zombie.ts）
                    ZombiePool: charMgrMod && charMgrMod.ZombiePool,
                    TombPool: charMgrMod && charMgrMod.TombPool,
                    ZombieEnum: zombiesMod && zombiesMod.ZombieEnum,
                    // ★ 点燃门改造要用它读 solid/deck 的**真实数值**（绝不硬编码）
                    SquareType: squareMod && squareMod.SquareType,
                });
                if (mf) recs.push(...mf);
            }
            // ---- 22c. 孢子菇：亡语（1×3 伤害 + 感染标记 + 0.75s 眩晕）+ 亡语特效 ----
            //  ⚠️【即时生效改造】不用 featOn 包住安装：钩子常驻，内部运行期现查 featOn('sporeshroom')。
            {
                // 特效播放要用的实例化入口（模块级注入；与心蕊/魔音甜菜用的是同一个）
                try { gpnSporeInstantiateRef = (nodePoolsMod && nodePoolsMod.instantiatePooly) || null; } catch (e) { /* 忽略 */ }
                const sp = makeSporeShroomPatch(sporeMod && sporeMod.SporeShroomPlant, {
                    Square: squareMod && squareMod.Square,
                    Rectangle: charMgrMod && charMgrMod.Rectangle,
                    Vec2: ccMod && ccMod.Vec2,
                    // ★★ 这两个都在 **CharacterManager.ts**（不是 Zombie.ts）—— 踩过的坑
                    ZombieDamageDetails: charMgrMod && charMgrMod.ZombieDamageDetails,
                    ZombieDamageType: charMgrMod && charMgrMod.ZombieDamageType,
                    ZombiePool: charMgrMod && charMgrMod.ZombiePool,
                    jsonMod: jsonMod,
                });
                if (sp) recs.push(...sp);
                // 弹道钩子：缓存「引擎自己用的特效父节点」（只读观测）
                const sph = makeSporeShroomCommonShotHook(shotMod && shotMod.commonShot, {
                    Square: squareMod && squareMod.Square,
                });
                if (sph) recs.push(...sph);
                // 僵尸侧门禁：关掉开关 ⇒ 不生成孢子菇（开 ⇒ 走引擎原版逻辑）
                const spg = makeSporeShroomZombieGate(zombieMod && zombieMod.Zombie, {});
                if (spg) recs.push(...spg);
                // 亡语特效资源：**提前**加载好（首次进关卡时就绪，避免第一次亡语来不及）
                try { gpnSporeFxEnsure(null); } catch (e) { /* 忽略 */ }
            }
            // ---- 22d. 孢子菇 ×1.5（R6/R7）：带孢子标记的僵尸受**毒性家族**伤害 ×1.5（直伤 + Dot）----
            //  口径（用户定）：Poison 家族（数据判定）**减去** garlic / chilibean，
            //                 **加上** gloomshroom / shadowshroom（Shadow 家族，仅显式白名单）；
            //                 心蕊只算"子弹直击"（它的减防 debuff 本身不结算伤害）；
            //                 多段叠加 Dot = 该帧家族 Dot 合计只 ×1.5 一次。
            //  ⚠️【即时生效改造】不用 featOn 包住安装：钩子常驻，内部运行期现查 featOn('sporeshroom')。
            {
                const sb = makeSporePoisonBonusPatch({
                    Zombie: zombieMod && zombieMod.Zombie,
                    CommonShot: shotMod && shotMod.commonShot,
                    PrjFunctions: prjMod && prjMod.PrjFunctions,
                    Peashooter: peashooterMod && peashooterMod.PeashooterPlant,
                    ScaredyShroom: scaredyMod && scaredyMod.ScaredyShroomPlant,
                    CabbagePult: cabbagePultMod && cabbagePultMod.CabbagePultPlant,
                    FumeShroom: fumeShroomMod && fumeShroomMod.FumeShroomPlant,
                    Vamporcini: vamporciniMod && vamporciniMod.VamporciniPlant,
                    GloomShroom: gloomShroomMod && gloomShroomMod.GloomShroomPlant,
                    ShadowShroom: shadowShroomMod && shadowShroomMod.ShadowShroomPlant,
                    AilMint: ailMintMod && ailMintMod.AilMintPlant,
                    MariGold: mariGoldMod && mariGoldMod.MariGoldPlant,
                    GooFoodPrj: gooFoodMod && gooFoodMod.goopeaFoodPrj,
                    GooTileLiquid: gooTileMod && gooTileMod.GooTileLiquid,
                });
                if (sb) recs.push(...sb);
            }
            // ---- 23. 红针花：左键循环切换形态 ----
            {
                const rs = makeRedStingerPatch(redStingerMod && redStingerMod.RedStingerPlant, {
                    cc: ccMod, Rectangle: charMgrMod.Rectangle, Vec2: ccMod.Vec2,
                    Square: squareMod.Square, FrontYard: frontYardMod && frontYardMod.FrontYard,
                });
                if (rs) recs.push(...rs);
            }
            // ---- 24. 暗影夏威夷果：暗影态本体隐身（视觉）+ 暗影物质耐久 + 打光后真隐身 ----
            {
                const mk = makeMurkadamiaPatch(murkadamiaMod && murkadamiaMod.MurkadamiaNutPlant, {
                    cc: ccMod,
                });
                if (mk) recs.push(...mk);
            }
            // ---- 25. 裂荚射手：左键左右翻转 + 前后豌豆数对调 ----
            //  ⚠️【即时生效改造·样板】这里**不再**用 `featOn` 包住安装 ——
            //  补丁**永远装着**，行为在钩子内部**运行期现查** `featOn('splitpea')`。
            //  这样在游戏内配置界面改开关就能**立刻生效**（不需要退出游戏重进）。
            //  其它功能后续按同一套路逐个改造（阶段②）。
            {
                const sp = makeSplitPeaPatch(splitPeaMod && splitPeaMod.SplitPeaPlant, { cc: ccMod });
                if (sp) recs.push(...sp);
            }
            // ---- 20b. 寒冰射手：金卡（数据 + 显示两条路一起走）----
            //  ⚠️【即时生效改造】这里**不再**用 featOn 包住安装：
            //    · getBGAnm 钩子**常驻**，内部运行期现查 featOn('snowpea')；
            //    · 数据层（OBTAINWORLD）抽成 gpnSnowPeaGoldApply()，切换 snowpea 时立刻重刷。
            //  注意：**已经存在的卡片**不会自动重读 ⇒ 卡面在"进关卡 / 重开图鉴"重建卡面时随之变化
            //        （引擎里没有 refreshCard 之类的刷新入口，已核对）。
            try {
                const PM0 = plantsMod && plantsMod.plants;   // 模块导出名是小写 plants（踩过的坑）
                const res0 = PM0 && PM0.plantRes;
                const listPF = (res0 && res0.PlantFeatures) ? res0.PlantFeatures : [];   // ★ 快照一次
                if (listPF && typeof listPF.length === 'number' && listPF.length > 0) {
                    const sd0 = res0.PlantFeatures.find((x) => x && x.CODENAME === 'snowdrop');
                    const goldW = (sd0 && sd0.OBTAINWORLD) || 'market';
                    const vanW = (res0.PlantFeatures.find((x) => x && x.CODENAME === CFG.snowpea.plantType) || {}).OBTAINWORLD;
                    gpnSnowPeaGoldApply = function () {
                        try {
                            const on = featOn('snowpea');
                            // ⚠️ 实机报过 "PlantFeatures is not iterable" ⇒ 不用 for...of，改下标循环
                            for (let gi = 0; gi < listPF.length; gi++) {
                                const f = listPF[gi];
                                if (f && f.CODENAME === CFG.snowpea.plantType) f.OBTAINWORLD = on ? goldW : vanW;
                            }
                            log('寒冰射手：OBTAINWORLD -> ' + (on ? goldW + '（金卡）' : String(vanW) + '（还原）'));
                            return true;
                        } catch (e) { warn('寒冰射手：OBTAINWORLD 补丁出错', e); return false; }
                    };
                    gpnSnowPeaGoldApply();          // 启动时先应用一次
                } else {
                    warn('寒冰射手：拿不到 PlantFeatures（金卡改走显示层钩子）｜ len=' + (listPF ? listPF.length : 'n/a'));
                }
            } catch (e) { warn('寒冰射手：OBTAINWORLD 准备出错', e); }
            // 显示层兜底：包【植物管理类】的 getBGAnm（常驻 + 运行期现查）
            try {
                const PM = plantsMod && plantsMod.plants;
                if (PM && typeof PM.getBGAnm === 'function') {
                    const og = PM.getBGAnm;
                    PM.getBGAnm = function (feature, boosted) {
                        try {
                            if (featOn('snowpea') && feature && feature.CODENAME === CFG.snowpea.plantType) {
                                return { bg: CFG.snowpea.goldBg, golden: true, lod: false };
                            }
                        } catch (e) { /* 忽略 */ }
                        return og.apply(this, arguments);
                    };
                    recs.push({ Cls: PM, name: 'getBGAnm', original: og });
                    log('寒冰射手：金卡钩子（Plants.getBGAnm）已挂（运行期现查）');
                } else { warn('寒冰射手：Plants.getBGAnm 不在 —— 若数据路线也失败则卡面不变金'); }
            } catch (e) { warn('寒冰射手：金卡钩子出错', e); }

            // ---- 17. A2 星星果追击攻击 ----
            {
                const follow = makeStarFollowPatch(shotMod.commonShot, {
                    Square: squareMod.Square,
                    Vec2: ccMod.Vec2,
                    Plant: plantMod && plantMod.Plant,     // 「延迟窗口合并」大招取消钩子要挂 Plant.food

                    // 触发门要用：enemyType 判"是不是被弹反的子弹" + 三种护盾实体按 ID 认
                    CharacterType: characterMod.CharacterType,
                    ZombieEnum: zombiesMod && zombiesMod.ZombieEnum,
                });
                if (follow) recs.push(...follow);
            }

            // ---- 16. 甜椒投手：落点 3x3 灼烧 ----
            {
                const burn = makePepperBurnPatch(shotMod.commonShot, {
                    Square: squareMod.Square,
                    SquareType: squareMod.SquareType,
                    GroundFireColorEnum: groundFireMod.GroundFireColorEnum,
                    JalapenoFire: jalapenoMod.jalapenoFire,
                    // 注意：component（当前管理器实例）是【GroundFiresManager 类】的静态字段，
                    // 在 onLoad 里赋值 —— 跟 jalapeno 类没有关系。
                    GroundFiresManager: gfmMod && gfmMod.GroundFiresManager,
                    // 植物阵营的火（被弹反的甜椒弹）要用到这几样：
                    //   CharacterType       判 enemyType 是不是被翻成了 plant
                    //   CharacterManager    Rectangle（圈出"这一格"去判被催眠的僵尸）
                    //   ZombieDamageDetails 打被催眠僵尸用的伤害对象
                    CharacterType: characterMod.CharacterType,
                    CharacterManager: charMgrMod,
                    ZombieDamageDetails: charMgrMod.ZombieDamageDetails,
                    ZombieDamageType: charMgrMod.ZombieDamageType,
                    // 伞叶注册表（CharacterManager 上的静态数组）：被弹反的甜椒弹落地时按位置判定用
                    Umbrellas: charMgrMod.Umbrellas,
                    // 「是谁反弹的」两个类（独立模块）：只用来给子弹打来源标记 ⇒
                    //   弄臣反弹的 ⇒ 不再算投掷物（不吃伞叶）；三节棍反弹的 ⇒ 仍算投掷物（照旧可挡）
                    DarkJesterZombieCls: darkJesterMod && (darkJesterMod.DarkJesterZombie || darkJesterMod.default),
                    Abbot3SectionStaffCls: abbot3Mod && (abbot3Mod.Abbot3SectionStaffZombie || abbot3Mod.default),
                });
                if (burn) recs.push(...burn);
                // 卸载时把还没烧完的"植物阵营火"清掉（否则会留着已经销毁的格子引用）
                recs.push({ __onCleanup: function () { gpnPlantFires.length = 0; } });
            }

            // ---- 6. 甜薯：自回血 + 受到治疗加成 ----
            {
                const sweet = makeSweetPotatoPatch(plantMod.Plant);
                if (sweet) recs.push(...sweet);
            }

            // ---- 7. 白萝卜：受伤间隔（挂在扣血叶子上，不影响覆盖层）----
            {
                const turnip = makeTurnipPatch(plantMod.Plant);
                if (turnip) recs.push(turnip);
            }

            // ---- 8. 心蕊 DEBUFF -> 对心蕊/甜薯/热辣海枣的啃食伤害减免 ----
            {
                const victim = makeBloomingHeartVictimPatch(plantMod.Plant);
                if (victim) recs.push(victim);
            }

            // ---- 9. 香水菇：香水火 13.5 秒（原版 9）+ 施加 6 层心蕊 DEBUFF ----
            {
                const perfume = makePerfumeShroomPatch(perfumeMod.PerfumeFire, squareMod.Square,
                    zombieMod.Zombie, gfmMod.GroundFiresManager, buffCache);
                if (perfume) recs.push(...perfume);
                const perfumeDur = makePerfumeDurationPatch(perfumeShroomMod && perfumeShroomMod.PerfumeShroomPlant);
                if (perfumeDur) recs.push(...perfumeDur);   // 香水火时长 9 -> 13.5 秒

                // ---- 10. 取减防特效 prefab（异步，不阻塞 setup）----
                loadBloomingHeartBuffPrefab(ccMod, buffCache);
            }

            // ---- 13. 暗影油桃：毒气时长 x2 / 攻击 x0.5 ----
            {
                const noct = makeNoctarinePatch(noctarineMod.NoctarinePlant);
                if (noct) recs.push(noct);
                const gas = makeNoctarineGasPatch(gasMod.noctarineBuffParticle);
                if (gas) recs.push(gas);
            }

            // ---- 14. 腐尸豆荚：召唤权重 ----
            {
                const zoy = makeZoybeanPatch(zoybeanMod.ZoybeanPodPlant);
                if (zoy) recs.push(zoy);
            }

            // ---- 15. 蒲公英：额外一颗子弹 ----
            {
                const dan = makeDandelionPatch(dandelionMod.DandelionPlant, squareMod.Square, shotMod.commonShot, {
                    Square: squareMod.Square,
                    ZombieDamageDetails: charMgrMod && charMgrMod.ZombieDamageDetails,
                    ZombieDamageType: charMgrMod && charMgrMod.ZombieDamageType,
                    SkyDropShipZombie: skyShipMod && skyShipMod.SkyDropShipZombie,
                });
                if (dan) recs.push(...dan);
            }

            // ---- 12. 推植物：跳过「不可推」的挡路植物（不再飞出屏幕）----
            {
                const pushFix = makePushSkipPatch(charMgrMod.footballmech);
                if (pushFix) recs.push(...pushFix);
            }

            // ---- 11. 高坚果：同原始坚果，可扛 3 次巨人砸击 ----
            {
                // !! WallNut.ts 导出的名字是 WallNutPlant（大写 N），不是 WallnutPlant ——
                //    写错会拿到 undefined，补丁会「静默跳过」（v2.4.0 就是这个 BUG：扛 3 次砸击没生效）
                const wallNutCls = wallNutMod.WallNutPlant || wallNutMod.WallnutPlant;
                if (!wallNutMod.WallNutPlant && wallNutMod.WallnutPlant) {
                    warn('WallNut.ts 用的是备用导出名 WallnutPlant，请检查是否版本变动');
                }
                const tall = makeTallnutPatch(wallNutCls, primalMod.PrimalWallNutPlant, tallnutMod && tallnutMod.TallNutPlant);
                if (tall) { if (Array.isArray(tall)) recs.push.apply(recs, tall); else recs.push(tall); }
            // ---- 卷心菜投手：子弹首次命中后再弹 1 格（2026/10/22 用户指定）----
            {
                const cabRecs = makeCabbagePultPatch(
                    shotMod && shotMod.commonShot,
                    {
                        PrjFunctions: prjMod && prjMod.PrjFunctions,
                        Vec2: ccMod && ccMod.Vec2,
                        Square: squareMod && squareMod.Square,
                        CharacterType: characterMod && characterMod.CharacterType,
                    });
                if (cabRecs && cabRecs.length) recs.push.apply(recs, cabRecs);
            }
            }

            {
                const off = Object.keys(FEATURES_LIVE).filter((k) => !featOn(k) && k !== 'verboseLog');
                // 依赖：starfruit 关掉 ⇒ starfruitFollowMerge 一律视为关闭（运行时判定，绝不去改玩家的 features.json）。
                //   ① 把它也列进【已关闭】，玩家能看到"我没关它、它也关了"；
                //   ② 玩家【显式写了 true】时额外打一行黄色提示，解释为什么没生效。
                if (!featOn('starfruit') && off.indexOf('starfruitFollowMerge') === -1) {
                    off.push('starfruitFollowMerge');
                }
                log('开关状态：' + (off.length ? ('已关闭 ' + off.join('、')) : '全部开启'));
                if (!featOn('starfruit') && FEATURES_MERGE_EXPLICIT_TRUE) {
                    warn('提示：starfruit 已关闭 ⇒ starfruitFollowMerge视为关闭');
                }
            }

            const perTooth = Math.ceil(CFG.spikerock.maxSpike / CFG.spikerock.teeth);
            log('[CTM] BUILD = config-l90 ｜ 本行用于确认实机加载的代码版本 ｜ ' + new Date().toISOString());
            // ★ 图鉴文案总览（只读设施）就绪提示：**只在 verboseLog 打开时打一行**，不刷屏。
            //   要详情就在 F12 控制台执行：gpnAlmDumpAll() / gpnAlmDumpOne('starfruit')
            if (verboseOn()) {
                try {
                    const _ao = gpnAlmOverview();
                    if (_ao && !_ao.error) {
                        log('【图鉴文案总览】已就绪：图鉴共 ' + _ao.total + ' 条 ｜ 我们改过 '
                            + _ao.changed.length + ' 株 ｜ 详情请执行 gpnAlmDumpAll()');
                    } else {
                        log('【图鉴文案总览】暂不可用（' + ((_ao && _ao.error) || '数据容器未就绪') + '）');
                    }
                } catch (eAO) { /* 只影响这一行日志 */ }
            }
            log('已加载 v' + MOD_VERSION + '：'
                + '巴豆(' + (CFG.chilibean.fullFartForEveryEater ? '每只完整' : '其余静默') + ')、'
                + '钢地刺(阳光' + CFG.spikerock.sunCost + '/承受' + CFG.spikerock.maxSpike + '次/每' + perTooth
                + '次掉牙/冷却' + CFG.spikerock.cooldown + '秒)、'
                + '心蕊(1x' + CFG.bloomingheart.splashWidthTiles + ' debuff)、'
                + '暗影龙葵(阳光' + CFG.nightshade.sunCost + '/穿透' + gpnPierceText(CFG.nightshade.pierceTargets)
                + (CFG.nightshade.shadowOnlyPierce ? '(仅暗影态)' : '')
                + '/击退' + CFG.nightshade.knockbackDistance + ')、'
                + '白萝卜(' + CFG.turnip.damageGateSeconds + 's 受伤间隔)、'
                + '甜薯(自回血' + CFG.sweetpotato.selfHealPerSecond + '/秒'
                + (CFG.sweetpotato.selfHealAlsoDoubled ? '×' + CFG.sweetpotato.healReceivedMultiplier : '')
                + '，受治疗×' + CFG.sweetpotato.healReceivedMultiplier + ')、'
                + '心蕊啃食减伤(心蕊×' + CFG.bloomingheart.victimDamageScale.bloominghearts
                + '/甜薯·海枣×' + CFG.bloomingheart.victimDamageScale.sweetpotato + ')、'
                + '香水菇(' + CFG.perfumeshroom.layers + '层心蕊DEBUFF/火' + CFG.perfumeshroom.fireDuration + '秒)、'
                + '高坚果(免疫位移+扛3次砸击+冷却' + CFG.tallnut.cooldown + '秒)、'
                + '星星果系(阳光' + CFG.starfruit.sunCost + '/天使' + CFG.starfruit.pinkSunCost
                + '/流星' + CFG.starfruit.shootingSunCost
                + '/普攻打中：星星果' + gpnPierceN(CFG.starfruit.pierceTargets) + '个、天使'
                + gpnPierceN(CFG.starfruit.pinkPierceTargets) + '个、流星'
                + (gpnPierceN(CFG.starfruit.shootingPierceTargets) === 1
                    ? '不穿透' : gpnPierceN(CFG.starfruit.shootingPierceTargets) + '个')
                + '/溅射'
                + Math.round(CFG.starfruit.splashRatio * 100) + '%(流星果'
                + Math.round(CFG.starfruit.splashRatioShooting * 100) + '%)'
                + (CFG.starfruit.followEnabled
                    ? '/追击' + Math.round(CFG.starfruit.followDamageRatio * 100) + '%打中'
                        + gpnFollowPierce() + '个·溅射'
                        + Math.round(CFG.starfruit.followSplashRatio * 100) + '%'
                        + (gpnFollowMergeOn() ? '/延迟窗口合并' + CFG.starfruit.followMergeWindow + '秒' : '')
                    : '') + ')、'
                + '暗影油桃(伤害x' + CFG.noctarine.damageScale + ')、'
                + '腐尸豆荚(召唤权重)、'
                + '蒲公英(每次+' + CFG.dandelion.extraShots + '颗/延迟' + CFG.dandelion.extraDelay + '秒/阳光'
                + CFG.dandelion.sunCost + '/对飞行×' + CFG.dandelion.flyingDamageScale + '·眩晕'
                + CFG.dandelion.flyingStun + '/' + CFG.dandelion.plantfoodFlyingStun + '秒'
                + (CFG.dandelion.pbDriveDropShip ? '/大招驱离运兵艇(' + CFG.dandelion.pbDriveMode + ')' : '') + ')、'
                + '飓风甘蓝(其他行推力' + Math.round(CFG.hurrikale.otherLanePushScale * 100) + '%'
                + '/全屏吹飞/特效同行)、'
                + '玉米投手(黄油落地留油' + CFG.kernelpult.tileLiquidDuration + '秒/大招' + CFG.kernelpult.tileLiquidDurationPlantfood + '秒)、'
                + '卷心菜投手(子弹首次命中再弹' + CFG.cabbagepult.bounceCells + '格/同伤害/阳光' + CFG.cabbagepult.sunCost + ')、'
                + '甜椒投手(阳光' + CFG.pepperpult.sunCost + '/冷却' + CFG.pepperpult.packetCooldown
                + '秒/落点3x3灼烧' + CFG.pepperpult.burnSeconds + '秒/'
                + (CFG.pepperpult.burnArmorProtection ? '不穿甲' : '穿甲') + ')、'
                + '魔音甜菜(普攻眩晕' + CFG.phatbeet.normalStun + '秒'
                + '/普攻免疫音乐' + CFG.phatbeet.normalJamClearSeconds + '秒'
                + '/大招眩晕' + CFG.phatbeet.plantfoodStun
                + '秒+原地击起/解除安抚/音乐免疫' + CFG.phatbeet.jamClearSeconds + '秒'
                + ((CFG.phatbeet.clearFx || CFG.phatbeet.jamFx) ? '/命中特效' : '') + ')、'
                + '大蒜(啃食' + CFG.garlic.eatDamage + '/阳光' + CFG.garlic.sunCost
                + '/冷却' + CFG.garlic.cooldown + '秒)、'
                + '寒冰射手(子弹冰减速/冰锥' + Math.round(CFG.snowpea.freezeChance * 100)
                + '%(薄荷×' + CFG.snowpea.mintChanceFactor + ')/冻结' + CFG.snowpea.freezeDuration
                + '秒+单格' + CFG.snowpea.splashFreezeDuration + '秒/金卡)、'
                + '红针花(阳光' + CFG.redstinger.sunCost + '/承伤×' + CFG.redstinger.tier1 + '·×' + CFG.redstinger.tier2
                + (CFG.redstinger.clickSwitch ? '/左键切形态' : '') + ')、'
                + '暗影夏威夷果(暗影态本体' + Math.round(CFG.murkadamia.shadowBodyAlpha * 100) + '%透明'
                + '/暗影物质上限' + (CFG.murkadamia.jellyBaseHp + CFG.murkadamia.jellyBonusHp)
                + '·冷却' + CFG.murkadamia.jellyCooldown + '秒'
                + (CFG.murkadamia.hideWhenJellyDown ? '/打光后真隐身' : '') + ')、'
                + '裂荚射手(左键左右翻转/前后豌豆对调/阳光' + CFG.splitpea.sunCost + ')、'
                // ↓ 2026/10/16 补：这两项上线时漏进了启动摘要（F12 里没法一眼核对），现在补上。
                //   顺序与 FEATURES 表一致（splitpea → meteorflowerAim → sporeshroom）。
                + '流星花(索敌：本行僵尸→全场僵尸→本行障碍/护盾→全场障碍/护盾；第2颗不打歪；纯墓碑场面也开火)、'
                + '孢子菇(阳光' + CFG.sporeshroom.sunCost + '/血量' + CFG.sporeshroom.toughness
                + '/亡语' + (CFG.sporeshroom.deathRadiusTiles > 0 ? CFG.sporeshroom.deathRadiusTiles : 3)
                + '格(标记' + (CFG.sporeshroom.deathMarkRows || 1) + '×' + (CFG.sporeshroom.deathMarkCols || 3) + ')'
                + '·伤害=普攻×' + CFG.sporeshroom.deathDamageScale
                + '(' + (CFG.sporeshroom.deathDamageByPea.sporeshroom_spore * CFG.sporeshroom.deathDamageScale)
                + '·' + (CFG.sporeshroom.deathDamageByPea.sporeshroom_spore1 * CFG.sporeshroom.deathDamageScale)
                + '·' + (CFG.sporeshroom.deathDamageByPea.sporeshroom_spore2 * CFG.sporeshroom.deathDamageScale) + ')'
                + '/眩晕' + CFG.sporeshroom.deathStun + '秒/感染/毒性家族×' + CFG.sporeshroom.poisonBonus
                + '/特效)、'
                + '推植物跳过挡路者(' + (CFG.pushPlant.skipBlockers ? '开' : '关') + ')');

            return function cleanup() {
                // ★ 先停下"本实例的活动"（轮询 / 点击 / 存盘），再做原型还原。
                //   为什么关键：GP-NEXT「保存并重载」时旧运行时会被 dispose，但我们没注册清理，
                //   旧代码会继续跑（继续操作界面、继续存盘）⇒ 与新运行时并行 ⇒ 开关错乱。
                gpnDisposed = true;
                try { if (typeof gpnCfgTimer !== 'undefined' && gpnCfgTimer) clearInterval(gpnCfgTimer); } catch (e) { /* 忽略 */ }
                // !! 必须【倒序】还原：同一个方法可能被多个补丁层层包裹
                //    （例如 commonShot.dealDamageToZombie 被"甜椒灼烧"和"星星果追击"各包了一层），
                //    正序还原会把先包的那层包装重新装回去 = 卸载后补丁还在。
                for (const rec of recs.slice().reverse()) {
                    if (rec.__dataPatch) rec.__dataPatch.revert();
                    else if (typeof rec.__onCleanup === 'function') {
                        try { rec.__onCleanup(); } catch (e) { warn('卸载清理项出错', e); }
                    } else restore(rec);
                }
                log('已还原。');
            };
        }).catch((err) => {
            console.error('[' + MOD_ID + '] Setup failed:', err);
        });
    },
};

