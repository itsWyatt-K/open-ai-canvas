package app

// W1-01 / W1-B-02 任务链能力（自研，非上游）。
//
// 迁移说明：上游把 internal/service 整体重构成 internal/app + internal/platform，
// 旧包只留下兼容别名（type Service = app.Service），因此无法再在 service 包里给
// Service 定义方法（"cannot define new methods on non-local type"）。
// 这些方法原本在 internal/service/task_chain.go，现整体搬入 app 包。

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// ShotTimelineEntry 是 Timeline 投影用的 DTO（D-026：不落数据库）。
//
// D-033 时长语义：
//   - PlannedDurationMs = Shot.DurationMs，是导演的**计划时长**
//   - ActualDurationMs  = 当前活动版本 / 选中产物实测媒体时长；尚未生成时为 0
//
// Timeline 的视觉长度规则：ActualDurationMs > 0 用实际值，否则回退到 PlannedDurationMs。
type ShotTimelineEntry struct {
	ShotID            string  `json:"shotId"`
	ProjectID         string  `json:"projectId"`
	UnitID            string  `json:"unitId"`
	Title             string  `json:"title"`
	Position          int     `json:"position"`
	CanvasNodeID      string  `json:"canvasNodeId,omitempty"`
	SemanticType      string  `json:"semanticType,omitempty"`
	Status            string  `json:"status"`
	PlannedDurationMs int64   `json:"plannedDurationMs"`
	ActualDurationMs  float64 `json:"actualDurationMs"`
	// EffectiveDurationMs 是 Timeline 实际应该使用的时长（实际值优先，否则计划值）。
	EffectiveDurationMs float64 `json:"effectiveDurationMs"`
	RevisionID          string  `json:"revisionId,omitempty"`
	RevisionVersion     int     `json:"revisionVersion"`
	LatestTaskID        string  `json:"latestTaskId,omitempty"`
	LatestJobID         string  `json:"latestJobId,omitempty"`
	LatestArtifactID    string  `json:"latestArtifactId,omitempty"`
	HasArtifact         bool    `json:"hasArtifact"`
}

// TaskChainDetail 是 /tasks/:id/chain 的返回结构（D-009 可追踪链）。
type TaskChainDetail struct {
	Task      *model.Task                `json:"task"`
	Jobs      []model.ComfyBridgeRequest `json:"jobs"`
	Artifacts []model.ShotArtifact       `json:"artifacts"`
}

// TaskChain 读取任务链（Task → ComfyJob → Artifact）。
// D-024：逐层归属校验，禁止仅凭 ID 返回。
func (s *Service) TaskChain(userID string, taskID string) (*TaskChainDetail, error) {
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	jobs, err := s.repo.ComfyBridgeRequestsByTask(task.ID)
	if err != nil {
		return nil, err
	}
	artifacts, err := s.repo.ShotArtifactsByTask(task.ID)
	if err != nil {
		return nil, err
	}
	s.hydrateTaskProviderRequestID(task)
	return &TaskChainDetail{Task: taskForOutput(*task), Jobs: jobs, Artifacts: artifacts}, nil
}

// ShotTimelineEntries 返回项目下所有分镜的 Timeline 投影 DTO（D-026 / D-033）。
func (s *Service) ShotTimelineEntries(userID string, projectID string) ([]ShotTimelineEntry, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return nil, err
	}
	shots, err := s.repo.ProjectShots(projectID)
	if err != nil {
		return nil, err
	}
	shotIDs := make([]string, 0, len(shots))
	for _, shot := range shots {
		shotIDs = append(shotIDs, shot.ID)
	}
	revisions, err := s.repo.ShotRevisionsByShotIDs(shotIDs)
	if err != nil {
		return nil, err
	}
	artifacts, err := s.repo.SelectedArtifactsByShotIDs(shotIDs)
	if err != nil {
		return nil, err
	}
	revisionByShot := make(map[string]model.ShotRevision, len(revisions))
	for _, revision := range revisions {
		revisionByShot[revision.ShotID] = revision
	}
	artifactByShot := make(map[string]model.ShotArtifact, len(artifacts))
	for _, artifact := range artifacts {
		artifactByShot[artifact.ShotID] = artifact
	}
	entries := make([]ShotTimelineEntry, 0, len(shots))
	for _, shot := range shots {
		entry := ShotTimelineEntry{
			ShotID:            shot.ID,
			ProjectID:         shot.ProjectID,
			UnitID:            shot.UnitID,
			Title:             shot.Title,
			Position:          shot.Position,
			CanvasNodeID:      shot.CanvasNodeID,
			SemanticType:      shot.SemanticType,
			Status:            shot.Status,
			PlannedDurationMs: shot.DurationMs,
			LatestTaskID:      shot.LatestTaskID,
			LatestJobID:       shot.LatestJobID,
			LatestArtifactID:  shot.LatestArtifactID,
		}
		if revision, ok := revisionByShot[shot.ID]; ok {
			entry.RevisionID = revision.ID
			entry.RevisionVersion = revision.Version
		}
		if artifact, ok := artifactByShot[shot.ID]; ok {
			entry.HasArtifact = true
			entry.ActualDurationMs = artifact.DurationMs
		}
		// D-033：实际时长优先，未生成时回退到计划时长
		entry.EffectiveDurationMs = entry.ActualDurationMs
		if entry.EffectiveDurationMs <= 0 {
			entry.EffectiveDurationMs = float64(entry.PlannedDurationMs)
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// RetryShotTask 在分镜上下文中重试任务（D-030：Retry = 同一 Task 新增一个 ComfyJob）。
func (s *Service) RetryShotTask(userID string, projectID string, shotID string, taskID string) (*model.Task, error) {
	if _, err := s.requireShotInProject(userID, projectID, shotID); err != nil {
		return nil, err
	}
	task, err := s.repo.TaskForShot(userID, shotID, taskID)
	if err != nil {
		return nil, err
	}
	return s.RetryTask(userID, task.ID)
}

// RegenerateShot 为分镜新建一个生成任务（D-030：Regenerate = 新建 GenerationTask）。
func (s *Service) RegenerateShot(userID string, projectID string, shotID string) (*model.Task, error) {
	shot, err := s.requireShotInProject(userID, projectID, shotID)
	if err != nil {
		return nil, err
	}
	latestID := strings.TrimSpace(shot.LatestTaskID)
	if latestID == "" {
		return nil, BadAuthRequest("该镜头还没有生成记录，无法重新生成")
	}
	latest, err := s.repo.TaskForUser(userID, latestID)
	if err != nil {
		return nil, err
	}
	decrypted, err := s.decryptTaskInputJSON(latest.InputJSON)
	if err != nil {
		return nil, err
	}
	var input map[string]any
	if strings.TrimSpace(decrypted) != "" {
		if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
			return nil, BadAuthRequest("原任务参数无法解析，不能重新生成")
		}
	}
	created, err := s.CreateTask(userID, CreateTaskRequest{
		ProjectID:      latest.ProjectID,
		Type:           latest.Type,
		Operation:      latest.Operation,
		Prompt:         latest.Prompt,
		Provider:       latest.Provider,
		Model:          latest.Model,
		LogicalModelID: latest.LogicalModelID,
		Input:          input,
	})
	if err != nil {
		return nil, err
	}
	// 新任务的 canonical 链字段从原任务继承（SaveTaskChainContext 只补空值，不会覆盖）
	if err := s.repo.SaveTaskChainContext(created.ID, shot.ID, shot.CanvasNodeID, latest.WorkflowStepID); err != nil {
		return nil, err
	}
	created.ShotID = shot.ID
	created.CanvasNodeID = shot.CanvasNodeID
	created.WorkflowStepID = latest.WorkflowStepID
	created.AgentSessionID = latest.AgentSessionID
	created.AgentTurnID = latest.AgentTurnID
	return created, nil
}

// SelectShotArtifact 切换分镜「当前采用的版本」（W1-B-02）。
//
// selected 是**版本指针**，不是状态——切换版本不动 status、不动 revision、
// 不产生新版本；它只决定「下载/成片/时间线 effective 时长取哪一版」。
func (s *Service) SelectShotArtifact(userID string, projectID string, shotID string, artifactID string) (*model.ShotArtifact, error) {
	if _, err := s.requireShotInProject(userID, projectID, shotID); err != nil {
		return nil, err
	}
	artifactID = strings.TrimSpace(artifactID)
	if artifactID == "" {
		return nil, BadAuthRequest("请选择要采用的产物版本")
	}
	return s.repo.SelectShotArtifact(shotID, artifactID, time.Now())
}

// 镜头审核动作与对应状态（W1-B-02 part2 / Q-30 A 案）。
// 通过后进终态，打回退回可重做态：approve → completed，reject → draft。
const (
	shotReviewActionApprove = "approve"
	shotReviewActionReject  = "reject"

	shotStatusAfterApprove = "completed"
	shotStatusAfterReject  = "draft"
)

// ReviewShotRequest 是审核动作的输入。
type ReviewShotRequest struct {
	// Action 审核结论：approve（通过）/ reject（打回）。
	Action string `json:"action"`
	// Reason 审核理由。**不落库**（Q-31 A 案），仅由服务层回显给调用方。
	Reason string `json:"reason,omitempty"`
}

// ShotReviewResult 是审核动作的返回结果。
type ShotReviewResult struct {
	ShotID         string    `json:"shotId"`
	Title          string    `json:"title,omitempty"`
	Action         string    `json:"action"`
	Status         string    `json:"status"`
	PreviousStatus string    `json:"previousStatus"`
	Reason         string    `json:"reason,omitempty"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

// ReviewShot 对镜头给出审核结论（W1-B-02 part2）。
//
// 三条边界（Q-30/31/32 全 A 案）：
//  1. 只改 Shot.Status 一个字段，不动产物、不动 revision；
//  2. reason 不落库，只原样回显；
//  3. 不触发任何生成——打回后是否重做由调用方显式发起。
func (s *Service) ReviewShot(userID string, projectID string, shotID string, req ReviewShotRequest) (ShotReviewResult, error) {
	shot, err := s.requireShotInProject(userID, projectID, shotID)
	if err != nil {
		return ShotReviewResult{}, err
	}
	action := strings.TrimSpace(req.Action)
	var next string
	switch action {
	case shotReviewActionApprove:
		next = shotStatusAfterApprove
	case shotReviewActionReject:
		next = shotStatusAfterReject
	case "":
		return ShotReviewResult{}, BadAuthRequest("请给出审核结论：approve（通过）或 reject（打回）")
	default:
		return ShotReviewResult{}, BadAuthRequest("不支持的审核动作，只支持 approve（通过）或 reject（打回）")
	}
	now := time.Now()
	updated, err := s.repo.ReviewShot(shot.ID, next, now)
	if err != nil {
		return ShotReviewResult{}, err
	}
	return ShotReviewResult{
		ShotID:         updated.ID,
		Title:          updated.Title,
		Action:         action,
		Status:         next,
		PreviousStatus: shot.Status,
		Reason:         strings.TrimSpace(req.Reason),
		UpdatedAt:      updated.UpdatedAt,
	}, nil
}

// requireShotInProject 逐层校验「用户 → 项目 → 分镜」归属（D-024）。
func (s *Service) requireShotInProject(userID string, projectID string, shotID string) (*model.Shot, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return nil, err
	}
	shot, err := s.repo.ShotForProject(projectID, shotID)
	if err != nil {
		return nil, err
	}
	return shot, nil
}
