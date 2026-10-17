/**
 * 电商工坊 · 分屏策划（移植自 pr(1) 的 CommerceScreen，去除画布节点依赖）。
 *
 * 来源：`一键详情pr(1)/源码/web/src/types/commerce-workflow.ts` 的 CommerceScreen。
 * 移植纪律（pr(1) PR说明.md「关键设计边界」）：
 *   - promptOverride 非空时最高优先，**AI 重策划不得覆盖**；
 *   - referenceNodeIds 是单屏风格参考（仅参与策划，不直接进生图参考）；
 *   - copy 留空表示本屏纯图无字，是合法状态，不代表画面方案缺失。
 */

/** 单屏策划卡（对应后端 ecommerce_slots 行的可编辑投影）。 */
export type PrCommerceScreen = {
    id: string;
    title: string;
    copy: string;
    /** 画面描述（策划编译产物 / 人工编写）。 */
    prompt: string;
    /** 完整提示词覆盖：非空时最高优先，AI 重策划不覆盖。 */
    promptOverride?: string;
    /** 单屏风格参考资源 ID（仅参与策划）。 */
    referenceNodeIds?: string[];
    /** 单屏比例覆盖（空 = 跟随本组）。 */
    size?: string;
    /** 场景类型（产品特写 / 使用场景 / 参数说明）。 */
    sceneType?: string;
    /** 本屏绑定的已确认卖点。 */
    sellingPoints?: string;
    /** 竞品复刻：本屏绑定的版式模板资源 ID（详情页策划不使用）。 */
    templateNodeId?: string;
};

/** 策划 JSON 解析结果（每屏的编译后 prompt）。 */
export type PrCompiledScreen = PrCommerceScreen & { prompt: string };

/** 详情页策划 schema 的字段说明（供策划提示词拼装，与后端契约同源）。 */
export const commerceDetailPlanSchema = {
    productAnalysis: "产品身份与外观事实",
    styleAnalysis: "风格参考的视觉语言分析",
    visualSystem: "整组统一视觉系统",
    screens: "逐屏方案",
};
