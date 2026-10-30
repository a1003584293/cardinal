# Cardinal 代码库导览（供 AI 快速理解用）

> 目的：让任何 AI（或新成员）在 5 分钟内建立对 Cardinal 的完整认知，不必重读全部源码。
> 生成时间：2026-09-05。基于当时的主分支代码，若代码大幅演进请以实际代码为准。

## 1. 项目是什么

Cardinal 是一个 **macOS 文件极速搜索应用**（对标 Windows 的 Everything）。

- 技术栈：**Tauri 2 + React 18 + TypeScript**（前端） + **Rust**（后端核心）
- 前端 UI：React 虚拟列表，风格模仿 macOS Finder
- 后端：自建文件索引缓存（slab + mmap），FSEvents 实时监听，Rust 原生 QuickLook 缩略图
- 目前仅 macOS（大量 objc2 / NSWorkspace / QLThumbnailGenerator 原生调用）

## 2. 仓库结构（Monorepo）

```
/Users/smith/cardinal/                  ← 仓库根
├── cardinal/                           ← 桌面应用（Tauri 项目）
│   ├── src/                            ← React 前端
│   ├── src-tauri/                      ← Rust 后端（Tauri shell）
│   ├── package.json / vite.config.ts
│   └── dist/                           ← 前端构建产物（gitignore）
├── cardinal-sdk/                       ← Rust 共享类型（EventFlag、FsEvent、EventWatcher 等）
├── lsf/                                ← CLI 搜索工具（复用搜索内核）
├── fswalk/                             ← 文件系统遍历（并行 walk）
├── fs-icon/                            ← 图标/缩略图提取（NSWorkspace + QLThumbnail）
├── namepool/                           ← 文件名内存池
├── query-segmentation/                 ← 查询分词
├── search-cache/                       ← 搜索缓存内核（SearchCache、SlabIndex、slab 分配器）
├── search-cancel/                      ← 搜索取消令牌（CancellationToken，原子版本号）
├── cardinal-syntax/                    ← 查询语法解析（Everything 兼容语法）
├── slab-mmap/                          ← mmap 支持的 slab 分配器
└── was/                                ← 独立 CLI，通过 SDK 流式输出 FSEvents
```

工具链：`rust-toolchain.toml` 钉死 **nightly-2025-05-09**。Rust workspace 在根 `Cargo.toml`。

## 3. 前端架构（cardinal/src/）

### 3.1 入口与组装

- `main.tsx` — 入口。依次初始化：主题 → 全局快捷键 → 应用菜单 → Tauri 事件运行时，然后渲染 `<App />`（StrictMode）
- `App.tsx` — **组合根**。把各 hook 的返回值拼装成 UI，本身几乎无业务逻辑
- `App.css` — **全部样式都在这一个文件**（~2000 行），含浅色/深色主题（`[data-theme='dark']` 与 `prefers-color-scheme` 两套）

### 3.2 核心组件（src/components/）

| 文件 | 职责 |
|---|---|
| `SearchBar.tsx` | 顶部搜索栏，支持"文件夹范围"分段输入（directory scope segment） |
| `FileRow.tsx` | 单行结果（memo 化）。列布局：文件名/路径/大小/修改时间/创建时间。支持拖拽（原生文件拖拽）、右键菜单、修饰键多选 |
| `VirtualList.tsx` | **虚拟滚动列表核心**。自带冻结视口（frozen viewport）机制：结果集切换时旧画面冻结，新视口就绪后无闪切换。暴露 `VirtualListHandle`（scrollToRow / getItem / ensureRangeLoaded） |
| `FilesTabContent.tsx` | 文件 tab 的容器：列头（ColumnHeader）+ VirtualList + 状态显示（StateDisplay） |
| `FSEventsPanel.tsx` | 文件系统事件 tab（实时事件流，含自己的列宽管理） |
| `ColumnHeader.tsx` | 可拖拽调宽的列头，支持排序点击与右键重置列宽 |
| `StatusBar.tsx` | 底部状态栏：生命周期指示 + Files/Events tab 切换 + 重扫描按钮 + 设置按钮 + 结果统计 |
| `PreferencesOverlay.tsx` | 偏好设置弹窗（主题/语言/托盘/排序阈值/监控根路径/忽略路径/包含路径） |
| `PermissionOverlay.tsx` | 完全磁盘访问权限引导浮层 |
| `Scrollbar.tsx` | 自绘虚拟滚动条（因为用的是 transform 虚拟滚动而非原生滚动） |
| `MiddleEllipsisHighlight.tsx` | 文件名中间省略 + 关键词高亮 |
| `StateDisplay.tsx` | loading / empty / error 状态展示 |

### 3.3 核心 hooks（src/hooks/）

数据流主线（App.tsx 中的调用顺序）：

```
useFileSearch        ← 搜索状态机（useReducer）。核心概念：
                        - searchParams: {query, directoryQuery, directoryScopeOpen, caseSensitive}
                        - queueSearch(query, {immediate?}) → 防抖 300ms（SEARCH_DEBOUNCE_MS）
                        - invoke('search') → 后端 → SEARCH_SUCCESS 更新 results/resultsVersion
                        - resultsVersion 每次结果集变化 +1，下游 hook 依赖它做缓存重置
                        - 前端有 searchVersionRef 版本号防过期响应，后端另有 CancellationToken

useFilesTabState     ← 搜索输入框 + tab 切换的 UI 状态（含搜索历史 useSearchHistory）
useRemoteSort        ← 远程排序：invoke('get_sorted_view') 让后端按元数据排序（阈值默认 20000）
useSelection         ← 行选择状态机（shift 范围选 / cmd 点选 / 活动行）；resultsVersion 变化自动清空
useQuickLook         ← QuickLook 预览面板控制（invoke toggle/update/close_quicklook）
useContextMenu       ← 右键菜单（Tauri Menu.popup：打开/Finder显示/复制文件/复制路径/QuickLook）
useAppHotkeys        ← 全局键盘快捷键（Cmd+F/R/O/C，方向键导航，Space 预览）
useAppPreferences    ← 偏好设置状态 + start_logic 触发（FDA 授权后启动后端逻辑）
useAppWindowListeners← Tauri 事件订阅（status_bar_update / lifecycle / quick_launch / 拖放）
useFilesTabEffects   ← tab 切换的副作用集中地（清选择、关预览、滚动重置）
useDataLoader        ← VirtualList 的行数据懒加载（按视口 invoke get_nodes_info，含图标）
useIconViewport      ← 视口图标节流上报（invoke update_icon_viewport，后端异步回推 icon_update）
useColumnResize / useEventColumnWidths ← 列宽拖拽
useRecentFSEvents    ← 事件 tab 的实时事件流订阅与过滤
useStoredState       ← localStorage 持久化 useState 封装（watchRoot 等在用）
useFullDiskAccessPermission ← FDA 权限检查（macos-permissions 插件）
useFrozenViewport / useStableEvent / useIgnorePaths / useIncludePaths / useWatchRoot ← 支撑性 hooks
```

### 3.4 其它前端目录

- `types/` — `ipc.ts`（Tauri 事件 payload）、`search.ts`（SearchResultItem）、`slab.ts`（SlabIndex=number）、`sort.ts`
- `runtime/tauriEventRuntime.ts` — **Tauri 事件总线**：模块级 Set 分发器，把 `listen()` 收到的事件转发给多个订阅者（`subscribeStatusBarUpdate` / `subscribeIconUpdate` 等）。新增事件模式固定：加 listeners Set + `listen()` + `subscribeXxx()`
- `utils/` — `openResultPath`（invoke open_path）、`openPreferences`（window event 触发 App 内监听）、`globalShortcuts`（注册 Cmd+Shift+Space 全局唤起）、`path.ts`（splitPath）、`keyboard.ts`（hasModifierKey）、`drag.ts`（原生拖拽）、`format.ts`（KB/时间戳）、`watchConfig.ts`、`watchRoot.ts`
- `constants/` — 列宽比例、ROW_HEIGHT=24、防抖值、appEvents（window 自定义事件名）
- `i18n/` — i18next，15 种语言，资源在 `resources/*.json`；`menu.ts` 菜单项文本也走 i18n
- `menu.ts` — **应用菜单**（Tauri Menu API）：About / Preferences(Cmd+,) / Hide(Esc) / Quit / Edit / View / Window / Help
- `theme.ts` — 主题偏好（system/light/dark → `data-theme` 属性 + localStorage）
- `tray.ts` / `trayIconPreference.ts` — 托盘图标

### 3.5 前端数据流要点（改代码必读）

1. **SlabIndex 是行的主键**：后端返回 `number[]`（slab 索引），前端按需 `get_nodes_info` 换取 path/metadata/icon。`useDataLoader` 的缓存 Map 以 SlabIndex 为 key，`dataResultsVersion` 变化时整个缓存作废重建
2. **图标异步两阶段**：行数据先到（无图标），后端 `icon_update` 事件随后推送 base64 PNG（`useDataLoader` 里的 iconOverrides 机制防止旧覆盖新）
3. **搜索防抖 + 版本号**：300ms 防抖；前端 `searchVersionRef`、后端 CancellationToken 双保险，晚到的响应直接丢弃
4. **虚拟滚动非原生**：`scrollTop` 是 React state，滚轮事件被 preventDefault 后手动累积；横向滚动用原生（同步给列头）
5. **窗口失焦变灰**：`data-window-focused` 属性切换选中行配色（模仿 Finder）

## 4. 后端架构（cardinal/src-tauri/src/）

| 文件 | 职责 |
|---|---|
| `main.rs` | 仅 3 行，调 `cardinal_lib::run()` |
| `lib.rs` | **Tauri 组装**。创建各 crossbeam channel，注册命令与窗口事件。**两条线程模型**：主线程跑 Tauri 事件循环；`logic 线程`等 FDA 授权（`start_logic` 命令）后跑 `run_logic_thread`（加载/构建缓存 → 起 EventWatcher → 进 `run_background_event_loop`）。退出时 flush 缓存到 `~/Library/Application Support/com.cardinal.one/cardinal.db` |
| `background.rs` | **后台事件循环核心**（select! 多路复用各 channel）。搜到 icon 请求时用 rayon spawn 并行生成 QL 缩略图，100ms 节流批量 emit `icon_update` |
| `commands.rs` | **所有 #[tauri::command]**：search / get_nodes_info / get_sorted_view / update_icon_viewport / trigger_rescan / set_watch_config / open_path / open_in_finder / quicklook 三兄弟 / copy_files_to_clipboard（NSPasteboard）/ toggle_main_window / start_logic 等。SearchState 持有各 channel Sender |
| `quicklook.rs` | QLPreviewPanel 原生封装（objc2） |
| `sort.rs` | 后端排序（SortEntry + sort_entries） |
| `lifecycle.rs` | App 状态机：Initializing → Updating → Ready（emit `app_lifecycle_state`） |
| `search_activity.rs` | 活跃时间记录（防休眠扫描？） |
| `window_controls.rs` | 主窗口显示/隐藏/切换（NSApp activate） |

### 4.1 关键数据结构

- `SearchJob { query, options, cancellation_token, result_tx }` — 前端每次 search 都经 channel 发给后台线程，后台用缓存查询后经 result_tx 回传
- `SearchResponse { results: Vec<SlabIndex>, highlights, status_code }` — status_code 0=OK 1=CANCELLED
- `IconPayload { slab_index, icon: String(base64) }` — 后台异步推图标

### 4.2 channel 清单（lib.rs 创建）

search_tx / node_info_tx / icon_viewport_tx / rescan_tx / watch_config_tx / icon_update_tx / update_window_state_tx / finish_tx / logic_start_tx

## 5. 搜索语法（cardinal-syntax crate）

支持 Everything 兼容语法：`*.pdf briefing`、`size:>100MB`、`in:/Users demo !.psd`、`tag:A;B`、`content:"..."`、引号短语、`/前缀/`、`~/**/.DS_Store` globstar 等。详见 `doc/pub/search-syntax.md`。

## 6. 构建与开发命令

```bash
# 前端
cd cardinal
npm ci
npm run dev                          # 纯 Vite（浏览器预览，无 Tauri 外壳）
npm run tauri dev -- --release --features dev   # 桌面开发模式
npm run build                        # 前端产物
npm run tauri build                  # 打包 .app/.dmg（产物在 src-tauri/target/release/bundle/）
npm run typecheck                    # tsc --noEmit
npm run test                         # vitest（单次）
npm run format / format:check        # Prettier

# Rust workspace
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets
cargo fmt --all
```

- 首次构建需：`rustup toolchain install nightly-2025-05-09` + Xcode CLT
- Tauri 配置：`cardinal/src-tauri/tauri.conf.json`（identifier `com.cardinal.one`，bundle signingIdentity "-" 即 ad-hoc 签名）
- 权限能力声明：`src-tauri/capabilities/{default,desktop}.json`（global-shortcut、opener、drag、window-state、macos-permissions）

## 7. 约定与风格（AGENTS.md 摘要 + 实际观察）

- Rust：分组 import、`anyhow::Result`、`tracing` 日志、测试与代码同目录
- React：组件 PascalCase.tsx；hooks 导出 camelCase；Prettier（单引号、100 宽、all 尾逗号）
- 测试：`src/__tests__/`（App 级）、`components/__tests__/`、`hooks/__tests__/`；App 测试大量 vi.mock 各 hook
- i18n：**新增任何用户可见文案必须同步 15 个 resources/*.json**（至少 en-US + zh-CN，其余可后补但会破坏测试一致性）
- CSS：全部在 App.css，新 UI 沿用既有 design token（--color-*、--row-* 等变量），深色模式两套都要写（`[data-theme='dark']` + `@media prefers-color-scheme` 内的 `:root:not([data-theme])`）
- 状态持久化惯例：localStorage key 前缀 `cardinal.`（如 `cardinal.theme`、`cardinal.language`、`cardinal.search.directoryScopeOpen`）

## 8. 本次会话新增功能（书签 / 平铺视图 / 多标签页）

已完成：

1. **书签管理器**（`src/components/BookmarksOverlay.tsx` + `src/hooks/useBookmarks.ts`，localStorage key `cardinal.bookmarks.v1`）
   - 左侧分类、右侧该书签列表；上移/下移/编辑/删除；双击书签默认新标签页搜索
   - 书签有展示名（name）与实际搜索词（query）两个字段；**只填其中一个时会用另一个补齐**（避免"添加无反应"）
2. **平铺视图**（`src/components/IconGrid.tsx` + `IconGridItem.tsx`，开关在 `useViewMode.ts`）
   - 空格子定位必须是 `top: row * cellHeight + CELL_GAP - scrollTop`：`.virtual-list-viewport` 是 `overflow-y: hidden`，滚动完全靠 `scrollTop` 状态驱动，漏减 `scrollTop` 会让下方行被裁掉（曾表现为"越滚越空"）
   - `scrollToRow` 必须实现 `nearest/start/end/center` 对齐；简化的"直接滚到 row*cellHeight"会让右键选中把视图顶飞
   - 图标栅格由 `useDataLoader({ iconSize })` 决定：列表 32px，平铺按当前档位 ×2（上限 384px）。`iconSize` 变化会清空行缓存并重新拉取
3. **多标签页**（`src/components/SearchTabsBar.tsx` + `src/hooks/useSearchTabs.ts`）：只保存 query，切换标签触发重搜
4. **书签右键菜单**：在当前标签页搜索（替换）/ 在新标签页搜索

**图标尺寸链路**（改尺寸相关需求必须一起动）：
`IconSizePreset`（`IconGrid.tsx`）→ `useDataLoader({iconSize})` / `useIconViewport({iconSize})` → 命令 `get_nodes_info` / `update_icon_viewport` 的 `iconSize` 参数 → `fs-icon::icon_of_path_ns_sized` / `icon_of_path_ql_sized`。

**布局注意**：`main.container` 是 flex column（不是 grid），因为标签栏是可选行。`results-container` 用 `flex: 1 1 auto`，`search-container` / `search-tabs` / `status-bar` 用 `flex: 0 0 auto`。

### 本次追加（第三轮）

5. **目录范围浏览语义**：限定文件夹范围时，`search_directory_contents` 先返回匹配到的目录本身，再返回其全部子孙（目录在前）。注意 `search_directory_scope`（作为主查询 base 时）**仍只取子孙**，不要混用
6. **筛选器下拉**（`src/components/FiltersOverlay.tsx` + `src/hooks/useSearchFilters.ts` + `src/types/searchFilters.ts`，localStorage `cardinal.searchFilters.v1` / `.selected.v1`）
   - 首次运行用内置预设播种（音频/压缩/文档/可执行/文件夹/图片/视频），之后完全归用户所有
   - 选中项与输入框通过 `combineQueryWithFilter` 组合：空查询→直接用 filter；有查询→`(query) filter`
   - 配置弹窗左侧表格、右侧竖排按钮（新建/编辑/导入/导出/删除）
7. **CSV 导入导出**（`src/utils/csv.ts` + `src/utils/fileTransfer.ts` + 后端 `write_text_file` / `read_text_file`）
   - 书签格式：`category,name,query`；筛选器格式：`name,search`
   - 首次引入 `@tauri-apps/plugin-dialog`；**JS 包版本必须与 Rust crate 的 minor 对齐**，否则 `tauri build` 会因版本不匹配直接失败
8. **全局字号**（`src/hooks/useFontSize.ts` + `src/types/fontSize.ts`）
   - 通过 `--app-font-size` 自定义属性驱动 `:root { font-size }`；App.css 中所有字号都写成 `rem`，改一处全局生效
   - `--row-height: calc(var(--app-font-size) * 1.85)`，与 `rowHeightForFontSize()` 保持一致

**两条易回归的坐标/尺寸陷阱**：
- `IconGrid`/`VirtualList` 的 `viewportHeight` 必须测 `.virtual-list-viewport` 的 `clientHeight`（不含横向滚动条），测外层容器会让最后一行被横向滚动条盖住
- `.row` 的行高由 slot 决定，`line-height: var(--row-height)` 且无垂直 padding，字号放大时不会溢出

### 第四轮（书签过滤器 / Cmd+S / 性能）

9. **`ext:` 与分号语法**（回答"这串是什么"）：`ext:` 是 Everything 风格过滤器，冒号前是过滤器名、后面是参数；分号 `;` 是**多个扩展名的列表分隔符**，等价于 OR。所以 `ext:ani;apng;avif;...;wmf` = "扩展名属于这一串中的任意一个"。本仓库完全支持，见 `cardinal-syntax` 的 `try_parse_list` 与 `search-cache` 的 `normalize_extensions`；`folder:` 表示"只要目录"。粘贴 Everything 的整串可以直接用。
10. **书签带过滤器**：`Bookmark.filterSearch` 存的是过滤器的 **search 文本**（不是预设 id），这样预设改名/删除后书签仍有效，CSV 也可移植。打开书签时**同时替换查询与过滤器**（新标签页从该过滤器起步）。
11. **默认分类**：`DEFAULT_BOOKMARK_CATEGORY_ID = 'default'`，不可删除/改名，永远排第一；Cmd+S 保存的书签都进这里。导出时该分类的 `category` 列写空；导入时 `category` 为空的行回落到默认分类。
12. **Cmd+S**：`useAppHotkeys` 在"可编辑元素早退"**之前**处理，所以在搜索框里也能用；保存当前 tab 的 `query`（name/query 都是它）与当前过滤器，并弹 toast。Cmd+Shift+S 不拦截。
13. **书签 CSV**：`category,name,query,filter`。空 `name`+`query` 但 `category` 有值的行会**创建该分类**（不丢行）。
14. **性能（三个根因）**：
    - 空查询原先返回**全盘所有节点**（几百万 slab index 过 IPC）→ 现在返回空结果，开新 tab 立刻出空状态
    - `get_nodes_info` 原先**同步为每行生成图标**（平铺还是 384px 光栅）→ 现在 `includeIcons: false`，只取元数据，图标走后台 `update_icon_viewport`（新增 `fs_icon::icon_of_path_sized`，带 NSWorkspace 回退，所以目录也有图标）
    - 目录范围浏览整棵子树原先无上限 → `DIRECTORY_BROWSE_LIMIT = 20_000` 封顶
15. **字号滑块**：拖动时只更新本地 draft，`pointerup/mouseup/keyup/blur` 才提交，轨道加宽到 16rem，避免 1 像素跳动跨 5 档。

### 第五轮（图标策略 / 书签面板 / tab 过滤器隔离）

16. **图标策略（前端可读，但生成必须在原生侧）**：文件图标无法在纯前端拿到"系统为该类型关联的应用图标"——按扩展名自己画一套是错的（`.html` 该显示 Chrome/VS Code 的图标，取决于用户默认应用）。正确做法是原生 `NSWorkspace::iconForFile`，它**天然返回"默认打开该类型应用的图标"**，也就是访达里看到的那张图。所以：
    - 图片/视频扩展名（`IMAGE_EXTENSIONS` / `VIDEO_EXTENSIONS`）→ QuickLook 封面图
    - 其它（含目录）→ `NSWorkspace` 应用图标
    - **提速靠缓存不是靠前端**：`APP_ICON_CACHE` 按 `扩展名@尺寸` 缓存位图，500 个 `.html` 只付 1 次 LaunchServices 查询
17. **书签面板改为非模态浮层**：`position: fixed; top/right/bottom`，容器 `pointer-events: none`、卡片 `auto`，`main` 不再 `aria-hidden`。这样连续右键「在新标签页搜索」能立刻看到新 tab，而不是以为没生效
18. **tab 过滤器隔离**：`createTab` / `activateTab` 的 `setState` 尚未提交时调用 `setActiveTabFilter` 会写到**上一个** active tab。因此：
    - 打开书签/切换 tab 只调用 `selectFilterPreset`（只更新下拉），过滤器随 tab 一起由 `createTab(query, filter)` 带上，或用 `queueSearchWithFilter` 直接驱动搜索
    - 需要改当前 tab 过滤器时（用户操作下拉）才用 `setActiveTabFilter`
19. **书签编辑器**：name / query 任一输入框按 Enter 都提交；`filterOptions` 里没有匹配项时保留原 filter 并用「自定义过滤器」占位，避免静默重置
20. **书签 CSV 保留空分类**：导出时没有书签的分类会补一行 `分类名,,,`；导入时 `category` 有值而 name/query 为空 → 创建空分类

### 第六轮（启动最近文件 / 可拖动面板 / 排序菜单）

21. **启动默认视图**：空查询不再返回空列表，而是 `most_recent_nodes(RECENT_NODE_LIMIT = 200)` —— 按 `ctime` 倒序（回退 `mtime`）取最新的 200 个。注意走查阶段 metadata 是懒加载的，`ctime` 常为未缓存，所以此函数会对缺时间的节点**按需 `stat` 并回填缓存**（`stat_timestamp`），否则文件永远进不了"最近"列表
22. **书签面板**：非模态浮层 + **可拖动**（`usePanelDrag`，拖 header 即可，位置存 `cardinal.bookmarks.panelPosition.v1`，拖 header 上的按钮不触发拖动，窗口缩放时自动夹回视口）。打开书签（两种模式）都**不关闭**面板
23. **删除按钮被遮挡**：`.bookmarks-body` 的网格列改为 `180px minmax(0, 1fr)`、行改为 `minmax(0,1fr) minmax(0,0.9fr) auto` —— 用 `minmax(0, …)` 才能让名字/查询列收缩，否则长文本把 edit/delete 挤出面板
24. **右键排序菜单**（`SortMenu.tsx`）：结果区空白处右键 → `按大小 / 创建时间 / 修改时间 / 名称` + 悬停二级 `正序 / 倒序`，另有「取消排序」。用 HTML 实现是因为 **Tauri 原生菜单不支持二级菜单**；`SortMenu` 会同时避开窗口右/下边界
25. **排序按 tab 隔离**：`useRemoteSort(..., sortScopeKey)` 内部用 `Record<tabId, SortState>` 保存，切换 tab 各自恢复；`setSortState` 暴露出来供右键菜单直接设置

### 第七轮（授权后免重启 / 启动卡死根因）

26. **完全磁盘访问授权后免重启**：`check_full_disk_access_permission` 每次都是真实的 `readdir` 系统调用，TCC 逐次评估，所以**轮询即可感知授权**，不需要重启进程。`useFullDiskAccessPermission` 现在在 `denied` 状态下每 `FDA_POLL_INTERVAL_MS(1200ms)` 静默重试，并在 `window focus` / `visibilitychange` 时立即重试；`granted` 后停止轮询。弹窗新增「重新检测」按钮与「无需重启」提示，第 3 步文案从"允许重启"改为"回到 Cardinal 自动生效"
    - 关键：静默轮询不设置 `isChecking`，否则会让 `useAppPreferences` 的启动闸门反复 bail 并闪烁
    - 探测有 4s 超时，超时**保持原状态**而不是降级为 `denied`，避免已授权应用被误弹权限框
27. **启动卡死的两个真实根因**（都修了）：
    - `start_logic` 若在 `LOGIC_START` 初始化前到达会被静默丢弃，而前端已把 `logicStartedRef` 置位 → 后台线程永远停在 "Waiting for Full Disk Access signal"。现在早到的请求存入 `PENDING_LOGIC_START`，`wait_for_logic_start` 先取它；前端在 `invoke` 失败时清除 latch 以便重试
    - `most_recent_nodes` 曾对全盘每个节点 `stat`（380 万文件 ≈ 数分钟，把搜索线程堵死）。现在限制为 `RECENT_SCAN_LIMIT(20000)` + `RECENT_STAT_BUDGET_MS(60)` 预算，并用 `take_indices` 避免先物化整个索引。实测 release：缓存加载 2.4s、最近列表 60ms
28. **窗口恢复越界**：window-state 插件可能恢复出屏幕外的坐标（如 `y:1105` 而屏幕高 1080），表现为"软件启动了但看不到窗口"。`activate_window` 新增 `ensure_on_screen`，窗口与所有显示器都不相交时移回主屏左上角

### 第八轮（面板缩放 / tab 间距 / 选中项信息 / 首页懒加载）

29. **书签面板可缩放**（`usePanelDrag` 扩展）：拖左边缘调宽、拖下边缘调高，尺寸存 `cardinal.bookmarks.panelSize.v1`。缩放时左边缘向外扩张必须同时调整 `x`（右边缘保持不动），且 `y` 要取**面板原始 top**，不能用鼠标位置（这个 bug 是被单测抓出来的）。最小 `420×260`
30. **书签编辑器布局**：原来四个控件挤一行会把过滤器下拉和输入框裁掉。现在 `.bookmarks-bookmark-add` 用 grid，**过滤器独占第一行**（`grid-column: 1 / -1`），名称/搜索/按钮在第二行
31. **tab 间距**：`.search-tab` 加 `min-width: 4.5rem`、`padding: 0 10px`、`gap: 8px`、高 30px，标签字号 0.95rem 且 `flex: 1`，短查询（如 `dd`）不再比关闭按钮还小
32. **选中项信息**：
    - 底部状态栏：路径（`direction: rtl` + `unicode-bidi: plaintext`，长路径保留文件名）+ 人类友好大小 + 多选计数
    - 顶部工具栏右侧（大/超大图标之后）：创建时间、修改时间，格式 `YYYY-MM-DD HH:mm:ss`
    - 数据源：`useSelection` 新增 `selectedItems`（完整行数据），`selectedPaths` 改为从它派生
33. **人类友好大小**：`formatSize()` → `4KB` / `50MB` / `200MB` / `1G` / `1.24G`（<10 保留两位并去尾零，≥10 取整）。行内大小列也改用它
34. **首页懒加载**：空查询视图滚到接近底部自动请求下一页
    - 前端：`VirtualList` / `IconGrid` 新增 `onNearEnd`（距底 20 行 / 2 格时触发）；`SEARCH_APPEND` 追加结果且**不 bump `resultsVersion`**（否则会清空行缓存和滚动位置），App 侧按 slabIndex 去重
    - 后端：`get_recent_nodes(offset, limit)`；**必须缓存排名快照**（`RECENT_SNAPSHOT_SIZE = 5000`）后按需切片。逐页重新排名不可用：`most_recent_nodes` 有时钟预算，两次调用会停在不同位置，实测页间重叠 4 条
    - 快照在 FS 事件到达时失效（`recent_snapshot = None`），避免展示过期条目
    - 仅空查询视图启用，真实搜索结果始终完整（再排名意味着反复 `stat`）

### 第九轮（8 向缩放 / query 列交互 / 时间居中）

35. **书签面板 8 向缩放**：`usePanelDrag` 的 `resizeHandleProps(name)` 接受 `top/bottom/left/right/topLeft/topRight/bottomLeft/bottomRight`（内部映射到 `n|s|e|w|ne|nw|se|sw`）。角手柄同时置两个方向标志，所以对角线跟随鼠标
    - 关键：拖 west/north 类手柄时原点要跟着走（`x = startLeft + (startWidth - nextWidth)`），否则面板会「反向移动」；这项有单测覆盖四个角
    - 把手尺寸：边 6px、角 14px（角覆盖边，避免角落失效）；CSS 类名 `bookmarks-resize-handle--<name>`
36. **query 列与 name 列行为一致**：把 `<span>` 改成 `<button class="bookmarks-bookmark-query">`，单击载入编辑器、双击新标签页打开、右键弹搜索菜单。注意这会让 `getByTitle`/`getByRole(name)` 在 name 与 query 文本相同时匹配到两个元素，测试要用 class 精确定位
37. **工具栏时间居中**：`.view-toolbar__meta` 改为 `position: absolute; left: 50%; transform: translate(-50%, -50%)` + 父级 `position: relative`。用 `flex: 1` + `justify-content: center` 只能居中「图标按钮右侧的剩余空间」，视觉上仍偏右

### 第十轮（书签行等高对齐 / 首屏筛选器错位）

38. **首屏筛选器显示与结果不一致（真 bug）**：`useSearchFilters` 曾用 `useStoredState` 持久化 `selectedId`（`cardinal.searchFilters.selected.v1`），而每个标签页的 `tab.filterId` 是内存态。于是重启后下拉框显示「文件夹」，实际标签页的过滤器是 `null` → 首页列表里混进了非文件夹结果；手动点「所有」因为值和当前相等，`onChange` 不触发，看起来「切了没反应」
    - 修复：`selectedId` 改成纯 `useState<string | null>(null)`，启动时总是「所有」；同时 `useEffect` 删除历史遗留的 storage key（`LEGACY_SELECTED_STORAGE_KEY`），否则老用户继续踩
    - 经验：**选择态如果能被另一份状态（`tab.filterId`）覆盖，就不要持久化它**，否则两份状态会在重启后分叉。有 2 个回归测试，其中「有 legacy key 也必须是未选中」那条做了变异验证
39. **书签行两列不等高 / 分隔线不齐**：name 和 query 都是 `<button>`，只写了 `background: transparent` 时浏览器 UA 仍会加 `padding` + `border`，且 name 里的文字被 `align-items` 拉伸 → query 撑到文字高度、name 撑到行高，底部 border 看着就错位
    - 修复：两列共用一条规则，显式清空 `display: flex; align-items: center; height: 1.9rem; padding: 0 4px; border: none; margin: 0`；name 加 `justify-content: center`（用户要求居中而非左对齐）
    - **flex 容器无法自己 ellipsis**：文本要包一层 `.bookmarks-bookmark-cell-text`（`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`），否则长名字直接把列撑破
40. **书签分隔线颜色**：新增 token `--bookmark-row-border`（浅色 `#495057`、深色 `#868e96`），刻意比 `--color-border` 深，1px 才看得见。改颜色只动这个 token，别去改 `border-bottom` 那行


## 9. 快速定位表（"我想改 X 应该去哪"）

| 想改什么 | 去哪 |
|---|---|
| 搜索逻辑/防抖/结果状态 | `src/hooks/useFileSearch.ts` |
| 搜索框行为 | `SearchBar.tsx` + `useFilesTabState.ts` |
| 结果列表渲染/虚拟滚动 | `VirtualList.tsx` + `FileRow.tsx` |
| 行数据/图标懒加载 | `useDataLoader.ts` + `useIconViewport.ts` |
| 快捷键 | `useAppHotkeys.ts`（应用内）/ `utils/globalShortcuts.ts`（全局） |
| 右键菜单 | `useContextMenu.ts` |
| 应用菜单栏 | `menu.ts` |
| 偏好设置 | `PreferencesOverlay.tsx` + `useAppPreferences.ts` |
| 后端命令/IPC | `src-tauri/src/commands.rs` + `lib.rs` 的 invoke_handler |
| 后台循环/搜索执行 | `src-tauri/src/background.rs` |
| 图标/缩略图生成 | `fs-icon/src/lib.rs` + `background.rs` 的 handle_icon_viewport_update |
| 主题/深色模式 | `App.css`（token + 两套深色规则）+ `theme.ts` |
| 新语言文案 | `src/i18n/resources/*.json`（15 个全改） |
| 搜索筛选器（下拉/配置/导入导出） | `useSearchFilters.ts` + `FiltersOverlay.tsx` + `types/searchFilters.ts` |
| CSV 导入导出 | `utils/csv.ts` + `utils/fileTransfer.ts` + 后端 `write_text_file`/`read_text_file` |
| 全局字号 | `useFontSize.ts` + `--app-font-size`（App.css 全部用 rem） |
| 书签（过滤器/默认分类/Cmd+S） | `useBookmarks.ts` + `BookmarksOverlay.tsx` + `types/bookmarks.ts` |
| Cmd+S 保存书签 | `useAppHotkeys.ts` + `App.tsx` 的 `handleSaveCurrentSearchAsBookmark` |
| `ext:` / `folder:` 语法 | `cardinal-syntax`（解析）+ `search-cache/src/query.rs`（求值） |
| 搜索结果上限/浏览封顶 | `search-cache/src/cache.rs` 的 `DIRECTORY_BROWSE_LIMIT` |
| 文件图标策略（系统应用图标 vs 封面图） | `fs-icon/src/lib.rs` 的 `prefers_cover_thumbnail` + `APP_ICON_CACHE` |
| 启动"最近文件"列表 | `search-cache/src/cache.rs` 的 `most_recent_nodes` + `RECENT_NODE_LIMIT` |
| 完全磁盘访问授权/免重启 | `useFullDiskAccessPermission.ts`（轮询）+ `PermissionOverlay.tsx` |
| 启动闸门（何时开始索引） | `useAppPreferences.ts` 的 logic gate + 后端 `LOGIC_START` / `PENDING_LOGIC_START` |
| 窗口显示/位置校正 | `window_controls.rs` 的 `activate_window` / `ensure_on_screen` |
| 书签面板拖动/缩放 | `usePanelDrag.ts`（位置 + 尺寸持久化） |
| 首页懒加载分页 | `background.rs` 的 `RECENT_SNAPSHOT_SIZE` + `get_recent_nodes` + `SEARCH_APPEND` |
| 文件大小/时间格式化 | `utils/format.ts` 的 `formatSize` / `formatTimestamp` |
| 书签行样式/分隔线 | `App.css` 的 `.bookmarks-bookmark-row` + `--bookmark-row-border` |
| 筛选器选中态（不持久化） | `useSearchFilters.ts` 的 `selectedId` |
| 结果区右键排序 | `SortMenu.tsx` + `useRemoteSort` 的 `sortScopeKey` |
| 窗口行为（关闭即隐藏等） | `lib.rs` 的 on_window_event + `window_controls.rs` |
