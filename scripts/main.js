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
const MOD_VERSION = '1.0.0';


/* =========================================================================
 * 功能开关 —— 从同目录的 features.json 读取
 *   · 改完必须【完全退出游戏再重新启动】才生效（按 Save & Reload 没用）
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
    // ↓ 下面这几个以前【忘了登记】：features.json 里写了 false 也不会生效（featOn 找不到这个键 -> 当成开）
    phatbeet: true,         // 魔音甜菜：普攻眩晕 / 大招眩晕+击起 / 解除安抚 / 音乐免疫
    garlic: true,           // 大蒜：每口固定伤害 37.5 / 阳光 75 / 冷却 15 秒
    snowpea: true,          // 寒冰射手：单格冰减速 + 概率冰锥（冻结）
    redstinger: true,       // 红针花：承伤 ×0.25 / ×0.125 + 左键切形态
    murkadamia: true,       // 暗影夏威夷果：暗影态本体隐身 / 暗影物质 5000
    splitpea: true,         // 裂荚射手：左键左右翻转 / 前后豌豆对调
    // ↓ 诊断日志总开关：★注意★ 它在表里登记成 false —— 日志开关故意和别的开关【反着来】：
    //   · 只有 features.json 里显式写 true 才开；写 false / 删掉 / 整个文件读不到 ⇒ 一律【关】；
    //   · 打开后 = 所有"每次触发一条"的诊断日志（各功能的 debugLog）全部回来，方便排查。
    verboseLog: false,      // 诊断日志总开关（默认关；排查时把 features.json 里的 verboseLog 改成 true）
};

/** 只有【显式写了 false】才算关；键不存在 / 不是布尔 -> 按开 */
function featOn(name) { return FEATURES[name] !== false; }

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
            for (const k of Object.keys(FEATURES)) {
                if (obj[k] === true || obj[k] === false) FEATURES[k] = obj[k];
            }
            FEATURES_MERGE_EXPLICIT_TRUE = (obj.starfruitFollowMerge === true);
            const off = Object.keys(FEATURES).filter((k) => !featOn(k) && k !== 'verboseLog');
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
        cooldown: 15,      // 种植冷却秒数（改成 15 秒）
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
    perfumeshroom: {
        plantType: 'perfumeshroom',
        layers: 6,                                     // 香水火对每只僵尸施加 6 层心蕊 DEBUFF（引擎 damageScale 每层 ×1/0.9）
        fireDuration: 13.5,                            // 香水火持续时间（秒）—— 原版【硬编码 9 秒】在 PerfumeShroomPlant 的攻击载荷里
        // 心蕊普攻子弹在 resources bundle 里的路径 —— 用来取那个减防特效 prefab
        buffPrjPath: 'projectiles/BloomingHeart0PRJ',
        debugLog: false,
    },
    tallnut: {
        plantType: 'tallnut',
        // 同原始坚果：每次砸击扣 25% 最大血，25% 及以下时再挨一下就死
        // ⇒ 满血能扛住 3 次巨人砸击，第 4 次死
        smashHpFraction: 0.25,
        cooldown: 30,                  // v2.8.2 新增：种植冷却 20 -> 30 秒（引擎字段是 Cooldown）
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
        normalStun: 0.1,               //   普攻使命中的僵尸眩晕几秒
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
        sunCost: 200,                  //   阳光消耗（原版 150 ⇒ 本次 150 -> 200）
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
function normalizeType(t) {
    return (typeof t === 'string') ? t.toLowerCase().replace(/[^a-z0-9]/g, '') : '';
}

/** 打补丁前先登记原方法 + 它是不是自有属性 */
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
/** 数字 -> 中文（图鉴文本用；1~10 用汉字，其它回落到阿拉伯数字） */
const GPN_ZH_NUM = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
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
    return (n >= 0 && n <= 10) ? GPN_ZH_NUM[n] : String(n);
}

/** 穿透文案专用的中文数字：2 写成「两」（量词习惯：穿透两个目标），其余沿用 gpnZhNum */
function gpnPierceZh(n) {
    return (Math.round(n) === 2) ? '两' : gpnZhNum(n);
}

function makeDataPatcher(PvZ2ObjectContainer) {
    const undo = [];

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
        const list = PvZ2ObjectContainer[listName];
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
        if (PvZ2ObjectContainer && Array.isArray(PvZ2ObjectContainer.PlantAlmanac)) {
            const AL = PvZ2ObjectContainer.PlantAlmanac;
            const findAl = (alias) => {
                for (const e of AL) {
                    if (e && Array.isArray(e.aliases) && e.aliases.indexOf(alias) !== -1) return e;
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
                return e ? setLoc(e.objdata, 'Introduction', zh, en) : false;
            };
            const writeBrief = (alias, zh, en) => {
                const e = findAl(alias);
                return e ? setLoc(e.objdata, 'BriefIntroduction', zh, en) : false;
            };
            const addSpecial = (alias, zh, en) => {
                const e = findAl(alias);
                if (!e || !e.objdata) return false;
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
                if (typeof zhSuffix === 'string' && d.zh.indexOf(zhSuffix) === -1) {
                    track(d, 'zh'); d.zh = d.zh + zhSuffix;
                }
                if (typeof enSuffix === 'string' && typeof d.en === 'string'
                    && d.en.indexOf(enSuffix) === -1) {
                    track(d, 'en'); d.en = d.en + enSuffix;
                }
                if (dbgOn(CFG.splitpea.debugLog)) log('图鉴：' + alias + ' 的「' + hitNeedle + '」在 ' + hit.path + '，已追加');
                return true;
            };

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
                    + 'Blooming Heart ×' + P50 + '%, Sweet Potato / Hot Date ×' + P75 + '%');
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
                                + '个目标,溅射伤害继承比略微提高，且极短时间眩晕目标'
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
                            '追击在' + CFG.starfruit.followMergeWindow + ' 秒内被多次触发时只追一次，每颗弹伤害 = '
                            + ST_R + '% × Σ(各次触发时的攻击力)',
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
                addSpecial('noctarine', '造成伤害仅为攻击力的' + NO_DMG + '%，但毒气持续时间×' + NO_DUR + '%',
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
                    + CFG.pepperpult.burnSeconds + ' 秒。单次火焰总伤害为子弹的'
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
                const PB_N = CFG.phatbeet.normalStun;
                const PB_F = CFG.phatbeet.plantfoodStun;
                const PB_J = CFG.phatbeet.jamClearSeconds;
                addSpecial('phatbeet', '普通攻击使命中的僵尸眩晕 ' + PB_N + ' 秒',
                    'Its normal attack stuns the zombies it hits for ' + PB_N + ' second(s).');
                addSpecial('phatbeet', '可以解除伤害范围内音响僵尸对植物施加的安抚',
                    'Removes the soothing effect that Boombox Zombies inflict on plants within its damage range.');
                addSpecial('phatbeet', '大招使命中的僵尸眩晕 ' + PB_F + ' 秒并向上击起，并令命中僵尸不受魔音舞台效果影响，持续 ' + PB_J + ' 秒',
                    'Its Plant Food stuns the zombies it hits for ' + PB_F + ' second(s) and knocks them'
                    + ' upward, and frees the hit zombies from the current Jam Stage Effect for ' + PB_J + ' second(s).');
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
        }

        return true;
    };

    const apply = () => {
        // 钢地刺：降价 + 打击次数 3 -> 9
        if (featOn('spikerock')) {
            setField('PlantProps', 'spikerock', 'SunCost', CFG.spikerock.sunCost);
            setField('PlantProps', 'spikerock', 'MaxSpike', CFG.spikerock.maxSpike);
            setField('PlantProps', 'spikerock', 'Cooldown', CFG.spikerock.cooldown);
        }
        // 暗影龙葵：涨价
        if (featOn('nightshade')) {
            setField('PlantProps', 'nightshade', 'SunCost', CFG.nightshade.sunCost);
        }
        // 高坚果：免疫位移。这是原版字段，vanilla 里只有 turnip(白萝卜) 和 gravebuster 开了它。
        // 注意【不要】动 canBeChied()：那个开关是「整体打断气功 + 保护身后」，不是我们要的。
        // 只开这个字段的效果 = 橄榄车/抛掷/舞王推/渔夫钩 全部无效，但气功照常对其它植物生效、
        //                        高坚果自己原地不动（pushPlantLeft 对它的格子返回 false）。
        // 时空黑洞(ChiHole) 走的是 canBeChied()，不看这个字段 ⇒ 高坚果照样被吸走，符合预期。
        if (featOn('tallnut')) {
            setField('PlantProps', CFG.tallnut.plantType, 'CannotBePushedByFootballMech', true);
            // v2.8.2：种植冷却 20 -> 30 秒
            if (CFG.tallnut.cooldown > 0) {
                setField('PlantProps', CFG.tallnut.plantType, 'Cooldown', CFG.tallnut.cooldown);
            }
        }

        // 星星果系：阳光 + 12 条弹道的穿透/溅射
        if (featOn('starfruit')) {
            // !! v2.8.2 补：CFG 里一直有 sunCost:125，但【从来没有写进数据】——
            //    v2.8.1 之前游戏里星星果一直是 150 阳光。这里补上。
            setField('PlantProps', 'starfruit', 'SunCost', CFG.starfruit.sunCost);
            // 本次：天使星星果 175 阳光、流星果 550 阳光（原版 500）+ 种植冷却 10 秒
            setField('PlantProps', 'pinkstarfruit', 'SunCost', CFG.starfruit.pinkSunCost);
            setField('PlantProps', 'shootingstarfruit', 'SunCost', CFG.starfruit.shootingSunCost);
            setField('PlantProps', 'shootingstarfruit', 'Cooldown', CFG.starfruit.shootingCooldown);
            const STAR_PRJ = ['star', 'star1', 'star2', 'star_pf',
                'pinkstar', 'pinkstar1', 'pinkstar2', 'pinkstar_pf',
                'shootingstar', 'shootingstar1', 'shootingstar2', 'shootingstar_pf'];
            const list = PvZ2ObjectContainer.ProjectileProps;
            if (Array.isArray(list)) {
                for (const e of list) {
                    if (!e || !Array.isArray(e.aliases)) continue;
                    if (!e.aliases.some((a) => STAR_PRJ.indexOf(a) !== -1)) continue;
                    if (!e.objdata) e.objdata = {};
                    const put = (key, value) => { track(e.objdata, key); e.objdata[key] = value; };
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
        if (featOn('dandelion')) {
            setField('PlantProps', 'dandelion', 'SunCost', CFG.dandelion.sunCost);
            const DANDELION_KIND = { dandelion: 'normal', dandelion_blew: 'blew', dandelion_pf: 'pf' };
            const dlist = PvZ2ObjectContainer.ProjectileProps;
            if (Array.isArray(dlist)) {
                for (const e of dlist) {
                    if (!e || !Array.isArray(e.aliases)) continue;
                    for (const a of e.aliases) {
                        const kind = DANDELION_KIND[a];
                        if (!kind) continue;
                        if (!e.objdata) e.objdata = {};
                        track(e.objdata, DANDELION_KIND_KEY);
                        e.objdata[DANDELION_KIND_KEY] = kind;
                    }
                }
            }
        }
        // ---- 魔音甜菜：阳光（改回原版 150）----
        if (featOn('phatbeet')) {
            setField('PlantProps', CFG.phatbeet.plantType, 'SunCost', CFG.phatbeet.sunCost);   // 魔音甜菜 阳光：改回原版 150
        }
        // ---- 大蒜：每口固定伤害 / 阳光 / 冷却（引擎字段就是 ReceivesDamageWhenEaten、Cooldown）----
        if (featOn('garlic')) {
            setField('PlantProps', CFG.garlic.plantType, 'ReceivesDamageWhenEaten', CFG.garlic.eatDamage);
            setField('PlantProps', CFG.garlic.plantType, 'SunCost', CFG.garlic.sunCost);
            setField('PlantProps', CFG.garlic.plantType, 'Cooldown', CFG.garlic.cooldown);
        }
        // ---- 红针花：承伤倍率（越小越肉）+ 半防御半攻击形态的子弹击退 ----
        if (featOn('redstinger')) {
            setField('PlantProps', CFG.redstinger.plantType, 'DamageScale1', CFG.redstinger.tier1);
            setField('PlantProps', CFG.redstinger.plantType, 'DamageScale2', CFG.redstinger.tier2);
            setField('PlantProps', CFG.redstinger.plantType, 'SunCost', CFG.redstinger.sunCost);
            // 击退：inArea1（半防御半攻击）专用弹道是 redstinger_weak ——
            //   引擎 RedStinger.animationListener 里 inArea==1 时走 PeaTypeWeak，别名就是它，别的形态/植物都不用这条 ⇒
            //   直接写数据即可（引擎在 specialOnObjdataSet 里把这三个字段搬到子弹上，命中时自己调 knockBack）。
            //   两个附加字段与「飞天豌豆 / 暗影龙葵」同一口径：地面推不挑飞 + 不打断已有击退。
            {
                const plist = PvZ2ObjectContainer.ProjectileProps;
                if (Array.isArray(plist)) {
                    for (const e of plist) {
                        if (!e || !Array.isArray(e.aliases)) continue;
                        if (e.aliases.indexOf('redstinger_weak') === -1) continue;
                        if (!e.objdata) e.objdata = {};
                        const put = (key, value) => { track(e.objdata, key); e.objdata[key] = value; };
                        put('KnockbackDistance', CFG.redstinger.knockbackDistance);
                        put('CancelsKnockbackFlying', true);
                        put('CannotInterruptOtherKnockback', true);
                    }
                }
            }
        }
        // ---- 裂荚射手：阳光【显式写回原版 200】（原注释错写成「200 -> 225」；写一遍防被别的 mod 改掉）----
        if (featOn('splitpea')) {
            setField('PlantProps', CFG.splitpea.plantType, 'SunCost', CFG.splitpea.sunCost);
        }
        // ---- 寒冰射手：单格范围冰减速 + 概率冰锥（伤害跟随寒冰射手）----
        if (featOn('snowpea')) {
            const SP = CFG.snowpea, PC = PvZ2ObjectContainer;   // 容器是 makeDataPatcher 的入参
            const pea = (PC.ProjectileProps || []).find((x) => x && (x.aliases || []).indexOf(SP.peaType) !== -1);
            const peaDmg = pea && pea.objdata ? pea.objdata.Damage : null;
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
        }
        // 甜椒投手：阳光 + 种植冷却 + 灼烧标记
        if (featOn('pepperpult')) {
            setField('PlantProps', 'pepperpult', 'SunCost', CFG.pepperpult.sunCost);
            // !! v2.8.2 修：真实字段叫 Cooldown，不叫 PacketCooldown ——
            //    之前写错了名字，等于凭空加了个没人读的字段，游戏里冷却一直是 20 秒。
            setField('PlantProps', 'pepperpult', 'Cooldown', CFG.pepperpult.packetCooldown);
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
                    e.objdata[BURN_RATIO_KEY] = CFG.pepperpult.burnTotalRatio;
                    pepHit++;
                }
                if (!pepHit) {
                    warn('甜椒灼烧：一条弹道都没匹配上，灼烧不会生效（期望别名：' + want.join(',') + '）');
                }
            }
        }

        // 暗影油桃：阳光 + 数据驱动的「爆炸」伤害
        if (featOn('noctarine')) {
            setField('PlantProps', 'noctarine', 'SunCost', CFG.noctarine.sunCost);
            // 注意：油桃有【两个】伤害来源 —— 数据里的 Actions 爆炸（一次性）和毒气云每跳伤害。
            // v2.5.0 只改了后者，所以实测还是掉 20。这里把爆炸也一起减半。
            const plist = PvZ2ObjectContainer.PlantProps;
            if (Array.isArray(plist)) {
                for (const e of plist) {
                    if (!e || !Array.isArray(e.aliases) || e.aliases.indexOf('noctarine') === -1) continue;
                    const acts = e.objdata && e.objdata.Actions;
                    if (!Array.isArray(acts)) continue;
                    for (const act of acts) {
                        if (!act || typeof act.Damage !== 'number' || act.Damage <= 0) continue;
                        track(act, 'Damage');            // track 对任意对象都适用
                        act.Damage = act.Damage * CFG.noctarine.damageScale;
                    }
                }
            }
        }

        // 龙葵 6 条弹道：穿透标记（+ 地面推的两个辅助字段）
        // 注意：击退【不在这里】—— 它是逐发按暗影态在 _shoot 里设的（见 makeNightShadePatch），
        //       否则非暗影态的子弹也会带击退（v2.4.2 的 BUG）。
        const prjs = PvZ2ObjectContainer.ProjectileProps;
        if (featOn('nightshade') && Array.isArray(prjs) && prjs.length) {
            for (const e of prjs) {
                if (!e || !Array.isArray(e.aliases)) continue;
                if (!e.aliases.some((a) => typeof a === 'string' && a.indexOf('nightshade') === 0)) continue;
                if (!e.objdata) e.objdata = {};
                const put = (key, value) => { track(e.objdata, key); e.objdata[key] = value; };
                put('CancelsKnockbackFlying', true);          // 与飞天豌豆一致：地面推，不挑飞
                put('CannotInterruptOtherKnockback', true);   // 与飞天豌豆一致：不打断已有击退
                // 穿透数同样走统一钳制（小数向下取整 / < 1 ⇒ 1）；1 = 不穿透 ⇒ 干脆不写标记
                const nsPierce = gpnPierceN(CFG.nightshade.pierceTargets);
                if (nsPierce >= 2) put(PIERCE_KEY, nsPierce);
                else { track(e.objdata, PIERCE_KEY); delete e.objdata[PIERCE_KEY]; }
            }
        }
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

    return { apply, revert };
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
        if (this.__gpnQuiet) { quietKill(this); return; }
        return originals.fart.call(this, stunDuration, poison);
    };
    Zombie.prototype.chilibeanFart = patchedFart;
    recs.push({ Cls: Zombie, name: 'chilibeanFart', original: originals.fart });

    /** 对巴豆免疫吗？判据一：重写过 chilibeanFart（引擎的原生免疫机制）；判据二：补漏名单 */
    const extraMechRe = /^(kongfu_bronze_strong|kongfu_bronze_chi|kongfu_bronze_chi_without_torch|kongfu_bronze_hook)$/;
    const arbiterRe = /arbiter/i;
    const isImmune = (z) => {
        if (!z || typeof z.chilibeanFart !== 'function') return true;
        if (z.chilibeanFart !== patchedFart) return true;
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

    ChiliBean.prototype.specialPlantOnEaten = function (dmg, zombie, hpBefore, hpAfter) {
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
    };
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

    SpikerockPlant.prototype.setSpikeSlot = function (remain) {
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
    };
    return { Cls: SpikerockPlant, name: 'setSpikeSlot', original };
}

/* =========================================================================
 * 4. 心蕊：debuff 由单体改成 1x3
 * =======================================================================*/
function makeBloomingHeartPatch(Shot, Rectangle, Square) {
    if (!Shot || !Shot.prototype || typeof Shot.prototype.beforeZombieHit !== 'function') {
        warn('跳过心蕊：拿不到 beforeZombieHit');
        return null;
    }
    if (!Rectangle || !Square) { warn('跳过心蕊：拿不到 Rectangle / Square'); return null; }
    const original = Shot.prototype.beforeZombieHit;

    Shot.prototype.beforeZombieHit = function (zombie) {
        if (!zombie || !zombie.inLnC || !zombie.inLane) return original.call(this, zombie);

        // 以命中目标所在格为中心、同排 3 格宽的判定框
        const rec = Rectangle.createRectangleNodeCenter(
            zombie.inLnC.node,
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
    };
    return { Cls: Shot, name: 'beforeZombieHit', original };
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

    NightShadePlant.prototype._shoot = function (isFood) {
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
    };
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
    Plant.prototype.heal = function (amount) {
        if (this.Plant_Type === KEY) {
            const mult = CFG.sweetpotato.healReceivedMultiplier;
            if (mult > 0 && mult !== 1 && typeof amount === 'number') amount *= mult;
            if (dbgOn(CFG.sweetpotato.debugLog)) log('甜薯 heal → ' + amount);
        }
        return recHeal.original.call(this, amount);
    };

    // ---- B. 每秒自回血（挂在基类 characterUpdate 上，甜薯没有重写它）----
    Plant.prototype.characterUpdate = function (dt) {
        const r = recUpdate.original.call(this, dt);
        if (this.Plant_Type === KEY && !this.dead) {
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

    Plant.prototype.defaultDealNormalDamage = function (dmg, type) {
        if (this.Plant_Type === KEY) {
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
function makeTallnutPatch(WallNut, PrimalWallNut) {
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

    WallNut.prototype.normalSmash = function (attacker) {
        if (normalizeType(this.Plant_Type) !== KEY) return rec.original.call(this, attacker);
        if (primal) return primal.call(this, attacker);
        // 兜底内联（PrimalWallNut 没导入成功时）
        if (this.fooding || this.invincible) return;
        if (this.armorHealth > 0) { this.armorHealth = 0; this.foodable = true; this.setArmor(); return; }
        const q = this.toughness * CFG.tallnut.smashHpFraction;
        let hp = this.health;
        while (hp - q > 0) hp -= q;
        this.dealNormalDamage(hp);
    };
    return rec;
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
    NoctarinePlant.prototype.explode = function () {
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
    };
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
    ZoybeanPodPlant.prototype.summon = function () {
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
    };
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

function makeDandelionPatch(DandelionPlant, Square, CommonShot) {
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

    return out;
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
function gpnPepperBurnAt(shot, deps, cellOverride) {
    const { Square, SquareType, GroundFireColorEnum, JalapenoFire, GroundFiresManager } = deps;
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

    // ★★ 伞叶 / 回旋镖射手：被弹反的甜椒弹是【投掷物】，本来就该被它们挡住。
    //    引擎为什么挡不住：`Plant.dealDamage` 里那条"伞叶吸收"只在【伤害类型 1】时才走，
    //    而类型是这么定的 —— `this.bodyLinearVelocity < 0 ? 1 : 2`（只有"正在下落"才算投掷物）。
    //    可弹反（三节棍 / 小丑）偏偏会 `bodyLinearVelocity *= -1` ⇒ 下落的弹变成"上升" ⇒ 类型 2 ⇒ 伞叶判定整条被跳过。
    //    这里把两条判定都补回来（只有 plantSide = 被弹反的投掷物才查，直线弹一律不查）：
    //      ① 按位置：子弹落在【注册进 Umbrellas 的伞叶】检测框内 ⇒ 整发被弹开（只有伞叶会注册，回旋镖不注册 ⇒ 削弱版）
    //      ② 按植物：由调用方（dealDamageToPlant 钩子）先查"目标植物 3×3 内有没有 umbrella()" ⇒ 见 gpnUmbrellaAbsorbs
    //    一旦被挡：打上标记 ⇒ 后面所有入口（再撞植物 / 落地 / 打障碍物）都不再产生任何火。
    if (plantSide) {
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
    let cell = (cellOverride && typeof cellOverride.get3x3 === 'function') ? cellOverride : shot.inLnC;
    if (!cell && Square && typeof Square.getLnC === 'function'
        && shot.lIndex >= 0 && shot.cIndex >= 0) {
        cell = Square.getLnC(shot.lIndex, shot.cIndex);
    }

    const fires = [];
    // 要铺火的格子：
    //   正常     = 落点格的 get3x3()（9 格）
    //   落点拿不到 = 直接按子弹坐标铺 3x3
    // v2.8.3 修：打到「最右列【右边一格】的场外目标」时，getLnC 会返回空 ——
    //   以前这里直接 return，导致【整片火都不生成】（不是场内部分没火，是一片都没有）。
    //   现在按坐标铺 3x3：场外格 addGroundFire 自己会拒绝，3x3 里【场内那部分照常出火】。
    let cells = (cell && typeof cell.get3x3 === 'function') ? cell.get3x3() : null;
    if (!cells || !cells.length) cells = gpnBurnCellsByCoord(shot, Square);
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
        if (skipped) {
            warn('甜椒灼烧：3x3 里 ' + skipped + ' 格是天空/海面，剩下拿不到格子，这次不铺火');
        } else {
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
        warn('甜椒灼烧：拿不到 GroundFiresManager.component（火已铺出，但不会有伤害）');
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
    const recs = [];

    // 命中目标 -> 烧
    if (typeof CommonShot.prototype.dealDamageToZombie === 'function') {
        const rec = methodRecord(CommonShot, 'dealDamageToZombie');
        CommonShot.prototype.dealDamageToZombie = function (z, isDirect) {
            const r = rec.original.apply(this, arguments);
            try {
                // isDirect === false 的是溅射伤害，不重复烧
                if (isDirect !== false && this.__gpnBurnRatio > 0) gpnPepperBurnAt(this, deps);
            } catch (e) { warn('甜椒灼烧(命中)出错', e); }
            return r;
        };
        recs.push(rec);
    } else {
        warn('跳过甜椒灼烧：commonShot 上没有 dealDamageToZombie');
    }

    // 触地 -> 烧（引擎在 hitFloor 里调 specialOnGroundHit）
    if (typeof CommonShot.prototype.specialOnGroundHit === 'function') {
        const rec2 = methodRecord(CommonShot, 'specialOnGroundHit');
        CommonShot.prototype.specialOnGroundHit = function () {
            const r = rec2.original.apply(this, arguments);
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
            // 只对【被弹反的投掷物】生效：enemyType 翻成 plant 且带灼烧标记（= 我们的甜椒弹）
            const isLobbedHostile = this.__gpnBurnRatio > 0 && deps.CharacterType
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
    const build = (prop, toward, dirSign, awayArgs) => {
        const name = prop === 'lefter' ? 'pushPlantLeft' : 'pushPlantRight';
        if (typeof FootballMech[name] !== 'function') { warn('跳过 ' + name + '：不是函数'); return; }

        FootballMech[name] = function (plant, dmg, dur, cbA, cbB, needSpace) {
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
    build('lefter', 'lefter', 1, []);
    build('righter', 'righter', -1, [false]);
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
    const wantFx = !!(C.jamFx && fx && deps && typeof deps.instantiatePooly === 'function');
    const iv = wantFx ? gpnJamFxInterval(fx) : 0;
    for (const lane of (Square.getAllLane() || [])) {
        if (!lane) continue;
        const pools = [];
        if (typeof lane.zombiePool === 'function') pools.push(lane.zombiePool());
        if (typeof lane.hypnoZombiePool === 'function') pools.push(lane.hypnoZombiePool());
        for (const pool of pools) {
            for (const z of (pool || [])) {
                if (!z || !(z.__gpnJamClearCD > 0)) { if (z) z.__gpnJamFxAcc = 0; continue; }
                z.__gpnJamClearCD -= dt;
                if (z.dead) { z.__gpnJamClearCD = 0; z.__gpnJamFxAcc = 0; continue; }
                if (wantFx) {
                    z.__gpnJamFxAcc = (z.__gpnJamFxAcc || 0) + dt;
                    if (z.__gpnJamFxAcc >= iv) {
                        z.__gpnJamFxAcc = 0;
                        gpnHitFxSpawn(fx, z, deps, !C.jamFxLiftFollow);   // 纯特效：只放节点，不碰伤害
                    }
                }
                if (z.__gpnJamClearCD <= 0) { z.__gpnJamClearCD = 0; z.__gpnJamFxAcc = 0; }
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
                            // 立刻关掉专属状态：写入会经转发访问器走到【引擎自己的 setter】
                            //   -> 贴图/动画当场回退（闪耀僵尸的彩虹立刻消散），不用等下一帧
                            try { if ('dancing' in target) target.dancing = false; } catch (e) {}
                        }
                    } else if (!invin && !target.isBoss && C.normalStun > 0) {   // ---- 普攻命中 ----
                        target.setStun(C.normalStun);
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
            this.__gpnDancingRaw = undefined;
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

/** 寒冰射手（Snow Pea）：冰锥概率控制
 *  引擎事实：普攻走 get defaultPea(){ Math.random() < ChanceToFreeze ? PeaFreezeType : PeaType }；
 *  而【大招】在 onFoodLeftPeaCountDec 里【显式】传 PeaTypePlantfood ⇒ 绕过 defaultPea ⇒ 永远不出冰锥；
 *  另外 defaultPea 也【不吃薄荷倍率】（那是雪滴花 Butter 那条路径才有）。
 *  所以统一在 _shoot 里处理：
 *    · 大招弹（显式 PeaTypePlantfood）-> 每发独立掷
 *    · 普攻（不传类型）            -> 由我们掷并把类型显式传进去（才吃薄荷 x3）
 *    · 其它调用（已显式传类型）    -> 原样放行 */
function makeSnowPeaFreezePatch(SnowPeaPlant) {
    const recs = [];
    const P = SnowPeaPlant && SnowPeaPlant.prototype;
    if (!P || typeof P._shoot !== 'function') { warn('跳过寒冰射手冰锥：拿不到 SnowPeaPlant._shoot'); return null; }
    const C = CFG.snowpea;
    const rec = methodRecord(SnowPeaPlant, '_shoot');
    P._shoot = function (a0, a1, a2) {
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
        let r;
        try { if (typeof baseOnMouseDown === 'function') r = baseOnMouseDown.apply(this, arguments); }
        catch (e) { warn('红针花：原版 onMouseDown 出错', e); }
        try {
            if (!CFG.redstinger.clickSwitch) return r;
            if (!ev || typeof ev.getButton !== 'function') return r;
            if (ev.getButton() !== 0) return r;             // 只认左键
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
 *   · 初始比例 = jellyInitialPct（0.6 → 0.5 ⇒ 出现/冷却结束时是 2500）
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
    const wantHp = plant.__gpnMkBaseJelly + (C.jellyBonusHp > 0 ? C.jellyBonusHp : 0);
    if (od.JellyToughness !== wantHp) od.JellyToughness = wantHp;
    if (C.jellyCooldown > 0 && od.JellyCooldown !== C.jellyCooldown) od.JellyCooldown = C.jellyCooldown;
    if (C.jellyInitialPct > 0 && od.JellyInitialPct !== C.jellyInitialPct) od.JellyInitialPct = C.jellyInitialPct;
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
            if (C.debugLog) log('夏威夷果：暗影物质被打光 → 上真隐身（僵尸看不见）');
        }
    } else if (plant.__gpnMkHidden) {
        // 只清我们自己那 1 秒的续期值；路灯花大招给的 3 秒不碰
        if (!(plant.PlanternHidden > 1)) plant.PlanternHidden = 0;
        plant.__gpnMkHidden = false;
        if (C.debugLog) log('夏威夷果：暗影物质回血 → 解除隐身');
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

/**
 * 翻转后的【发射口】：跟着贴图走。
 *  引擎 _shoot() 用的是 this.peaSpawnpoint（植物根节点下的子节点 ⇒ 会随 scale 一起镜像）。
 *  ⇒ 朝【机械前方】那发要用【镜像后的位置】：2×植物x − spawn.x（也就是翻过来的那个嘴）
 *  ⇒ 朝【机械后方】那发直接用镜像后的 spawn.x（那个嘴本身就是翻过来的）
 *  并且【不再】用引擎 _shootBack 的 -50 偏移 —— 因为偏移的前提是"发射口还在原来的前面"。
 */
function gpnSpSpawnFor(plant, dir) {
    const sp = plant && plant.peaSpawnpoint;
    const wp = sp && sp.worldPosition;
    if (!wp || typeof wp.x !== 'number' || typeof plant.worldPositionX !== 'number') return null;
    const x = (dir > 0) ? (2 * plant.worldPositionX - wp.x) : wp.x;
    return { worldPosition: { x: x, y: wp.y } };
}

/** 翻转时朝指定方向发一颗（dir：+1 朝前 / -1 朝后） */
function gpnSpFireDir(baseShoot, plant, dir, o, n, type, i, a, sp) {
    const spawn = gpnSpSpawnFor(plant, dir) || sp;
    const pr = baseShoot.call(plant, o, n, type, i, a, spawn);
    if (dir < 0 && pr && typeof pr.then === 'function') {
        return pr.then((pea) => {
            try { if (pea && pea.linearVelocity) pea.linearVelocity.x *= -1; }
            catch (e) { /* 不是子弹对象就算了 */ }
            return pea;
        });
    }
    return pr;
}

function makeSplitPeaPatch(SplitPeaPlant, deps) {
    const recs = [];
    const P = SplitPeaPlant && SplitPeaPlant.prototype;
    if (!P) { warn('跳过裂荚射手：拿不到 SplitPeaPlant'); return null; }
    const C = CFG.splitpea;
    const baseShoot = P._shoot;                 // 继承自 PeashooterPlant；先抓住原版再包
    if (typeof baseShoot !== 'function') { warn('跳过裂荚射手：拿不到 _shoot（对调会失效）'); return null; }

    /** 翻转 = 引擎自己的 scale 符号（x 带符号 ⇒ 整株镜像；装扮 / 动画 / 影子都跟着走） */
    const applyFlip = (plant, on) => {
        plant.__gpnSpFlip = !!on;
        try { plant.scale = on ? -1 : 1; }
        catch (e) { warn('裂荚射手：翻转出错', e); }
    };

    // ---- ① 左键：左右翻转（引擎只在"手上没拿卡"时才调 onMouseDown ⇒ 不抢种植左键）----
    const baseOnMouseDown = P.onMouseDown;      // 可能继承自 Plant 基类
    P.onMouseDown = function (ev) {
        let r;
        try { if (typeof baseOnMouseDown === 'function') r = baseOnMouseDown.apply(this, arguments); }
        catch (e) { warn('裂荚射手：原版 onMouseDown 出错', e); }
        try {
            if (!C.clickFlip) return r;
            if (!ev || typeof ev.getButton !== 'function') return r;
            if (ev.getButton() !== 0) return r;                 // 只认左键
            const next = !this.__gpnSpFlip;
            applyFlip(this, next);
            if (C.debugLog) {
                log('裂荚射手：' + (next ? '已翻转（前方 2 颗 / 后方 1 颗）' : '已翻回（前方 1 颗 / 后方 2 颗）'));
            }
            return true;                                        // 告诉引擎"这次点击我处理了"
        } catch (e) { warn('裂荚射手：左键翻转出错', e); }
        return r;
    };
    recs.push({ Cls: SplitPeaPlant, name: 'onMouseDown', original: baseOnMouseDown });

    // ---- ② 方向整体对调（前 ⇄ 后）----
    const recShoot = methodRecord(SplitPeaPlant, '_shoot');
    P._shoot = function (o, n, e, i, a, sp) {
        if (this.__gpnSpFlip) return gpnSpFireDir(baseShoot, this, -1, o, n, e, i, a, sp);   // 朝后
        return recShoot.original.apply(this, arguments);
    };
    recs.push(recShoot);

    const recBack = methodRecord(SplitPeaPlant, '_shootBack');
    P._shootBack = function (o, n, e, i, a, sp) {
        if (this.__gpnSpFlip) return gpnSpFireDir(baseShoot, this, 1, o, n, e, i, a, sp);    // 朝前
        return recBack.original.apply(this, arguments);
    };
    recs.push(recBack);

    // ---- ③ 播哪支动画也要对调（否则"只有前方"时仍会播只发 1 颗那支）----
    if (typeof P.detectEnemySplit === 'function') {
        const rec = methodRecord(SplitPeaPlant, 'detectEnemySplit');
        P.detectEnemySplit = function () {
            const n = rec.original.apply(this, arguments);
            if (!this.__gpnSpFlip) return n;
            return (n === 1) ? 2 : ((n === 2) ? 1 : n);          // 3 = 两边都有，不用变
        };
        recs.push(rec);
    } else {
        warn('跳过裂荚射手：没有 detectEnemySplit（前后动画不会对调）');
    }

    // ---- ④ 移动位置后保持翻转（搬株只换格子，不重初始化）----
    if (typeof P.specialPlantOnSquareChange === 'function') {
        const rec = methodRecord(SplitPeaPlant, 'specialPlantOnSquareChange');
        P.specialPlantOnSquareChange = function (t, o) {
            const r = rec.original.apply(this, arguments);
            try { if (this.__gpnSpFlip) this.scale = -1; }
            catch (e) { warn('裂荚射手：移动后保持翻转出错', e); }
            return r;
        };
        recs.push(rec);
    }

    // ---- ⑤ 池化复用：新种一株默认不翻转 ----
    if (typeof P.specialPlantOnEnable === 'function') {
        const rec = methodRecord(SplitPeaPlant, 'specialPlantOnEnable');
        P.specialPlantOnEnable = function () {
            try { this.__gpnSpFlip = false; this.scale = 1; }
            catch (e) { warn('裂荚射手：复位出错', e); }
            return rec.original.apply(this, arguments);
        };
        recs.push(rec);
    }

    return recs;
}

export default {
    // 给自检脚本用（GP-Next 会忽略多余字段）
    _config: CFG,
    _features: FEATURES,               // 同上：自检用来核对开关表
    _followMergeOn: gpnFollowMergeOn,   // 同上：合并开关的依赖判定（纯查询，便于单测）
    _pierceN: gpnPierceN,              // 同上：穿透数钳制（小数/负数 → 1）
    _followPierce: gpnFollowPierce,    // 同上：追击弹的打中数（= 星果打中数 + bonus）
    _gpnNullWriteStats: () => ({ total: gpnNullWriteTotal, detail: gpnNullWriteDetail, quiet: gpnNullWriteQuiet }),  // 同上：护栏降噪统计
    _gpnNullWriteReset: () => { gpnNullWriteTotal = 0; gpnNullWriteDetail = 0; gpnNullWriteQuiet = false; },  // 同上：自检用来把统计清零
    _starCanReach: gpnStarCanReach,   // 追击的"能不能打到"判定（纯函数，便于单测）
    id: MOD_ID,
    name: "Cutemaodie's Tweak Mod",
    version: MOD_VERSION,
    author: 'CuteMaodie',
    description: '21 项可逐项开关的杂项调整：巴豆 / 钢地刺 / 心蕊 / 暗影龙葵 / 星星果系 / 寒冰射手 / 红针花 / 暗影夏威夷果 / 裂荚射手 等；含穿透与溅射、A2 追击、毒气、召唤权重、落点灼烧。',

    setup() {
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
        ];

        // 先读 features.json（读不到就按全开处理），再加载模块
        return featLoad().then(() => Promise.all(IMPORTS.map((m) => System.import(m).catch((e) => {
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
                zombiesMod = mods[33], perfumeShroomMod = mods[34];

            const recs = [];
            /** 心蕊减防特效 prefab 的缓存（香水菇要用） */
            const buffCache = { par: null };

            // ---- 1. 数值 ----
            if (jsonMod.PvZ2ObjectContainer) {
                const dataPatch = makeDataPatcher(jsonMod.PvZ2ObjectContainer);
                dataPatch.apply();

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

            // ---- 2. 巴豆 ----
            if (featOn('chilibean')) {
                const chili = makeChiliPatches(chiliMod.ChiliBean, zombieMod.Zombie, zombieMod.ZombiePoison);
                recs.push(...chili.recs);
            }

            // ---- 3. 钢地刺 ----
            if (featOn('spikerock')) {
                const spy = makeSpikerockPatch(spikerockMod.SpikerockPlant);
                if (spy) recs.push(spy);
            }

            // ---- 4. 心蕊 ----
            if (featOn('bloomingheart')) {
                const bloom = makeBloomingHeartPatch(bloomMod.bloomingheartShot,
                    charMgrMod.Rectangle, squareMod.Square);
                if (bloom) recs.push(bloom);
            }

            // ---- 5. 暗影龙葵：先重写 _shoot 打标记，再装穿透 ----
            if (featOn('nightshade')) {
                const night = makeNightShadePatch(nightMod.NightShadePlant,
                    prjMod.PrjFunctions, ccMod.Vec2, characterMod.CharacterType);
                if (night) recs.push(night);

            }

            // 私有字段桥 / 溅射 / 穿透都长在 commonShot 上：
            // 暗影龙葵、星星果、甜椒投手任意一个开着就得装（各自靠私有标记判定，互不干扰）
            if (featOn('nightshade') || featOn('starfruit') || featOn('pepperpult') || featOn('dandelion')) {
                const pierce = makePiercePatch(shotMod.commonShot,
                    characterMod.CharacterType, charMgrMod.ZombieDamageDetails,
                    zombiesMod && zombiesMod.ZombieEnum);
                if (pierce) recs.push(...pierce);
            }

            // ---- 18. 飓风甘蓝：全屏寒风 ----
            if (featOn('hurrikale')) {
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
            if (featOn('phatbeet')) {
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
            if (featOn('snowpea')) {
                const spf = makeSnowPeaFreezePatch(snowPeaMod && snowPeaMod.SnowPeaPlant);
                if (spf) recs.push(...spf);
            }
            // ---- 23. 红针花：左键循环切换形态 ----
            if (featOn('redstinger')) {
                const rs = makeRedStingerPatch(redStingerMod && redStingerMod.RedStingerPlant, {
                    cc: ccMod, Rectangle: charMgrMod.Rectangle, Vec2: ccMod.Vec2,
                    Square: squareMod.Square, FrontYard: frontYardMod && frontYardMod.FrontYard,
                });
                if (rs) recs.push(...rs);
            }
            // ---- 24. 暗影夏威夷果：暗影态本体隐身（视觉）+ 暗影物质耐久 + 打光后真隐身 ----
            if (featOn('murkadamia')) {
                const mk = makeMurkadamiaPatch(murkadamiaMod && murkadamiaMod.MurkadamiaNutPlant, {
                    cc: ccMod,
                });
                if (mk) recs.push(...mk);
            }
            // ---- 25. 裂荚射手：左键左右翻转 + 前后豌豆数对调 ----
            if (featOn('splitpea')) {
                const sp = makeSplitPeaPatch(splitPeaMod && splitPeaMod.SplitPeaPlant, { cc: ccMod });
                if (sp) recs.push(...sp);
            }
            // ---- 20b. 寒冰射手：金卡（数据 + 显示两条路一起走）----
            //  getBGAnm 在【植物管理类】（持有 PlantFeatures 的那个）上，不在 Cards.ts 上。
            //  先把数据改掉（OBTAINWORLD = market ⇒ 金卡 + prenium 背景），拿不到表只 warn。
            if (featOn('snowpea')) {
                try {
                    const PM = plantsMod && plantsMod.plants;   // 模块导出名是小写 plants（踩过的坑）
                    const res = PM && PM.plantRes;
                    if (res && Array.isArray(res.PlantFeatures)) {
                        const sd = res.PlantFeatures.find((x) => x && x.CODENAME === 'snowdrop');
                        const w = (sd && sd.OBTAINWORLD) || 'market';
                        for (const f of res.PlantFeatures) {
                            if (f && f.CODENAME === CFG.snowpea.plantType) f.OBTAINWORLD = w;
                        }
                        log('寒冰射手：OBTAINWORLD -> ' + w + '（金卡）');
                    } else { warn('寒冰射手：拿不到 PlantFeatures（金卡改走显示层钩子）'); }
                } catch (e) { warn('寒冰射手：OBTAINWORLD 补丁出错', e); }
            }
            // 显示层兜底：包【植物管理类】的 getBGAnm，只对 snowpea 返回金卡参数
            if (featOn('snowpea')) {
                try {
                    const PM = plantsMod && plantsMod.plants;   // 模块导出名是小写 plants（踩过的坑）
                    if (PM && typeof PM.getBGAnm === 'function') {
                        const og = PM.getBGAnm;
                        PM.getBGAnm = function (feature, boosted) {
                            const r = og.apply(this, arguments);
                            if (feature && feature.CODENAME === CFG.snowpea.plantType && r) {
                                return { bg: CFG.snowpea.goldBg, golden: true, lod: false };
                            }
                            return r;
                        };
                        recs.push({ Cls: PM, name: 'getBGAnm', original: og });
                        log('寒冰射手：金卡钩子（Plants.getBGAnm）已挂');
                    } else { warn('寒冰射手：Plants.getBGAnm 不在 —— 若数据路线也失败则卡面不变金'); }
                } catch (e) { warn('寒冰射手：金卡钩子出错', e); }
            }

            // ---- 17. A2 星星果追击攻击 ----
            if (featOn('starfruit') && CFG.starfruit.followEnabled) {
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
            if (featOn('pepperpult')) {
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
                });
                if (burn) recs.push(...burn);
                // 卸载时把还没烧完的"植物阵营火"清掉（否则会留着已经销毁的格子引用）
                recs.push({ __onCleanup: function () { gpnPlantFires.length = 0; } });
            }

            // ---- 6. 甜薯：自回血 + 受到治疗加成 ----
            if (featOn('sweetpotato')) {
                const sweet = makeSweetPotatoPatch(plantMod.Plant);
                if (sweet) recs.push(...sweet);
            }

            // ---- 7. 白萝卜：受伤间隔（挂在扣血叶子上，不影响覆盖层）----
            if (featOn('turnip')) {
                const turnip = makeTurnipPatch(plantMod.Plant);
                if (turnip) recs.push(turnip);
            }

            // ---- 8. 心蕊 DEBUFF -> 对心蕊/甜薯/热辣海枣的啃食伤害减免 ----
            if (featOn('bloomingheart')) {
                const victim = makeBloomingHeartVictimPatch(plantMod.Plant);
                if (victim) recs.push(victim);
            }

            // ---- 9. 香水菇：香水火 13.5 秒（原版 9）+ 施加 6 层心蕊 DEBUFF ----
            if (featOn('perfumeshroom')) {
                const perfume = makePerfumeShroomPatch(perfumeMod.PerfumeFire, squareMod.Square,
                    zombieMod.Zombie, gfmMod.GroundFiresManager, buffCache);
                if (perfume) recs.push(...perfume);
                const perfumeDur = makePerfumeDurationPatch(perfumeShroomMod && perfumeShroomMod.PerfumeShroomPlant);
                if (perfumeDur) recs.push(...perfumeDur);   // 香水火时长 9 -> 13.5 秒

                // ---- 10. 取减防特效 prefab（异步，不阻塞 setup）----
                loadBloomingHeartBuffPrefab(ccMod, buffCache);
            }

            // ---- 13. 暗影油桃：毒气时长 x2 / 攻击 x0.5 ----
            if (featOn('noctarine')) {
                const noct = makeNoctarinePatch(noctarineMod.NoctarinePlant);
                if (noct) recs.push(noct);
                const gas = makeNoctarineGasPatch(gasMod.noctarineBuffParticle);
                if (gas) recs.push(gas);
            }

            // ---- 14. 腐尸豆荚：召唤权重 ----
            if (featOn('zoybeanpod')) {
                const zoy = makeZoybeanPatch(zoybeanMod.ZoybeanPodPlant);
                if (zoy) recs.push(zoy);
            }

            // ---- 15. 蒲公英：额外一颗子弹 ----
            if (featOn('dandelion')) {
                const dan = makeDandelionPatch(dandelionMod.DandelionPlant, squareMod.Square, shotMod.commonShot);
                if (dan) recs.push(...dan);
            }

            // ---- 12. 推植物：跳过「不可推」的挡路植物（不再飞出屏幕）----
            if (featOn('pushPlantFix')) {
                const pushFix = makePushSkipPatch(charMgrMod.footballmech);
                if (pushFix) recs.push(...pushFix);
            }

            // ---- 11. 高坚果：同原始坚果，可扛 3 次巨人砸击 ----
            if (featOn('tallnut')) {
                // !! WallNut.ts 导出的名字是 WallNutPlant（大写 N），不是 WallnutPlant ——
                //    写错会拿到 undefined，补丁会「静默跳过」（v2.4.0 就是这个 BUG：扛 3 次砸击没生效）
                const wallNutCls = wallNutMod.WallNutPlant || wallNutMod.WallnutPlant;
                if (!wallNutMod.WallNutPlant && wallNutMod.WallnutPlant) {
                    warn('WallNut.ts 用的是备用导出名 WallnutPlant，请检查是否版本变动');
                }
                const tall = makeTallnutPatch(wallNutCls, primalMod.PrimalWallNutPlant);
                if (tall) recs.push(tall);
            }

            {
                const off = Object.keys(FEATURES).filter((k) => !featOn(k) && k !== 'verboseLog');
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
                + CFG.dandelion.flyingStun + '/' + CFG.dandelion.plantfoodFlyingStun + '秒)、'
                + '飓风甘蓝(其他行推力' + Math.round(CFG.hurrikale.otherLanePushScale * 100) + '%'
                + '/全屏吹飞/特效同行)、'
                + '甜椒投手(阳光' + CFG.pepperpult.sunCost + '/冷却' + CFG.pepperpult.packetCooldown
                + '秒/落点3x3灼烧' + CFG.pepperpult.burnSeconds + '秒/'
                + (CFG.pepperpult.burnArmorProtection ? '不穿甲' : '穿甲') + ')、'
                + '魔音甜菜(普攻眩晕' + CFG.phatbeet.normalStun + '秒/大招眩晕' + CFG.phatbeet.plantfoodStun
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
                + '推植物跳过挡路者(' + (CFG.pushPlant.skipBlockers ? '开' : '关') + ')');

            return function cleanup() {
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
