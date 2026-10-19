import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();
const db = getFirestore();
const requireUser = (uid?: string) => { if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.'); return uid; };
const requirePastor = (token: Record<string, unknown>, uid?: string) => { requireUser(uid); if (token.pastor !== true) throw new HttpsError('permission-denied', 'Pastor access required.'); return uid!; };
const log = (uid: string, action: string, target: string) => db.collection('auditLogs').add({ uid, action, target, at: FieldValue.serverTimestamp() });
const text = (v: unknown, max = 500) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new HttpsError('invalid-argument', 'A required text field is invalid.'); return v.trim(); };
const quizRef = (id: unknown) => db.collection('quizzes').doc(text(id, 100));

export const saveQuiz = onCall(async request => {
  const pastor = requirePastor(request.auth?.token ?? {}, request.auth?.uid);
  const d = request.data ?? {};
  const title = text(d.title, 120);
  const startAt = new Date(d.startAt);
  const durationMinutes = Number(d.durationMinutes);
  if (Number.isNaN(startAt.getTime()) || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 180) throw new HttpsError('invalid-argument', 'Invalid schedule.');
  if (!Array.isArray(d.questions) || d.questions.length < 1 || d.questions.length > 100) throw new HttpsError('invalid-argument', 'Add 1 to 100 questions.');
  const questions = d.questions.map((q: any) => {
    if (!Array.isArray(q.options) || q.options.length !== 4 || !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) throw new HttpsError('invalid-argument', 'Each question needs four choices and a correct answer.');
    return { prompt: text(q.prompt, 1000), options: q.options.map((o: unknown) => text(o, 300)), correctIndex: q.correctIndex, explanation: typeof q.explanation === 'string' ? q.explanation.slice(0, 1000) : '' };
  });
  const ref = d.id ? quizRef(d.id) : db.collection('quizzes').doc();
  const existing = await ref.get();
  if (existing.exists && existing.data()?.status !== 'draft') throw new HttpsError('failed-precondition', 'Only drafts can be edited.');
  await db.runTransaction(async tx => {
    tx.set(ref, { title, description: String(d.description ?? '').slice(0, 1000), startAt: Timestamp.fromDate(startAt), durationMinutes, questionCount: questions.length, status: 'draft', createdBy: pastor, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    questions.forEach((q: any, i: number) => {
      tx.set(ref.collection('questions').doc(String(i)), { prompt: q.prompt, options: q.options, order: i });
      tx.set(db.collection('protectedAnswerKeys').doc(`${ref.id}_${i}`), { quizId: ref.id, order: i, correctIndex: q.correctIndex, explanation: q.explanation });
    });
  });
  await log(pastor, 'saveQuiz', ref.id);
  return { id: ref.id };
});

export const publishQuiz = onCall(async request => {
  const pastor = requirePastor(request.auth?.token ?? {}, request.auth?.uid);
  const ref = quizRef(request.data?.id);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.status !== 'draft') throw new HttpsError('failed-precondition', 'Quiz must be a draft.');
    tx.update(ref, { status: 'published', publishedAt: FieldValue.serverTimestamp() });
  });
  await log(pastor, 'publishQuiz', ref.id);
  return { ok: true };
});

export const startAttempt = onCall(async request => {
  const uid = requireUser(request.auth?.uid);
  const ref = quizRef(request.data?.quizId);
  const quiz = await ref.get();
  const q = quiz.data();
  if (!q || q.status !== 'published') throw new HttpsError('failed-precondition', 'Quiz is unavailable.');
  const now = Date.now(), start = (q.startAt as Timestamp).toMillis(), end = start + q.durationMinutes * 60000;
  if (now < start || now >= end) throw new HttpsError('failed-precondition', 'The quiz is outside its scheduled time.');
  const attempt = db.collection('attempts').doc(`${ref.id}_${uid}`);
  await db.runTransaction(async tx => {
    const snap = await tx.get(attempt);
    if (snap.exists) throw new HttpsError('already-exists', 'An attempt already exists.');
    tx.create(attempt, { quizId: ref.id, uid, startedAt: Timestamp.now(), deadline: Timestamp.fromMillis(end), status: 'active' });
  });
  const questions = await ref.collection('questions').orderBy('order').get();
  return { attemptId: attempt.id, deadline: end, questions: questions.docs.map(d => ({ id: d.id, ...d.data() })) };
});

export const submitAttempt = onCall(async request => {
  const uid = requireUser(request.auth?.uid);
  const quizId = text(request.data?.quizId, 100);
  const answers = request.data?.answers;
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new HttpsError('invalid-argument', 'Answers are required.');
  const attempt = db.collection('attempts').doc(`${quizId}_${uid}`);
  const result = db.collection('results').doc(attempt.id);
  const quiz = await quizRef(quizId).get();
  const q = quiz.data();
  if (!q) throw new HttpsError('not-found', 'Quiz not found.');
  const keys = await db.collection('protectedAnswerKeys').where('quizId', '==', quizId).get();
  const score = keys.docs.reduce((sum, doc) => sum + (answers[String(doc.data().order)] === doc.data().correctIndex ? 1 : 0), 0);
  await db.runTransaction(async tx => {
    const snap = await tx.get(attempt);
    if (!snap.exists || snap.data()?.uid !== uid || snap.data()?.status !== 'active') throw new HttpsError('failed-precondition', 'No active attempt.');
    const deadline = (snap.data()!.deadline as Timestamp).toMillis();
    if (Date.now() > deadline + 30000) throw new HttpsError('deadline-exceeded', 'The submission deadline has passed.');
    tx.update(attempt, { status: 'submitted', submittedAt: FieldValue.serverTimestamp(), answers });
    tx.create(result, { quizId, uid, score, maxScore: q.questionCount, published: false, submittedAt: FieldValue.serverTimestamp() });
  });
  return { submitted: true };
});

export const recordSecurityEvent = onCall(async request => {
  const uid = requireUser(request.auth?.uid);
  const quizId = text(request.data?.quizId, 100);
  const type = request.data?.type;
  if (!['background', 'camera_denied', 'focus_loss', 'network_loss'].includes(type)) throw new HttpsError('invalid-argument', 'Invalid event.');
  const attempt = await db.collection('attempts').doc(`${quizId}_${uid}`).get();
  if (attempt.data()?.status !== 'active') throw new HttpsError('failed-precondition', 'No active attempt.');
  await db.collection('securityEvents').add({ quizId, uid, type, at: FieldValue.serverTimestamp() });
  return { ok: true };
});

export const publishResults = onCall(async request => {
  const pastor = requirePastor(request.auth?.token ?? {}, request.auth?.uid);
  const ref = quizRef(request.data?.quizId);
  const quiz = await ref.get();
  if (!quiz.exists || Date.now() < quiz.data()!.startAt.toMillis() + quiz.data()!.durationMinutes * 60000) throw new HttpsError('failed-precondition', 'Quiz has not ended.');
  const results = await db.collection('results').where('quizId', '==', ref.id).get();
  const batch = db.batch();
  results.docs.forEach(doc => batch.update(doc.ref, { published: true }));
  batch.update(ref, { status: 'closed' });
  await batch.commit();
  await log(pastor, 'publishResults', ref.id);
  return { count: results.size };
});

export const disqualifyMember = onCall(async request => {
  const pastor = requirePastor(request.auth?.token ?? {}, request.auth?.uid);
  const attemptId = text(request.data?.attemptId, 220), reason = text(request.data?.reason, 1000);
  await db.collection('attempts').doc(attemptId).update({ disqualified: true, disqualificationReason: reason, reviewedBy: pastor });
  await log(pastor, 'disqualifyMember', attemptId);
  return { ok: true };
});

// Bootstrap a pastor only from a trusted local admin script or Firebase Admin SDK, never from a client callable.
export { getAuth };
