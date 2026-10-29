import { expect, test } from "bun:test";

import { friendlyErrorText, toFriendlyError } from "@/pages/modules/layer-studio-errors";

// 战役二收尾：SSRF 判定收紧后的误伤/漏判防护。
// 判定口径 = 网络/地址语义词 或 完整 IPv4 且落在后端出站守卫封禁网段内；不裸匹配 10./192.168 片段。

test("素材编号 10.2 版本上传失败：IP 片段不误判为内网拦截", () => {
    const error = toFriendlyError("素材编号 10.2 版本上传失败");
    expect(error.tone).not.toBe("blocked");
    expect(error.tone).toBe("unknown");
});

test("内网语义词 + 127.0.0.1：判为 blocked 且 refreshable=false", () => {
    const error = toFriendlyError("该图片地址指向内网 127.0.0.1，已拦截");
    expect(error.tone).toBe("blocked");
    expect(error.refreshable).toBe(false);
    expect(error.raw).toBe("该图片地址指向内网 127.0.0.1，已拦截");
});

test("无语义词但出现封禁网段完整 IPv4：仍判 blocked", () => {
    expect(toFriendlyError("远程地址 192.168.1.10 拉取失败").tone).toBe("blocked");
    expect(toFriendlyError("远程地址 172.16.5.4 拉取失败").tone).toBe("blocked");
    expect(toFriendlyError("远程地址 169.254.169.254 拉取失败").tone).toBe("blocked");
});

test("公网 IP 与非法八位组（版本号样式）不判 blocked", () => {
    expect(toFriendlyError("远程地址 8.8.8.8 拉取失败").tone).not.toBe("blocked");
    expect(toFriendlyError("版本 10.2.3.999 上传失败").tone).not.toBe("blocked");
});

test("revision 冲突保持 refreshable=true（一键刷新并合并）", () => {
    const error = toFriendlyError("数据已被更新，请刷新后重试");
    expect(error.tone).toBe("conflict");
    expect(error.refreshable).toBe(true);
});

test("上传超限文案对齐后端真实口径（单文件 < 50MB，运行策略可调）", () => {
    const error = toFriendlyError("单个上传文件必须小于 50MB");
    expect(error.tone).toBe("limit");
    expect(error.hint).toContain("50MB");
    expect(error.hint).toContain("运行策略");
});

test("friendlyErrorText 渲染出标题+建议的一行人话", () => {
    const text = friendlyErrorText(toFriendlyError("请求超时"));
    expect(text).toContain("等太久了");
    expect(text).toContain("重试");
});

// 牌序回归（前端工程专家实测发现）：nxf 引擎本身跑在 127.0.0.1:8823，
// 引擎/超时报错必然含这个地址，SSRF 规则在兜底位不能抢走它们。
test("引擎返回 5xx（含 127.0.0.1:8823）落 service，不判 blocked", () => {
    const error = toFriendlyError("引擎 http://127.0.0.1:8823/api/v1/ecommerce/vision/live-compose 返回 500");
    expect(error.tone).toBe("service");
    expect(error.refreshable).toBe(false);
});

test("引擎连接超时（含 127.0.0.1:8823）落 network，不判 blocked", () => {
    expect(toFriendlyError("引擎 127.0.0.1:8823 连接超时").tone).toBe("network");
});

test("请求内网引擎地址超时落 network，不判 blocked", () => {
    expect(toFriendlyError("请求 http://10.0.0.8:8823 超时").tone).toBe("network");
});

// 兜底位不漏判：无语义伴随词的真实 SSRF 拦截仍要落 blocked。
test("无超时/引擎伴随词时，真实 SSRF 拦截仍落 blocked", () => {
    expect(toFriendlyError("不允许访问本机或内网地址").tone).toBe("blocked");
    expect(toFriendlyError("远程地址 192.168.1.10 拉取失败").tone).toBe("blocked");
});
