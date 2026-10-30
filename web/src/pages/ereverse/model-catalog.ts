/**
 * AI 片段仿拍 · 视频模型选型目录（严格对接真库 channel_models 实况，2026-10-30 侦察）。
 *
 * 真库 7 个 video 模型：
 * - 现役可用 4 个 H3：CHANNEL_000021 秘塔 MiniMax-H3（minimax-video 协议）
 *   + CHANNEL_000015 AutoDL ComfyUI ×3（autodl-comfyui 协议）；
 * - CHANNEL_000011 火山方舟 Seedance 2.5/2.0/1.5 Pro 渠道 enabled=0（停用）。
 *
 * 防静默错路由（关键）：resolveModelChannel 对找不到的模型会 fallback 到
 * channels[0]——用户选 H3 可能被路由到无关渠道。因此每张卡片都在用户渠道里
 * 找得到才可点；找不到的诚实显示「未配置/未启用」并给出去渠道页的入口。
 * 命中时用 encodeChannelModel(channelId, modelKey) 钉死渠道。
 */

import { encodeChannelModel, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

export type VideoModelCard = {
    id: string;
    modelKey: string;
    title: string;
    badge?: string;
    desc: string;
    /** 默认选中（对标 AppGrowing 的 🔥推荐位）。 */
    recommended?: boolean;
};

/** 施工令指定的选型卡（顺序即展示顺序）。 */
export const VIDEO_MODEL_CARDS: VideoModelCard[] = [
    {
        id: "metaso-h3",
        modelKey: "MiniMax-H3",
        title: "MiniMax H3（秘塔直连）",
        badge: "🔥 推荐",
        desc: "效果接近 Seedance 2.5，价格实惠，不卡人脸，支持多图与原片参考",
        recommended: true,
    },
    {
        id: "autodl-h3-15s",
        modelKey: "minimax_h3_lightx2v_v5_15s",
        title: "H3 多图生视频 15秒（成片用）",
        badge: "New",
        desc: "适合多产品展示与 15s 长镜头，审核宽松，不卡人脸",
    },
    {
        id: "autodl-h3-v5",
        modelKey: "minimax_h3_lightx2v_v5",
        title: "H3 多图参考生视频（产品图用）",
        desc: "适合带商品参考图的动作复刻",
    },
    {
        id: "autodl-h3-no-pic",
        modelKey: "minimax_h3_lightx2v_no_pic",
        title: "H3 文生视频（快速打样）",
        desc: "低成本验证分镜节奏",
    },
    {
        id: "ark-seedance",
        modelKey: "doubao-seedance-2-5-260628",
        title: "Seedance 2.5 / 2.0（火山方舟）",
        desc: "适合 30s 长视频，音画质量高（渠道停用时可去后台一键开启）",
    },
];

export type ModelCardState = VideoModelCard & {
    /** 用户渠道里是否配了该模型（false → 禁用 + 引导）。 */
    available: boolean;
    /** 命中渠道（available 时有值），用于 encodeChannelModel 钉死路由。 */
    channel: ModelChannel | null;
    /** 钉死渠道后的 config.model 值。 */
    pinnedModel: string;
    /** 渠道禁用/未配的如实原因。 */
    reason: string;
};

export function resolveModelCardStates(config: AiConfig): ModelCardState[] {
    return VIDEO_MODEL_CARDS.map((card) => {
        const channel = config.channels.find((item) => item.models.includes(card.modelKey)) || null;
        if (!channel) {
            return {
                ...card,
                available: false,
                channel: null,
                pinnedModel: card.modelKey,
                reason: "当前账号渠道未配置该模型",
            };
        }
        return {
            ...card,
            available: true,
            channel,
            pinnedModel: encodeChannelModel(channel.id, card.modelKey),
            reason: "",
        };
    });
}

/** 默认选中项：第一张可用且 recommended 的卡，否则第一张可用卡。 */
export function defaultModelCard(states: ModelCardState[]): ModelCardState | null {
    return states.find((item) => item.available && item.recommended) || states.find((item) => item.available) || null;
}
