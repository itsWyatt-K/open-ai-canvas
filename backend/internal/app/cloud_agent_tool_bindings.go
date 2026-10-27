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
		// 本地 handler 签名 (services, userID, call) 经适配器接入注册表 Read 链。
		agenttool.EcommerceGetProductDetail: {Read: cloudAgentAdaptLocalRead(cloudAgentEcommerceGetProductDetail)},
		agenttool.EcommerceUpdateSlotPrompt: {Read: cloudAgentAdaptLocalRead(cloudAgentEcommerceUpdateSlotPrompt)},
		agenttool.EcommerceApplyPlatform:    {Read: cloudAgentAdaptLocalRead(cloudAgentEcommerceApplyPlatform)},
		agenttool.EcommercePlanProduct:      {Read: cloudAgentAdaptLocalRead(cloudAgentEcommercePlanProduct)},
		agenttool.EcommerceConfirmPlan:      {Read: cloudAgentAdaptLocalRead(cloudAgentEcommerceConfirmPlan)},
		agenttool.DirectorValidatePrompt:    {Read: cloudAgentAdaptLocalRead(cloudAgentDirectorValidatePrompt)},
		agenttool.DirectorValidateLedger:    {Read: cloudAgentAdaptLocalRead(cloudAgentDirectorValidateLedger)},
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
