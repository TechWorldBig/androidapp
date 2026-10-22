import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { collection, getFirestore, onSnapshot, query, orderBy } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import './style.css';

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});
const auth = getAuth(app), db = getFirestore(app), fn = getFunctions(app);

type Question = { prompt: string; options: string[]; correctIndex: number; explanation: string };
const blankQuestion = (): Question => ({ prompt: '', options: ['', '', '', ''], correctIndex: 0, explanation: '' });

function App() {
  const [user, setUser] = useState<any>(null);
  const [pastor, setPastor] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tab, setTab] = useState<'quizzes' | 'members' | 'events'>('quizzes');
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);

  // Quiz creation form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState('');
  const [duration, setDuration] = useState(15);
  const [questions, setQuestions] = useState<Question[]>([blankQuestion()]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, async u => {
      setUser(u);
      if (u) {
        const tokenRes = await u.getIdTokenResult();
        setPastor(!!tokenRes.claims.pastor);
      } else {
        setPastor(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!pastor) return;
    const off = [
      onSnapshot(collection(db, 'quizzes'), s => setQuizzes(s.docs.map(d => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, 'users'), s => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() }));
        list.sort((a: any, b: any) => (b.points || 0) - (a.points || 0));
        setMembers(list);
      }),
      onSnapshot(collection(db, 'securityEvents'), s => setEvents(s.docs.map(d => ({ id: d.id, ...d.data() })))),
    ];
    return () => off.forEach(f => f());
  }, [pastor]);

  async function act(name: string, data: object, success: string) {
    setBusy(true);
    setMessage('');
    try {
      await httpsCallable(fn, name)(data);
      setMessage(success);
    } catch (e: any) {
      setMessage(e.message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!title.trim()) return setMessage('Please enter a title for the quiz challenge.');
    if (!startAt) return setMessage('Choose a start date and time.');
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.prompt.trim()) return setMessage(`Question ${i + 1} is missing question text.`);
      if (q.options.some(o => !o.trim())) return setMessage(`Question ${i + 1} needs all 4 choices filled.`);
    }

    await act(
      'saveQuiz',
      {
        title: title.trim(),
        description: description.trim(),
        startAt: new Date(startAt).toISOString(),
        durationMinutes: duration,
        questions,
      },
      'Quiz challenge draft saved successfully!'
    );

    // Reset after saving
    setTitle('');
    setDescription('');
    setStartAt('');
    setQuestions([blankQuestion()]);
  }

  function editQuestion(index: number, patch: Partial<Question>) {
    setQuestions(questions.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }

  if (!user) {
    return (
      <main className="auth">
        <div className="mark">✦</div>
        <p className="eyebrow">JSC KOLLEMCODE</p>
        <h1>Pastor’s desk</h1>
        <p>Manage church Bible quiz challenges, timer, questions, and view member scores.</p>
        <form
          onSubmit={async e => {
            e.preventDefault();
            try {
              await signInWithEmailAndPassword(auth, email, password);
            } catch (err: any) {
              setMessage(err.message);
            }
          }}
        >
          <label>
            Email
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <button>Sign in</button>
        </form>
        <p role="status">{message}</p>
      </main>
    );
  }

  if (!pastor) {
    return (
      <main className="auth">
        <h1>Access restricted</h1>
        <p>This account does not have pastor access. Please grant pastor claims using the setup script.</p>
        <button onClick={() => signOut(auth)}>Sign out</button>
      </main>
    );
  }

  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span className="mark">✦</span>
          <div>
            <strong>JSC Bible Quiz</strong>
            <small>PASTOR ADMINISTRATION</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <button className={tab === 'quizzes' ? 'active' : ''} onClick={() => setTab('quizzes')}>
            Challenges & Competitions
          </button>
          <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>
            Members & Points <span>({members.length})</span>
          </button>
          <button className={tab === 'events' ? 'active' : ''} onClick={() => setTab('events')}>
            Integrity events
          </button>
        </nav>
        <button className="signout" onClick={() => signOut(auth)}>
          Sign out
        </button>
      </aside>

      <main className="content">
        <header>
          <p className="eyebrow">JSC KOLLEMCODE · MINISTRY DASHBOARD</p>
          <h1>
            {tab === 'quizzes'
              ? 'Challenges & Competitions'
              : tab === 'members'
              ? 'Registered Members & Points'
              : 'Integrity events'}
          </h1>
          <p role="status" className="status">
            {message}
          </p>
        </header>

        {tab === 'quizzes' && (
          <div className="grid">
            <section className="panel">
              <h2>All Quizzes</h2>
              {quizzes.length === 0 && <p>No quizzes yet. Create the first one on the right.</p>}
              {quizzes.map(q => (
                <article className="row" key={q.id}>
                  <div>
                    <strong>{q.title}</strong>
                    <small>
                      Status: <b>{q.status}</b> · {q.questionCount} questions · {q.durationMinutes} mins timer
                    </small>
                  </div>
                  <div className="actions">
                    {q.status === 'draft' && (
                      <button
                        className="small"
                        disabled={busy}
                        onClick={() => act('publishQuiz', { id: q.id }, 'Quiz published for members!')}
                      >
                        Publish Now
                      </button>
                    )}
                    {q.status === 'published' && (
                      <button
                        className="small secondary"
                        disabled={busy}
                        onClick={() => act('publishResults', { quizId: q.id }, 'Quiz marked closed.')}
                      >
                        Close Quiz
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </section>

            <section className="panel">
              <h2>Create New Timed Challenge</h2>
              <label>
                Challenge Title *
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Gospel of John Chapter 1-5"
                />
              </label>

              <label>
                Description & Instructions
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. Test your knowledge of John chapter 1 to 5. 10 points for each correct question."
                />
              </label>

              <div className="two">
                <label>
                  Start Date and Time *
                  <input
                    type="datetime-local"
                    value={startAt}
                    onChange={e => setStartAt(e.target.value)}
                  />
                </label>
                <label>
                  Timer Limit (Minutes) *
                  <input
                    type="number"
                    min="1"
                    max="180"
                    value={duration}
                    onChange={e => setDuration(Number(e.target.value))}
                  />
                </label>
              </div>

              {questions.map((q, i) => (
                <div className="question" key={i}>
                  <h3>Question {i + 1}</h3>
                  <label>
                    Question Prompt *
                    <input
                      value={q.prompt}
                      onChange={e => editQuestion(i, { prompt: e.target.value })}
                      placeholder="e.g. In the beginning was the Word, and the Word was with...?"
                    />
                  </label>

                  {q.options.map((o, n) => (
                    <label key={n}>
                      Choice {n + 1} *
                      <input
                        value={o}
                        onChange={e =>
                          editQuestion(i, {
                            options: q.options.map((v, j) => (j === n ? e.target.value : v)),
                          })
                        }
                        placeholder={`Choice ${n + 1}`}
                      />
                    </label>
                  ))}

                  <label>
                    Correct Choice *
                    <select
                      value={q.correctIndex}
                      onChange={e => editQuestion(i, { correctIndex: Number(e.target.value) })}
                    >
                      {[0, 1, 2, 3].map(n => (
                        <option value={n} key={n}>
                          Choice {n + 1}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Scripture Reference / Explanation
                    <textarea
                      value={q.explanation}
                      onChange={e => editQuestion(i, { explanation: e.target.value })}
                      placeholder="e.g. John 1:1"
                    />
                  </label>
                </div>
              ))}

              <div className="actions" style={{ marginTop: 20 }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setQuestions([...questions, blankQuestion()])}
                >
                  + Add Another Question
                </button>
                <button type="button" disabled={busy} onClick={save}>
                  {busy ? 'Saving…' : 'Save & Prepare Draft'}
                </button>
              </div>
            </section>
          </div>
        )}

        {tab === 'members' && (
          <section className="panel narrow">
            <h2>Registered Members Leaderboard</h2>
            <p>All registered church members, their age, and their total points earned from challenges.</p>
            {members.length === 0 && <p>No members registered yet.</p>}
            {members.map((m, index) => (
              <article className="row" key={m.id}>
                <div>
                  <strong>
                    #{index + 1} {m.name || 'Member'}
                  </strong>
                  <small>
                    Email: {m.email} {m.age ? `· Age: ${m.age}` : ''} · Status: {m.status}
                  </small>
                </div>
                <div>
                  <span
                    style={{
                      background: '#102942',
                      color: 'white',
                      padding: '6px 14px',
                      borderRadius: '20px',
                      fontWeight: 800,
                      fontSize: 14,
                    }}
                  >
                    ⭐ {m.points ?? 0} pts
                  </span>
                </div>
              </article>
            ))}
          </section>
        )}

        {tab === 'events' && (
          <section className="panel narrow">
            <h2>Integrity Events</h2>
            <p>Events recorded when a member’s device leaves the quiz screen during an active attempt.</p>
            {events.length === 0 && <p>No events recorded.</p>}
            {events.map(e => (
              <article className="row" key={e.id}>
                <div>
                  <strong>{e.type}</strong>
                  <small>
                    Member UID: {e.uid} · Quiz ID: {e.quizId}
                  </small>
                </div>
              </article>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
