package main

import (
	"encoding/json"
	"fmt"
	"log"
	"io"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// collectorVllm scrapes a vLLM OpenAI-server Prometheus /metrics endpoint,
// stores raw gauges and derives rates/percentiles.
type collectorVllm struct {
	url string

	prev     map[string]float64 // previous counter values
	prevTime time.Time
}

type sample struct {
	name   string
	labels map[string]string
	value  float64
}

// collect returns the derived time-series rows for the current scrape.
func (v *collectorVllm) collect() ([]row, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(v.url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("vllm /metrics: status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}

	samples := parsePrometheusText(string(body))
	// TensorFold: its /metrics token counters only cover FINISHED requests, so
	// they are flat while a request is decoding (measured: generation_tokens_total
	// does not move for the whole life of a request). /health is a live snapshot
	// whose counters DO move — scrape it too and let it win: its samples go first
	// and valueOf() takes the first match for a family.
	if base := strings.TrimSuffix(v.url, "/metrics"); base != v.url {
		if hs, err := fetchHealthJSON(base + "/health"); err == nil {
			samples = append(hs, samples...)
		} else {
			log.Printf("tf /health scrape: %v", err)
		}
	}
	samples = aliasTensorfold(samples)
	now := time.Now()

	cur := collectCounters(samples)
	out := make([]row, 0, 24)
	nowTs := now.Unix()

	// --- raw gauges (always) ---
	for _, g := range gaugeFams {
		out = append(out, row{Name: g.name, Ts: nowTs, Val: g.get(cur)})
	}

	// --- deltas / rates (needs a previous scrape) ---
	if !v.prevTime.IsZero() {
		dt := now.Sub(v.prevTime).Seconds()
		if dt > 0 {
			diff := func(key string) float64 {
				d := cur[key] - v.prev[key]
				if d < 0 {
					d = 0 // counter reset (restart)
				}
				return d
			}
			rate := func(key, name string) {
				out = append(out, row{Name: name, Ts: nowTs, Val: diff(key) / dt})
			}
			rate("gen_tokens", "vllm.decode_tok_s")
			// prefill 吞吐只统计“真正计算”的 prefill token（排除缓存命中），
			// 否则在 prefix 命中率（~99%）下，prompt_tokens_total 的差分几乎全是 cache hit，
			// 会把真实 prefill 计算吞吐放大 ~80 倍（实测假值 13198.9 tok/s）。
			pc := diff("prompt_tokens") - diff("prompt_cached")
			if pc < 0 {
				pc = 0
			}
			out = append(out, row{Name: "vllm.prompt_tok_s", Ts: nowTs, Val: pc / dt})
			rate("iter_tokens", "vllm.iter_tok_s")

			// 单流等效吞吐（ITL p50 的倒数）与每流吞吐（聚合 / 并发数）。
			// decode_tok_s 是引擎级聚合；没有这两个量就无法回答
			// “单流多少、并发升高后每流是否被拖慢”。
			// TensorFold 没有 ITL 直方图：用 decode_seconds 差分 / 输出 token 差分
			// 推导平均单 token 延迟（均值口径），发布为 vllm.itl_avg_s。
			// 只有真的产出了 token 才谈得上“每 token 延迟”：gen_tokens 差分为 0 时
			// decode_seconds/gen_tokens 会得到 +Inf，曾把 +Inf 写进 TSDB，令 /changes 的
			// JSON 编码失败（空 body）→ 中控永久卡死。显式要求分母 > 0 且结果有限。
			itlAvg := 0.0
			if dg := diff("gen_tokens"); dg > 0 {
				itlAvg = diff("decode_seconds") / dg
			}
			if itlAvg > 0 && !math.IsInf(itlAvg, 0) {
				out = append(out, row{Name: "vllm.itl_avg_s", Ts: nowTs, Val: itlAvg})
				out = append(out, row{Name: "vllm.single_stream_tok_s", Ts: nowTs, Val: 1 / itlAvg})
			} else if itlP50, _, _ := percentiles(samples, "vllm:inter_token_latency_seconds"); itlP50 > 0 {
				out = append(out, row{Name: "vllm.single_stream_tok_s", Ts: nowTs, Val: 1 / itlP50})
			}
			running := cur["running"]
			if running < 1 {
				running = 1
			}
			out = append(out, row{Name: "vllm.per_stream_tok_s", Ts: nowTs, Val: (diff("gen_tokens") / dt) / running})

			if dq := diff("prefix_queries"); dq > 0 {
				out = append(out, row{Name: "vllm.prefix_hit_rate", Ts: nowTs, Val: diff("prefix_hits") / dq})
			}
			// TensorFold: use its FINISHED-request cached/total pair so numerator
			// and denominator step together (see note in collectCounters).
			if dpf := diff("prompt_tokens_finished"); dpf > 0 {
				out = append(out, row{Name: "vllm.prompt_cached_pct", Ts: nowTs,
					Val: diff("prompt_cached_finished") / dpf * 100})
			} else if dp := diff("prompt_tokens"); dp > 0 {
				out = append(out, row{Name: "vllm.prompt_cached_pct", Ts: nowTs, Val: diff("prompt_cached") / dp * 100})
			}
			if dd := diff("spec_draft"); dd > 0 {
				out = append(out, row{Name: "vllm.spec_accept_rate", Ts: nowTs, Val: diff("spec_accepted") / dd})
			} else if ddr := diff("spec_drafts"); ddr > 0 {
				// TensorFold：无 draft-token 计数，用 drafted 总量代替（accepted/drafted）
				out = append(out, row{Name: "vllm.spec_accept_rate", Ts: nowTs, Val: diff("spec_accepted") / ddr})
			}
			if dn := diff("spec_drafts"); dn > 0 {
				out = append(out, row{Name: "vllm.spec_accept_len", Ts: nowTs, Val: diff("spec_accepted") / dn})
			}
			// per-position acceptance rates (position k: accepted_k / drafts)。
			// 只对 vLLM 实际发布的 position 生成系列：硬编码上界会产生
			// 永不更新的幽灵系列（例如只发布 0..4 时，position=5 恒为 0）。
			for _, k := range specPositions(samples) {
				key := fmt.Sprintf("spec_pos_accepted[position=%d]", k)
				if dn := diff("spec_drafts"); dn > 0 {
					out = append(out, row{Name: fmt.Sprintf("vllm.spec_pos_%d_rate", k), Ts: nowTs, Val: diff(key) / dn})
				}
			}
		}
	}

	// --- histogram percentiles (always) ---
	for _, h := range histFams {
		p50, p90, p99 := percentiles(samples, h.fam)
		out = append(out,
			row{Name: h.name + "_p50", Ts: nowTs, Val: p50},
			row{Name: h.name + "_p90", Ts: nowTs, Val: p90},
			row{Name: h.name + "_p99", Ts: nowTs, Val: p99},
		)
	}

	v.prev = cur
	v.prevTime = now
	return out, nil
}

// gaugeFams: raw series stored as-is each scrape.
type famDef struct {
	name string // output series name (without leading vllm.)
	key  string // counter key in cur map
	get  func(cur map[string]float64) float64
}

func gauges(outName string, key string) famDef {
	return famDef{name: outName, key: key, get: func(cur map[string]float64) float64 { return cur[key] }}
}

var gaugeFams = []famDef{
	gauges("vllm.kv_usage_pct", "kv_usage"),
	gauges("vllm.running", "running"),
	gauges("vllm.waiting", "waiting"),
	gauges("vllm.preemptions", "preemptions"),
	gauges("vllm.prompt_tok_total", "prompt_tokens"),
	gauges("vllm.gen_tok_total", "gen_tokens"),
	gauges("vllm.iter_tok_total", "iter_tokens"),
	gauges("vllm.prompt_cached_total", "prompt_cached"),
	gauges("vllm.prefix_hits_total", "prefix_hits"),
	gauges("vllm.prefix_queries_total", "prefix_queries"),
	gauges("vllm.spec_draft_total", "spec_draft"),
	gauges("vllm.spec_accept_total", "spec_accepted"),
	gauges("vllm.spec_drafts_total", "spec_drafts"),
	gauges("vllm.pool_tokens", "pool_tokens"),
	gauges("vllm.pool_free_tokens", "pool_free_tokens"),
	// TensorFold 特有（/health）
	gauges("vllm.num_streams_filling", "num_streams_filling"),
	gauges("vllm.num_streams_decoding", "num_streams_decoding"),
	gauges("vllm.num_streams_prefilling", "num_streams_prefilling"),
	gauges("vllm.num_streams_paused", "num_streams_paused"),
	gauges("vllm.streams_max", "streams_max"),
	gauges("vllm.kept_prompts", "kept_prompts"),
	gauges("vllm.rounds_total", "rounds"),
	gauges("vllm.prefill_seconds_total", "prefill_seconds"),
	gauges("vllm.decode_seconds_total", "decode_seconds"),
}

var histFams = []struct {
	fam, name string
}{
	{"vllm:time_to_first_token_seconds", "vllm.ttft"},
	{"vllm:inter_token_latency_seconds", "vllm.itl"},
	{"vllm:e2e_request_latency_seconds", "vllm.e2e"},
	{"vllm:request_queue_time_seconds", "vllm.queue"},
}

// collectCounters flattens the relevant counter families (optionally
// label-scoped) into a single map keyed by short names.
func collectCounters(samples []sample) map[string]float64 {
	m := make(map[string]float64)
	add := func(key, fam string, kv map[string]string) {
		m[key] = valueOf(samples, fam, kv)
	}
	addCode := func(key, fam string) { add(key, fam, nil) }

	addCode("gen_tokens", "vllm:generation_tokens_total")
	addCode("prompt_tokens", "vllm:prompt_tokens_total")
	addCode("prompt_cached", "vllm:prompt_tokens_cached_total")
	addCode("iter_tokens", "vllm:iteration_tokens_total_sum")
	addCode("prefix_hits", "vllm:prefix_cache_hits_total")
	addCode("prefix_queries", "vllm:prefix_cache_queries_total")
	addCode("spec_draft", "vllm:spec_decode_num_draft_tokens_total")
	addCode("spec_accepted", "vllm:spec_decode_num_accepted_tokens_total")
	addCode("spec_drafts", "vllm:spec_decode_num_drafts_total")
	add("kv_usage", "vllm:kv_cache_usage_perc", nil)
	add("running", "vllm:num_requests_running", nil)
	add("waiting", "vllm:num_requests_waiting", nil)
	add("preemptions", "vllm:num_preemptions_total", nil)
	// TensorFold-only: the shared KV pool (tokens), live from /health.
	add("pool_tokens", "tfhealth:pool_tokens", nil)
	add("pool_free_tokens", "tfhealth:pool_free_tokens", nil)
	// TensorFold 特有计数器（供差分用）
	addCode("prefill_seconds", "vllm:prefill_seconds_total")
	addCode("decode_seconds", "vllm:decode_seconds_total")
	addCode("rounds", "vllm:rounds_total")
	// TensorFold 特有 gauge（/health 快照）
	add("kept_prompts", "tfhealth:kept_prompts", nil)
	add("streams_max", "tfhealth:streams:max", nil)
	add("num_streams_filling", "tfhealth:streams:filling", nil)
	add("num_streams_decoding", "tfhealth:streams:decoding", nil)
	add("num_streams_prefilling", "tfhealth:streams:prefilling", nil)
	add("num_streams_paused", "tfhealth:streams:paused", nil)

	// TensorFold publishes no prefix-cache counters. The closest consistent pair
	// is its FINISHED-request cached/total prompt tokens (both step on request
	// completion, so their diff ratio is a well-defined cache hit rate; mixing
	// them with the live counters would give 0/plateau artifacts mid-request).
	// Only fill when the vLLM counter is absent, so a real vLLM scrape wins.
	add("prompt_cached_finished", "tfhealth:cached_tokens_total", nil)
	add("prompt_tokens_finished", "tensorfold:prompt_tokens_total", nil)
	if m["prefix_hits"] == 0 {
		if v := m["prompt_cached_finished"]; v > 0 {
			m["prefix_hits"] = v
		}
	}
	if m["prefix_queries"] == 0 {
		if v := m["prompt_tokens_finished"]; v > 0 {
			m["prefix_queries"] = v
		}
	}

	for k := 0; k < 6; k++ {
		add(fmt.Sprintf("spec_pos_accepted[position=%d]", k),
			"vllm:spec_decode_num_accepted_tokens_per_pos_total",
			map[string]string{"position": strconv.Itoa(k)})
	}
	return m
}

// valueOf returns the value of the first sample matching family `fam`
// (kv=nil matches any) — used to fetch pure unlabeled families and
// label-scoped counters.
func valueOf(samples []sample, fam string, kv map[string]string) float64 {
	for _, s := range samples {
		if s.name != fam {
			continue
		}
		if kv != nil {
			match := true
			for k, want := range kv {
				if s.labels[k] != want {
					match = false
					break
				}
			}
			if !match {
				continue
			}
		}
		return s.value
	}
	return 0
}

func parsePrometheusText(text string) []sample {
	var out []sample
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		var name string
		var labels map[string]string
		rest := line
		if i := strings.IndexByte(line, '{'); i >= 0 {
			name = line[:i]
			i2 := strings.IndexByte(line, '}')
			if i2 < 0 {
				continue
			}
			labels = map[string]string{}
			for _, kv := range strings.Split(line[i+1:i2], ",") {
				p := strings.SplitN(kv, "=", 2)
				if len(p) == 2 {
					labels[strings.TrimSpace(p[0])] = strings.Trim(p[1], `"`)
				}
			}
			rest = line[i2+1:]
		} else {
			parts := strings.Fields(line)
			if len(parts) == 2 {
				name = parts[0]
				rest = parts[1]
			} else {
				continue
			}
		}
		val, err := strconv.ParseFloat(strings.TrimSpace(rest), 64)
		if err != nil {
			continue
		}
		if labels == nil {
			labels = map[string]string{}
		}
		out = append(out, sample{name: name, labels: labels, value: val})
	}
	return out
}

// percentiles computes approximate p50/p90/p99 from a cumulative-bucket
// histogram family (le/count samples).
func percentiles(samples []sample, fam string) (p50, p90, p99 float64) {
	type b struct {
		le    float64
		count float64
	}
	var buckets []b
	var total float64
	for _, s := range samples {
		if !strings.HasPrefix(s.name, fam) {
			continue
		}
		switch {
		case strings.HasSuffix(s.name, "_bucket"):
			if le, ok := s.labels["le"]; ok && le != "+Inf" {
				if lf, err := strconv.ParseFloat(le, 64); err == nil {
					buckets = append(buckets, b{le: lf, count: s.value})
				}
			}
		case strings.HasSuffix(s.name, "_count"):
			total = s.value
		}
	}
	if total == 0 || len(buckets) == 0 {
		return 0, 0, 0
	}
	sort.Slice(buckets, func(i, j int) bool { return buckets[i].le < buckets[j].le })

	q := func(p float64) float64 {
		target := p / 100 * total
		if target <= 0 {
			return 0
		}
		for _, b := range buckets {
			if b.count >= target {
				return b.le
			}
		}
		return buckets[len(buckets)-1].le
	}
	return q(50), q(90), q(99)
}

// specPositions 返回本次抓取中实际出现的 spec-decode position（升序），
// 让 per-position 系列数量跟随 vLLM 配置，而非硬编码。
func specPositions(samples []sample) []int {
	set := make(map[int]struct{})
	for _, s := range samples {
		if s.name != "vllm:spec_decode_num_accepted_tokens_per_pos_total" {
			continue
		}
		if p, ok := s.labels["position"]; ok {
			if n, err := strconv.Atoi(p); err == nil {
				set[n] = struct{}{}
			}
		}
	}
	pos := make([]int, 0, len(set))
	for k := range set {
		pos = append(pos, k)
	}
	sort.Ints(pos)
	return pos
}

// --- TensorFold support -----------------------------------------------------
// TensorFold serves an OpenAI-compatible endpoint whose /metrics carries the
// same quantities as vLLM's, under a `tensorfold:` prefix instead of `vllm:`.
// Rather than duplicating the whole collector, translate the families onto the
// vLLM names and let everything downstream (gauges, rates, percentiles) work.

// tfAliases maps an exact TensorFold family to the vLLM family this collector
// reads, with a scale factor (TensorFold reports the KV cache as a 0..1 ratio
// while vLLM reports a 0..100 percentage). `tfhealth:*` samples come from the
// live /health snapshot and take precedence over the finished-requests-only
// counters on /metrics (they are placed first in the sample list).
var tfAliases = map[string]struct {
	to    string
	scale float64
}{
	"tfhealth:completion_tokens_total":      {"vllm:generation_tokens_total", 1},
	"tfhealth:prompt_tokens_total":          {"vllm:prompt_tokens_total", 1},
	"tfhealth:drafted_total":                {"vllm:spec_decode_num_drafts_total", 1},
	"tfhealth:accepted_total":               {"vllm:spec_decode_num_accepted_tokens_total", 1},
	"tensorfold:requests_running":           {"vllm:num_requests_running", 1},
	"tensorfold:requests_waiting":           {"vllm:num_requests_waiting", 1},
	"tensorfold:kv_cache_usage_ratio":       {"vllm:kv_cache_usage_perc", 100},
	"tensorfold:generation_tokens_total":    {"vllm:generation_tokens_total", 1},
	"tensorfold:prompt_tokens_total":        {"vllm:prompt_tokens_total", 1},
	"tfhealth:cached_tokens_total":          {"vllm:prompt_tokens_cached_total", 1},
	"tensorfold:mtp_drafted_total":          {"vllm:spec_decode_num_drafts_total", 1},
	"tensorfold:mtp_accepted_total":         {"vllm:spec_decode_num_accepted_tokens_total", 1},
	// TensorFold 特有（/health 快照）：stream 状态、kept 前缀、耗时累计、草稿轮次
	"tfhealth:streams:filling":    {"vllm:num_streams_filling", 1},
	"tfhealth:streams:decoding":   {"vllm:num_streams_decoding", 1},
	"tfhealth:streams:prefilling": {"vllm:num_streams_prefilling", 1},
	"tfhealth:streams:paused":     {"vllm:num_streams_paused", 1},
	"tfhealth:streams_max":        {"vllm:streams_max", 1},
	"tfhealth:kept_prompts":       {"vllm:kept_prompts", 1},
	"tfhealth:prefill_seconds_total": {"vllm:prefill_seconds_total", 1},
	"tfhealth:decode_seconds_total":  {"vllm:decode_seconds_total", 1},
	"tfhealth:rounds_total":          {"vllm:rounds_total", 1},
	"tfhealth:iteration_s":           {"vllm:iteration_s", 1},
}

// tfHistAliases maps TensorFold cumulative-histogram families onto their vLLM
// counterparts; the _bucket/_sum/_count suffix is carried over verbatim.
var tfHistAliases = map[string]string{
	"tensorfold:time_to_first_token_seconds": "vllm:time_to_first_token_seconds",
	"tensorfold:request_latency_seconds":     "vllm:e2e_request_latency_seconds",
}

// fetchHealthJSON scrapes TensorFold's /health — a live snapshot whose counters
// move while requests decode (the /metrics token counters only cover finished
// requests) — and turns its numeric fields into samples under `tfhealth:`.
func fetchHealthJSON(url string) ([]sample, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tf /health: status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var j map[string]interface{}
	if err := json.Unmarshal(body, &j); err != nil {
		return nil, err
	}
	var out []sample
	// 嵌套对象展开一层（如 streams:{filling,decoding,...} → tfhealth:streams:filling）
	var walk func(prefix string, m map[string]interface{})
	walk = func(prefix string, m map[string]interface{}) {
		for k, v := range m {
			if f, ok := v.(float64); ok {
				out = append(out, sample{name: prefix + k, value: f})
			} else if sub, ok := v.(map[string]interface{}); ok {
				walk(prefix+k+":", sub)
			}
		}
	}
	walk("tfhealth:", j)
	return out, nil
}

// aliasTensorfold returns the input samples plus, for every TensorFold family
// with a vLLM counterpart, an extra sample under the vLLM name. Originals are
// kept so a TensorFold-only metric stays visible to other consumers.
func aliasTensorfold(in []sample) []sample {
	out := make([]sample, 0, len(in)+len(tfAliases))
	out = append(out, in...)
	for _, s := range in {
		if a, ok := tfAliases[s.name]; ok {
			out = append(out, sample{name: a.to, labels: s.labels, value: s.value * a.scale})
			continue
		}
		for from, to := range tfHistAliases {
			if strings.HasPrefix(s.name, from+"_") {
				out = append(out, sample{
					name:   to + strings.TrimPrefix(s.name, from),
					labels: s.labels,
					value:  s.value,
				})
				break
			}
		}
	}
	return out
}
