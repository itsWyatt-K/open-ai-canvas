import { apiClient, request, type BackendEnvelope } from "./request";

export interface InspirationPrompt {
    version?: string;
    text?: string;
    negativePrompt?: string;
    ratio?: string;
    resolution?: string;
    durationSeconds?: number;
    fps?: number;
    cfgScale?: number;
    steps?: number;
    sampler?: string;
    seed?: number;
    cameraMotion?: string;
    lighting?: string;
    style?: string;
    shotType?: string;
    notes?: string;
}

export interface InspirationCase {
    id: number;
    sourceRepo: string;
    sourceId: string;
    title: string;
    summary: string;
    titleEn?: string;
    summaryEn?: string;
    mediaType: "video" | "image" | "ui" | "copy" | string;
    category: string;
    categoryName: string;
    tags: string[];
    modelFamily: string;
    models: string[];
    creator: string;
    coverUrl: string;
    mediaUrl: string;
    posterUrl?: string;
    mediaUrls: string[];
    prompts: InspirationPrompt[];
    sourceUrl: string;
    goodcaseUrl: string;
    score: number;
    stability: number;
    evidence: string;
    reproStatus: string;
    batchId?: number;
    license?: string;
    favorited?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface InspirationRetest {
    id: number;
    origin: "local" | "goodcase" | string;
    model: string;
    modelVersion?: string;
    taskId?: string;
    videoPath?: string;
    videoUrl?: string;
    score?: number;
    conclusion: "reproduced" | "degraded" | "failed" | string;
    notes?: string;
    testedAt?: string;
}

export interface InspirationCaseDetail {
    case: InspirationCase;
    retests: InspirationRetest[];
}

export interface InspirationListQuery {
    mediaType?: string;
    category?: string;
    modelFamily?: string;
    reproStatus?: string;
    keyword?: string;
    sort?: "hot" | "score" | "stability" | "new" | string;
    page?: number;
    size?: number;
}

export interface InspirationListResult {
    total: number;
    page: number;
    size: number;
    items: InspirationCase[];
}

export interface InspirationStats {
    total: number;
    withVideo: number;
    withCover: number;
    localRetests: number;
    officialRetests: number;
    mediaTypeCounts: Record<string, number>;
}

export async function listInspirationCases(query?: InspirationListQuery): Promise<InspirationListResult> {
    const res = await apiClient.get<BackendEnvelope<InspirationListResult>>("/inspiration/cases", {
        params: query,
    });
    return await request(Promise.resolve(res));
}

export async function getInspirationCase(id: number): Promise<InspirationCaseDetail> {
    const res = await apiClient.get<BackendEnvelope<InspirationCaseDetail>>(`/inspiration/cases/${id}`);
    return await request(Promise.resolve(res));
}

export async function toggleInspirationFavorite(id: number): Promise<boolean> {
    const res = await apiClient.post<BackendEnvelope<{ favorited: boolean }>>(`/inspiration/cases/${id}/favorite`);
    const data = await request(Promise.resolve(res));
    return data.favorited;
}

export async function listFavoriteInspirationCases(): Promise<InspirationCase[]> {
    const res = await apiClient.get<BackendEnvelope<{ items: InspirationCase[] }>>("/inspiration/favorites");
    const data = await request(Promise.resolve(res));
    return data.items || [];
}

export async function getInspirationStats(): Promise<InspirationStats> {
    const res = await apiClient.get<BackendEnvelope<InspirationStats>>("/inspiration/stats");
    return await request(Promise.resolve(res));
}
