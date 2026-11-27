/**
 * 公网展示站构建与打包（ZCode Sites 托管）：
 *   node scripts/dev/site.mjs build   —— WAL 落盘 + 以 JYC_PUBLIC_SITE=1 构建 apps/web（剔除 /ask 路由与导航）
 *   node scripts/dev/site.mjs stage   —— 组装 .zcode-site/stage：build 产物 + linux 运行时依赖 + DB 快照 + start.sh
 * 之后用 zcode-site CLI：check / deploy（见 docs/技术方案.md §运行手册）
 */
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const webDir = join(root, "apps", "web");
const stageDir = join(root, ".zcode-site", "stage");

const RUNTIME_DEPS = {
  "@react-router/node": "^7.18.5",
  "@react-router/serve": "^7.18.5",
  // @jyc/core 链路 import "dotenv"（SSR bundle 保留为外部导入）；缺它时云上向上解析不到会启动即退
  dotenv: "^17.2.3",
  isbot: "^5.2.2",
  react: "^19.3.1",
  "react-dom": "^19.3.1",
  "react-router": "^7.18.5",
};

function sh(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", shell: process.platform === "win32" ? "powershell.exe" : "bash", ...opts });
}

function build() {
  // WAL checkpoint：把 -wal 并回主库，快照完整且无需携带 wal/shm 文件
  const db = new DatabaseSync(join(root, "data", "jycgs.db"));
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  console.log("[site] DB 已 checkpoint");

  sh("npm run build", {
    cwd: webDir,
    env: { ...process.env, JYC_PUBLIC_SITE: "1", VITE_PUBLIC_SITE: "1" },
  });
  console.log("[site] 公网版构建完成（无 /ask 路由）");
}

function stage() {
  if (!existsSync(join(webDir, "build", "server", "index.js"))) {
    throw new Error("缺少构建产物，请先运行 site.mjs build");
  }
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  // 1) SSR 构建产物（server + client 静态资源）
  cpSync(join(webDir, "build"), join(stageDir, "build"), { recursive: true });

  // 关键修复：vite 在 Windows 构建时把 assetsBuildDirectory 以 "build\\client" 烘焙进 server bundle，
  // Linux 上该字面量目录不存在 → express.static 全 404 → 页面无样式。统一替换为 POSIX 分隔符。
  const serverEntry = join(stageDir, "build", "server", "index.js");
  let serverSrc = readFileSync(serverEntry, "utf8");
  const patched = serverSrc.split("build\\\\client").join("build/client");
  if (patched === serverSrc) {
    console.log("[site] 提示：server bundle 未发现 Windows 路径（可能已在 Linux 构建），跳过替换");
  } else {
    writeFileSync(serverEntry, patched);
    console.log("[site] 已修复 server bundle 中的 assetsBuildDirectory 路径分隔符");
  }

  // 2) 运行时 package.json + linux x86-64 依赖（全部纯 JS，无原生编译）
  writeFileSync(
    join(stageDir, "package.json"),
    JSON.stringify({ name: "jyc-site", private: true, type: "module", dependencies: RUNTIME_DEPS }, null, 2),
  );
  sh("npm install --omit=dev --no-audit --no-fund --os=linux --cpu=x64", { cwd: stageDir });

  // 3) DB 快照 + 迁移脚本（openDb 需要 migrations 目录存在；运行时拷到 $DATA_DIR 再打开）
  mkdirSync(join(stageDir, "data"));
  cpSync(join(root, "data", "jycgs.db"), join(stageDir, "data", "jycgs.db"));
  cpSync(join(root, "database"), join(stageDir, "database"), { recursive: true });

  // 4) start.sh（模板：前台运行、0.0.0.0:3000、不装不建）
  const startSh = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'cd "$(dirname "${BASH_SOURCE[0]}")"',
    "",
    "export NODE_ENV=production",
    'export PORT="${PORT:-3000}"',
    "export HOST=0.0.0.0 HOSTNAME=0.0.0.0",
    'export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"',
    'export DATA_DIR="${DATA_DIR:-$PWD/data}"',
    'mkdir -p "$DATA_DIR"',
    "# /app 只读风险规避：把 DB 快照拷到可写目录（SQLite WAL 需写权限），迁移目录保持包内只读",
    'if [ "$DATA_DIR" != "$PWD/data" ]; then cp -f data/jycgs.db "$DATA_DIR/jycgs.db" 2>/dev/null || true; fi',
    'export JYC_DB_PATH="$DATA_DIR/jycgs.db"',
    "",
    "exec node node_modules/@react-router/serve/bin.js ./build/server/index.js",
    "",
  ].join("\n");
  writeFileSync(join(stageDir, "start.sh"), startSh, { mode: 0o755 });

  // 5) 清理跨平台残留的无关二进制（本组依赖纯 JS，防御性删除非 linux 预编译目录）
  const nm = join(stageDir, "node_modules");
  for (const dir of readdirSync(nm, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const junk of ["prebuilds", "vendor"]) {
      const p = join(nm, dir.name, junk);
      if (existsSync(p)) rmSync(p, { recursive: true, force: true });
    }
  }

  console.log(`[site] stage 就绪：${stageDir}`);
}

const cmd = process.argv[2];
if (cmd === "build") build();
else if (cmd === "stage") stage();
else {
  console.log("用法：node scripts/dev/site.mjs <build|stage>");
  process.exit(1);
}
