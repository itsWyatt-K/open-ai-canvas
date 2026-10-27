package app

import (
	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/repository"
)

func cloudAgentToolHandlers() map[string]cloudAgentToolHandler {
	return map[string]cloudAgentToolHandler{
		agenttool.AgentProfileRead:       {Read: cloudAgentHandleAgentProfileRead},
		agenttool.PlanUpdate:             {Read: cloudAgentHandlePlanUpdate},
		agenttool.AskUser:                {Read: cloudAgentHandleAskUser},
		agenttool.PrevisSceneRead:        {Read: cloudAgentHandlePrevisSceneRead},
		agenttool.PrevisPreview:          {Read: cloudAgentHandlePrevisPreview},
		agenttool.PrevisSceneCreate:      {Write: applyCloudAgentPrevisMutation, Preview: cloudAgentPreviewPrevisCreate},
		agenttool.PrevisApplyPatch:       {Write: applyCloudAgentPrevisMutation, Preview: cloudAgentPreviewPrevisPatch},
		agenttool.CanvasListNodeTypes:    {Read: cloudAgentHandleCanvasListNodeTypes},
		agenttool.CanvasGetState:         {Read: cloudAgentHandleCanvasGetState},
		agenttool.CanvasReadText:         {Read: cloudAgentHandleCanvasReadText},
		agenttool.CanvasReadBatchTable:   {Read: cloudAgentHandleCanvasReadBatchTable},
		agenttool.CanvasReadStoryboard:   {Read: cloudAgentHandleCanvasReadStoryboard},
		agenttool.ImageTextDetect:        {Read: cloudAgentHandleImageTextDetect},
		agenttool.ImageAnnotationRender:  {Read: cloudAgentHandleImageAnnotationRender},
		agenttool.SkillReadFile:          {Read: cloudAgentHandleSkillReadFile},
		agenttool.SkillSearch:            {Read: cloudAgentHandleSkillSearch},
		agenttool.TaskGet:                {Read: cloudAgentHandleTaskGet},
		agenttool.CanvasInspectImage:     {Pipeline: cloudAgentToolVision},
		agenttool.RecallLessons:          {Read: cloudAgentHandleRecallLessons},
		agenttool.RememberLesson:         {Read: cloudAgentHandleRememberLesson},
		agenttool.ImageLayerSplit:        {Pipeline: cloudAgentToolMedia},
		agenttool.ModelList:              {Read: cloudAgentHandleModelList},
		agenttool.CanvasCreateStoryboard: {Write: applyCloudAgentStoryboardMutation, Preview: cloudAgentPreviewStoryboardCreate},
		agenttool.CanvasEditStoryboard:   {Write: applyCloudAgentStoryboardMutation, Preview: cloudAgentPreviewStoryboardEdit},
		agenttool.CanvasCreateCharacter:  {Write: applyCloudAgentCharacterCreate, Preview: cloudAgentPreviewCharacterCreate},
		agenttool.CanvasEditBatchTable:   {Write: applyCloudAgentBatchTableMutation, Preview: cloudAgentPreviewBatchTable},
		agenttool.CanvasApplyOps:         {Write: applyCloudAgentCanvas, Preview: cloudAgentPreviewCanvas},
		agenttool.CanvasArrangeNodes:     {Write: applyCloudAgentArrangeNodes, Preview: cloudAgentPreviewArrange},
		agenttool.GenerateMedia:          {Pipeline: cloudAgentToolMedia},
		// ===== 本地增量工具执行绑定（2026-10-27 合流）=====
		// 本地 handler 签名 (services, userID, call) 经适配器接入注册表；
		// KindWrite 工具补 Write+Preview，KindMedia 工具标记 media 管线（审批门全模式生效）。
		agenttool.EcommerceGetProductDetail: {Read: cloudAgentAdaptLocalRead(cloudAgentEcommerceGetProductDetail)},
		agenttool.EcommerceUpdateSlotPrompt: {Write: cloudAgentAdaptLocalWrite(cloudAgentEcommerceUpdateSlotPrompt), Preview: cloudAgentPreviewEcommerceAction("修改槽位文案与提示词")},
		agenttool.EcommerceApplyPlatform:    {Write: cloudAgentAdaptLocalWrite(cloudAgentEcommerceApplyPlatform), Preview: cloudAgentPreviewEcommerceAction("切换电商目标平台")},
		agenttool.EcommercePlanProduct:      {Pipeline: cloudAgentToolMedia, Write: cloudAgentAdaptLocalWrite(cloudAgentEcommercePlanProduct), Preview: cloudAgentPreviewEcommerceAction("派发 AI 视觉策划（按文本模型计费）")},
		agenttool.EcommerceConfirmPlan:      {Pipeline: cloudAgentToolMedia, Write: cloudAgentAdaptLocalWrite(cloudAgentEcommerceConfirmPlan), Preview: cloudAgentPreviewEcommerceAction("确认企划并派发生图（计费动作）")},
		agenttool.DirectorValidatePrompt:    {Read: cloudAgentAdaptLocalRead(cloudAgentDirectorValidatePrompt)},
		agenttool.DirectorValidateLedger:    {Read: cloudAgentAdaptLocalRead(cloudAgentDirectorValidateLedger)},
	}
}

// cloudAgentAdaptLocalWrite 把本地 (services, userID, call) 签名的 handler 适配为
// 注册表 Write handler：Service 由 repo 现构（代码库既有模式 &Service{repo: repo}）。
func cloudAgentAdaptLocalWrite(fn func([]*Service, string, cloudAgentCall) (any, error)) cloudAgentWriteHandler {
	return func(repo *repository.Repository, userID, _ string, call cloudAgentCall, _ RuntimePolicySetting, _ ...cloudAgentMutationRecorder) (any, error) {
		return fn([]*Service{{repo: repo}}, userID, call)
	}
}

// cloudAgentPreviewEcommerceAction 电商工具审批预演：从调用参数提取商品 ID，
// 给出动作说明（实际扣费与槽位影响以执行时服务端核算为准）。
func cloudAgentPreviewEcommerceAction(action string) cloudAgentPreviewHandler {
	return func(_ *repository.Repository, _ string, _ string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
		var args struct {
			ProductID string `json:"productId"`
			Platform  string `json:"platform"`
			SlotID    string `json:"slotId"`
		}
		if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
			return cloudAgentApprovalPreview{}, cloudAgentJSONArgumentError(err)
		}
		description := action
		if args.Platform != "" {
			description += "（目标平台：" + args.Platform + "）"
		}
		return cloudAgentApprovalPreview{
			Kind:        "ecommerce",
			Title:       action,
			Description: description + "；商品 " + args.ProductID + "。",
			Items: []cloudAgentApprovalPreviewItem{{Operation: action, NodeTitle: args.ProductID}},
		}, nil
	}
}

// cloudAgentAdaptLocalRead 把本地 (services, userID, call) 签名的 handler 适配为
// 注册表 Read handler（repo/runtime 参数忽略——本地工具不经过画布事务链）。
func cloudAgentAdaptLocalRead(fn func([]*Service, string, cloudAgentCall) (any, error)) cloudAgentReadHandler {
	return func(_ *repository.Repository, userID string, _ *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
		return fn(services, userID, call)
	}
}

func cloudAgentPreviewCanvas(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentCanvasMutation(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewArrange(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentArrangeNodes(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewStoryboardCreate(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentStoryboardCreate(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewStoryboardEdit(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentStoryboardEdit(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewCharacterCreate(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentCharacterCreate(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewBatchTable(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentBatchTableEdit(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewPrevisCreate(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentPrevisSceneCreate(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}

func cloudAgentPreviewPrevisPatch(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (cloudAgentApprovalPreview, error) {
	plan, err := prepareCloudAgentPrevisApplyPatch(repo, userID, canvasID, call)
	if err != nil {
		return cloudAgentApprovalPreview{}, err
	}
	return plan.Preview, nil
}
