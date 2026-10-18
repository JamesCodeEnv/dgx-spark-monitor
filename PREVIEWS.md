# 面板效果预览（PREVIEWS）

> 本仓库**只放成本页一张实拍**（[screenshots/cost.png](screenshots/cost.png)）——它最能体现本项目新增的能力，
> 且其中的金额/用量来自一套已公开使用中的集群，作者认为无敏感信息。
> **其余页面不放截图**：它们带运行环境的机器名/节点 id 与实时曲线，公开仓库不留；界面构成见下文，
> 想要图就在自己环境一键生成（见文末），生成物默认**不要**提交。
> 「节点配置」页含真实内网地址，生成脚本**刻意跳过**它。

## 1. 总览（Overview）

双节点在线状态、服务健康卡（解码吞吐 / prefill / KV cache / prefix 命中率 / 投机解码 / 运行队列 / 延迟分位）、GPU 利用率与吞吐实时曲线。首页顶部一排 KPI 卡（累计 prefill/输出/缓存抵扣 token），往下是各引擎指标的实时曲线。

## 2. GPU / 主机（GPU & Host）

双机 GPU 利用率/温度/功耗/时钟、CPU 负载、内存、磁盘、推理容器占用。GB10 的 `nvidia-smi` 不报显存，这里的"显存占用"由 `--query-compute-apps` 逐进程求和得到。

## 3. 吞吐 / 延迟（Throughput & Latency）

decode/prefill tok/s，TTFT / ITL / 端到端 / 排队 的 p50 / p90 / p99。prefill 只统计**未命中缓存**、真正计算的 prompt token。

## 4. 投机解码（Speculative Decoding）

MTP 投机解码：接受率、平均接受长度、draft/accepted 累计。若引擎不导出逐位置接受率（如 TensorFold），该图改为文字说明（`SPEC_PER_POS=0`）。

## 5. 缓存 / 队列（Cache & Queue）

prefix 缓存命中率/缓存占比、KV cache 使用率、运行/等待/抢占、命中与查询累计。

## 6. 网络（Network）

RoCE 双链路状态、4 个 fabric 口双向吞吐。

## 7. 成本（Cost）· 本项目新增

**两个口径分列**：电费 = 实际支出（GPU 功耗 × 整机系数 × 电价）；token = 对外等价节省（按 DeepSeek 官方价折算）。按历史价目分段、峰谷分时折算，按日明细 + 净收益；今日/近7天为固定口径，其余卡片跟随顶栏「统计范围」。

![成本](screenshots/cost.png)

## 8. 节点配置（节点 Config）

配置中心：增删改要拉取的机器、启停、看在线状态。**含真实内网地址，不生成截图**，用法见 [CONFIG.md](CONFIG.md)。

---

## 如何重新生成截图（本地自用，勿提交）

环境：面板运行在 `http://127.0.0.1:8890`，本机有 Playwright 的 chromium。

```bash
pnpm exec playwright install chromium     # 一次性
bash docs/screenshots/capture.sh
```

脚本会启动无头 chromium → 逐页打开（`#/overview` … `#/cost`）→ 等图表与成本计算落地 → 整页截图写到 `docs/screenshots/`。

> 想让图表更有数据：截图前发几个请求制造流量，或在「总览」右上角把时间窗调到 15 分钟看更密的曲线。
