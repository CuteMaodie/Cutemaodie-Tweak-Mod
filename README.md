# Cutemaodie's Tweak Mod

PvZ2 Gardendless 的杂项强化模组（GP-Next **JS 模组**）。

- 作者：可爱小耄（CuteMaodie）。
- 目标版本：`0.15.x` / `0.16.x`（GP-Next `1.5.5`；0.16.1 已实测）
- 形式：`pack.json` + `scripts/main.js`
- 依赖：无 —— 但**要先用 GP-Next 的「实验性 → JS Modding」开启 JS**（一次性，由你确认风险；不开则 JS 模组无法加载）

## 文件清单

| 文件 | 作用 |
| --- | --- |
| `pack.json` | 模组元信息（`js.entry` 指向脚本） |
| `scripts/main.js` | 模组本体：全 30 项改动 + `cleanup()` |
| `features.json` | 功能开关的**初始值 / 备用改法**。**平时不用动它** —— 请用游戏内的「**配置界面**」（见 §3） |
| `README.md` | 本文 |

> **⭐ 开关怎么改？进游戏就能改**：**设置 →（拉到最底下）→「配置界面」** ——
> 30 个开关一目了然，点一下就生效（**改完立刻生效，不用重启游戏**；关掉游戏再进也会记住）。
> 详见 [§3 功能开关](#3-功能开关配置界面--featuresjson)。

> **遇到 BUG 怎么办？**
>
> **① 先自查 30 秒**（能自己解决一半问题）
> - **完全退出游戏**再进（不是在「**模组**」页按「**保存并应用**」）；确认 `packs\Cutemaodie's Tweak Mod\` 里**没有多套一层文件夹**
> - F12 里应该有一行 `[Cutemaodies_Tweaks] 已加载 v1.4.6：…`；没有 ⇒ 没装上 / 没勾选 / 没重启
> - 看到 `跳过 xxx：拿不到 yyy` ⇒ 引擎版本变了（见 §4）
> - 在「**模组**」页**取消勾选**本模组 → 「**保存并应用**」→ 重启；如果还犯 ⇒ 多半不是这个包的问题
> - 游戏自带的红字**不用发**：`No armature data` / `Same slot` / `has no custom name in pack.json` /
>   `Non-existent animation.` + `DragonBones name: …`（游戏模型缺动画：**刷屏但无害**，导完日志把 F12 关掉就行）
>
> **② 按这个模板整理**（复制填空即可）
>
> ```text
> 【现象】
> 【复现步骤】哪一关 → 哪株植物 / 哪种僵尸 → 怎么操作 → 第几步出问题 → 能否重复
> 【期望】
> 【环境】游戏版本 / 模组版本 / GP-Next 版本 / 其它 mod / 在「配置界面」关掉了哪些开关
> 【F12 日志】以 [Cutemaodies_Tweaks] 开头的那几行（尤其带「跳过」「出错」的）；闪退 / 卡死就说清「怎么操作会崩、必现还是偶尔」
> 【截图】可选
> ```
>
> **③ 发到哪**（两个地方都行）：
> 1. **GitHub Issues**：[CuteMaodie/Cutemaodie-Tweak-Mod/issues](https://github.com/CuteMaodie/Cutemaodie-Tweak-Mod/issues)
> 2. **B 站评论区**
>
> **日志比文字描述更有用** —— F12 里平时只有启动摘要 + 真正的警告（"每次触发一条"的诊断日志默认关），
> 想看细节就**进游戏 → 设置 →「配置界面」→ 打开「诊断日志」**（**点一下就有，不用重启**）。
> （等价的手改方式：把 `features.json` 里的 `verboseLog` 改成 `true`，然后**完全退出游戏重启**。）

## 当前内容

> 顺序与 `features.json` 的开关列表一致；这里只列一句话速览，完整细节见 **[CHANGES.md](CHANGES.md)**。
> **想关掉其中某一项** ⇒ 进游戏 **设置 → 配置界面** 点一下（**即时生效，不用重启**），见 §3。
>
> **穿透弹通用**（暗影龙葵 / 星星果系的普攻·大招·追击弹都适用）：被小丑 / 三节棍**弹反后照样能打植物**；**路灯花 / 真隐身的植物**也照样能打到、穿透名额正常分配；**力场盾 / 全息坚果大招盾 / 月光花大招盾**也能穿过去（护盾吃伤害、子弹继续飞）。

| 植物 | 类型 | 一句话改动 |
| --- | --- | --- |
| **巴豆** | 混合 | 被啃死时击杀所有正在啃食它的非机械僵尸 |
| **钢地刺** | 数值 | 阳光 200 / 承伤 9 次 / 每 3 次掉牙 / 冷却 15 秒 |
| **心蕊** | 机制 | debuff 单体 → 1×3；被标记的僵尸啃食心蕊 / 甜薯 / 热辣海枣时减伤 |
| **暗影龙葵** | 混合 | 阳光 125；暗影态穿透 2 个 + 击退 0.25 格 |
| **白萝卜** | 机制 | 新增 0.00175 秒受伤间隔（同一帧只结算一次） |
| **甜薯** | 机制 | 受到的治疗 ×2；每秒自回血 20（实际 40/秒） |
| **高坚果** | 混合 | 免疫位移；能扛 3 次巨人砸击；冷却 30 秒 |
| **推植物修复** | 修复 | 被不可推的植物挡住时跳过它，继续找空位 |
| **香水菇** | 机制 | 香水火持续 13.5 秒；本行每只僵尸叠加 6 层心蕊减防 |
| **星星果系** | 混合 | 阳光 / 穿透 / 溅射 / 追击整套调整（含子开关「追击合并」） |
| **暗影油桃** | 混合 | 阳光 100；毒气持续 ×2；伤害 ×0.5 |
| **腐尸豆荚** | 数值 | 召唤权重调整（普通 / 大招） |
| **蒲公英** | 混合 | 阳光 325；普攻额外弹；射击有索敌；可驱离运兵艇 |
| **甜椒投手** | 混合 | 阳光 225 / 冷却 15 秒；落点 3×3 灼烧 1 秒 |
| **飓风甘蓝** | 混合 | 全屏寒风 / 减速 / 吹飞飞行僵尸；其他行同款特效 |
| **魔音甜菜** | 混合 | 眩晕 / 音乐免疫 / 解除安抚后 6 秒免疫；打断麦克与霹雳舞特殊攻击；大招击起 |
| **大蒜** | 数值 | 啃食伤害 37.5 / 阳光 75 / 冷却 15 秒 |
| **寒冰射手** | 机制 | 单格冰减速；30% 冰锥；卡面与选卡改金卡 |
| **红针花** | 混合 | 阳光 175；承伤倍率 0.2 / 0.1；左键切形态 |
| **暗影夏威夷果** | 混合 | 暗影态本体隐身；暗影物质上限 5000；冷却 5 秒 |
| **裂荚射手** | 机制 | 左键左右翻转；前后豌豆数量对调；大招同步 |
| **流星花** | 机制 | 索敌改造；第 2 颗不打歪；纯墓碑场面也会开火 |
| **孢子菇** | 混合 | 阳光 175 / 血量 100；亡语感染；毒性家族 ×1.5 |
| **玉米投手** | 机制 | 黄油落点留地面黄油（普攻 120 秒 / 大招 150 秒） |
| **卷心菜投手** | 机制 | 阳光 125；子弹首次命中后再弹 1 格 |
| **弹簧豆** | 混合 | 阳光 75 / 冷却 15 秒；群体击退；落地 3×3 眩晕 |
| **阳光菇** | 机制 | 阳光 50 / 血量 200；永久小形态；光环减冷却；大招 3×50 |
| **闪电芦苇** | 机制 | 可两栖种植；攻击与连锁可索敌浮潜僵尸 |

> **表格说明**：这里只保留一句话速览；完整数值、机制、公式、例外和图鉴改动见 **[CHANGES.md](CHANGES.md)**。
>
> 类型：**数值** / **机制** / **混合**；子开关「追击合并」属于星星果系。整行绿底 = 开，整行红底 = 关。


---

## 1. 安装

**前置（只需要做一次）**：在 GP-Next 里 **「实验性 → JS Modding」确认风险并开启 JS** ——
本模组是 **JS 模组**，不开这一项**根本加载不了**。（这不是本模组特有的要求，所有 JS 模组都一样。）

然后把整个文件夹放进「**模组 → 打开目录**」里显示的**数据目录**下的：

    %APPDATA%\com.pvzge.game\gp-next\packs\Cutemaodie's Tweak Mod\

里面应**直接**看到 `pack.json` 和 `scripts\`。然后进游戏 `F9` → 「**模组**」页 → 勾选本模组 → 「**保存并应用**」→ **重启游戏**
（也可以在「模组」页用「**导入文件夹**」直接选这一层）。

加载时控制台会打印一行确认：

    [Cutemaodies_Tweaks] 已加载 v1.4.6：巴豆(每只完整)、钢地刺(阳光200/承受9次/每3次掉牙/冷却15秒)、心蕊(1x3 debuff)、暗影龙葵(阳光125/穿透2(仅暗影态)/击退0.25)、白萝卜(0.00175s 受伤间隔)、甜薯(自回血20/秒×2，受治疗×2)、心蕊啃食减伤(心蕊×0.5/甜薯·海枣×0.75)、香水菇(6层心蕊DEBUFF/火13.5秒)、高坚果(免疫位移+扛3次砸击+冷却30秒)、星星果系(阳光125/天使175/流星550/普攻打中：星星果2个、天使2个、流星2个/溅射20%(流星果40%)/追击50%打中3个·溅射40%/延迟窗口合并0.1秒)、暗影油桃(伤害x0.5)、腐尸豆荚(召唤权重)、蒲公英(每次+1颗/延迟0.4秒/阳光325/对飞行×2·眩晕1/5秒/大招驱离运兵艇(kill))、飓风甘蓝(其他行推力50%/全屏吹飞/特效同行)、玉米投手(黄油落地留油120秒/大招150秒)、卷心菜投手(子弹首次命中再弹1格/同伤害/阳光125)、甜椒投手(阳光225/冷却15秒/落点3x3灼烧1秒/不穿甲)、魔音甜菜(普攻眩晕0.15秒/普攻免疫音乐1.25秒/大招眩晕5秒+原地击起/解除安抚/音乐免疫25秒/命中特效)、大蒜(啃食37.5/阳光75/冷却15秒)、寒冰射手(子弹冰减速/冰锥30%(薄荷×3)/冻结6秒+单格5秒/金卡)、红针花(阳光175/承伤×0.2·×0.1/左键切形态)、暗影夏威夷果(暗影态本体50%透明/暗影物质上限5000·冷却5秒/打光后真隐身)、裂荚射手(左键左右翻转/前后豌豆对调/阳光200)、流星花(索敌：本行僵尸→全场僵尸→本行障碍/护盾→全场障碍/护盾；第2颗不打歪；纯墓碑场面也开火)、孢子菇(阳光200/血量100/亡语3格·伤害=普攻×1.35(67.5·202.5·337.5)/眩晕1.5秒/感染/毒性家族×1.5/特效)、推植物跳过挡路者(开)

**卸载**：在「**模组**」页取消勾选、或把文件夹移出 `packs\` → 「**保存并应用**」。模组自带 `cleanup()`，会把所有原型方法和数据改动还原。

---

## 2. 调数值

全部集中在 `scripts/main.js` 顶部的 `CFG`：

```js
const CFG = {
    // 下面列的就是【当前实际值】；一切以 scripts/main.js 里的 CFG 为准
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
                     pbDriveDropShip: true, pbDriveMode: 'kill', pbDriveDelay: 1,     // 大招驱离运兵艇（等同电离红掌；'leave' = 纯离场；1.5 秒后生效）
                     flyingDamageScale: 2, flyingStun: 1, plantfoodFlyingStun: 5,   // 对飞行 ×2 + 眩晕（普攻1秒/大招5秒）
                     bossDamageScale: 2,                             // 指定 BOSS（热气球浮艇/领空统治者）伤害 ×2
                     bossTypes: ['zombossmech_lostcity', 'zombossmech_lostcity2', 'zombossmech_sky'] },
    pushPlant:     { skipBlockers: true },            // false = 恢复原版「被挡就把植物扔出屏幕」
    hurrikale:     { plantType: 'hurrikale', otherLanePushScale: 0.5,   // 其他行推力 = 本行的 50%
                     affectAllLanes: true, mintScalesOtherLanes: true,
                     shipWindUseBloverDuration: true, bloverType: 'blover',
                     otherLaneVfx: true, otherLaneDandelions: 1 },      // 其他每行各随机 1 株蒲公英
    phatbeet:      { plantType: 'phatbeet', sunCost: 150,
                     normalStun: 0.15, normalJamClearSeconds: 1.25, normalJamFx: true,   // 普攻眩晕 / 普攻也给音乐免疫（且也铺特效）
                     plantfoodStun: 5, liftDuration: 0.5, liftHeight: 40,
                     bossBlocksLift: true, heavyBlocksLift: true, clearPlantDebuff: true,
                     jamClearSeconds: 25, clearFx: true, jamFx: true,
                     jamFxInterval: 0, jamFxFallback: 0.3, jamFxScale: 1, jamFxLiftFollow: true },
    garlic:        { plantType: 'garlic', eatDamage: 37.5, sunCost: 75, cooldown: 15 },
    snowpea:       { plantType: 'snowpea', peaType: 'pea_snow', spikeAlias: 'pea_snow_spike',
                     cloneFrom: 'snowdrop_freeze', freezeChance: 0.30, mintChanceFactor: 3,
                     chillDuration: 10, freezeDuration: 6, splashFreezeDuration: 5 },
    redstinger:    { plantType: 'redstinger', sunCost: 175, tier1: 0.2, tier2: 0.1,
                     knockbackDistance: 0.05, clickSwitch: true },
    murkadamia:    { plantType: 'murkadamia', shadowBodyAlpha: 0.5, shieldKeepsOpaque: true,
                     hideWhenJellyDown: true, jellyBaseHp: 2500, jellyBonusHp: 2500,
                     jellyCooldown: 5, jellyInitialPct: 0.3 },
    splitpea:      { plantType: 'splitpea', sunCost: 200, clickFlip: true,
                     extraZh: '。或者向前方两倍，向后方正常', extraEn: ' Or double forward, normal backward.' },
    sporeshroom:   { plantType: 'sporeshroom',
                     sunCost: 175, toughness: 100,      // 阳光 150->175；血量上限 300->100
                     deathDamageScale: 1.35,            // 亡语伤害 = 本株普攻攻击力 × 该倍率 ⇒ 67.5 / 202.5 / 337.5
                     poisonBonus: 1.5,                  // 带「孢子感染」的僵尸受毒性家族伤害的倍率（图鉴文案也从这里现算）
                     deathStun: 1.5, deathRadiusTiles: 3,
                     deathDamageByPea: { sporeshroom_spore: 50, sporeshroom_spore1: 150, sporeshroom_spore2: 250 },   // 普攻值本身
                     fxEnable: true, debugLog: false },
};
```

---

## 3. 功能开关（配置界面 / features.json）

### 3.1 ⭐ 推荐：游戏内的「配置界面」

> **完全不用改文件、不用重启。**

1. 进游戏 → 点 **设置**
2. **把设置窗拉到最底下** → 点 **「配置界面」**
3. 出来一个有 **30 个开关**的窗口，点哪一行就切换哪一行

| 界面元素 | 含义 |
| --- | --- |
| **整行绿底** | 该项**开**（生效中） |
| **整行红底** | 该项**关**（不生效） |
| 右侧 **开 / 关** 小字 | 与颜色一致，方便色弱分辨 |
| **灰掉的行**（点不动） | 它的**父开关**关着 —— 例如「**追击合并**」需要先开「**星星果系**」 |
| 右上角**蓝色齿轮** | **恢复默认**（把 30 项全部改回出厂状态） |
| **「诊断日志」**那一行 | 打开后 F12 会多出排查用的详细日志（**只影响日志，不影响游戏**） |

**⭐ 而且不用重启**：点一下**立刻生效**，**两个方向都一样**（关掉立刻失效、再打开立刻恢复）。
退出游戏再进，也会记住你改过的状态。

> **连图鉴都会跟着变**：关掉某一项，图鉴里对应的描述会**恢复成原版**（不用重开图鉴，重新点一下那株植物就是新的）；
> 反过来打开也一样。跨功能的文案也按依赖走 —— 例如**心蕊**关掉时，**香水菇**那条 Special
> 就不再写「啃食伤害降低」（那本来是心蕊的功能）。另外**文案里的数值全部从 `CFG` 现算**，
> 所以你调了参数，图鉴会自动跟着变。

### 3.2 备用：手改 `features.json`

`features.json` 仍然有效（**配置界面改的就是同一份开关**），适合"打包前预设默认值"或"界面打不开时"。

> **注意：手改这一份必须完全退出游戏 → 重新启动才生效**（它在启动时读一次）；
> 在「模组」页按「保存并应用」**不生效**。想要即时生效就用上面的**配置界面**。



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
  "redstinger": true,       // 红针花（阳光175 / 承伤 ×0.2·×0.1 / 左键切形态 / inArea1 子弹击退0.05格）
  "murkadamia": true,       // 暗影夏威夷果（暗影态本体隐身 / 暗影物质上限 5000）
  "splitpea": true,         // 裂荚射手（左键左右翻转 / 前后豌豆对调）
  "verboseLog": false      // 【诊断日志总开关】默认关；排查问题时改成 true（只影响 F12 日志，不影响游戏）
}
```

**规则**：

- 只有**显式写了 `false`** 才算关；键不存在 / 不是布尔 → 一律按**开启**处理
- **子开关有依赖**：`starfruitFollowMerge`（A2 延迟窗口合并）**依赖 `starfruit`** —— 星果系关掉时，本项无论写 `true`、写 `false` 还是**整行删掉**，一律按**关闭**处理（运行时判定，**不会改你的 `features.json`**；`starfruit` 关着却写了 `true` 时，控制台会打一行黄色提示）
- **关掉 = 完全不打那个补丁**（不是"打了再改回原版"）
- **生效时机分两种**：
  - **用「配置界面」改** ⇒ **立刻生效**（两个方向都一样），**不用重启**；
  - **手改这个 `features.json`** ⇒ 必须 **完全退出游戏 → 重新启动**（它在启动时读一次）；
    在「**模组**」页按「**保存并应用**」**不生效**（模组只在启动时读一次；而且「保存并应用」根本不会卸载已注入的模组）
- **读不到 / 解析失败 → 全部按开启**，并在控制台打一行警告 —— 绝不会因此让模组挂掉
- **`verboseLog` 是唯一例外（它反着来）**：这是【诊断日志总开关】，**默认关** —— 写 `false` / 删掉 / 整个文件读不到，都保持**关**；
  只有显式写 `true`（或在**配置界面**里点开「诊断日志」）才会把「每次触发一条」的诊断日志打出来（甜薯治疗/自回血、心蕊减伤、香水菇、甜椒灼烧、腐尸豆荚召唤表、
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