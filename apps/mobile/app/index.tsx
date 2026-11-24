import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Href, router } from 'expo-router';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../lib/firebase';
import {
  deriveNameFromEmail,
  getInitials,
  getTimeGreeting,
  resolveDisplayName,
  UserProfile,
} from '../lib/profile';

type ViewMode = 'login' | 'register' | 'forgot_password';
const PROFILE_ROUTE = '/profile' as Href;

interface QuizItem {
  id: string;
  title: string;
  description?: string;
  durationMinutes: number;
  questionCount?: number;
  status: 'draft' | 'published' | 'closed';
  startAt?: { seconds: number };
}

interface UserResult {
  quizId: string;
  score: number;
  maxScore: number;
  points: number;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('login');
  const [greeting, setGreeting] = useState(() => getTimeGreeting());

  // Challenges & user results for the home feed
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  const [quizzesLoading, setQuizzesLoading] = useState(false);
  const [userResults, setUserResults] = useState<Record<string, UserResult>>({});

  // Form fields
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [age, setAge] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [churchName, setChurchName] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Status and feedback
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const googleWebClientId =
    process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ||
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ||
    '323325289419-tc8l2f3r0pbrashkb3429otrvthkkeo4.apps.googleusercontent.com';

  // Keep greeting in sync with local time while app is open
  useEffect(() => {
    setGreeting(getTimeGreeting());
    const timer = setInterval(() => setGreeting(getTimeGreeting()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Configure native Google Sign-In with device account picker
  useEffect(() => {
    if (Platform.OS !== 'web') {
      GoogleSignin.configure({
        webClientId: googleWebClientId,
        scopes: ['profile', 'email'],
      });
    }
  }, [googleWebClientId]);

  // Track Firebase Auth state and user profile document
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, u => {
      setUser(u);
      if (u) {
        const userDocRef = doc(db, 'users', u.uid);
        const unsubProfile = onSnapshot(userDocRef, snap => {
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          } else {
            setProfile(null);
          }
        });
        return () => unsubProfile();
      } else {
        setProfile(null);
        setQuizzes([]);
        setUserResults({});
      }
    });
    return () => unsubscribe();
  }, []);

  // Subscribe to admin-published challenges and current user's quiz results when logged in
  useEffect(() => {
    if (!user) return;
    setQuizzesLoading(true);

    const unsubQuizzes = onSnapshot(
      query(collection(db, 'quizzes'), where('status', 'in', ['published', 'closed'])),
      snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as QuizItem));
        // Show active/published challenges before closed ones
        list.sort((a, b) => {
          if (a.status === b.status) {
            return (b.startAt?.seconds || 0) - (a.startAt?.seconds || 0);
          }
          return a.status === 'published' ? -1 : 1;
        });
        setQuizzes(list);
        setQuizzesLoading(false);
      },
      () => {
        setQuizzesLoading(false);
      }
    );

    const unsubResults = onSnapshot(
      query(collection(db, 'results'), where('uid', '==', user.uid)),
      snap => {
        const map: Record<string, UserResult> = {};
        snap.docs.forEach(docSnap => {
          const data = docSnap.data() as UserResult;
          if (data.quizId) {
            map[data.quizId] = data;
          }
        });
        setUserResults(map);
      },
      () => {}
    );

    return () => {
      unsubQuizzes();
      unsubResults();
    };
  }, [user?.uid]);

  async function ensureUserProfileExists(u: User, authProvider: 'google' | 'password' = 'google') {
    const userRef = doc(db, 'users', u.uid);
    const snap = await getDoc(userRef);
    const resolvedName = u.displayName?.trim() || deriveNameFromEmail(u.email);

    if (!snap.exists()) {
      await setDoc(userRef, {
        name: resolvedName,
        age: null,
        email: u.email || '',
        phoneNumber: null,
        churchName: null,
        address: null,
        status: 'active',
        points: 0,
        authProvider,
        createdAt: serverTimestamp(),
      });
      if (u.email && authProvider === 'google') {
        httpsCallable(functions, 'notifyRegistration')({
          email: u.email,
          name: resolvedName,
        }).catch(() => {});
      }
    }
  }

  async function handleGoogleSignIn() {
    setError('');
    setInfoMessage('');
    setBusy(true);
    try {
      if (Platform.OS === 'web') {
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: 'select_account' });
        const cred = await signInWithPopup(auth, provider);
        await ensureUserProfileExists(cred.user, 'google');
        setInfoMessage('Signed in with Google successfully!');
      } else {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const signInResult = await GoogleSignin.signIn();
        const idToken = signInResult.data?.idToken || (signInResult as any).idToken;
        if (idToken) {
          const credential = GoogleAuthProvider.credential(idToken);
          const cred = await signInWithCredential(auth, credential);
          await ensureUserProfileExists(cred.user, 'google');
          setInfoMessage('Signed in with Google successfully!');
        } else {
          setError('Google did not return an identity token. Please try again.');
        }
      }
    } catch (e: any) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS) {
        // User dismissed picker or flow already active
      } else if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        setError('Google Play Services is not available or outdated on this device.');
      } else if (e.code === 'auth/operation-not-allowed') {
        setError(
          'Google Sign-In is disabled in Firebase Console. Please enable Google in Firebase Console -> Authentication -> Sign-in method.'
        );
      } else {
        setError(e.message || 'Google sign-in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister() {
    const trimmedName = name.trim();
    const trimmedUsername = username.trim().toLowerCase();
    const trimmedEmail = email.trim();
    const trimmedAge = age.trim();
    const trimmedPhone = phoneNumber.trim();
    const trimmedChurch = churchName.trim();
    const trimmedAddress = address.trim();

    if (!trimmedName) {
      setError('Please enter your full name.');
      return;
    }
    const parsedAge = parseInt(trimmedAge, 10);
    if (isNaN(parsedAge) || parsedAge < 3 || parsedAge > 120) {
      setError('Please enter a valid age (e.g. 25).');
      return;
    }
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter a valid email address (e.g. yourname@gmail.com).');
      return;
    }
    if (!trimmedPhone || trimmedPhone.replace(/[^0-9+]/g, '').length < 7) {
      setError('Please enter a valid phone number.');
      return;
    }
    if (!trimmedChurch) {
      setError('Please enter your church name.');
      return;
    }
    if (!trimmedAddress) {
      setError('Please enter your address.');
      return;
    }
    if (trimmedUsername && !/^[a-z0-9_]{3,30}$/.test(trimmedUsername)) {
      setError('Username must be 3-30 characters using letters, numbers, or underscores.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    const fallbackUsername =
      trimmedEmail
        .split('@')[0]
        .replace(/[^a-z0-9_]/g, '')
        .slice(0, 20) || 'member_' + Math.floor(Math.random() * 10000);
    const finalUsername = trimmedUsername || fallbackUsername;

    setBusy(true);
    setError('');
    setInfoMessage('');

    try {
      // 1. Create user in Firebase Authentication
      const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      await updateProfile(cred.user, { displayName: trimmedName }).catch(() => {});

      // 2. Save complete registration profile directly to Firestore
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: trimmedName,
        username: finalUsername,
        age: parsedAge,
        email: trimmedEmail,
        phoneNumber: trimmedPhone,
        churchName: trimmedChurch,
        address: trimmedAddress,
        status: 'active',
        points: 0,
        authProvider: 'password',
        createdAt: serverTimestamp(),
      });

      try {
        await httpsCallable(functions, 'claimUsername')({ username: finalUsername });
      } catch (uErr) {
        console.log('Username reservation notice:', uErr);
      }

      try {
        await sendEmailVerification(cred.user);
      } catch (emailErr) {
        console.log('Firebase verification email notice:', emailErr);
      }

      try {
        await httpsCallable(functions, 'notifyRegistration')({
          email: trimmedEmail,
          name: trimmedName,
        });
      } catch (notifyErr) {
        console.log('Cloud notification error:', notifyErr);
      }

      setInfoMessage(
        'You have been registered to church app successfully! A confirmation email has been sent to ' +
          trimmedEmail +
          '.'
      );
      setPassword('');
      setConfirmPassword('');
    } catch (e: any) {
      if (e.code === 'auth/email-already-in-use') {
        setError('This email is already registered. Please sign in instead.');
      } else {
        setError(e.message || 'Registration failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin() {
    const loginValue = email.trim();
    if (!loginValue) {
      setError('Please enter your email or username.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setBusy(true);
    setError('');
    setInfoMessage('');

    try {
      let loginEmail = loginValue;
      if (!loginValue.includes('@')) {
        try {
          const resolved = await httpsCallable(functions, 'resolveUsername')({
            username: loginValue,
          });
          loginEmail = (resolved.data as { email: string }).email;
        } catch {
          loginEmail = loginValue;
        }
      }
      const cred = await signInWithEmailAndPassword(auth, loginEmail, password);
      await ensureUserProfileExists(cred.user, 'password');
    } catch (e: any) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/invalid-credential') {
        setError(
          'No account found with this email or password incorrect. If you have not registered yet, tap "Register" above to create your church account in 10 seconds!'
        );
      } else if (e.code === 'auth/wrong-password') {
        setError(
          'Incorrect password. Tap "Forgot Password?" below to receive a reset link in your email.'
        );
      } else {
        setError(e.message || 'Sign in failed. Please check your credentials and try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError('Please enter your registered email address to receive reset instructions.');
      return;
    }

    setBusy(true);
    setError('');
    setInfoMessage('');

    try {
      await sendPasswordResetEmail(auth, trimmedEmail);
      setInfoMessage(
        'Password reset email sent! Please check your inbox and follow the link to reset your password.'
      );
    } catch (e: any) {
      setError(e.message || 'Failed to send password reset email.');
    } finally {
      setBusy(false);
    }
  }

  const displayName = useMemo(() => resolveDisplayName(profile, user), [profile, user]);
  const initials = useMemo(() => getInitials(displayName), [displayName]);
  const completedCount = useMemo(() => Object.keys(userResults).length, [userResults]);
  const activeChallengesCount = useMemo(
    () => quizzes.filter(q => q.status === 'published').length,
    [quizzes]
  );

  // Signed-in Dashboard View
  if (user) {
    const points = profile?.points ?? 0;
    const progressPercent = Math.min(100, Math.max(8, (points % 500) / 5));

    return (
      <View style={styles.dashboardShell}>
        <ScrollView contentContainerStyle={styles.dashboardPage} showsVerticalScrollIndicator={false}>
          {/* Header: Time-based Greeting + Clickable Profile Avatar */}
          <View style={styles.greetingHeader}>
            <View style={styles.greetingTextWrap}>
              <Text style={styles.greetingSmall}>{greeting}</Text>
              <Text style={styles.greetingName} numberOfLines={2}>
                {displayName}
              </Text>
              <Text style={styles.greetingChurch}>
                {profile?.churchName || 'JSC Kollemcode Pentecostal Church'}
              </Text>
            </View>

            <Pressable
              style={styles.profileTrigger}
              onPress={() => router.push(PROFILE_ROUTE)}
              accessibilityLabel="Open Profile"
            >
              <View style={styles.avatarRing}>
                {user.photoURL ? (
                  <Image source={{ uri: user.photoURL }} style={styles.avatarImg} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarInitials}>{initials}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.profileTriggerText}>Profile</Text>
            </Pressable>
          </View>

          {/* Bento Stats Row */}
          <View style={styles.bentoRow}>
            <Pressable
              style={styles.lightBentoCard}
              onPress={() => router.push('/quizzes')}
            >
              <Text style={styles.lightBentoValue}>{completedCount}</Text>
              <Text style={styles.lightBentoLabel}>Challenges taken</Text>
            </Pressable>

            <Pressable
              style={styles.darkBentoCard}
              onPress={() => router.push(PROFILE_ROUTE)}
            >
              <Text style={styles.darkBentoEyebrow}>Your rewards</Text>
              <Text style={styles.darkBentoValue}>★ {points} pts</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
            </Pressable>
          </View>

          {/* Highlight Action Banner */}
          <Pressable
            style={styles.limeActionCard}
            onPress={() => router.push('/quizzes')}
          >
            <View style={styles.limeActionTextWrap}>
              <Text style={styles.limeActionTitle}>Bible Competitions</Text>
              <Text style={styles.limeActionSub}>
                {activeChallengesCount > 0
                  ? `${activeChallengesCount} live challenge${activeChallengesCount > 1 ? 's' : ''} ready`
                  : 'View challenges & results'}
              </Text>
            </View>
            <View style={styles.limeArrowCircle}>
              <Text style={styles.limeArrowText}>→</Text>
            </View>
          </Pressable>

          {/* Challenges Feed directly below */}
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionTitle}>Challenges from Admin</Text>
              <Text style={styles.sectionSubtitle}>
                Tap a challenge below to begin or view your score
              </Text>
            </View>
            <Pressable onPress={() => router.push('/quizzes')}>
              <Text style={styles.seeAllLink}>See all</Text>
            </Pressable>
          </View>

          {quizzesLoading ? (
            <ActivityIndicator size="large" color="#141517" style={{ marginVertical: 24 }} />
          ) : quizzes.length === 0 ? (
            <View style={styles.emptyChallengeCard}>
              <Text style={styles.emptyChallengeIcon}>📖</Text>
              <Text style={styles.emptyChallengeTitle}>No challenges published yet</Text>
              <Text style={styles.emptyChallengeText}>
                When your pastor/admin publishes a Bible challenge, it will appear right here.
              </Text>
            </View>
          ) : (
            quizzes.map(item => {
              const result = userResults[item.id];
              const isClosed = item.status === 'closed';

              return (
                <Pressable
                  key={item.id}
                  style={styles.challengeCard}
                  onPress={() => router.push({ pathname: '/quiz/[id]', params: { id: item.id } })}
                >
                  <View style={styles.challengeTopRow}>
                    {result ? (
                      <View style={styles.completedBadge}>
                        <Text style={styles.completedBadgeText}>
                          ✓ {result.score}/{result.maxScore} · {result.points ?? result.score * 10} pts
                        </Text>
                      </View>
                    ) : isClosed ? (
                      <View style={styles.closedBadge}>
                        <Text style={styles.closedBadgeText}>Closed</Text>
                      </View>
                    ) : (
                      <View style={styles.liveBadge}>
                        <Text style={styles.liveBadgeText}>● Live Challenge</Text>
                      </View>
                    )}

                    <Text style={styles.challengePointsTag}>
                      ★ {(item.questionCount || 0) * 10} pts
                    </Text>
                  </View>

                  <Text style={styles.challengeTitle}>{item.title}</Text>
                  {item.description ? (
                    <Text style={styles.challengeDesc} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}

                  <View style={styles.challengeFooterRow}>
                    <View style={styles.challengeMetaRow}>
                      <Text style={styles.metaChip}>⏱ {item.durationMinutes}m</Text>
                      <Text style={styles.metaChip}>📝 {item.questionCount || 0} Qs</Text>
                    </View>
                    <Text style={styles.challengeCta}>
                      {result ? 'View score →' : isClosed ? 'Details →' : 'Start →'}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        {/* Bottom Circular Quick Action Dock */}
        <View style={styles.bottomDock}>
          <Pressable style={[styles.dockBtn, styles.dockBtnActive]} onPress={() => {}}>
            <Text style={styles.dockIcon}>🏠</Text>
            <Text style={styles.dockLabelActive}>Home</Text>
          </Pressable>

          <Pressable style={styles.dockBtn} onPress={() => router.push('/quizzes')}>
            <Text style={styles.dockIcon}>📖</Text>
            <Text style={styles.dockLabel}>Quizzes</Text>
          </Pressable>

          <Pressable style={styles.dockBtn} onPress={() => router.push(PROFILE_ROUTE)}>
            <Text style={styles.dockIcon}>👤</Text>
            <Text style={styles.dockLabel}>Profile</Text>
          </Pressable>

          <Pressable style={styles.dockBtn} onPress={() => signOut(auth)}>
            <Text style={styles.dockIcon}>🚪</Text>
            <Text style={styles.dockLabel}>Logout</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // Logged-out Authentication View
  return (
    <ScrollView contentContainerStyle={styles.authPage} keyboardShouldPersistTaps="handled">
      <Text style={styles.cross}>✦</Text>
      <Text style={styles.eyebrow}>JSC KOLLEMCODE PENTECOSTAL CHURCH</Text>
      <Text style={styles.title}>Bible Quiz</Text>
      <Text style={styles.subtitle}>Read. Remember. Grow together.</Text>

      <View style={styles.card}>
        {viewMode !== 'forgot_password' && (
          <View style={styles.tabContainer}>
            <Pressable
              style={[styles.tab, viewMode === 'login' && styles.activeTab]}
              onPress={() => {
                setViewMode('login');
                setError('');
                setInfoMessage('');
              }}
            >
              <Text style={[styles.tabText, viewMode === 'login' && styles.activeTabText]}>
                Sign In
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tab, viewMode === 'register' && styles.activeTab]}
              onPress={() => {
                setViewMode('register');
                setError('');
                setInfoMessage('');
              }}
            >
              <Text style={[styles.tabText, viewMode === 'register' && styles.activeTabText]}>
                Register
              </Text>
            </Pressable>
          </View>
        )}

        <Text style={styles.heading}>
          {viewMode === 'register'
            ? 'New Member Registration'
            : viewMode === 'forgot_password'
            ? 'Reset Your Password'
            : 'Member Sign In'}
        </Text>

        {infoMessage ? <Text style={styles.success}>{infoMessage}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {viewMode === 'register' && (
          <>
            <TextInput
              style={styles.input}
              placeholder="Full Name *"
              value={name}
              onChangeText={setName}
              accessibilityLabel="Full Name"
              placeholderTextColor="#8a94a0"
            />
            <TextInput
              style={styles.input}
              placeholder="Age (e.g. 24) *"
              keyboardType="numeric"
              value={age}
              onChangeText={setAge}
              accessibilityLabel="Age"
              placeholderTextColor="#8a94a0"
            />
            <TextInput
              style={styles.input}
              placeholder="Email Address (e.g. Gmail) *"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              accessibilityLabel="Email Address"
              placeholderTextColor="#8a94a0"
            />
            <TextInput
              style={styles.input}
              placeholder="Phone Number *"
              keyboardType="phone-pad"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              accessibilityLabel="Phone Number"
              placeholderTextColor="#8a94a0"
            />
            <TextInput
              style={styles.input}
              placeholder="Church Name *"
              value={churchName}
              onChangeText={setChurchName}
              accessibilityLabel="Church Name"
              placeholderTextColor="#8a94a0"
            />
            <TextInput
              style={[styles.input, styles.addressInput]}
              placeholder="Home Address *"
              multiline
              numberOfLines={2}
              value={address}
              onChangeText={setAddress}
              accessibilityLabel="Address"
              placeholderTextColor="#8a94a0"
            />
            <TextInput
              style={styles.input}
              placeholder="Username (optional, e.g. john_25)"
              autoCapitalize="none"
              value={username}
              onChangeText={setUsername}
              accessibilityLabel="Username"
              placeholderTextColor="#8a94a0"
            />
            <TextInput
              style={styles.input}
              placeholder="Password (minimum 6 characters) *"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              accessibilityLabel="Password"
              placeholderTextColor="#8a94a0"
            />
            <TextInput
              style={styles.input}
              placeholder="Confirm Password *"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              accessibilityLabel="Confirm Password"
              placeholderTextColor="#8a94a0"
            />

            <Pressable style={styles.button} disabled={busy} onPress={handleRegister}>
              {busy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.buttonText}>Register & Send Confirmation</Text>
              )}
            </Pressable>
          </>
        )}

        {viewMode === 'login' && (
          <>
            <TextInput
              style={styles.input}
              placeholder="Email (e.g. Gmail) or username"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              accessibilityLabel="Email Address"
              placeholderTextColor="#8a94a0"
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              accessibilityLabel="Password"
              placeholderTextColor="#8a94a0"
            />

            <Pressable style={styles.button} disabled={busy} onPress={handleLogin}>
              {busy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.buttonText}>Sign In</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => {
                setViewMode('forgot_password');
                setError('');
                setInfoMessage('');
              }}
            >
              <Text style={styles.forgotLink}>Forgot Password?</Text>
            </Pressable>
          </>
        )}

        {viewMode === 'forgot_password' && (
          <>
            <Text style={styles.body}>
              Enter the email address you registered with. We will send you an email link to reset
              your password.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Registered Email Address"
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              accessibilityLabel="Registered Email"
              placeholderTextColor="#8a94a0"
            />
            <Pressable style={styles.button} disabled={busy} onPress={handleForgotPassword}>
              {busy ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.buttonText}>Send Reset Link</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                setViewMode('login');
                setError('');
                setInfoMessage('');
              }}
            >
              <Text style={styles.link}>← Back to Sign In</Text>
            </Pressable>
          </>
        )}

        {viewMode !== 'forgot_password' && (
          <View style={styles.socialSection}>
            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.divider} />
            </View>

            <Pressable style={styles.googleButton} disabled={busy} onPress={handleGoogleSignIn}>
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleButtonText}>Sign in with Google</Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 52;

const styles = StyleSheet.create({
  // Signed-in Dashboard Styles
  dashboardShell: {
    flex: 1,
    backgroundColor: '#f5f4ef',
  },
  dashboardPage: {
    paddingTop: topInset,
    paddingHorizontal: 20,
    paddingBottom: 110,
  },
  greetingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 22,
  },
  greetingTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  greetingSmall: {
    fontSize: 32,
    fontWeight: '700',
    color: '#141517',
    lineHeight: 36,
    letterSpacing: -0.6,
  },
  greetingName: {
    fontSize: 34,
    fontWeight: '800',
    color: '#141517',
    lineHeight: 40,
    letterSpacing: -0.8,
  },
  greetingChurch: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '600',
    marginTop: 6,
  },
  profileTrigger: {
    alignItems: 'center',
  },
  avatarRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2.5,
    borderColor: '#c5ee3c',
    padding: 2,
    backgroundColor: '#ffffff',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 25,
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 25,
    backgroundColor: '#141517',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    color: '#c5ee3c',
    fontWeight: '800',
    fontSize: 18,
  },
  profileTriggerText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4b5563',
    marginTop: 4,
  },
  bentoRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  lightBentoCard: {
    flex: 1,
    backgroundColor: '#eae8df',
    borderRadius: 22,
    padding: 18,
    justifyContent: 'space-between',
    minHeight: 112,
  },
  lightBentoValue: {
    fontSize: 30,
    fontWeight: '800',
    color: '#141517',
  },
  lightBentoLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#525866',
    marginTop: 6,
  },
  darkBentoCard: {
    flex: 1.2,
    backgroundColor: '#141517',
    borderRadius: 22,
    padding: 18,
    justifyContent: 'space-between',
    minHeight: 112,
  },
  darkBentoEyebrow: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: '600',
  },
  darkBentoValue: {
    fontSize: 26,
    fontWeight: '800',
    color: '#c5ee3c',
    marginTop: 4,
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#2d3138',
    borderRadius: 999,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#c5ee3c',
    borderRadius: 999,
  },
  limeActionCard: {
    backgroundColor: '#c5ee3c',
    borderRadius: 22,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  limeActionTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  limeActionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#141517',
  },
  limeActionSub: {
    fontSize: 13,
    fontWeight: '600',
    color: '#344012',
    marginTop: 4,
  },
  limeArrowCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#141517',
    justifyContent: 'center',
    alignItems: 'center',
  },
  limeArrowText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '700',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 14,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#141517',
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  seeAllLink: {
    fontSize: 13,
    fontWeight: '700',
    color: '#141517',
    textDecorationLine: 'underline',
  },
  emptyChallengeCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 26,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e6e4dc',
  },
  emptyChallengeIcon: {
    fontSize: 34,
    marginBottom: 8,
  },
  emptyChallengeTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#141517',
    marginBottom: 4,
  },
  emptyChallengeText: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    lineHeight: 19,
  },
  challengeCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e6e4dc',
  },
  challengeTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  liveBadge: {
    backgroundColor: '#e6f7d2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  liveBadgeText: {
    color: '#215711',
    fontSize: 12,
    fontWeight: '700',
  },
  completedBadge: {
    backgroundColor: '#e8f0fe',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  completedBadgeText: {
    color: '#1a73e8',
    fontSize: 12,
    fontWeight: '700',
  },
  closedBadge: {
    backgroundColor: '#eceae2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  closedBadgeText: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '700',
  },
  challengePointsTag: {
    fontSize: 13,
    fontWeight: '800',
    color: '#141517',
  },
  challengeTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#141517',
    marginBottom: 4,
  },
  challengeDesc: {
    fontSize: 13,
    color: '#525866',
    lineHeight: 18,
    marginBottom: 12,
  },
  challengeFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  challengeMetaRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metaChip: {
    backgroundColor: '#f3f1ea',
    color: '#374151',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  challengeCta: {
    fontSize: 13,
    fontWeight: '800',
    color: '#141517',
  },
  bottomDock: {
    position: 'absolute',
    bottom: 16,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    padding: 8,
    borderRadius: 34,
    borderWidth: 1,
    borderColor: '#e6e4dc',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 6,
  },
  dockBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 26,
  },
  dockBtnActive: {
    backgroundColor: '#c5ee3c',
  },
  dockIcon: {
    fontSize: 16,
  },
  dockLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280',
    marginTop: 2,
  },
  dockLabelActive: {
    fontSize: 11,
    fontWeight: '800',
    color: '#141517',
    marginTop: 2,
  },

  // Auth / Login / Register Styles
  authPage: {
    flexGrow: 1,
    padding: 24,
    paddingTop: topInset + 8,
    justifyContent: 'center',
    backgroundColor: '#f6f0df',
  },
  cross: {
    color: '#b58a3b',
    fontSize: 44,
    textAlign: 'center',
  },
  eyebrow: {
    color: '#786741',
    textAlign: 'center',
    letterSpacing: 2,
    fontSize: 11,
    marginTop: 12,
    fontWeight: '600',
  },
  title: {
    color: '#102942',
    fontSize: 42,
    textAlign: 'center',
    fontWeight: '700',
    marginTop: 6,
  },
  subtitle: {
    color: '#455767',
    textAlign: 'center',
    marginBottom: 24,
    fontSize: 15,
  },
  card: {
    backgroundColor: '#fffdf7',
    borderRadius: 18,
    padding: 22,
    borderColor: '#dacba7',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 3,
  },
  tabContainer: {
    flexDirection: 'row',
    marginBottom: 18,
    backgroundColor: '#ece3ce',
    borderRadius: 10,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  activeTab: {
    backgroundColor: '#102942',
  },
  tabText: {
    color: '#455767',
    fontWeight: '600',
    fontSize: 14,
  },
  activeTabText: {
    color: 'white',
    fontWeight: '700',
  },
  heading: {
    color: '#102942',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 16,
  },
  body: {
    color: '#455767',
    marginBottom: 18,
    lineHeight: 21,
  },
  input: {
    borderWidth: 1,
    borderColor: '#c9ccd0',
    borderRadius: 8,
    padding: 13,
    marginBottom: 11,
    backgroundColor: 'white',
    fontSize: 15,
    color: '#102942',
  },
  addressInput: {
    minHeight: 68,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: '#102942',
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
  forgotLink: {
    color: '#8a621d',
    textAlign: 'right',
    marginTop: 12,
    fontWeight: '600',
    fontSize: 13,
  },
  link: {
    color: '#8a621d',
    textAlign: 'center',
    marginTop: 16,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  socialSection: {
    marginTop: 20,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: '#e0d5bd',
  },
  dividerText: {
    marginHorizontal: 10,
    color: '#8a94a0',
    fontSize: 12,
    fontWeight: '600',
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: '#b9bdc0',
    borderRadius: 8,
    padding: 13,
  },
  googleIcon: {
    fontSize: 18,
    fontWeight: '900',
    color: '#4285F4',
    marginRight: 10,
  },
  googleButtonText: {
    color: '#102942',
    fontWeight: '600',
    fontSize: 15,
  },
  error: {
    color: '#aa2828',
    backgroundColor: '#fde8e8',
    padding: 10,
    borderRadius: 6,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 18,
  },
  success: {
    color: '#1b632e',
    backgroundColor: '#e7f7ec',
    padding: 10,
    borderRadius: 6,
    marginBottom: 14,
    fontSize: 13,
    lineHeight: 18,
  },
});
