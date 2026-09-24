# Cutemaodie's Tweak Mod

PvZ2 Gardendless 的杂项强化模组（GP-Next **JS 模组**）。

- 作者：可爱小耄（CuteMaodie）。
- 目标版本：`0.14.0`（GP-Next `1.4.6`）
- 形式：`pack.json` + `scripts/main.js`
- 依赖：无（不需要开任何实验性 / 运行时扩展开关）

## 文件清单

| 文件 | 作用 |
| --- | --- |
| `pack.json` | 模组元信息（`js.entry` 指向脚本） |
| `scripts/main.js` | 模组本体：全 21 项改动 + `cleanup()` |
| `features.json` | **功能开关**：手改 `true`/`false` 决定每一项是否生效 |
| `README.md` | 本文 |

> **遇到 BUG 怎么办？**
>
> **① 先自查 30 秒**（能自己解决一半问题）
> - **完全退出游戏**再进（不是 Patcher 的 Save & Reload）；确认 `packs\Cutemaodie's Tweak Mod\` 里**没有多套一层文件夹**
> - F12 里应该有一行 `[Cutemaodies_Tweaks] 已加载 v1.0.0：…`；没有 ⇒ 没装上 / 没勾选 / 没重启
> - 看到 `跳过 xxx：拿不到 yyy` ⇒ 引擎版本变了（见 §4）
> - Patcher 里**取消勾选**本模组 → 重启；如果还犯 ⇒ 多半不是这个包的问题
> - 游戏自带的红字**不用发**：`No armature data` / `Same slot` / `has no custom name in pack.json` /
>   `Non-existent animation.` + `DragonBones name: …`（游戏模型缺动画：**刷屏但无害**，导完日志把 F12 关掉就行）
>
> **② 按这个模板整理**（复制填空即可）
>
> ```text
> 【现象】
> 【复现步骤】哪一关 → 哪株植物 / 哪种僵尸 → 怎么操作 → 第几步出问题 → 能否重复
> 【期望】
> 【环境】游戏版本 / 模组版本 / GP-Next 版本 / 其它 mod / features.json 关闭了哪些开关
> 【F12 日志】以 [Cutemaodies_Tweaks] 开头的那几行（尤其带「跳过」「出错」的）；闪退 / 卡死就说清「怎么操作会崩、必现还是偶尔」
> 【截图】可选
> ```
>
> **③ 发到哪**（两个地方都行）：
> 1. **GitHub Issues**：[CuteMaodie/Cutemaodie-Tweak-Mod/issues](https://github.com/CuteMaodie/Cutemaodie-Tweak-Mod/issues)
> 2. **B 站评论区**
>
> **日志比文字描述更有用** —— F12 里平时只有启动摘要 + 真正的警告（"每次触发一条"的诊断日志默认关），
> 想看细节就把 `features.json` 里的 `verboseLog` 改成 `true` → **完全退出游戏重启**。

## 当前内容

> 顺序与 `features.json` 的开关列表一致；`<br>` 后面是细则。
>
> **穿透弹通用**（暗影龙葵 / 星星果系的普攻·大招·追击弹都适用）：被小丑 / 三节棍**弹反后照样能打植物**；**路灯花 / 真隐身的植物**也照样能打到、穿透名额正常分配；**力场盾 / 全息坚果大招盾 / 月光花大招盾**也能穿过去（护盾吃伤害、子弹继续飞）。

| 植物 | 改动 |
| --- | --- |
| **巴豆** | 被啃死时，杀死**所有**正在啃食它的非机械僵尸（复制 N 份原版单体击杀，不是爆炸、不换模型） |
| **钢地刺** | 阳光 `250 → 200`；可承受打击次数 `3 → 9`；**每承受 3 次**才掉一颗牙；**种植冷却 → 15 秒** |
| **心蕊** | 普攻 / 大招的 **debuff 由单体 → 1×3**（以命中目标为中心，同排左右各一格），子弹伤害不变<br>**带这个 debuff 的僵尸**啃食 **心蕊 / 甜薯 / 热辣海枣** 时，伤害分别降到 **50% / 75% / 75%** |
| **暗影龙葵** | 阳光 `75 → 125`；**只有暗影态**发射的攻击**打中 3 个目标（= 穿透 2 个）** + **飞天豌豆档击退 `0.25` 格**；非暗影态与原版一致<br>穿透弹通用细则见上面那条 |
| **白萝卜** | 新增特性：**0.00175 秒内只能受到一次伤害**（等价于「同一帧内只结算一次伤害」，不丢跨帧伤害） |
| **甜薯** | 新增特性：**受到的任何治疗 ×200%**；**每秒自回血 20 点**（吃同一个 ×2 ⇒ 实际 **40/秒**） |
| **高坚果** | 新增特性：**免疫位移** —— 橄榄车推 / 抛掷铲走 / 舞王推 / 渔夫钩拖走 全部无效（后两者改为原地吃伤害）<br>**同原始坚果，能扛住 3 次巨人砸击**（每次扣 25% 最大血，第 4 次死）；**种植冷却 `20 → 30 秒`** |
| **推植物修正** | **被「不可推」的植物挡住时跳过它、继续找空位**（原版会把植物扔出屏幕） |
| **香水菇** | 新增特性：香水火**持续 13.5 秒**（原版 9 秒），期间对**本行**每只僵尸**施加 6 层心蕊 debuff**（带减防特效） |
| **星星果系** | 数值：星星果阳光 `150 → 125`、天使星星果 **175**、流星果 **500 → 550**（+ **种植冷却 10 秒**）<br>普攻：**星星果 / 天使星星果打中 2 个目标（= 穿透 1 个）**、**流星果打中 2 个（= 穿透 1 个）** + **单格溅射**（= 该发子弹伤害的 20%，**流星果单独 40%**，运行时算）<br>**A2 追击**：天使星星果 / 流星果的子弹**打中僵尸或障碍物**时（不穿透也算打中），能打到该目标的基础星星果**补一轮 5 方向齐射**（伤害 ×50% / 打中 3 个（= 星星果打中数 2 + `followPierceBonus` 1）/ 溅射 40% = 攻击 ×20% / 眩晕 0.075 秒）<br>**延迟窗口合并**（独立开关 `starfruitFollowMerge`，默认开）：同一株在 **0.1 秒**内被多次触发时**只补一轮**；**公式：K 次触发只补一轮 5 发，每颗弹伤害 = 50% × Σ(各次触发时的攻击力)，总伤害与不合并完全相同**；打中数仍 3、大招期间不记录<br>穿透弹通用细则见上面那条 |
| **暗影油桃** | 阳光 `150 → 100`；毒气**持续时间 ×2**（含 3×3 影子 buff 时长）；**伤害 ×0.5**（**爆炸 20→10、毒气每跳 20/30→10/15 两处都改**） |
| **腐尸豆荚** | 召唤权重（普通）：普通僵尸 **28** / 路障 **30** / 铁桶 **23** / **城堡头僵尸 13** / **超新星巨尸 3** / **豆腐巨尸 3**<br>大招：豆腐巨尸 **92** / 超新星巨尸 **8** |
| **蒲公英** | 阳光 275 → **325**；每次**普攻**额外发射一颗子弹（**延迟 0.4 秒**）<br>**索敌**：第一颗优先打**本行**；本行没僵尸就取相邻两行里**最靠近房子**的僵尸那行；僵尸优先于障碍物；都没有就**不开火**。第二颗在**本行 + 上下相邻行**里取最靠近房子的僵尸 / 障碍物，没有候选就**不发**<br>**对飞行僵尸**（含临时飞行）：伤害 **×2** + 眩晕 **1 秒**（普攻 / 吹风反应弹）、**5 秒**（大招弹），BOSS 不眩晕；对指定 BOSS（热气球浮艇 / 领空统治者，含第二形态）伤害 **×2**<br>图鉴新增特点「可击晕飞行僵尸，且对其造成更高伤害」 |
| **甜椒投手** | 阳光 `200 → 225`；种植冷却 `20 → 15 秒`；子弹**命中目标或触地**后，在**落点产生 3×3、持续 1 秒**的灼烧（**单次火焰总伤害 = 子弹伤害 ×40%**，运行时算，**不穿甲**）<br>**被小丑 / 三节棍弹反后**：子弹照样打得到植物，产生的火变成**植物阵营火**（**只烧植物 + 被催眠的僵尸**）；这种投掷物**能被【伞叶】/【回旋镖射手】挡下**（挡住 ⇒ 不打伤害、不产生任何火）；命中护盾（力场盾 / 全息坚果盾 / 月光花盾）被「吸收」时**照样产生火**（落在护盾那一格） |
| **飓风甘蓝** | **全屏寒风**：其他 4 行也推 + 减速（**推力只有本行的 50%**，减速照常）；**全屏吹飞飞行僵尸**（同三叶草，**天空之城飞船扣血同三叶草**）；其他行也有**同款寒风特效**<br>天空之城与沙盒的差别**照引擎的刻意行为** |
| **魔音甜菜** | 普攻使命中的僵尸**眩晕 0.1 秒**；普攻(3×3) / 大招(5×5) 可**解除音响僵尸对植物施加的「安抚」**（索敌范围内有被安抚的植物时**也会发动普攻**，且**不伤害植物**）<br>大招使命中的僵尸**眩晕 5 秒 + 原地向上击起**（**BOSS 与处于「沉重」的僵尸不会被击起**），并让其在 **25 秒**内**不受魔音舞台效果影响**<br>**命中特效**（纯视觉、零伤害）：解除安抚时在那株植物脚下放一次；解除音乐期间在被解除的僵尸脚下按**特效动画自身时长**持续放 |
| **大蒜** | 被啃一口的固定伤害 `150 → 37.5`（血量 900 不变 ⇒ 由 6 口变 24 口）；阳光 `50 → 75`；种植冷却 `5 → 15 秒` |
| **寒冰射手** | 机制回调（同早期版本、现由雪滴花专职）：子弹附**单格范围冰减速**；**30% 概率**（薄荷 ×3 ⇒ 90%）射出**冰锥**（**冻结单体 6 秒 + 单格范围 5 秒**，伤害**跟随寒冰射手**）<br>卡面与选卡界面改为**金卡**（同雪滴花）；图鉴 Intro / 特点中英同步改 |
| **红针花** | 阳光 `150 → 200`；**承伤倍率**：`inArea 1`（第 4~6 列）`0.3333333→0.2`（**80% 减伤**）、`inArea 2`（第 7~9 列）`0.2→0.1`（**90% 减伤**）<br>**左键循环切换形态** `0→1→2→0`（手动状态保留；只写 `inArea` ⇒ **血量继承、绝不回血**；弹种/攻速/动画/是否攻击/浇水·重植全部自动跟随）<br>**半防御半攻击形态（inArea1）的子弹可以击退敌人 `0.05` 格**<br>图鉴新增**两条特点**：「可以通过鼠标左键点击主动切换形态」+「攻击形态火力最强，中间形态攻击可造成微弱击退，并提升一定防御力，防御形态大幅提高防御力」（关掉 `redstinger` 开关 ⇒ 两条一起恢复原版） |
| **暗影夏威夷果** | 暗影状态下**本体隐身**（**50% 透明**，判定不动 ⇒ 僵尸照常来但**只啃得到暗影物质**、本体不掉血）；**暗影物质与护盾不隐身**<br>暗影状态下**暗影物质耐久上限 + 本体耐久**（`2500 + 2500` = **5000**）；打光后的冷却 **5 秒**；出现 / 冷却结束时初始比例 **30%（= 1500）**；暗影物质被打光后**进入真隐身**，回血立刻解除 |
| **裂荚射手** | **左键点它 → 左右翻转**（贴图/装扮/动画/影子一起翻）：**前 2 后 1** ⇄ 原版 **前 1 后 2**；**大招也跟着换**（60 前 / 90 后 ⇄ 90 前 / 60 后）；**阳光保持原版 200**；图鉴「射速」那行补一句 |

---

## 1. 安装

把整个文件夹放进：

    你的用户目录\AppData\Roaming\com.pvzge.game\gp-next\packs\Cutemaodie's Tweak Mod\

里面应**直接**看到 `pack.json` 和 `scripts\`。然后 `F9` → **Patcher** → 勾选 → **Save & Reload** → **重启游戏**。

加载时控制台会打印一行确认：

    [Cutemaodies_Tweaks] 已加载 v1.0.0：巴豆(每只完整)、钢地刺(阳光200/承受9次/每3次掉牙/冷却15秒)、心蕊(1x3 debuff)、暗影龙葵(阳光125/穿透2(仅暗影态)/击退0.25)、白萝卜(0.00175s 受伤间隔)、甜薯(自回血20/秒×2，受治疗×2)、心蕊啃食减伤(心蕊×0.5/甜薯·海枣×0.75)、香水菇(6层心蕊DEBUFF/火13.5秒)、高坚果(免疫位移+扛3次砸击+冷却30秒)、星星果系(阳光125/天使175/流星550/普攻打中：星星果2个、天使2个、流星2个/溅射20%(流星果40%)/追击50%打中3个·溅射40%/延迟窗口合并0.1秒)、暗影油桃(伤害x0.5)、腐尸豆荚(召唤权重)、蒲公英(每次+1颗/延迟0.4秒/阳光325/对飞行×2·眩晕1/5秒)、飓风甘蓝(其他行推力50%/全屏吹飞/特效同行)、甜椒投手(阳光225/冷却15秒/落点3x3灼烧1秒/不穿甲)、魔音甜菜(普攻眩晕0.1秒/大招眩晕5秒+原地击起/解除安抚/音乐免疫25秒/命中特效)、大蒜(啃食37.5/阳光75/冷却15秒)、寒冰射手(子弹冰减速/冰锥30%(薄荷×3)/冻结6秒+单格5秒/金卡)、红针花(阳光200/承伤×0.2·×0.1/左键切形态)、暗影夏威夷果(暗影态本体50%透明/暗影物质上限5000·冷却5秒/打光后真隐身)、裂荚射手(左键左右翻转/前后豌豆对调/阳光200)、推植物跳过挡路者(开)

**卸载**：Patcher 取消勾选或移出 `packs\` → Save & Reload。模组自带 `cleanup()`，会把所有原型方法和数据改动还原。

---

## 2. 调数值

全部集中在 `scripts/main.js` 顶部的 `CFG`：

```js
const CFG = {
    // ★ 下面列的就是【当前实际值】；一切以 scripts/main.js 里的 CFG 为准
    chilibean:     { fullFartForEveryEater: true },   // false = 只有第一只跑完整特效，其余静默
    spikerock:     { sunCost: 200, maxSpike: 9, teeth: 3, cooldown: 15 },
    bloomingheart: { splashWidthTiles: 3,             // 减防 debuff 的横向格数（1x3）
                     victimDamageScale: {             // 被带 debuff 的僵尸【啃食】时的伤害倍率
                         bloominghearts: 0.50,        //   心蕊
                         sweetpotato:    0.75,        //   甜薯
                         hotdate:        0.75 },      //   热辣海枣
                     debuffLayer: 0.9 },              // 单层减防值
    perfumeshroom: { plantType: 'perfumeshroom', layers: 6, fireDuration: 13.5 },   // 层数 / 火持续秒数
    tallnut:       { plantType: 'tallnut', smashHpFraction: 0.25,   // 每次砸击扣最大血的百分比（0.25 = 扛 3 次）
                     cooldown: 30 },                  // 种植冷却 20 -> 30 秒
    nightshade:    { sunCost: 125,
                     pierceTargets: 3,               // 一次打中几个（3 = 穿透 2 个；1 = 不穿透）
                     shadowOnlyPierce: true, knockbackDistance: 0.25 },   // 只有暗影态才穿透
    turnip:        { plantType: 'turnip', damageGateSeconds: 0.00175 },   // 白萝卜受伤间隔（越大越肉）
    sweetpotato:   { plantType: 'sweetpotato', selfHealPerSecond: 20,
                     healReceivedMultiplier: 2, selfHealAlsoDoubled: true },
    starfruit:     { sunCost: 125,
                     pierceTargets: 2,                // 星星果：一次打中几个（穿透 = 该值 - 1）
                     pinkPierceTargets: 2,            // 天使星星果：同上
                     shootingPierceTargets: 2,        // 流星果：打中 2 个（= 穿透 1 个）；1 = 不穿透
                     pinkSunCost: 175,                // 天使星星果阳光
                     shootingSunCost: 550,            // 流星果阳光（原版 500）
                     shootingCooldown: 10,            // 流星果种植冷却（秒）
                     splashRatio: 0.2,                // 普攻溅射（星星果/天使）= 该发伤害的 20%
                     splashRatioShooting: 0.4,        // 流星果单独 40%
                     splashCells: 1,                  // 溅射格数
                     followEnabled: true,             // A2 追击总开关
                     followDamageRatio: 0.50,         // 追击弹伤害 = 该发攻击的 50%
                     followPierceBonus: 1,            // 追击弹比星果普攻多打中几个（= 2 + 1 = 3）
                     followSplashRatio: 0.4,          // 追击溅射 = 追击弹伤害的 40%
                     followMergeWindow: 0.1,          // 追击「延迟窗口」秒数（0 = 关闭合并；独立开关 starfruitFollowMerge）
                     followMergeDebugLog: false,      // 追击合并调试日志（排查用，默认关）
                     followStun: 0.075,               // 追击附带的眩晕秒数
                     followAnimSpeed: 2, followAnimGuard: 1.0 },
    noctarine:     { sunCost: 100, damageScale: 0.5,  // 伤害 x0.5
                     normalLifespan: 40, shadowLifespan: 50 },   // 毒气时长（原版 20 秒）
    pepperpult:    { sunCost: 225, packetCooldown: 15, burnSeconds: 1,
                     burnTotalRatio: 0.4,             // 单次火焰【总】伤害 = 子弹伤害 x40%
                     burnCells: 3, burnHeight: 15, burnArmorProtection: true },
    zoybeanpod:    { plantType: 'zoybeanpod',         // 召唤权重（普通 / 大招）
                     summon: [ { Weight: 28, Type: 'zoybean' },
                               { Weight: 30, Type: 'zoybean_armor1' },
                               { Weight: 23, Type: 'zoybean_armor2' },
                               { Weight: 13, Type: 'dark_armor4' },
                               { Weight: 3,  Type: 'supernova_gargantuar' },
                               { Weight: 3,  Type: 'zoybean_gargantuar' } ],
                     plantfood: [ { Weight: 92, Type: 'zoybean_gargantuar' },
                                  { Weight: 8,  Type: 'supernova_gargantuar' } ] },
    dandelion:     { sunCost: 325, extraShots: 1, extraDelay: 0.4,   // 阳光 275->325；额外一颗延迟 0.4 秒
                     flyingDamageScale: 2, flyingStun: 1, plantfoodFlyingStun: 5,   // 对飞行 ×2 + 眩晕（普攻1秒/大招5秒）
                     bossDamageScale: 2,                             // 指定 BOSS（热气球浮艇/领空统治者）伤害 ×2
                     bossTypes: ['zombossmech_lostcity', 'zombossmech_lostcity2', 'zombossmech_sky'] },
    pushPlant:     { skipBlockers: true },            // false = 恢复原版「被挡就把植物扔出屏幕」
    hurrikale:     { plantType: 'hurrikale', otherLanePushScale: 0.5,   // 其他行推力 = 本行的 50%
                     affectAllLanes: true, mintScalesOtherLanes: true,
                     shipWindUseBloverDuration: true, bloverType: 'blover',
                     otherLaneVfx: true, otherLaneDandelions: 1 },      // 其他每行各随机 1 株蒲公英
    phatbeet:      { plantType: 'phatbeet', sunCost: 150,
                     normalStun: 0.1, plantfoodStun: 5, liftDuration: 0.5, liftHeight: 40,
                     bossBlocksLift: true, heavyBlocksLift: true, clearPlantDebuff: true,
                     jamClearSeconds: 25, clearFx: true, jamFx: true,
                     jamFxInterval: 0, jamFxFallback: 0.3, jamFxScale: 1, jamFxLiftFollow: true },
    garlic:        { plantType: 'garlic', eatDamage: 37.5, sunCost: 75, cooldown: 15 },
    snowpea:       { plantType: 'snowpea', peaType: 'pea_snow', spikeAlias: 'pea_snow_spike',
                     cloneFrom: 'snowdrop_freeze', freezeChance: 0.30, mintChanceFactor: 3,
                     chillDuration: 10, freezeDuration: 6, splashFreezeDuration: 5 },
    redstinger:    { plantType: 'redstinger', sunCost: 200, tier1: 0.2, tier2: 0.1,
                     knockbackDistance: 0.05, clickSwitch: true },
    murkadamia:    { plantType: 'murkadamia', shadowBodyAlpha: 0.5, shieldKeepsOpaque: true,
                     hideWhenJellyDown: true, jellyBaseHp: 2500, jellyBonusHp: 2500,
                     jellyCooldown: 5, jellyInitialPct: 0.3 },
    splitpea:      { plantType: 'splitpea', sunCost: 200, clickFlip: true,
                     extraZh: '。或者向前方两倍，向后方正常', extraEn: ' Or double forward, normal backward.' },
};
```

---

## 3. 功能开关 features.json

模组根目录的 `features.json` 决定**每一项调整是否生效**。

> **图鉴文本也跟着开关走**：关掉某一项，图鉴里对应的描述会**恢复成原版**，
> 不会出现「已经关了、图鉴还在讲改了的效果」。跨功能的文案也按依赖走 ——
> 例如**心蕊**关掉时，**香水菇**那条 Special 就不再写「啃食伤害降低」（那本来是心蕊的功能）。
> 另外**文案里的数值全部从 `CFG` 现算**，所以你调了参数，图鉴会自动跟着变。



```json
{
  "chilibean": true,        // 巴豆
  "spikerock": true,        // 钢地刺
  "bloomingheart": true,    // 心蕊（1x3 + 啃食减伤）
  "nightshade": true,       // 暗影龙葵
  "turnip": true,           // 白萝卜
  "sweetpotato": true,      // 甜薯
  "tallnut": true,          // 高坚果（免疫位移 + 扛3次）
  "pushPlantFix": true,     // 推植物修正
  "perfumeshroom": true,    // 香水菇
  "starfruit": true,        // 星星果系（穿透 + 溅射 + 阳光125 + A2 追击；关掉 = 这些一起关）
  "starfruitFollowMerge": true,   // A2 追击「延迟窗口合并」（关掉 = 每次触发各一轮；依赖 starfruit）
  "noctarine": true,        // 暗影油桃（毒气时长x2 / 攻击x0.5 / 阳光100）
  "zoybeanpod": true,       // 腐尸豆荚（召唤权重）
  "dandelion": true,        // 蒲公英（索敌 / 额外弹 / 阳光325 / 对飞行×2+眩晕）
  "pepperpult": true,       // 甜椒投手（阳光225 / 冷却15 / 落点3x3灼烧）
  "hurrikale": true,        // 飓风甘蓝（全屏寒风：其他行 50% 推力 + 全屏吹飞飞行僵尸）
  "phatbeet": true,         // 魔音甜菜（普攻眩晕 / 大招眩晕+击起 / 解除安抚 / 音乐免疫 25 秒）
  "garlic": true,           // 大蒜（每口固定伤害 37.5 / 阳光 75 / 冷却 15 秒）
  "snowpea": true,          // 寒冰射手（单格范围冰减速 + 概率冰锥 / 金卡）
  "redstinger": true,       // 红针花（阳光200 / 承伤 ×0.2·×0.1 / 左键切形态 / inArea1 子弹击退0.05格）
  "murkadamia": true,       // 暗影夏威夷果（暗影态本体隐身 / 暗影物质上限 5000）
  "splitpea": true,         // 裂荚射手（左键左右翻转 / 前后豌豆对调）
  "verboseLog": false      // 【诊断日志总开关】默认关；排查问题时改成 true（只影响 F12 日志，不影响游戏）
}
```

**规则**：

- 只有**显式写了 `false`** 才算关；键不存在 / 不是布尔 → 一律按**开启**处理
- **子开关有依赖**：`starfruitFollowMerge`（A2 延迟窗口合并）**依赖 `starfruit`** —— 星果系关掉时，本项无论写 `true`、写 `false` 还是**整行删掉**，一律按**关闭**处理（运行时判定，**不会改你的 `features.json`**；`starfruit` 关着却写了 `true` 时，控制台会打一行黄色提示）
- **关掉 = 完全不打那个补丁**（不是"打了再改回原版"）
- 改完必须 **完全退出游戏 → 重新启动**。按 Patcher 的 `Save & Reload` **不生效**
  （模组只在启动时读一次；而且 `Save & Reload` 根本不会卸载已注入的模组）
- **读不到 / 解析失败 → 全部按开启**，并在控制台打一行警告 —— 绝不会因此让模组挂掉
- **`verboseLog` 是唯一例外（它反着来）**：这是【诊断日志总开关】，**默认关** —— 写 `false` / 删掉 / 整个文件读不到，都保持**关**；
  只有显式写 `true` 才会把「每次触发一条」的诊断日志打出来（甜薯治疗/自回血、心蕊减伤、香水菇、甜椒灼烧、腐尸豆荚召唤表、
  蒲公英分叉、红针花切形态、魔音甜菜特效、飓风甘蓝联动、星星果追击/合并调试等）。它**只影响 F12 日志，不影响任何游戏效果**。

**怎么读的**（三级兜底，写在这里备查）：

| 顺序 | 路径 |
| --- | --- |
| 1 | `%APPDATA%\com.pvzge.game\gp-next\packs\<模组文件夹名>\features.json`（文件夹名从 `import.meta.url` 抠出来，改名也能用） |
| 2 | 同上，但文件夹名硬编码为 `Cutemaodie's Tweak Mod`（旧名 `Cutemaodie's Mod` 也保留兜底） |
| 3 | `C:\Users\86152\AppData\Roaming\com.pvzge.game\gp-next\packs\...`（appDataDir 失败时的绝对路径兜底） |

读取走 Tauri 的 fs 插件：

```js
window.__TAURI_INTERNALS__.invoke('plugin:fs|read_text_file', { path })
```

> 为什么不用 `fetch`？因为 `http://tauri.localhost/` 对**任何不存在的路径**都返回 `200 + index.html`
> （SPA 兜底），fetch 出来的东西不可信 —— 实测验证过。

---

## 4. 已知限制

**引擎大版本更新后，如果类结构 / 模块名变了，对应的补丁会失效**：`setup()` 会在控制台打一行
`跳过 xxx：拿不到 yyy` 的警告 —— **不会崩游戏**，但那一项就不生效。

个别补丁会「**优雅退化**」而不是整个跳过：

| 情况 | 退化表现 |
| --- | --- |
| 香水火时长拿不到引擎对象（`PerfumeShroomPlant.explode`） | 退回**原版 9 秒**（只打警告） |
| 香水菇拿不到 `GroundFiresManager.registerJalapenoFire` | 退化成「每片火各叠 6 层」（会过强，有警告） |
| 减防特效拿不到 `cc.Prefab` / resources 路径 | 特效缺失（减防本身照常，有兜底缓存） |
| 全部数值改动拿不到 `PvZ2ObjectContainer` | 数值改动全部不生效 |

> 上面这些都会在控制台留下 `[Cutemaodies_Tweaks]` 的警告行 —— 看到就知道是哪一项没接上。

本模组代码以 **MIT License** 发布（见 [LICENSE](LICENSE)）。
