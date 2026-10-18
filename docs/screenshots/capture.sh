#!/usr/bin/env bash
# 重新生成面板所有页截图到 docs/screenshots/（需 playwright 的 chromium + 面板在 127.0.0.1:8890）
#   安装一次：pnpm exec playwright install chromium   （或任何已装 playwright 的 node 环境）
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="${BASE:-http://127.0.0.1:8890}"

# 一次性写入截图小工具（放在 /tmp，不进仓库）；playwright 模块用 Node 的解析规则找
if [[ ! -f /tmp/shot.mjs ]]; then
  cat > /tmp/shot.mjs <<'JS'
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://127.0.0.1:8890';
const OUT = process.env.OUT;
const pages = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
for (const pg of pages) {
  await page.goto(`${BASE}/#/${pg}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4500);            // 等图表与成本计算落地
  await page.screenshot({ path: `${OUT}/${pg}.png`, fullPage: true });
  console.log(`${pg}.png ✓`);
}
await browser.close();
JS
fi

# 注意：故意不含 settings（节点配置页显示真实内网地址，不生成截图）
for pg in overview gpu throughput spec cache network cost; do
  BASE="$BASE" OUT="$DIR" node /tmp/shot.mjs "$pg"
done
echo "完成 → $DIR"
