// Temporary diagnostic script — run with: node server/check-origami.js
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env");
const lines = readFileSync(envPath, "utf8").split("\n");
for (const line of lines) {
  const [key, ...rest] = line.split("=");
  if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
}

const BASE  = process.env.VITE_ORIGAMI_BASE_URL;
const USER  = process.env.VITE_ORIGAMI_USERNAME;
const SEC   = process.env.VITE_ORIGAMI_API_SECRET;

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USER, api_secret: SEC, ...body }),
  });
  return res.json();
}

// 1. List all entities — check protected_entity flag on e_163
console.log("\n=== Entities list ===");
const entities = await post("/entities/api/entities_list/format/json", {});
const e163 = (entities.data || entities).find?.((e) => e.entity_data_name === "e_163");
console.log("e_163 entry:", JSON.stringify(e163, null, 2));

// 2. Get entity structure
console.log("\n=== Entity structure ===");
const structure = await post("/entities/api/entity_structure/format/json", {
  entity_data_name: "e_163",
});
console.log(JSON.stringify(structure, null, 2));
