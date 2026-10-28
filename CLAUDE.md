# 黑皮爱嘉欣（抖音小游戏，横屏跑酷）

2026-10-28 从「嘉豪斩」（`../jiahaozhan`）的横屏跑酷原型拆出来单独立项（用户："这两个玩法分成两个项目吧，把这个单独立项，叫黑皮爱嘉欣"）。
两个项目从此各改各的，**改这边不要动 `../jiahaozhan`**。

## 工作规则

- **每次修改完成后，都要 commit 并 push 到 `main` 分支。** 不需要另开分支或 PR。（远程仓库还没建：建好以前只 commit。）

## 项目说明

- 抖音小游戏，**appid 还没有**：`project.config.json` 里是占位 `TODO-heipiaijiaxin-appid`，用户在抖音开发者后台新建小游戏以后换上。千万别填嘉豪斩的 appid（`ttab1bdda63562bafb02`）：一上传就把嘉豪斩覆盖了。
- 横屏（`game.json` 的 `deviceOrientation: landscape`），主玩法 `CFG.mainMode = 'lane'`，代码在 `game.js` 2.17 节（`LN` 参数、`updateLane` / `drawLane`，全在屏幕坐标里画）：
  四条道，上下划换道（换道撞到旁边的嘉豪踢飞），往右划斩同一条道够得着的嘉豪；柜子 / 黑板 / 饮水机斩不动；
  掉血学地铁跑酷：撞嘉豪 / 换道蹭到障碍 = 绊一跤（教导主任冲到身后 `chaseT` 秒），他在身后再绊 = 被抓，正面撞障碍 = 直接被抓。
- `game.js` 里还留着嘉豪斩的黑潮 / 正式玩法代码（`hordeMode`、`CFG.mainMode` 'horde' / 'classic'），这边用不到，测试照样跑着；以后可以删。
- 全部游戏代码在 `game.js` 一个文件里。平台 API 一律通过顶部适配层的 `MG` 调用（抖音的 `tt` 优先，微信 `wx` 兜底），不要直接写 `tt.` / `wx.`。
- 亮区（看得清的范围）= 斩杀圈 `POW.autoReach`，见 `lightR()` / `litAt()`。`view` 只是感知半径（黑暗里看得见怪物核的范围、刷怪距离、守望者），改它不会改变亮区。
- `dev/` 是调试工具，不进包（`packOptions.ignore`）。`dev/preview.js` 仍是旧的微信开发者工具预览脚本。
- 正反馈系统在 `game.js` 2.8 节：连斩段位 `COMBO_TIERS`、刃阶 `RANKS`（按累计斩杀，只是称号）、`FB` 状态。HUD 上的分数 / 余光是 `FB.score` / `FB.ying` 这类**显示值**（连斩分断了才入账、余光光点落地才加），判断真实数值要看 `score` / `yingRun`。
- 技能在 2.5 节（`SKILLS` 文案 + `SK` 数值，玩法只读 `POW`）。**换技能的 id / 级数时把 `SKILL_VER` 加一，并把旧价格表写进 `OLD_SKILL_COST`**，老存档才会全额退款。新手教学同理：换了教学步骤就把 `TUT_VER` 加一，老存档会重新教一遍。

## 声音

- 声音全是 `game.js` 里的 `S` 用 WebAudio 现场合成的。抖音**没有** `tt.createWebAudioContext`（`tt.getAudioContext` 是另一套不完整的接口），所以抖音上 `S` 一律换成文件版 `SF`：用 `tt.createInnerAudioContext` 播放 `audio/` 下的文件（循环用 wav，失败自动换 mp3 备份；单发音效用 mp3）。微信 / 浏览器仍走现场合成。
- 主界面右下角版本号上面一行是音频体检（后端 / 就绪数 / 播放次数 / 最后一条错误）。用户说没声音时先让他看这一行。**每次改动都要更新 `BUILD_TAG`**，否则分不清手机上跑的是不是新版。
- `audio/` 里的文件是 `dev/render-audio.js` 用同一个 `S` 离线渲染出来的。**改了 `S` 里的任何合成参数（或 `BGM_TIERS` / `HIT_LEVELS` / `DRONE_REF`），都要重新渲染并一起提交：**
  ```sh
  npm i --no-save node-web-audio-api @breezystack/lamejs
  node dev/render-audio.js
  ```
  只新增一个单发音效时用 `node dev/render-audio.js <名字>`（例如 `shatter`）：只渲染这一个，不清空 `audio/`，别的文件不动。
  Linux 缺 `libasound.so.2` 时：`apt-get download libasound2t64`，`dpkg-deb -x` 解出来，用 `LD_LIBRARY_PATH` 指过去。

## 测试

```sh
for f in dev/test-*.js; do node "$f" | tail -1; done
```

跑酷自己的测试是 `dev/test-lane.js`（横屏 844×390 的环境）；别的测试是从嘉豪斩带过来的，测黑潮那套（环境里都设了 `CFG.mainMode = "horde"`）。

测试在 Node `vm` 沙箱里 mock 了 `tt` 全局对象。`test-balance.js` 是随机模拟，"死亡占比"每次跑都会浮动，不能当作通过/失败的判据。
