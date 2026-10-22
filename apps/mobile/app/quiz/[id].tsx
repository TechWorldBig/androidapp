import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import * as ScreenCapture from 'expo-screen-capture';
import { auth, db, functions } from '../../lib/firebase';

interface Question {
  id: string;
  prompt: string;
  options: string[];
  order?: number;
}

interface SubmissionResult {
  score: number;
  maxScore: number;
  pointsEarned: number;
}

export default function Quiz() {
  const { id } = useLocalSearchParams<{ id: string }>();

  const [quizData, setQuizData] = useState<any>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Completed result if user already took this quiz
  const [existingResult, setExistingResult] = useState<any>(null);
  // Immediate submission result
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);

  // 1. Fetch quiz info and check if already completed
  useEffect(() => {
    if (!id) return;

    // Load quiz doc
    getDoc(doc(db, 'quizzes', id))
      .then(snap => {
        if (snap.exists()) {
          setQuizData(snap.data());
        }
      })
      .catch(() => {});

    // Check if result already exists for current user
    const currentUid = auth.currentUser?.uid;
    if (currentUid) {
      const resultDocRef = doc(db, 'results', `${id}_${currentUid}`);
      const unsub = onSnapshot(resultDocRef, snap => {
        if (snap.exists()) {
          setExistingResult(snap.data());
        }
        setInitialLoading(false);
      });
      return () => unsub();
    } else {
      setInitialLoading(false);
    }
  }, [id]);

  // 2. Ticking 1-second timer
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 3. Screen capture prevention & integrity logging while quiz is active
  useEffect(() => {
    if (!deadline) return;
    ScreenCapture.preventScreenCaptureAsync();
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') {
        httpsCallable(functions, 'recordSecurityEvent')({ quizId: id, type: 'background' }).catch(() => {});
      }
    });
    return () => {
      sub.remove();
      ScreenCapture.allowScreenCaptureAsync();
    };
  }, [deadline, id]);

  // 4. Start Challenge with Timer
  async function start() {
    setBusy(true);
    setMessage('');
    try {
      const result: any = await httpsCallable(functions, 'startAttempt')({ quizId: id });
      setQuestions(result.data.questions || []);
      setDeadline(result.data.deadline);
      if (result.data.existingAnswers) {
        setAnswers(result.data.existingAnswers);
      }
    } catch (e: any) {
      setMessage(e.message || 'Could not start quiz.');
    } finally {
      setBusy(false);
    }
  }

  // 5. Submit Answers and Earn Points
  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      const res: any = await httpsCallable(functions, 'submitAttempt')({ quizId: id, answers });
      if (res.data?.submitted) {
        setSubmissionResult({
          score: res.data.score,
          maxScore: res.data.maxScore,
          pointsEarned: res.data.pointsEarned ?? res.data.score * 10,
        });
      }
      setQuestions([]);
      setDeadline(0);
    } catch (e: any) {
      setMessage(e.message || 'Failed to submit answers.');
    } finally {
      setBusy(false);
    }
  }

  // 6. Auto-submit when timer expires
  useEffect(() => {
    if (deadline && now >= deadline && questions.length > 0 && !busy) {
      submit();
    }
  }, [now, deadline, questions.length, busy]);

  // Timer calculation
  const secondsLeft = Math.max(0, Math.ceil((deadline - now) / 1000));
  const timerMinutes = Math.floor(secondsLeft / 60);
  const timerSeconds = secondsLeft % 60;
  const isTimeRunningLow = secondsLeft > 0 && secondsLeft <= 60;

  if (initialLoading) {
    return (
      <View style={[s.page, s.centered]}>
        <ActivityIndicator size="large" color="#102942" />
      </View>
    );
  }

  // Result / Completed view (either freshly submitted or already taken)
  const finalResult = submissionResult || (existingResult ? {
    score: existingResult.score,
    maxScore: existingResult.maxScore,
    pointsEarned: existingResult.points ?? (existingResult.score * 10),
  } : null);

  if (finalResult) {
    return (
      <ScrollView contentContainerStyle={s.page}>
        <Pressable onPress={() => router.replace('/quizzes')} style={s.backButton}>
          <Text style={s.backText}>← Back to Competitions</Text>
        </Pressable>

        <View style={s.resultCard}>
          <Text style={s.trophy}>🏆</Text>
          <Text style={s.resultTitle}>Challenge Completed!</Text>
          <Text style={s.resultSubtitle}>
            {quizData?.title || 'Bible Quiz Competition'}
          </Text>

          <View style={s.scoreBox}>
            <Text style={s.scoreLabel}>YOUR SCORE</Text>
            <Text style={s.scoreText}>
              {finalResult.score} / {finalResult.maxScore}
            </Text>
            <View style={s.pointsPill}>
              <Text style={s.pointsPillText}>
                +{finalResult.pointsEarned} Points Earned ⭐
              </Text>
            </View>
          </View>

          <Text style={s.resultCongrats}>
            {finalResult.score === finalResult.maxScore
              ? 'Outstanding! Perfect score!'
              : finalResult.score >= finalResult.maxScore / 2
              ? 'Great effort! Your points have been added to your profile.'
              : 'Good attempt! Keep reading the Scriptures and try the next challenge!'}
          </Text>

          <Pressable style={s.button} onPress={() => router.replace('/quizzes')}>
            <Text style={s.buttonText}>View More Challenges</Text>
          </Pressable>

          <Pressable style={s.secondaryButton} onPress={() => router.replace('/')}>
            <Text style={s.secondaryButtonText}>Return to Dashboard</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.page}>
      <Pressable onPress={() => router.replace('/quizzes')} style={s.backButton}>
        <Text style={s.backText}>← Back to Competitions</Text>
      </Pressable>

      <Text style={s.eyebrow}>PASTOR CHALLENGE</Text>
      <Text style={s.title}>{quizData?.title || 'Bible Quiz'}</Text>

      {!!message && <Text style={s.message}>{message}</Text>}

      {/* Pre-start Overview Card */}
      {!deadline && (
        <View style={s.card}>
          <Text style={s.cardHeading}>Competition Overview</Text>
          {quizData?.description ? <Text style={s.desc}>{quizData.description}</Text> : null}

          <View style={s.specList}>
            <View style={s.specItem}>
              <Text style={s.specIcon}>⏱</Text>
              <View>
                <Text style={s.specTitle}>Timer</Text>
                <Text style={s.specValue}>{quizData?.durationMinutes || 20} Minutes limit</Text>
              </View>
            </View>

            <View style={s.specItem}>
              <Text style={s.specIcon}>📝</Text>
              <View>
                <Text style={s.specTitle}>Questions</Text>
                <Text style={s.specValue}>{quizData?.questionCount || 0} Questions</Text>
              </View>
            </View>

            <View style={s.specItem}>
              <Text style={s.specIcon}>⭐</Text>
              <View>
                <Text style={s.specTitle}>Points Reward</Text>
                <Text style={s.specValue}>10 points per correct answer</Text>
              </View>
            </View>
          </View>

          <Text style={s.instructions}>
            • You have one attempt for this challenge.
            {'\n'}• The countdown timer starts immediately once you tap below.
            {'\n'}• Choose your answer for each question and submit before time runs out.
          </Text>

          <Pressable style={s.button} disabled={busy} onPress={start}>
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={s.buttonText}>Start Timed Challenge →</Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Active Quiz with Timer and Questions */}
      {!!deadline && (
        <>
          {/* Sticky Timer Banner */}
          <View style={[s.timerBanner, isTimeRunningLow && s.timerBannerWarning]}>
            <View>
              <Text style={[s.timerLabel, isTimeRunningLow && s.timerWarningText]}>
                {isTimeRunningLow ? '⚠️ TIME RUNNING LOW' : '⏱ TIME REMAINING'}
              </Text>
              <Text style={[s.timerValue, isTimeRunningLow && s.timerWarningText]}>
                {timerMinutes}:{timerSeconds < 10 ? '0' : ''}{timerSeconds}
              </Text>
            </View>
            <View style={s.progressBox}>
              <Text style={s.progressText}>
                Answered: {Object.keys(answers).length} / {questions.length}
              </Text>
            </View>
          </View>

          {/* Question List */}
          {questions.map((q, index) => (
            <View key={q.id} style={s.card}>
              <View style={s.questionHeader}>
                <Text style={s.questionNumber}>Question {index + 1} of {questions.length}</Text>
                {answers[q.id] !== undefined && (
                  <Text style={s.answeredBadge}>✓ Answered</Text>
                )}
              </View>

              <Text style={s.questionPrompt}>{q.prompt}</Text>

              {q.options.map((option: string, i: number) => {
                const isSelected = answers[q.id] === i;
                return (
                  <Pressable
                    key={i}
                    style={[s.choice, isSelected && s.selectedChoice]}
                    onPress={() => setAnswers({ ...answers, [q.id]: i })}
                  >
                    <View style={[s.radioCircle, isSelected && s.selectedRadio]}>
                      {isSelected ? <View style={s.radioDot} /> : null}
                    </View>
                    <Text style={[s.choiceText, isSelected && s.selectedChoiceText]}>
                      {option}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ))}

          <Pressable style={s.button} disabled={busy} onPress={submit}>
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={s.buttonText}>Submit Answers & Claim Points →</Text>
            )}
          </Pressable>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: {
    padding: 20,
    backgroundColor: '#f6f0df',
    flexGrow: 1,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButton: {
    paddingVertical: 6,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  backText: {
    color: '#8a621d',
    fontWeight: '700',
    fontSize: 14,
  },
  eyebrow: {
    color: '#786741',
    letterSpacing: 2,
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#102942',
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#fffdf7',
    padding: 20,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#dacba7',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#102942',
    marginBottom: 10,
  },
  desc: {
    color: '#5c6670',
    fontSize: 15,
    marginBottom: 18,
    lineHeight: 22,
  },
  specList: {
    backgroundColor: '#f6f0df',
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
    gap: 12,
  },
  specItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  specIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  specTitle: {
    fontSize: 12,
    color: '#707e8b',
    fontWeight: '600',
  },
  specValue: {
    fontSize: 15,
    color: '#102942',
    fontWeight: '700',
  },
  instructions: {
    color: '#5c6670',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 20,
  },
  timerBanner: {
    backgroundColor: '#102942',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  timerBannerWarning: {
    backgroundColor: '#aa2828',
  },
  timerLabel: {
    color: '#b58a3b',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  timerValue: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: '800',
    marginTop: 2,
  },
  timerWarningText: {
    color: '#fff',
  },
  progressBox: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  progressText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  questionNumber: {
    color: '#8a621d',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 1,
  },
  answeredBadge: {
    color: '#1b632e',
    fontSize: 12,
    fontWeight: '700',
  },
  questionPrompt: {
    fontSize: 17,
    fontWeight: '700',
    color: '#102942',
    marginBottom: 16,
    lineHeight: 24,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderWidth: 1,
    borderColor: '#c6ccd2',
    borderRadius: 10,
    marginBottom: 10,
    backgroundColor: '#ffffff',
  },
  selectedChoice: {
    borderColor: '#b58a3b',
    backgroundColor: '#fbf5e7',
    borderWidth: 2,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#9aa0a6',
    marginRight: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  selectedRadio: {
    borderColor: '#8a621d',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#8a621d',
  },
  choiceText: {
    fontSize: 15,
    color: '#202124',
    flex: 1,
  },
  selectedChoiceText: {
    fontWeight: '700',
    color: '#102942',
  },
  button: {
    backgroundColor: '#102942',
    padding: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 12,
  },
  buttonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
  secondaryButton: {
    borderColor: '#b9bdc0',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryButtonText: {
    color: '#5c6670',
    fontWeight: '600',
  },
  message: {
    backgroundColor: '#fde8e8',
    color: '#aa2828',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    lineHeight: 18,
  },
  resultCard: {
    backgroundColor: '#fffdf7',
    padding: 28,
    borderRadius: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dacba7',
    marginTop: 20,
  },
  trophy: {
    fontSize: 54,
    marginBottom: 12,
  },
  resultTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#102942',
    marginBottom: 6,
    textAlign: 'center',
  },
  resultSubtitle: {
    fontSize: 15,
    color: '#5c6670',
    marginBottom: 20,
    textAlign: 'center',
  },
  scoreBox: {
    backgroundColor: '#102942',
    width: '100%',
    padding: 20,
    borderRadius: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  scoreLabel: {
    color: '#b58a3b',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
  },
  scoreText: {
    color: '#ffffff',
    fontSize: 38,
    fontWeight: '800',
    marginVertical: 4,
  },
  pointsPill: {
    backgroundColor: '#f8edcf',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 6,
  },
  pointsPillText: {
    color: '#8a621d',
    fontWeight: '800',
    fontSize: 14,
  },
  resultCongrats: {
    fontSize: 14,
    color: '#455767',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
});
