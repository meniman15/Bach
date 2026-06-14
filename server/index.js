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
const USERNAME = process.env.VITE_ORIGAMI_USERNAME;
const API_SECRET = process.env.VITE_ORIGAMI_API_SECRET;
const IS_DEV = process.env.DEV === "true";

console.log("Loaded API_SECRET prefix:", API_SECRET?.slice(0, 10));
console.log("DEV Mode Active:", IS_DEV);

const ENTITY = "e_163";
const GROUP = "g_304";
const FLD_UNIT_NAME = "fld_1774";
const FLD_CMD_NAME = "fld_1775";
const FLD_PHONE = "fld_1776";
const FLD_CMD_ID = "fld_1777";
const FLD_OTP = "fld_1778";
const FLD_COMPANY = "fld_1779";

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

async function findCommanderByPhone(phone) {
  const res = await origamiPost("/entities/api/instance_data/format/json", {
    entity_data_name: ENTITY,
  });

  if (!res.ok) throw new Error(`Origami query failed (${res.status})`);
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message || "Origami error");

  const instances = Array.isArray(json?.data) ? json.data : [];
  const normPhone = normalisePhone(phone);

  for (const inst of instances) {
    const groups = inst.instance_data?.field_groups || [];
    const group = groups.find((g) => g.field_group_data?.group_data_name === GROUP);
    if (!group) continue;

    const fields = (group.fields_data || []).flat();
    const phoneField = fields.find((f) => f.field_data_name === FLD_PHONE);

    const stored = phoneField?.normalize?.normalize_full || normalisePhone(phoneField?.value);
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
// POST /api/request-otp  { phone }
// ------------------------------------------------------------------
app.post("/api/request-otp", async (req, res) => {
  const { phone } = req.body || {};
  if (!phone) {
    return res.status(400).json({ error: "phone is required" });
  }

  try {
    const commander = await findCommanderByPhone(phone);
    if (!commander) {
      return res.status(404).json({ error: "מספר טלפון לא רשום" });
    }

    const otp = generateOtp();
    if (IS_DEV) {
      console.log(`[DEBUG] DEV mode: Skipping writing OTP ${otp} to Origami for commander ${commander.instanceId}`);
    } else {
      await updateField(commander.instanceId, FLD_OTP, otp);
    }
 
    return res.json({ ok: true });
  } catch (err) {
    console.error("request-otp error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// POST /api/verify-otp  { phone, code }
// ------------------------------------------------------------------
app.post("/api/verify-otp", async (req, res) => {
  const { phone, code } = req.body || {};
  if (!phone || !code) {
    return res.status(400).json({ error: "phone and code are required" });
  }

  try {
    const commander = await findCommanderByPhone(phone);
    if (!commander) {
      return res.status(404).json({ error: "מספר טלפון לא רשום" });
    }

    const otpField = commander.fields.find((f) => f.field_data_name === FLD_OTP);
    const storedOtp = String(otpField?.value || "").trim();
    if (IS_DEV) {
      console.log(`[DEBUG] DEV mode: Bypassing OTP check (stored: "${storedOtp}", provided: "${code.trim()}")`);
    } else {
      if (!storedOtp || storedOtp !== code.trim()) {
        return res.status(401).json({ error: "קוד שגוי — נסה שוב" });
      }
    }

    const nameField = commander.fields.find((f) => f.field_data_name === FLD_CMD_NAME);
    const unitNameField = commander.fields.find((f) => f.field_data_name === FLD_UNIT_NAME);
    const companyField = commander.fields.find((f) => f.field_data_name === FLD_COMPANY);

    // fld_1779 is a plain text field containing the company (פלוגה) name
    const companyRaw = companyField?.value;
    const companyName = typeof companyRaw === "string"
      ? companyRaw
      : (companyRaw?.text || companyRaw?.instance_text || companyRaw?.name || "");

    return res.json({
      id: phone,
      name: String(nameField?.value || phone),
      unitId: commander.instanceId,
      unitName: String(unitNameField?.value || ""),
      companyName: String(companyName),
    });
  } catch (err) {
    console.error("verify-otp error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/topics  →  e_168 → g_310 → fld_1818
// ------------------------------------------------------------------
app.get("/api/topics", async (req, res) => {
  try {
    const origamiRes = await origamiPost("/entities/api/instance_data/format/json", {
      entity_data_name: "e_168",
    });
    const json = await origamiRes.json();
    if (json?.error) throw new Error(json.error.message || "Origami error");
    const instances = Array.isArray(json?.data) ? json.data : [];
    const topics = instances
      .map((inst) => {
        const groups = inst.instance_data?.field_groups || [];
        const group = groups.find((g) => g.field_group_data?.group_data_name === "g_310");
        const fields = (group?.fields_data || []).flat();
        const name = fields.find((f) => f.field_data_name === "fld_1818")?.value || "";
        return { id: inst.instance_data._id, name: String(name) };
      })
      .filter((t) => t.name);
    return res.json(topics);
  } catch (err) {
    console.error("topics error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/training-types?topicId=<e_168 instance id>
// Returns e_165 instances whose fld_1819 points to the given topic.
// ------------------------------------------------------------------
app.get("/api/training-types", async (req, res) => {
  const { topicId } = req.query;
  try {
    const origamiRes = await origamiPost("/entities/api/instance_data/format/json", {
      entity_data_name: "e_165",
    });
    const json = await origamiRes.json();
    if (json?.error) throw new Error(json.error.message || "Origami error");
    const instances = Array.isArray(json?.data) ? json.data : [];
    const types = instances
      .filter((inst) => {
        if (!topicId) return true;
        const groups = inst.instance_data?.field_groups || [];
        const group = groups.find((g) => g.field_group_data?.group_data_name === "g_306");
        const fields = (group?.fields_data || []).flat();
        const topicField = fields.find((f) => f.field_data_name === "fld_1819");
        return topicField?.value?.instance_id === topicId;
      })
      .map((inst) => {
        const groups = inst.instance_data?.field_groups || [];
        const group = groups.find((g) => g.field_group_data?.group_data_name === "g_306");
        const fields = (group?.fields_data || []).flat();
        const name = fields.find((f) => f.field_data_name === "fld_1784")?.value || "";
        return { id: inst.instance_data._id, name: String(name) };
      })
      .filter((t) => t.name);
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
        const group = groups.find((g) => g.field_group_data?.group_data_name === "g_307");
        const fields = (group?.fields_data || []).flat();
        const typeField = fields.find((f) => f.field_data_name === "fld_1786");
        return typeField?.value?.instance_id === typeId;
      })
      .map((inst) => {
        const groups = inst.instance_data?.field_groups || [];
        const group = groups.find((g) => g.field_group_data?.group_data_name === "g_307");
        const fields = (group?.fields_data || []).flat();
        const name = fields.find((f) => f.field_data_name === "fld_1787")?.value || "";
        return { id: inst.instance_data._id, name: String(name) };
      });

    return res.json(sessions);
  } catch (err) {
    console.error("training-sessions error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ------------------------------------------------------------------
// GET /api/unit-soldiers?unitId=<e_163 instance id>
// Returns all soldiers (e_164) whose fld_1783 (מחלקה) points to the
// given commander/unit instance.
// ------------------------------------------------------------------
app.get("/api/unit-soldiers", async (req, res) => {
  const { unitId } = req.query;
  console.log(`[DEBUG] /api/unit-soldiers called with unitId: "${unitId}"`);
  if (!unitId) return res.status(400).json({ error: "unitId is required" });

  if (IS_DEV && unitId === "6a2a6f570c43abe8f70aa44d") {
    const mockSoldiers = [];
    for (let i = 1; i <= 30; i++) {
      mockSoldiers.push({
        id: `mock_boxer_${i}`,
        name: `חייל ${i} (בוקסר)`,
        personalNumber: `80000${String(i).padStart(2, '0')}`
      });
    }
    console.log(`[DEBUG] DEV mode: returning 30 mock soldiers for unit 'בוקסר' (${unitId})`);
    return res.json(mockSoldiers);
  }

  try {
    const origamiRes = await origamiPost("/entities/api/instance_data/format/json", {
      entity_data_name: "e_164",
      limit: 5000,
    });
    const json = await origamiRes.json();
    if (json?.error) throw new Error(json.error.message || "Origami error");

    const instances = Array.isArray(json?.data) ? json.data : [];
    console.log(`[DEBUG] /api/unit-soldiers fetched ${instances.length} soldiers total from Origami`);

    const soldiers = instances
      .filter((inst) => {
        const groups = inst.instance_data?.field_groups || [];
        const group = groups.find((g) => g.field_group_data?.group_data_name === "g_305");
        const fields = (group?.fields_data || []).flat();
        const unitField = fields.find((f) => f.field_data_name === "fld_1783");
        const match = unitField?.value?.instance_id === unitId;
        return match;
      })
      .map((inst) => {
        const groups = inst.instance_data?.field_groups || [];
        const group = groups.find((g) => g.field_group_data?.group_data_name === "g_305");
        const fields = (group?.fields_data || []).flat();
        const name = fields.find((f) => f.field_data_name === "fld_1780")?.value || "";
        const idNum = fields.find((f) => f.field_data_name === "fld_1781")?.value || "";
        return { id: inst.instance_data._id, name: String(name), personalNumber: String(idNum) };
      });

    console.log(`[DEBUG] /api/unit-soldiers returning ${soldiers.length} filtered soldiers for unitId "${unitId}"`);
    return res.json(soldiers);
  } catch (err) {
    console.error("unit-soldiers error:", err.message);
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
      const group = groups.find((g) => g.field_group_data?.group_data_name === "g_305");
      const fields = (group?.fields_data || []).flat();
      const name = fields.find((f) => f.field_data_name === "fld_1780")?.value || "";
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

// ------------------------------------------------------------------
// POST /api/create-training-record
// Creates a new e_166 instance with main fields + repeatable soldier rows.
// Body: { typeId, unitId, trainingDate (YYYY-MM-DD), trainingNote, grades: [{soldierId, grade}] }
// ------------------------------------------------------------------
app.post("/api/create-training-record", async (req, res) => {
  const { typeId, unitId, trainingDate, trainingNote, lessonName, grades } = req.body || {};
  if (!typeId || !unitId || !trainingDate || !Array.isArray(grades) || !grades.length) {
    return res.status(400).json({ error: "typeId, unitId, trainingDate and grades are required" });
  }

  try {
    // Convert YYYY-MM-DD to DD/MM/YYYY (Origami custom validation expects d/m/Y format)
    const [y, m, d] = trainingDate.split("-");
    const formattedDate = `${d}/${m}/${y}`;
 
    // Build the form_data according to the Origami API spec
    const formData = [
      {
        group_data_name: "g_307", // Main group
        data: [
          {
            fld_1786: typeId,         // סוג אימון (select-from-entity)
            fld_1809: unitId,         // מחלקה (select-from-entity)
            fld_1788: formattedDate,  // תאריך אימון (d/m/Y format)
            fld_1789: (typeof trainingNote === "string" ? trainingNote.trim() : "") || "", // הערות
            fld_1787: (typeof lessonName === "string" ? lessonName.trim() : "") || "",     // שם השיעור
          }
        ]
      }
    ];
 
    // Repeatable group g_309: one row per soldier
    const realGrades = IS_DEV
      ? grades.filter(({ soldierId }) => !String(soldierId).startsWith("mock_"))
      : grades;

    if (realGrades.length > 0) {
      formData.push({
        group_data_name: "g_309",
        data: realGrades.map(({ soldierId, grade, note }) => {
          const row = {
            fld_1798: soldierId,
          };
          if (grade !== null && grade !== undefined && grade !== "") {
            row.fld_1800 = String(grade);
          }
          if (note) {
            row.fld_1823 = String(note).trim();
          }
          return row;
        })
      });
    }
 
    const createRes = await origamiPost("/entities/api/create_instance/format/json", {
      entity_data_name: "e_166",
      form_data: formData,
    });
    const json = await createRes.json();
    console.log("create-training-record response:", JSON.stringify(json));

    if (json?.error) throw new Error(json.error.message || "Create failed");

    return res.json({ ok: true, instanceId: json?.results?._id || json?.data?._id || json?.instance_id || null });
  } catch (err) {
    console.error("create-training-record error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Bach API server running on port ${PORT}`));
