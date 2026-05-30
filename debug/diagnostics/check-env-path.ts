/**
 * Перевірка, чи PM2/shell бачать той самий `.env`, що й очікує `database/db.ts`.
 *
 * Як працює завантаження:
 *   - `import "dotenv/config"` у `db.ts` підвантажує **лише** `.env` відносно `process.cwd()`
 *     (типово це каталог, з якого запущено процес).
 *   - У `ecosystem.config.cjs` для всіх апів задано `cwd: root`, де `root` — папка з
 *     `ecosystem.config.cjs`. Там саме має лежати `.env` (поруч із `package.json`).
 *
 * Запуск з кореня репозиторія:
 *   npx ts-node debug/check-env-path.ts
 *   node dist/debug/check-env-path.js
 *
 * Секрети не друкуються — лише ok / missing.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const REQUIRED_FOR_JANITOR = [
  "DB_USER",
  "DB_PASSWORD",
  "TELEGRAM_BOT_TOKEN",
] as const;

function findDirWithPackageJson(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

function flagsFromParsed(
  parsed: Record<string, string>,
): Record<(typeof REQUIRED_FOR_JANITOR)[number], "ok" | "missing"> {
  const out = {} as Record<(typeof REQUIRED_FOR_JANITOR)[number], "ok" | "missing">;
  for (const key of REQUIRED_FOR_JANITOR) {
    const v = parsed[key];
    out[key] = v != null && String(v).trim() !== "" ? "ok" : "missing";
  }
  return out;
}

function main(): void {
  const cwd = process.cwd();
  const repoFromScript = findDirWithPackageJson(__dirname);
  const envInCwd = path.join(cwd, ".env");
  const envInRepo =
    repoFromScript != null ? path.join(repoFromScript, ".env") : null;

  console.log("=== check-env-path (janitor / DB) ===\n");
  console.log("process.cwd()     ", cwd);
  console.log("__dirname (script)", __dirname);
  console.log(
    "repo root (package.json)",
    repoFromScript ?? "(not found walking up from script)",
  );
  console.log("");

  const blocks: { label: string; file: string }[] = [
    { label: ".env next to cwd (what dotenv/config uses by default)", file: envInCwd },
  ];
  if (envInRepo != null && path.resolve(envInRepo) !== path.resolve(envInCwd)) {
    blocks.push({
      label: ".env next to repo root (expected PM2 cwd = this folder)",
      file: envInRepo,
    });
  }

  for (const { label, file } of blocks) {
    console.log(`--- ${label} ---`);
    console.log("  path:", file);
    if (!fs.existsSync(file)) {
      console.log("  file: NOT FOUND");
      console.log("");
      continue;
    }
    const parsed = dotenv.parse(fs.readFileSync(file));
    const flags = flagsFromParsed(parsed);
    console.log("  file: exists");
    for (const [k, v] of Object.entries(flags)) {
      console.log(`  ${k}: ${v}`);
    }
    console.log("");
  }

  console.log("--- Simulating first import of database/db.ts from cwd ---");
  console.log(
    "  (db.ts does: import \"dotenv/config\" → loads only cwd/.env)",
  );
  const afterCwdOnly = fs.existsSync(envInCwd)
    ? dotenv.parse(fs.readFileSync(envInCwd))
    : {};
  const sim = flagsFromParsed(afterCwdOnly);
  const dbOk = sim.DB_USER === "ok" && sim.DB_PASSWORD === "ok";
  console.log(
    "  Result: DB_USER/DB_PASSWORD",
    dbOk ? "→ OK (janitor can connect)" : "→ FAIL (same as Missing DB_USER in logs)",
  );
  console.log("  TELEGRAM_BOT_TOKEN:", sim.TELEGRAM_BOT_TOKEN);
  console.log("");

  if (repoFromScript != null && path.resolve(cwd) !== path.resolve(repoFromScript)) {
    console.log(
      "⚠ cwd !== repo root. If you run `node dist/...` from another folder,",
    );
    console.log(
      "  dotenv will NOT read the project .env — use: cd <repo> && node ...",
    );
    console.log("  or set PM2 cwd to the repo root (as in ecosystem.config.cjs).");
  }
}

main();
