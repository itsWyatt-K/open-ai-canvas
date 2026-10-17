package ecommerce

// 商品任务状态（桌面版 domain.mjs 同款全集，中文映射见前端 StatusBadge）。
const (
	// ProductStatusDraft 未开始（已导入未启动）。
	ProductStatusDraft = "draft"
	// ProductStatusQueued 排队中（已启动待派发）。
	ProductStatusQueued = "queued"
	// ProductStatusRunning 进行中。
	ProductStatusRunning = "running"
	// ProductStatusReview 待确认方案（审核模式：整组方案待人工确认）。
	ProductStatusReview = "review"
	// ProductStatusFailed 失败。
	ProductStatusFailed = "failed"
	// ProductStatusUncertain 结果待确认（不自动重发）。
	ProductStatusUncertain = "uncertain"
	// ProductStatusCompleted 已完成（图片+标题全部成功）。
	ProductStatusCompleted = "completed"
	// ProductStatusCompletedWithWarnings 图片已完成（标题失败/待确认，titleStatus 单列）。
	ProductStatusCompletedWithWarnings = "completed_with_warnings"
	// ProductStatusPaused 已暂停。
	ProductStatusPaused = "paused"
)

// 标题状态（商品级，单列于 titleStatus）。
const (
	TitleStatusPending   = "pending"
	TitleStatusRunning   = "running"
	TitleStatusCompleted = "completed"
	TitleStatusFailed    = "failed"
	TitleStatusUncertain = "uncertain"
)

// 槽位状态（槽位级）。
const (
	SlotStatusPending   = "pending"
	SlotStatusDraft     = "draft"    // 方案已备、未派发（先审方案的暂存态）
	SlotStatusQueued    = "queued"   // 已派发、等画布子任务执行
	SlotStatusRefining  = "refining" // 细化中
	SlotStatusRunning   = "running"  // 生图中
	SlotStatusFailed    = "failed"
	SlotStatusUncertain = "uncertain" // 结果待确认
	SlotStatusCompleted = "completed"
	SlotStatusPaused    = "paused" // 用户主动停止（可重新派发）
)

// IsTerminalProductStatus 终态判定（删除/重试约束：非终态整项拒绝）。
func IsTerminalProductStatus(status string) bool {
	switch status {
	case ProductStatusCompleted, ProductStatusCompletedWithWarnings, ProductStatusFailed, ProductStatusPaused:
		return true
	default:
		return false
	}
}

// IsTerminalSlotStatus 槽位终态判定。
func IsTerminalSlotStatus(status string) bool {
	switch status {
	case SlotStatusCompleted, SlotStatusFailed:
		return true
	default:
		return false
	}
}

// SlotView 状态计算输入（Task 5 规格：status + titleStatus 两维）。
type SlotView struct {
	Status      string
	TitleStatus string
}

// ComputeProductStatus 由槽位与标题状态推导商品状态（completed_with_warnings 语义）。
//
// 规则（桌面版真值表）：
//   - 全部槽位图片完成且仅标题 failed/uncertain → completed_with_warnings；
//   - 图片+标题全部成功 → completed；
//   - 任一图片 uncertain → uncertain（不自动重发）；
//   - 任一图片 failed → failed；
//   - 其余（有 pending/queued/refining/running）→ running。
func ComputeProductStatus(slots []SlotView) (status string, titleStatus string) {
	if len(slots) == 0 {
		return ProductStatusDraft, TitleStatusPending
	}
	titleStatus = TitleStatusCompleted
	hasInFlight := false
	for _, slot := range slots {
		if slot.TitleStatus != "" {
			titleStatus = slot.TitleStatus
		}
		switch slot.Status {
		case SlotStatusUncertain:
			return ProductStatusUncertain, titleStatus
		case SlotStatusFailed:
			return ProductStatusFailed, titleStatus
		case SlotStatusCompleted, SlotStatusPending, SlotStatusDraft, SlotStatusQueued, SlotStatusPaused:
			// draft = 方案已备但未派发（先审方案暂存），不算在途。
			// paused = 用户主动停止，也不算在途（否则停止后又被推回 running）。
			// 只有 queued/running 才是真正等画布子任务的状态。
			if slot.Status == SlotStatusQueued || slot.Status == SlotStatusRunning {
				hasInFlight = true
			}
		default:
			hasInFlight = true
		}
	}
	if hasInFlight {
		return ProductStatusRunning, titleStatus
	}
	// 阶段 4：还有 draft/pending 屏未派发 → 停在 draft（不是 completed，
	// 否则用户会误以为全部生成完了）。
	for _, slot := range slots {
		if slot.Status == SlotStatusDraft || slot.Status == SlotStatusPending {
			return ProductStatusDraft, titleStatus
		}
	}
	if titleStatus == TitleStatusFailed || titleStatus == TitleStatusUncertain {
		return ProductStatusCompletedWithWarnings, titleStatus
	}
	return ProductStatusCompleted, titleStatus
}

// CountsAsCompletedForFilter 列表筛选语义：status=completed 同时含
// completed 与 completed_with_warnings 两类（桌面版"已完成"过滤同款）。
func CountsAsCompletedForFilter(status string) bool {
	return status == ProductStatusCompleted || status == ProductStatusCompletedWithWarnings
}
