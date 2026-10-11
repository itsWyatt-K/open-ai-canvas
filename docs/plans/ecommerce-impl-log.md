# 电商工坊本地落地 impl-log

> 每任务收尾追加一行：文件路径 + 一句话。验证手段标注（tsc ✅ / go ⏸ / bun ⏸）。

| 日期 | 任务 | 文件 | 一句话 | 验证 |
|---|---|---|---|---|
| 2026-10-11 | B1 数据模型与迁移 | `backend/internal/model/models_ecommerce.go`、`backend/internal/database/migrations.go` | 电商工坊五表（products/slots/slot_versions/user_configs/presets）+ v50 迁移，CurrentSchemaVersion 49→50 | go ⏸（本机无工具链），静态核对通过（引用/方法/标签） |
| 2026-10-11 | B2 常量与状态枚举 | `backend/internal/ecommerce/options.go`、`status.go`、`status_test.go`、`options_test.go` | 产品/标题/槽位状态全集 + completed_with_warnings 真值表 + 终态判定；质量/比例/文字模式/执行模式已固化；平台/市场/语言/模特/字体/色彩列表规范源缺失**留空待补**（不臆造） | go ⏸，测试已写待跑 |
| 2026-10-11 | F1 功能开关全链路 | `use-user-store.ts`、`require-feature.tsx`、`feature-availability-panel.tsx`、`platform/feature_availability.go`、`test/ecommerce-feature-flag.test.ts` | ecommerceEnabled 前后端全链路（类型/默认 false/union/管理面板行/payload/后端常量+Default+Enabled+Require）；tsc 抓出并修复 parse 漏字段 | 前端 **tsc ✅ 0 错误**；go ⏸；bun test 待环境 |
| 2026-10-11 | F2 路由与入口 | `router.tsx`、`workspace-sidebar-nav.tsx`、`navigation-tools.ts`、`pages/ecommerce/index.tsx`、`test/ecommerce-entry.test.ts` | /ecommerce 路由 RequireFeature 包裹；侧边栏 ecommerceEnabled 条件渲染；命名统一「电商工坊」；index.tsx 重写为占位空态（简化版三视图暂存待 F4 打捞）。**storyloom-home 本地无此结构（上游重构创作首页），首页卡片由 navigationTools 驱动已就位** | **tsc ✅ 0 错误**；bun test 待环境 |
| 2026-10-11 | B3 配置与预设 service | `internal/ecommerce/config.go(+test)`、`internal/repository/ecommerce.go`、`internal/app/ecommerce_config.go(+test)` | ConfigView 契约 + 缺省补齐语义（显式空串保持为空）+ 校验真值表（并发 1-5/mode/quality/自定义 ≤500/比例宽高）+ repo CRUD（归属防越权）+ service；预设只存创作参数（测试断言无 key/url 字段） | go ⏸（静态核对：符号/import/双包 NewAppError 用法均核对）；测试已写待跑。**验证债务：模型能力细粒度断言 [待接线]**（ResolveLogicalModel 存在性校验已做，看图/参考图断言签名待核实） |
