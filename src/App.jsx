import React, { useEffect, useMemo, useState } from "react";
import { origamiClient } from "./services/origamiClient";

const emptyLogin = {
  phone: "",
  otp: "",
};

export default function App() {
  const [screen, setScreen] = useState("login");
  const [login, setLogin] = useState(emptyLogin);
  const [commander, setCommander] = useState(null);
  const [topics, setTopics] = useState([]);
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [trainingTypes, setTrainingTypes] = useState([]);
  const [selectedTypeId, setSelectedTypeId] = useState("");
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [soldiers, setSoldiers] = useState([]);
  const [trainingDate, setTrainingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [trainingNote, setTrainingNote] = useState("");
  const [grades, setGrades] = useState({});
  const [toast, setToast] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [typesLoading, setTypesLoading] = useState(false);

  const selectedTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId),
    [selectedTopicId, topics],
  );
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

  // When topic changes, reload training types filtered by that topic
  useEffect(() => {
    if (!selectedTopicId) {
      setTrainingTypes([]);
      setSelectedTypeId("");
      return undefined;
    }

    let cancelled = false;
    setTypesLoading(true);
    setTrainingTypes([]);
    setSelectedTypeId("");

    origamiClient
      .getTrainingTypes({ topicId: selectedTopicId })
      .then((nextTypes) => {
        if (cancelled) return;
        setTrainingTypes(nextTypes);
        setSelectedTypeId(nextTypes[0]?.id || "");
      })
      .catch((error) => {
        if (cancelled) return;
        notify(error.message || "שגיאה בטעינת סוגי אימון", true);
      })
      .finally(() => {
        if (!cancelled) setTypesLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedTopicId]);

  // When training type changes, reload sessions
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
        phone: login.phone.trim(),
        code: login.otp.trim(),
      });
      const nextTopics = await origamiClient.getTopics();
      setCommander(verifiedCommander);
      setTopics(nextTopics);
      setSelectedTopicId(nextTopics[0]?.id || "");
      setScreen("training");
    });
  }

  async function openGradesScreen(event) {
    event.preventDefault();

    if (!selectedTypeId) {
      notify("אין סוג אימון נבחר", true);
      return;
    }

    await runSafely(async () => {
      const allSoldiers = await origamiClient.getUnitSoldiers({
        unitId: commander.unitId,
      });
      setSoldiers(allSoldiers);
      setGrades({});
      setTrainingNote("");
      setTrainingDate(new Date().toISOString().slice(0, 10));
      setScreen("grades");
    });
  }

  async function saveGrades(event) {
    event.preventDefault();

    if (!soldiers.length) {
      notify("אין ציונים לשמירה");
      return;
    }

    if (!trainingDate) {
      notify("יש לבחור תאריך אימון", true);
      return;
    }

    const gradedSoldiers = soldiers
      .filter((soldier) => {
        const val = grades[soldier.id]?.grade;
        return val !== undefined && val !== null && val !== "";
      })
      .map((soldier) => ({
        soldierId: soldier.id,
        grade: Number(grades[soldier.id].grade),
      }));

    if (gradedSoldiers.some((g) => g.grade < 0 || g.grade > 100)) {
      notify("יש להזין ציונים בין 0 ל-100", true);
      return;
    }

    if (!gradedSoldiers.length) {
      notify("יש להזין ציון לאחד לפחות", true);
      return;
    }

    await runSafely(async () => {
      await origamiClient.saveGrades({
        typeId: selectedTypeId,
        unitId: commander.unitId,
        trainingDate,
        trainingNote: trainingNote.trim(),
        grades: gradedSoldiers,
      });
      notify("האימון נשמר בהצלחה");
      setScreen("training");
    });
  }

  function logout() {
    setScreen("login");
    setLogin(emptyLogin);
    setCommander(null);
    setTopics([]);
    setSelectedTopicId("");
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
          topics={topics}
          selectedTopicId={selectedTopicId}
          trainingTypes={trainingTypes}
          typesLoading={typesLoading}
          selectedTypeId={selectedTypeId}
          sessionsLoading={sessionsLoading}
          isBusy={isBusy}
          onLogout={logout}
          onTopicChange={setSelectedTopicId}
          onTypeChange={setSelectedTypeId}
          onSubmit={openGradesScreen}
        />
      )}

      {screen === "grades" && commander && selectedType && (
        <GradesScreen
          topicName={selectedTopic?.name || ""}
          trainingTypeName={selectedType.name}
          unitName={commander.unitName}
          soldiers={soldiers}
          grades={grades}
          trainingDate={trainingDate}
          trainingNote={trainingNote}
          isBusy={isBusy}
          onBack={() => setScreen("training")}
          onTrainingDateChange={setTrainingDate}
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
        <img src="/logo.png" alt="Simply+ RED" className="brand-logo" />
        <h1 id="login-title">התחברות מפקד</h1>
        <p>כניסה מאובטחת באמצעות קוד חד פעמי</p>
      </div>

      <form className="stack" onSubmit={onSubmit}>


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
  topics,
  selectedTopicId,
  trainingTypes,
  typesLoading,
  selectedTypeId,
  sessionsLoading,
  isBusy,
  onLogout,
  onTopicChange,
  onTypeChange,
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
          <span>נושא אימון</span>
          <select value={selectedTopicId} required onChange={(event) => onTopicChange(event.target.value)}>
            {topics.length ? (
              topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))
            ) : (
              <option value="">טוען נושאים...</option>
            )}
          </select>
        </label>

        <label>
          <span>סוג אימון</span>
          <select
            value={selectedTypeId}
            required
            disabled={typesLoading || !trainingTypes.length}
            onChange={(event) => onTypeChange(event.target.value)}
          >
            {typesLoading ? (
              <option value="">טוען סוגי אימון...</option>
            ) : trainingTypes.length ? (
              trainingTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))
            ) : (
              <option value="">אין סוגי אימון לנושא זה</option>
            )}
          </select>
        </label>

        <button className="primary-button bottom-action" type="submit" disabled={isBusy || sessionsLoading || typesLoading}>
          המשך להזנה
        </button>
      </form>
    </section>
  );
}

function GradesScreen({
  topicName,
  trainingTypeName,
  unitName,
  soldiers,
  grades,
  trainingDate,
  trainingNote,
  isBusy,
  onBack,
  onTrainingDateChange,
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
          <p className="eyebrow">{topicName}</p>
          <h2 id="grades-title">{trainingTypeName}</h2>
        </div>
      </header>

      <section className="summary-panel" aria-label="פרטי אימון">
        <label>
          <span>שם מחלקה</span>
          <input type="text" value={unitName} disabled readOnly />
        </label>
        <label>
          <span>תאריך אימון</span>
          <input
            type="date"
            value={trainingDate}
            required
            max={new Date().toISOString().slice(0, 10)}
            onChange={(event) => onTrainingDateChange(event.target.value)}
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
        <span>חיילים ({soldiers.length})</span>
        <span className="muted-hint">ציון 0–100</span>
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
            <div className="summary-panel">אין חיילים במחלקה זו.</div>
          )}
        </div>

        <button className="success-button bottom-action" type="submit" disabled={isBusy}>
          שמירת אימון
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
          value={value.grade}
          onChange={(event) => {
            const val = event.target.value;
            if (val === "") {
              onChange(soldier.id, "grade", val);
              return;
            }
            const num = Number(val);
            if (!Number.isNaN(num) && num >= 0 && num <= 100) {
              onChange(soldier.id, "grade", val);
            }
          }}
        />
      </div>
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
