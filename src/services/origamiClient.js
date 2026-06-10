// All sensitive calls go through the local Node proxy (/api/*).
// No secrets or direct Origami calls from the browser.

const API_BASE = "/api";

// ---------------------------------------------------------------------------
// Seed data — used when the proxy is unreachable (Vite only, no server)
// ---------------------------------------------------------------------------
const seedData = {
  commander: { id: "1234567", name: "לירון", unitId: "unit-1", unitName: "מחלקה 1" },
  trainingTypes: [
    { id: "shooting", name: "קליעה" },
    { id: "fitness",  name: "כושר קרבי" },
    { id: "combat",   name: "קרב מגע" },
  ],
  sessions: [
    { id: "range-1",    typeId: "shooting", unitId: "unit-1", name: "מטווח 1" },
    { id: "range-night",typeId: "shooting", unitId: "unit-1", name: "מטווח לילה" },
    { id: "run-3k",     typeId: "fitness",  unitId: "unit-1", name: "ריצת 3 ק״מ" },
    { id: "check-07",   typeId: "combat",   unitId: "unit-1", name: "צ׳ק 07" },
  ],
  soldiers: [
    { id: "s-1", name: "אביב לוי",   personalNumber: "8123456", unitId: "unit-1" },
    { id: "s-2", name: "דניאל עמר",  personalNumber: "8234567", unitId: "unit-1" },
    { id: "s-3", name: "עומר כהן",   personalNumber: "8345678", unitId: "unit-1" },
    { id: "s-4", name: "נועם ביטון", personalNumber: "8456789", unitId: "unit-1" },
    { id: "s-5", name: "איתי פרץ",   personalNumber: "8567890", unitId: "unit-1" },
  ],
};

class OrigamiClient {
  constructor() {
    this.storageKey = "bach-training-grades";
    this._serverAvailable = null;
  }

  async _isServerAvailable() {
    if (this._serverAvailable !== null) return this._serverAvailable;
    try {
      const res = await fetch(`${API_BASE}/health`);
      this._serverAvailable = res.ok;
    } catch {
      this._serverAvailable = false;
    }
    return this._serverAvailable;
  }

  async _proxyPost(path, body) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `שגיאת שרת (${res.status})`);
    return json;
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  async requestOtp({ commanderId, phone }) {
    if (!(await this._isServerAvailable())) {
      // Dev fallback — no server running
      sessionStorage.setItem("pendingCommander", JSON.stringify(seedData.commander));
      return { ok: true };
    }
    return this._proxyPost("/request-otp", { commanderId, phone });
  }

  async verifyOtp({ commanderId, phone, code }) {
    if (!(await this._isServerAvailable())) {
      // Dev fallback — accept any code
      const raw = sessionStorage.getItem("pendingCommander");
      return raw ? JSON.parse(raw) : seedData.commander;
    }
    const commander = await this._proxyPost("/verify-otp", { commanderId, phone, code });
    return commander;
  }

  // -------------------------------------------------------------------------
  // Training data (seed until Origami tables are ready)
  // -------------------------------------------------------------------------

  async getTrainingTypes() {
    if (!(await this._isServerAvailable())) return seedData.trainingTypes;
    const res = await fetch(`${API_BASE}/training-types`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "שגיאה בטעינת סוגי אימון");
    return json;
  }

  async getTrainingSessions({ typeId, unitId }) {
    if (!(await this._isServerAvailable())) {
      return seedData.sessions.filter(
        (s) => s.typeId === typeId && s.unitId === unitId,
      );
    }
    const res = await fetch(`${API_BASE}/training-sessions?typeId=${encodeURIComponent(typeId)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "שגיאה בטעינת אימונים");
    return json;
  }

  async getUngradedSoldiers({ sessionId, unitId }) {
    if (!(await this._isServerAvailable())) {
      const saved = this._readLocalGrades();
      const gradedIds = new Set(
        saved.filter((g) => g.sessionId === sessionId).map((g) => g.soldierId),
      );
      return seedData.soldiers.filter(
        (s) => s.unitId === unitId && !gradedIds.has(s.id),
      );
    }
    const res = await fetch(`${API_BASE}/ungraded-soldiers?sessionId=${encodeURIComponent(sessionId)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "שגיאה בטעינת חיילים");
    return json;
  }

  async saveGrades(payload) {
    if (!(await this._isServerAvailable())) {
      const existing = this._readLocalGrades();
      localStorage.setItem(
        this.storageKey,
        JSON.stringify([...existing, ...payload.grades]),
      );
      return { saved: payload.grades.length };
    }
    const res = await fetch(`${API_BASE}/save-grades`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: payload.grades[0]?.sessionId,
        grades: payload.grades.map((g) => ({
          soldierId:  g.soldierId,
          grade:      g.grade,
          groupIndex: g.groupIndex,
        })),
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "שגיאה בשמירת ציונים");
    return json;
  }

  _readLocalGrades() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey) || "[]");
    } catch {
      return [];
    }
  }
}

export const origamiClient = new OrigamiClient();
