import express from "express";
import cors from "cors";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "../.env");
try {
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const [key, ...rest] = line.split("=");
    if (key && rest.length) process.env[key.trim()] = rest.join("=").trim();
  }
} catch {
  // rely on real environment variables
}

const ORIGAMI_BASE_URL = process.env.VITE_ORIGAMI_BASE_URL;
const USERNAME         = process.env.VITE_ORIGAMI_USERNAME;
const API_SECRET       = process.env.VITE_ORIGAMI_API_SECRET;

console.log("Loaded API_SECRET prefix:", API_SECRET?.slice(0, 10));

const ENTITY        = "e_163";
const GROUP         = "g_304";
const FLD_UNIT_NAME = "fld_1774";
const FLD_CMD_NAME  = "fld_1775";
const FLD_PHONE     = "fld_1776";
const FLD_CMD_ID    = "fld_1777";
const FLD_OTP       = "fld_1778";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function origamiPost(path, body) {
  return fetch(`${ORIGAMI_BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, api_secret: API_SECRET, ...body }),
  });
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalisePhone(p) {
  return String(p).replace(/\D/g, "").replace(/^0/, "972");
}

/**
 * Find a commander by ID + phone.
 * Returns { instanceId, fields } or null.
 */
async function findCommander(commanderId, phone) {
  const res = await origamiPost("/entities/api/instance_data/format/json", {
    entity_data_name: ENTITY,
    filters: [{ field: FLD_CMD_ID, value: commanderId, operator: "=" }],
  });

  if (!res.ok) throw new Error(`Origami query failed (${res.status})`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || "Origami error");

  const instances = Array.isArray(json?.data) ? json.data : [];
  const normPhone  = normalisePhone(phone);

  for (const inst of instances) {
    const groups = inst.instance_data?.field_groups || [];
    const group  = groups.find((g) => g.field_group_data?.group_data_name === GROUP);
    if (!group) continue;

    // fields_data from reads comes back as array-of-arrays — flatten one level
    const fields = (group.fields_data || []).flat();
    const phoneField = fields.find((f) => f.field_data_name === FLD_PHONE);
    if (!phoneField) continue;

    const stored = phoneField.normalize?.normalize_full || normalisePhone(phoneField.value);
    if (stored === normPhone) {
      return { instanceId: inst.instance_data._id, fields };
    }
  }
  return null;
}

/**
 * Update a single field on a commander record.
 * Uses the update_instance_fields endpoint with filter + field array format.
 */
async function updateField(instanceId, fieldDataName, value) {
  return updateInstanceFields(ENTITY, instanceId, [[fieldDataName, value, 0]]);
}

/**
 * Origami update_instance_fields: filter + field triplets [field_data_name, value, group_index].
 * @see https://documenter.getpostman.com/view/2653695/2s93kz65gS#0646b01f-1752-4355-802b-cb55c7b9bd7e
 */
async function updateInstanceFields(entityDataName, instanceId, fieldUpdates) {
  const payload = {
    entity_data_name: entityDataName,
    filter: [["_id", "=", instanceId]],
    field: fieldUpdates,
  };

  const res = await origamiPost("/entities/api/update_instance_fields/format/json", payload);
  const json = await res.json();

  if (json?.error) throw new Error(json.error.message || "Update failed");
  if (json?.success !== "ok") throw new Error("Update failed");

  return json;
}

// ------------------------------------------------------------------
// POST /api/request-otp  { commanderId, phone }
// ------------------------------------------------------------------
app.post("/api/request-otp", async (req, res) => {
  const { commanderId, phone } = req.body || {};
  if (!commanderId || !phone) {
    return res.status(400).json({ error: "commanderId and phone are required" });
  }

  try {
    const commander = await findCommander(commanderId, phone);
    if (!commander) {
      return res.status(404).json({ error: "מפקד לא נמצא — בדוק מספר אישי ומספר טלפון" });
    }

    const otp = generateOtp();
    console.log(`Generated OTP ${otp} for instance ${commander.instanceId}`);

    await updateField(commander.instanceId, FLD_OTP, otp);

    return res.json({ ok: true });
  } catch (err) {
    console.error("request-otp error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// POST /api/verify-otp  { commanderId, phone, code }
// ------------------------------------------------------------------
app.post("/api/verify-otp", async (req, res) => {
  const { commanderId, phone, code } = req.body || {};
  if (!commanderId || !phone || !code) {
    return res.status(400).json({ error: "commanderId, phone and code are required" });
  }

  try {
    const commander = await findCommander(commanderId, phone);
    if (!commander) {
      return res.status(404).json({ error: "מפקד לא נמצא" });
    }

    const otpField  = commander.fields.find((f) => f.field_data_name === FLD_OTP);
    const storedOtp = String(otpField?.value || "").trim();
    console.log(`Stored OTP: "${storedOtp}", provided: "${code.trim()}"`);

    if (!storedOtp || storedOtp !== code.trim()) {
      return res.status(401).json({ error: "קוד שגוי — נסה שוב" });
    }

    const nameField     = commander.fields.find((f) => f.field_data_name === FLD_CMD_NAME);
    const unitNameField = commander.fields.find((f) => f.field_data_name === FLD_UNIT_NAME);

    return res.json({
      id:       commanderId,
      name:     String(nameField?.value || commanderId),
      unitId:   commander.instanceId,
      unitName: String(unitNameField?.value || ""),
    });
  } catch (err) {
    console.error("verify-otp error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/training-types
// ------------------------------------------------------------------
app.get("/api/training-types", async (req, res) => {
  try {
    const origamiRes = await origamiPost("/entities/api/instance_data/format/json", {
      entity_data_name: "e_165",
    });

    const json = await origamiRes.json();
    if (json?.error) throw new Error(json.error.message || "Origami error");

    const instances = Array.isArray(json?.data) ? json.data : [];
    console.log("training-types raw first instance:", JSON.stringify(instances[0]?.instance_data, null, 2));
    const types = instances.map((inst) => {
      const groups = inst.instance_data?.field_groups || [];
      const group  = groups.find((g) => g.field_group_data?.group_data_name === "g_306");
      const fields = (group?.fields_data || []).flat();
      const name   = fields.find((f) => f.field_data_name === "fld_1784")?.value || "";
      return { id: inst.instance_data._id, name: String(name) };
    });

    return res.json(types);
  } catch (err) {
    console.error("training-types error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});


app.get("/api/training-sessions", async (req, res) => {
  const { typeId } = req.query;
  if (!typeId) return res.status(400).json({ error: "typeId is required" });

  try {
    const origamiRes = await origamiPost("/entities/api/instance_data/format/json", {
      entity_data_name: "e_166",
    });

    const json = await origamiRes.json();
    if (json?.error) throw new Error(json.error.message || "Origami error");

    const instances = Array.isArray(json?.data) ? json.data : [];
    const sessions = instances
      .filter((inst) => {
        const groups = inst.instance_data?.field_groups || [];
        const group  = groups.find((g) => g.field_group_data?.group_data_name === "g_307");
        const fields = (group?.fields_data || []).flat();
        const typeField = fields.find((f) => f.field_data_name === "fld_1786");
        return typeField?.value?.instance_id === typeId;
      })
      .map((inst) => {
        const groups = inst.instance_data?.field_groups || [];
        const group  = groups.find((g) => g.field_group_data?.group_data_name === "g_307");
        const fields = (group?.fields_data || []).flat();
        const name   = fields.find((f) => f.field_data_name === "fld_1787")?.value || "";
        return { id: inst.instance_data._id, name: String(name) };
      });

    return res.json(sessions);
  } catch (err) {
    console.error("training-sessions error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/ungraded-soldiers", async (req, res) => {
  const { sessionId } = req.query;
  console.log("[ungraded-soldiers] sessionId:", sessionId);
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

  try {
    // Fetch the training session instance to get its soldier group
    const sessionRes = await origamiPost("/entities/api/instance_data/format/json", {
      entity_data_name: "e_166",
      filter: [["_id", "=", sessionId]],
    });
    const sessionJson = await sessionRes.json();
    if (sessionJson?.error) throw new Error(sessionJson.error.message || "Origami error");

    const instances = Array.isArray(sessionJson?.data) ? sessionJson.data : [];
    const session = instances[0];
    if (!session) return res.status(404).json({ error: "Training session not found" });

    // Get the repeatable group g_309 with soldier rows
    const fieldGroups = session.instance_data?.field_groups || [];
    const soldierGroup = fieldGroups.find((g) => g.field_group_data?.group_data_name === "g_309");
    const rows = soldierGroup?.fields_data || [];

    // Each row is an array of fields — group_index is the row's position in fields_data
    const soldierInstanceIds = [];
    rows.forEach((row) => {
      const gradeField = row.find((f) => f.field_data_name === "fld_1800");
      const gradeValue = gradeField?.value;

      const soldierField = row.find((f) => f.field_data_name === "fld_1798");
      const instanceId = soldierField?.value?.instance_id;
      const dbGroupIndex = soldierField?.group_index;
      if (instanceId) {
        soldierInstanceIds.push({
          instanceId,
          groupIndex: typeof dbGroupIndex === "number" ? dbGroupIndex : 0,
          // Include existing grade if already recorded
          grade: (gradeValue !== "" && gradeValue !== null && gradeValue !== undefined)
            ? Number(gradeValue)
            : null,
        });
      }
    });

    if (!soldierInstanceIds.length) return res.json([]);

    // Fetch soldier names from e_164
    const soldiersRes = await origamiPost("/entities/api/instance_data/format/json", {
      entity_data_name: "e_164",
    });
    const soldiersJson = await soldiersRes.json();
    if (soldiersJson?.error) throw new Error(soldiersJson.error.message || "Origami error");

    const allSoldiers = Array.isArray(soldiersJson?.data) ? soldiersJson.data : [];

    // Build a map of instanceId -> name
    const nameMap = {};
    for (const inst of allSoldiers) {
      const id = inst.instance_data?._id;
      const groups = inst.instance_data?.field_groups || [];
      const group  = groups.find((g) => g.field_group_data?.group_data_name === "g_305");
      const fields = (group?.fields_data || []).flat();
      const name   = fields.find((f) => f.field_data_name === "fld_1780")?.value || "";
      if (id) nameMap[id] = String(name);
    }

    const soldiers = soldierInstanceIds.map(({ instanceId, groupIndex, grade }) => ({
      id: instanceId,
      name: nameMap[instanceId] || instanceId,
      personalNumber: instanceId,
      unitId: null,
      groupIndex,
      grade,
    }));

    return res.json(soldiers);
  } catch (err) {
    console.error("ungraded-soldiers error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/save-grades", async (req, res) => {
  const { sessionId, grades, trainingNote } = req.body || {};
  if (!sessionId || !Array.isArray(grades) || !grades.length) {
    return res.status(400).json({ error: "sessionId and grades are required" });
  }

  try {
    let saved = 0;

    for (const { grade, groupIndex } of grades) {
      const updateJson = await updateInstanceFields("e_166", sessionId, [
        ["fld_1800", String(grade), groupIndex],
      ]);
      saved += updateJson.results?.fields_updated_total || 0;
    }

    if (typeof trainingNote === "string" && trainingNote.trim()) {
      await updateInstanceFields("e_166", sessionId, [["fld_1789", trainingNote.trim(), 0]]);
    }

    if (saved === 0) throw new Error("לא עודכנו ציונים");

    return res.json({ saved });
  } catch (err) {
    console.error("save-grades error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Bach API server running on port ${PORT}`));
