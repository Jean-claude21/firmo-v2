// Démarre l'API (+ worker) puis le web dans le même conteneur. Si l'un s'arrête, le conteneur
// s'arrête aussi : Coolify le redémarre (pas de demi-service silencieux).
import { spawn } from "node:child_process";

const children = [];

function run(name, cwd, script, env) {
  const child = spawn(process.execPath, [script], { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
  child.on("exit", (code, signal) => {
    console.error(`[start] ${name} arrêté (code ${code ?? "-"}, signal ${signal ?? "-"})`);
    for (const other of children) if (other !== child && !other.killed) other.kill("SIGTERM");
    process.exit(code ?? 1);
  });
  children.push(child);
}

run("api", "/app/api", "dist/index.js", { PORT: process.env.FIRMO_API_PORT ?? "8790" });
run("web", "/app/web", "scripts/serve.mjs", { PORT: process.env.PORT ?? "3000" });

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal);
  });
}
