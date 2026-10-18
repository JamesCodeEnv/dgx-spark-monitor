package main

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

// collectorLmcache scrapes an LMCache MP server's Prometheus /metrics endpoint
// (default http://127.0.0.1:8080/metrics) and derives the panel series:
// L1/L2 usage, lookup hit rate, store/retrieve rates and cumulative counters.
//
// Only server-wide families are used on purpose: counters carrying a
// worker_id label (e.g. lmcache_mp_num_chunks_loaded_total) keep one stale
// series per past vLLM engine incarnation, so summing them over-counts and
// picking one is ambiguous. The l2_*/l1_* families below are engine-agnostic.
type collectorLmcache struct {
	url      string
	prev     map[string]float64 // previous counter values
	prevTime time.Time
}

const bytesPerGiB = 1 << 30

// collect returns the derived time-series rows for the current scrape.
func (l *collectorLmcache) collect() ([]row, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(l.url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("lmcache /metrics: status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, err
	}

	samples := parsePrometheusText(string(body))
	cur := lmcacheCounters(samples)
	now := time.Now()
	nowTs := now.Unix()

	out := make([]row, 0, 20)
	add := func(name string, val float64) { out = append(out, row{Name: name, Ts: nowTs, Val: val}) }

	// --- gauges (always) ---
	add("lmcache.l1_used_gb", cur["l1_used_bytes"]/bytesPerGiB)
	add("lmcache.l1_usage_pct", cur["l1_ratio"]*100)
	add("lmcache.l2_used_gb", cur["l2_used_bytes"]/bytesPerGiB)
	add("lmcache.active_prefetch", cur["active_prefetch"])

	// --- cumulative counters (always) ---
	add("lmcache.chunks_stored_total", cur["l2_store_chunks"])
	add("lmcache.chunks_retrieved_total", cur["l2_load_chunks"])
	add("lmcache.ssd_hit_chunks_total", cur["l2_hit_chunks"])
	add("lmcache.l1_evicted_chunks_total", cur["l1_evicted"])
	add("lmcache.event_dropped_total", cur["event_dropped"])
	if cur["lookup_tokens"] > 0 {
		add("lmcache.lookup_hit_pct_total", cur["hit_tokens"]/cur["lookup_tokens"]*100)
	} else {
		add("lmcache.lookup_hit_pct_total", 0)
	}

	// --- windowed rates (need a previous scrape) ---
	if !l.prevTime.IsZero() {
		dt := now.Sub(l.prevTime).Seconds()
		if dt > 0 {
			diff := func(key string) float64 {
				d := cur[key] - l.prev[key]
				if d < 0 {
					d = 0 // counter reset (server restart)
				}
				return d
			}
			rate := func(key, name string) { add(name, diff(key)/dt) }
			rate("l2_store_chunks", "lmcache.store_chunk_s")
			rate("l2_load_chunks", "lmcache.retrieve_chunk_s")
			rate("l1_write_chunks", "lmcache.l1_write_chunk_s")
			rate("l1_read_chunks", "lmcache.l1_read_chunk_s")
			rate("lookup_tokens", "lmcache.lookup_tokens_s")
			rate("hit_tokens", "lmcache.hit_tokens_s")
			// windowed hit rate: only meaningful while lookups happen, so the
			// series gets a gap (no point) on idle intervals.
			if dq := diff("lookup_tokens"); dq > 0 {
				add("lmcache.lookup_hit_pct", diff("hit_tokens")/dq*100)
			}
		}
	}

	l.prev = cur
	l.prevTime = now
	return out, nil
}

// lmcacheCounters flattens the server-wide LMCache metric families into a map.
func lmcacheCounters(samples []sample) map[string]float64 {
	m := make(map[string]float64, 16)
	add := func(key, fam string) { m[key] = valueOf(samples, fam, nil) }

	add("l1_used_bytes", "lmcache_mp_l1_memory_usage_bytes")
	add("l1_ratio", "lmcache_mp_l1_usage_ratio")
	add("l2_used_bytes", "lmcache_mp_l2_usage_bytes")
	add("l1_write_chunks", "lmcache_mp_l1_write_chunks_total")
	add("l1_read_chunks", "lmcache_mp_l1_read_chunks_total")
	add("l1_evicted", "lmcache_mp_l1_evicted_chunks_total")
	add("l2_store_chunks", "lmcache_mp_l2_store_completed_objects_chunks_total")
	add("l2_load_chunks", "lmcache_mp_l2_prefetch_load_completed_chunks_total")
	add("l2_hit_chunks", "lmcache_mp_l2_prefetch_hit_chunks_total")
	add("lookup_tokens", "lmcache_mp_lookup_requested_tokens_total")
	add("hit_tokens", "lmcache_mp_lookup_hit_tokens_total")
	add("active_prefetch", "lmcache_mp_active_prefetch_jobs")
	add("event_dropped", "lmcache_mp_event_bus_dropped_events_total")
	return m
}
