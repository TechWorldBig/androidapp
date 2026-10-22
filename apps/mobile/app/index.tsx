import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
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
  User,
} from 'firebase/auth';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, db, functions } from '../lib/firebase';

WebBrowser.maybeCompleteAuthSession();

type ViewMode = 'login' | 'register' | 'forgot_password';

interface UserProfile {
  name: string;
  age: number | null;
  email: string;
  status: string;
  points?: number;
  authProvider?: string;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('login');

  // Form fields
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Status and feedback
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [busy, setBusy] = useState(false);

  // Google Auth Session
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || undefined,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID || undefined,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID || undefined,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || undefined,
  });

  // Track Firebase Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, u => {
      setUser(u);
      if (u) {
        // Listen to user profile document in Firestore
        const userDocRef = doc(db, 'users', u.uid);
        const unsubProfile = onSnapshot(userDocRef, snap => {
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          } else {
            // First time Google or external sign in without profile
            setProfile(null);
          }
        });
        return () => unsubProfile();
      } else {
        setProfile(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Handle Google Auth Response
  useEffect(() => {
    if (response?.type === 'success') {
      const { id_token } = response.params;
      if (id_token) {
        handleGoogleCredentialSignIn(id_token);
      }
    } else if (response?.type === 'error') {
      setError(response.error?.message || 'Google sign-in was not completed.');
    }
  }, [response]);

  async function handleGoogleCredentialSignIn(idToken: string) {
    setBusy(true);
    setError('');
    setInfoMessage('');
    try {
      const credential = GoogleAuthProvider.credential(idToken);
      const cred = await signInWithCredential(auth, credential);
      await ensureUserProfileExists(cred.user);
      setInfoMessage('Signed in with Google successfully!');
    } catch (e: any) {
      setError(e.message || 'Google sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function ensureUserProfileExists(u: User) {
    const userRef = doc(db, 'users', u.uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      await setDoc(userRef, {
        name: u.displayName || 'Church Member',
        age: null,
        email: u.email || '',
        status: 'active',
        points: 0,
        authProvider: 'google',
        createdAt: serverTimestamp(),
      });
      // Queue welcome email for new Google user
      if (u.email) {
        httpsCallable(functions, 'notifyRegistration')({
          email: u.email,
          name: u.displayName || 'Church Member',
        }).catch(() => {});
      }
    }
  }

  async function handleGoogleSignIn() {
    setError('');
    setInfoMessage('');
    try {
      if (Platform.OS === 'web') {
        setBusy(true);
        const provider = new GoogleAuthProvider();
        const cred = await signInWithPopup(auth, provider);
        await ensureUserProfileExists(cred.user);
        setInfoMessage('Signed in with Google successfully!');
      } else {
        if (!request) {
          Alert.alert(
            'Google Sign-In Note',
            'To use live Google OAuth on mobile devices, set EXPO_PUBLIC_GOOGLE_CLIENT_ID in your environment variables. You can also sign in with your Google email and password directly.'
          );
          return;
        }
        await promptAsync();
      }
    } catch (e: any) {
      setError(e.message || 'Google sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  // Handle Registration
  async function handleRegister() {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedAge = age.trim();

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
      setError('Please enter a valid email address.');
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

    setBusy(true);
    setError('');
    setInfoMessage('');

    try {
      // 1. Create user in Firebase Authentication
      const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);

      // 2. Save member profile document in Firestore
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: trimmedName,
        age: parsedAge,
        email: trimmedEmail,
        status: 'active',
        points: 0,
        authProvider: 'password',
        createdAt: serverTimestamp(),
      });

      // 3. Send email verification / welcome to user's registered email
      try {
        await sendEmailVerification(cred.user);
      } catch (emailErr) {
        console.log('Firebase verification email notice:', emailErr);
      }

      // 4. Trigger cloud registration notification
      try {
        await httpsCallable(functions, 'notifyRegistration')({
          email: trimmedEmail,
          name: trimmedName,
        });
      } catch (notifyErr) {
        console.log('Cloud notification error:', notifyErr);
      }

      // 5. Notify user
      setInfoMessage(
        'You have been registered to church app successfully! A confirmation email has been sent to ' +
          trimmedEmail +
          '.'
      );
      // Reset form
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

  // Handle Standard Email/Password Sign-In
  async function handleLogin() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your email.');
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
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
    } catch (e: any) {
      if (e.code === 'auth/user-not-found' || e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential') {
        setError('Incorrect email or password. Please try again.');
      } else {
        setError(e.message || 'Sign in failed. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  // Handle Forgot Password
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
      setInfoMessage('Password reset email sent! Please check your inbox and follow the link to reset your password.');
    } catch (e: any) {
      setError(e.message || 'Failed to send password reset email.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.cross}>✦</Text>
      <Text style={styles.eyebrow}>JSC KOLLEMCODE PENTECOSTAL CHURCH</Text>
      <Text style={styles.title}>Bible Quiz</Text>
      <Text style={styles.subtitle}>Read. Remember. Grow together.</Text>

      {user ? (
        <View style={styles.card}>
          <Text style={styles.heading}>Welcome, {profile?.name || user.displayName || 'Member'}!</Text>
          <Text style={styles.body}>Your Bible quiz dashboard is ready. Take challenges posted by the pastor and earn points!</Text>

          {/* Member Profile & Points Banner */}
          <View style={styles.pointsBanner}>
            <Text style={styles.pointsLabel}>TOTAL POINTS</Text>
            <Text style={styles.pointsValue}>{profile?.points ?? 0} pts</Text>
            <Text style={styles.pointsSubtext}>Points update automatically when you complete challenges</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Email:</Text>
            <Text style={styles.infoValue}>{user.email}</Text>
          </View>
          {profile?.age ? (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Age:</Text>
              <Text style={styles.infoValue}>{profile.age} years</Text>
            </View>
          ) : null}

          <Pressable
            style={styles.button}
            onPress={() => router.push('/quizzes')}
          >
            <Text style={styles.buttonText}>View Competitions & Challenges →</Text>
          </Pressable>

          <Pressable
            style={styles.secondaryButton}
            onPress={() => signOut(auth)}
          >
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.card}>
          {/* Tabs for switching Login / Register */}
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
                <Text style={[styles.tabText, viewMode === 'login' && styles.activeTabText]}>Sign In</Text>
              </Pressable>
              <Pressable
                style={[styles.tab, viewMode === 'register' && styles.activeTab]}
                onPress={() => {
                  setViewMode('register');
                  setError('');
                  setInfoMessage('');
                }}
              >
                <Text style={[styles.tabText, viewMode === 'register' && styles.activeTabText]}>Register</Text>
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

          {/* Form based on View Mode */}
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
                placeholder="Email Address *"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                accessibilityLabel="Email Address"
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

              <Pressable
                style={styles.button}
                disabled={busy}
                onPress={handleRegister}
              >
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
                placeholder="Email Address (or Google Email)"
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

              <Pressable
                style={styles.button}
                disabled={busy}
                onPress={handleLogin}
              >
                {busy ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Sign In</Text>}
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
                Enter the email address you registered with. We will send you an email link to reset your password.
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
              <Pressable
                style={styles.button}
                disabled={busy}
                onPress={handleForgotPassword}
              >
                {busy ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Send Reset Link</Text>}
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

          {/* Google Sign In option */}
          {viewMode !== 'forgot_password' && (
            <View style={styles.socialSection}>
              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.divider} />
              </View>

              <Pressable
                style={styles.googleButton}
                disabled={busy}
                onPress={handleGoogleSignIn}
              >
                <Text style={styles.googleIcon}>G</Text>
                <Text style={styles.googleButtonText}>Sign in with Google</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#f6f0df',
  },
  cross: {
    color: '#b58a3b',
    fontSize: 48,
    textAlign: 'center',
  },
  eyebrow: {
    color: '#786741',
    textAlign: 'center',
    letterSpacing: 2,
    fontSize: 11,
    marginTop: 16,
    fontWeight: '600',
  },
  title: {
    color: '#102942',
    fontSize: 44,
    textAlign: 'center',
    fontWeight: '700',
    marginTop: 8,
  },
  subtitle: {
    color: '#455767',
    textAlign: 'center',
    marginBottom: 28,
    fontSize: 15,
  },
  card: {
    backgroundColor: '#fffdf7',
    borderRadius: 18,
    padding: 24,
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
    marginBottom: 20,
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
  pointsBanner: {
    backgroundColor: '#102942',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  pointsLabel: {
    color: '#b58a3b',
    fontSize: 12,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  pointsValue: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '800',
    marginVertical: 4,
  },
  pointsSubtext: {
    color: '#c2d1e0',
    fontSize: 12,
    textAlign: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f0e6d2',
    marginBottom: 8,
  },
  infoLabel: {
    color: '#707e8b',
    fontWeight: '600',
  },
  infoValue: {
    color: '#102942',
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderColor: '#c9ccd0',
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    backgroundColor: 'white',
    fontSize: 15,
    color: '#102942',
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
  secondaryButton: {
    borderColor: '#b9bdc0',
    borderWidth: 1,
    borderRadius: 8,
    padding: 13,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    color: '#5c6670',
    fontWeight: '600',
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
