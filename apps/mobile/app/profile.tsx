import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { onAuthStateChanged, signOut, updateProfile, User } from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { getInitials, resolveDisplayName, UserProfile } from '../lib/profile';

interface DetailField {
  label: string;
  value: string;
}

export default function ProfileScreen() {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  // Editable profile fields
  const [nameInput, setNameInput] = useState('');
  const [ageInput, setAgeInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [churchInput, setChurchInput] = useState('');
  const [addressInput, setAddressInput] = useState('');

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, current => {
      setUser(current);
      if (!current) {
        setProfile(null);
        setLoading(false);
        return;
      }

      const unsubDoc = onSnapshot(
        doc(db, 'users', current.uid),
        snap => {
          if (snap.exists()) {
            const data = snap.data() as UserProfile;
            setProfile(data);
            setNameInput(data.name || resolveDisplayName(null, current));
            setAgeInput(data.age != null ? String(data.age) : '');
            setPhoneInput(data.phoneNumber || '');
            setChurchInput(data.churchName || '');
            setAddressInput(data.address || '');
          } else {
            setProfile(null);
            setNameInput(resolveDisplayName(null, current));
            setAgeInput('');
            setPhoneInput('');
            setChurchInput('');
            setAddressInput('');
          }
          setLoading(false);
        },
        () => {
          setLoading(false);
        }
      );

      return () => unsubDoc();
    });

    return () => unsubAuth();
  }, []);

  async function handleSaveProfile() {
    if (!user) return;
    const trimmedName = nameInput.trim();
    const trimmedAge = ageInput.trim();
    const trimmedPhone = phoneInput.trim();
    const trimmedChurch = churchInput.trim();
    const trimmedAddress = addressInput.trim();

    if (!trimmedName) {
      setError('Name cannot be empty.');
      return;
    }

    let parsedAge: number | null = null;
    if (trimmedAge) {
      const n = parseInt(trimmedAge, 10);
      if (isNaN(n) || n < 3 || n > 120) {
        setError('Please enter a valid age between 3 and 120.');
        return;
      }
      parsedAge = n;
    }

    if (trimmedPhone && trimmedPhone.replace(/[^0-9+]/g, '').length < 7) {
      setError('Please enter a valid phone number.');
      return;
    }

    setSaving(true);
    setError('');
    setInfoMessage('');

    try {
      const userRef = doc(db, 'users', user.uid);
      if (profile) {
        await updateDoc(userRef, {
          name: trimmedName,
          age: parsedAge,
          phoneNumber: trimmedPhone || null,
          churchName: trimmedChurch || null,
          address: trimmedAddress || null,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(userRef, {
          name: trimmedName,
          age: parsedAge,
          email: user.email || '',
          phoneNumber: trimmedPhone || null,
          churchName: trimmedChurch || null,
          address: trimmedAddress || null,
          status: 'active',
          points: 0,
          authProvider: 'email',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      if (user.displayName !== trimmedName) {
        await updateProfile(user, { displayName: trimmedName }).catch(() => {});
      }

      setEditing(false);
      setInfoMessage('Profile updated successfully!');
    } catch (e: any) {
      setError(e.message || 'Could not save profile changes.');
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    await signOut(auth);
    router.replace('/');
  }

  if (loading) {
    return (
      <View style={s.centerBox}>
        <ActivityIndicator size="large" color="#141517" />
      </View>
    );
  }

  if (!user) {
    return (
      <View style={s.centerBox}>
        <Text style={s.emptyTitle}>You are not signed in</Text>
        <Pressable style={s.primaryBtn} onPress={() => router.replace('/')}>
          <Text style={s.primaryBtnText}>Go to Sign In</Text>
        </Pressable>
      </View>
    );
  }

  const displayName = resolveDisplayName(profile, user);
  const initials = getInitials(displayName);
  const fields: DetailField[] = [
    { label: 'Full Name', value: displayName },
    { label: 'Age', value: profile?.age != null ? `${profile.age} years` : 'Not added yet' },
    { label: 'Email Address', value: profile?.email || user.email || 'Not set' },
    { label: 'Phone Number', value: profile?.phoneNumber || 'Not added yet' },
    { label: 'Church Name', value: profile?.churchName || 'Not added yet' },
    { label: 'Address', value: profile?.address || 'Not added yet' },
  ];

  return (
    <ScrollView contentContainerStyle={s.page}>
      {/* Profile Hero Header */}
      <View style={s.heroCard}>
        <View style={s.avatarRing}>
          {user.photoURL ? (
            <Image source={{ uri: user.photoURL }} style={s.avatarImage} />
          ) : (
            <View style={s.avatarFallback}>
              <Text style={s.avatarInitials}>{initials}</Text>
            </View>
          )}
        </View>
        <Text style={s.heroName}>{displayName}</Text>
        <Text style={s.heroEmail}>{profile?.email || user.email}</Text>

        <View style={s.pointsPill}>
          <Text style={s.pointsPillText}>★ {profile?.points ?? 0} pts</Text>
        </View>
      </View>

      {infoMessage ? <Text style={s.success}>{infoMessage}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {/* Details / Edit Card */}
      <View style={s.card}>
        <View style={s.cardHeaderRow}>
          <Text style={s.cardTitle}>{editing ? 'Edit Member Details' : 'Member Profile'}</Text>
          {!editing && (
            <Pressable
              style={s.editPill}
              onPress={() => {
                setEditing(true);
                setError('');
                setInfoMessage('');
              }}
            >
              <Text style={s.editPillText}>Edit</Text>
            </Pressable>
          )}
        </View>

        {editing ? (
          <>
            <Text style={s.fieldLabel}>Full Name *</Text>
            <TextInput
              style={s.input}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Enter full name"
              placeholderTextColor="#8a9099"
            />

            <Text style={s.fieldLabel}>Age</Text>
            <TextInput
              style={s.input}
              value={ageInput}
              onChangeText={setAgeInput}
              placeholder="Enter age (e.g. 24)"
              keyboardType="numeric"
              placeholderTextColor="#8a9099"
            />

            <Text style={s.fieldLabel}>Email Address</Text>
            <TextInput
              style={[s.input, s.disabledInput]}
              value={profile?.email || user.email || ''}
              editable={false}
            />

            <Text style={s.fieldLabel}>Phone Number</Text>
            <TextInput
              style={s.input}
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="Enter phone number"
              keyboardType="phone-pad"
              placeholderTextColor="#8a9099"
            />

            <Text style={s.fieldLabel}>Church Name</Text>
            <TextInput
              style={s.input}
              value={churchInput}
              onChangeText={setChurchInput}
              placeholder="Enter church name"
              placeholderTextColor="#8a9099"
            />

            <Text style={s.fieldLabel}>Address</Text>
            <TextInput
              style={[s.input, s.multilineInput]}
              value={addressInput}
              onChangeText={setAddressInput}
              placeholder="Enter full address"
              multiline
              numberOfLines={3}
              placeholderTextColor="#8a9099"
            />

            <View style={s.editActionsRow}>
              <Pressable
                style={[s.secondaryBtn, { flex: 1 }]}
                disabled={saving}
                onPress={() => {
                  setEditing(false);
                  setError('');
                }}
              >
                <Text style={s.secondaryBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.primaryBtn, { flex: 1 }]}
                disabled={saving}
                onPress={handleSaveProfile}
              >
                {saving ? (
                  <ActivityIndicator color="#141517" />
                ) : (
                  <Text style={s.primaryBtnText}>Save Profile</Text>
                )}
              </Pressable>
            </View>
          </>
        ) : (
          <View>
            {fields.map((field, index) => (
              <View
                key={field.label}
                style={[s.detailRow, index === fields.length - 1 && s.detailRowLast]}
              >
                <Text style={s.detailLabel}>{field.label}</Text>
                <Text
                  style={[
                    s.detailValue,
                    field.value === 'Not added yet' && s.detailValueMuted,
                  ]}
                >
                  {field.value}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <Pressable style={s.backBtn} onPress={() => router.back()}>
        <Text style={s.backBtnText}>← Back to Dashboard</Text>
      </Pressable>

      <Pressable style={s.signOutBtn} onPress={handleSignOut}>
        <Text style={s.signOutBtnText}>Sign Out</Text>
      </Pressable>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  page: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: '#f5f4ef',
    paddingBottom: 40,
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#f5f4ef',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#141517',
    marginBottom: 16,
  },
  heroCard: {
    backgroundColor: '#141517',
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 3,
    borderColor: '#c5ee3c',
    padding: 3,
    marginBottom: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 38,
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 38,
    backgroundColor: '#24272c',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarInitials: {
    color: '#c5ee3c',
    fontSize: 28,
    fontWeight: '800',
  },
  heroName: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  heroEmail: {
    color: '#9ca3af',
    fontSize: 14,
    marginTop: 4,
    textAlign: 'center',
  },
  pointsPill: {
    backgroundColor: '#c5ee3c',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 14,
  },
  pointsPillText: {
    color: '#141517',
    fontWeight: '800',
    fontSize: 13,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e6e4dc',
    marginBottom: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#141517',
  },
  editPill: {
    backgroundColor: '#eceae2',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
  },
  editPillText: {
    color: '#141517',
    fontWeight: '700',
    fontSize: 13,
  },
  detailRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0eee6',
  },
  detailRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 2,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#767b84',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#141517',
  },
  detailValueMuted: {
    color: '#9ca3af',
    fontStyle: 'italic',
    fontWeight: '500',
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4b5563',
    marginBottom: 6,
    marginTop: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d9d6cc',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#faf9f5',
    fontSize: 15,
    color: '#141517',
  },
  disabledInput: {
    backgroundColor: '#eceae2',
    color: '#6b7280',
  },
  multilineInput: {
    minHeight: Platform.OS === 'ios' ? 76 : 72,
    textAlignVertical: 'top',
  },
  editActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  primaryBtn: {
    backgroundColor: '#c5ee3c',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#141517',
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryBtn: {
    backgroundColor: '#eceae2',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    color: '#141517',
    fontWeight: '700',
    fontSize: 15,
  },
  backBtn: {
    backgroundColor: '#141517',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  backBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  signOutBtn: {
    borderWidth: 1,
    borderColor: '#d6d3c9',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  signOutBtnText: {
    color: '#b91c1c',
    fontWeight: '700',
    fontSize: 15,
  },
  error: {
    color: '#aa2828',
    backgroundColor: '#fde8e8',
    padding: 12,
    borderRadius: 12,
    marginBottom: 14,
    fontSize: 13,
  },
  success: {
    color: '#1b632e',
    backgroundColor: '#e7f7ec',
    padding: 12,
    borderRadius: 12,
    marginBottom: 14,
    fontSize: 13,
  },
});

