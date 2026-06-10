import React, { useEffect, useMemo, useState } from "react";
import { origamiClient } from "./services/origamiClient.js";

const emptyLogin = {
  commanderId: "",
  phone: "",
  otp: "",
};

export default function App() {
  const [screen, setScreen] = useState("login");
  const [login, setLogin] = useState(emptyLogin);
  const [commander, setCommander] = useState(null);
  const [trainingTypes, setTrainingTypes] = useState([]);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [soldiers, setSoldiers] = useState([]);
  const [trainingCompleted, setTrainingCompleted] = useState(false);
  const [trainingNote, setTrainingNote] = useState("");
  const [grades, setGrades] = useState({});
  const [toast, setToast] = useState(null);
  const [isBusy, setIsBusy] = useState(false);

  const selectedType = useMemo(
    () => trainingTypes.find((type) => type.id === selectedTypeId),
    [selectedTypeId, trainingTypes],
  );
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId),
    [selectedSessionId, sessions],
  );

  useEffect(() => {
    if (!toast) return undefined;

    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!commander || !selectedTypeId) return undefined;

    let cancelled = false;
    setSessionsLoading(true);
    setSessions([]);
    setSelectedSessionId("");

    origamiClient
      .getTrainingSessions({
        typeId: selectedTypeId,
        unitId: commander.unitId,
      })
      .then((nextSessions) => {
        if (cancelled) return;
        setSessions(nextSessions);
        setSelectedSessionId(nextSessions[0]?.id || "");
      })
      .catch((error) => {
        if (cancelled) return;
        notify(error.message || "שגיאה בטעינת אימונים", true);
      })
      .finally(() => {
        if (!cancelled) setSessionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [commander, selectedTypeId]);

  async function requestOtp(event) {
    event.preventDefault();
    await runSafely(async () => {
      await origamiClient.requestOtp({
        commanderId: login.commanderId.trim(),
        phone: login.phone.trim(),
      });
      setScreen("otp");
      notify("נשלח קוד התחברות");
    });
  }

  async function verifyOtp(event) {
    event.preventDefault();
    await runSafely(async () => {
      const verifiedCommander = await origamiClient.verifyOtp({
        commanderId: login.commanderId.trim(),
        phone: login.phone.trim(),
        code: login.otp.trim(),
      });
      const types = await origamiClient.getTrainingTypes();
      setCommander(verifiedCommander);
      setTrainingTypes(types);
      setSelectedTypeId(types[0]?.id || "");
      setScreen("training");
    });
  }

  async function openGradesScreen(event) {
    event.preventDefault();

    if (!selectedSession) {
      notify("אין אימון זמין לסוג שנבחר", true);
      return;
    }

    await runSafely(async () => {
      const ungradedSoldiers = await origamiClient.getUngradedSoldiers({
        sessionId: selectedSession.id,
        unitId: commander.unitId,
      });
      setSoldiers(ungradedSoldiers);
      setGrades({});
      setTrainingCompleted(false);
      setTrainingNote("");
      setScreen("grades");
    });
  }

  async function saveGrades(event) {
    event.preventDefault();

    if (!soldiers.length) {
      notify("אין ציונים לשמירה");
      return;
    }

    const payloadGrades = soldiers.map((soldier) => ({
      soldierId: soldier.id,
      sessionId: selectedSession.id,
      commanderId: commander.id,
      grade: Number(grades[soldier.id]?.grade),
      note: grades[soldier.id]?.note?.trim() || "",
      groupIndex: soldier.groupIndex,
      recordedAt: new Date().toISOString(),
    }));

    if (payloadGrades.some((item) => Number.isNaN(item.grade) || item.grade < 0 || item.grade > 100)) {
      notify("יש להזין ציונים בין 0 ל-100", true);
      return;
    }

    await runSafely(async () => {
      const result = await origamiClient.saveGrades({
        unitId: commander.unitId,
        trainingCompleted,
        trainingNote: trainingNote.trim(),
        grades: payloadGrades,
      });
      notify(`נשמרו ${result.saved || payloadGrades.length} ציונים`);
      const ungradedSoldiers = await origamiClient.getUngradedSoldiers({
        sessionId: selectedSession.id,
        unitId: commander.unitId,
      });
      setSoldiers(ungradedSoldiers);
      setGrades({});
    });
  }

  function logout() {
    setScreen("login");
    setLogin(emptyLogin);
    setCommander(null);
    setTrainingTypes([]);
    setSessions([]);
    setSoldiers([]);
  }

  async function runSafely(action) {
    setIsBusy(true);
    try {
      await action();
    } catch (error) {
      notify(error.message || "אירעה שגיאה", true);
    } finally {
      setIsBusy(false);
    }
  }

  function notify(message, isError = false) {
    setToast({ message, isError });
  }

  return (
    <main className="app-shell">
      {screen === "login" && (
        <LoginScreen login={login} isBusy={isBusy} onChange={setLogin} onSubmit={requestOtp} />
      )}

      {screen === "otp" && (
        <OtpScreen
          otp={login.otp}
          isBusy={isBusy}
          onBack={() => setScreen("login")}
          onChange={(otp) => setLogin((current) => ({ ...current, otp }))}
          onSubmit={verifyOtp}
        />
      )}

      {screen === "training" && commander && (
        <TrainingScreen
          commander={commander}
          trainingTypes={trainingTypes}
          selectedTypeId={selectedTypeId}
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          selectedSessionId={selectedSessionId}
          isBusy={isBusy}
          onLogout={logout}
          onTypeChange={setSelectedTypeId}
          onSessionChange={setSelectedSessionId}
          onSubmit={openGradesScreen}
        />
      )}

      {screen === "grades" && commander && selectedType && selectedSession && (
        <GradesScreen
          commander={commander}
          selectedType={selectedType}
          selectedSession={selectedSession}
          soldiers={soldiers}
          grades={grades}
          trainingCompleted={trainingCompleted}
          trainingNote={trainingNote}
          isBusy={isBusy}
          onBack={() => setScreen("training")}
          onCompletedChange={setTrainingCompleted}
          onTrainingNoteChange={setTrainingNote}
          onGradeChange={(soldierId, field, value) =>
            setGrades((current) => ({
              ...current,
              [soldierId]: {
                ...current[soldierId],
                [field]: value,
              },
            }))
          }
          onSubmit={saveGrades}
        />
      )}

      <Toast toast={toast} />
    </main>
  );
}

function LoginScreen({ login, isBusy, onChange, onSubmit }) {
  return (
    <section className="screen is-active" aria-labelledby="login-title">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          S
        </div>
        <p className="eyebrow">SimplyINFRA</p>
        <h1 id="login-title">התחברות מפקד</h1>
        <p>כניסה מאובטחת באמצעות קוד חד פעמי</p>
      </div>

      <form className="stack" onSubmit={onSubmit}>
        <label>
          <span>מספר אישי / ת.ז</span>
          <input
            value={login.commanderId}
            inputMode="numeric"
            autoComplete="username"
            required
            onChange={(event) => onChange((current) => ({ ...current, commanderId: event.target.value }))}
          />
        </label>

        <label>
          <span>מספר טלפון</span>
          <input
            value={login.phone}
            type="tel"
            autoComplete="tel"
            required
            onChange={(event) => onChange((current) => ({ ...current, phone: event.target.value }))}
          />
        </label>

        <button className="primary-button" type="submit" disabled={isBusy}>
          שלח קוד התחברות
        </button>
      </form>
    </section>
  );
}

function OtpScreen({ otp, isBusy, onBack, onChange, onSubmit }) {
  return (
    <section className="screen is-active" aria-labelledby="otp-title">
      <button className="ghost-button back-button" type="button" onClick={onBack}>
        חזרה
      </button>

      <div className="page-heading">
        <p className="eyebrow">אימות</p>
        <h2 id="otp-title">הזנת קוד</h2>
        <p>הקוד נשלח למספר שהוזן</p>
      </div>

      <form className="stack" onSubmit={onSubmit}>
        <label>
          <span>קוד חד פעמי</span>
          <input
            value={otp}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            onChange={(event) => onChange(event.target.value)}
          />
        </label>

        <button className="primary-button" type="submit" disabled={isBusy}>
          כניסה למערכת
        </button>
      </form>
    </section>
  );
}

function TrainingScreen({
  commander,
  trainingTypes,
  selectedTypeId,
  sessions,
  sessionsLoading,
  selectedSessionId,
  isBusy,
  onLogout,
  onTypeChange,
  onSessionChange,
  onSubmit,
}) {
  return (
    <section className="screen is-active" aria-labelledby="training-title">
      <header className="top-bar">
        <div>
          <p className="eyebrow">{greetingText(commander.name)}</p>
          <h2 id="training-title">בחירת אימון</h2>
        </div>
        <button className="icon-button" type="button" aria-label="התנתקות" onClick={onLogout}>
          ⎋
        </button>
      </header>

      <form className="stack" onSubmit={onSubmit}>
        <label>
          <span>סוג אימון</span>
          <select value={selectedTypeId} required onChange={(event) => onTypeChange(event.target.value)}>
            {trainingTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>אימון ליחידה</span>
          <select
            value={selectedSessionId}
            required
            disabled={sessionsLoading || !sessions.length}
            onChange={(event) => onSessionChange(event.target.value)}
          >
            {sessionsLoading ? (
              <option value="">טוען אימונים...</option>
            ) : sessions.length ? (
              sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.name}
                </option>
              ))
            ) : (
              <option value="">אין אימונים זמינים</option>
            )}
          </select>
        </label>

        <button className="primary-button bottom-action" type="submit" disabled={isBusy || sessionsLoading}>
          המשך להזנה
        </button>
      </form>
    </section>
  );
}

function GradesScreen({
  commander,
  selectedType,
  selectedSession,
  soldiers,
  grades,
  trainingCompleted,
  trainingNote,
  isBusy,
  onBack,
  onCompletedChange,
  onTrainingNoteChange,
  onGradeChange,
  onSubmit,
}) {
  return (
    <section className="screen grades-screen is-active" aria-labelledby="grades-title">
      <header className="top-bar compact">
        <button className="ghost-button" type="button" onClick={onBack}>
          חזרה
        </button>
        <div>
          <p className="eyebrow">{selectedType.name}</p>
          <h2 id="grades-title">
            {selectedSession.name} - {commander.unitName}
          </h2>
        </div>
      </header>

      <section className="summary-panel" aria-label="פרטי אימון">
        <label className="switch-row">
          <span>האימון הושלם?</span>
          <input
            checked={trainingCompleted}
            type="checkbox"
            onChange={(event) => onCompletedChange(event.target.checked)}
          />
        </label>
        <label>
          <span>הערה כללית</span>
          <textarea
            value={trainingNote}
            rows={2}
            placeholder="הערה לאימון"
            onChange={(event) => onTrainingNoteChange(event.target.value)}
          />
        </label>
      </section>

      <div className="list-heading">
        <span>חיילים ללא ציון</span>
        <strong>{soldiers.length}</strong>
      </div>

      <form className="grades-form" onSubmit={onSubmit}>
        <div className="soldiers-list">
          {soldiers.length ? (
            soldiers.map((soldier) => (
              <SoldierGradeCard
                key={soldier.id}
                soldier={soldier}
                value={grades[soldier.id] || { grade: "", note: "" }}
                onChange={onGradeChange}
              />
            ))
          ) : (
            <div className="summary-panel">אין חיילים שממתינים לציון באימון הזה.</div>
          )}
        </div>

        <button className="success-button bottom-action" type="submit" disabled={isBusy}>
          שמירת ציונים
        </button>
      </form>
    </section>
  );
}

function SoldierGradeCard({ soldier, value, onChange }) {
  return (
    <article className="soldier-card">
      <div className="soldier-row">
        <div>
          <div className="soldier-name">{soldier.name}</div>
        </div>
        <input
          className="grade-input"
          type="number"
          min="0"
          max="100"
          inputMode="numeric"
          placeholder="ציון"
          required
          value={value.grade}
          onChange={(event) => onChange(soldier.id, "grade", event.target.value)}
        />
      </div>
      <label>
        <span>הערה לחייל</span>
        <input
          type="text"
          placeholder="אופציונלי"
          value={value.note || ""}
          onChange={(event) => onChange(soldier.id, "note", event.target.value)}
        />
      </label>
    </article>
  );
}

function Toast({ toast }) {
  return (
    <div className={`toast${toast ? " is-visible" : ""}${toast?.isError ? " is-error" : ""}`} role="status" aria-live="polite">
      {toast?.message}
    </div>
  );
}

function greetingText(name) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "בוקר טוב" : hour < 18 ? "צהריים טובים" : "ערב טוב";
  return `${part}, ${name}`;
}
