import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

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

export default function Quizzes() {
  const [items, setItems] = useState<QuizItem[]>([]);
  const [userResults, setUserResults] = useState<Record<string, UserResult>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Subscribe to published/closed quizzes
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'quizzes'), where('status', 'in', ['published', 'closed'])),
      snap => {
        setItems(snap.docs.map(d => ({ id: d.id, ...d.data() } as QuizItem)));
        setLoading(false);
      },
      e => {
        setError(e.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Subscribe to user's results to display completed badges and points
  useEffect(() => {
    const currentUid = auth.currentUser?.uid;
    if (!currentUid) return;

    const unsubResults = onSnapshot(
      query(collection(db, 'results'), where('uid', '==', currentUid)),
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

    return () => unsubResults();
  }, []);

  return (
    <View style={s.page}>
      <View style={s.headerRow}>
        <Pressable onPress={() => router.replace('/')} style={s.backButton}>
          <Text style={s.backText}>← Dashboard</Text>
        </Pressable>
      </View>

      <Text style={s.eyebrow}>PASTOR CHALLENGES</Text>
      <Text style={s.title}>Bible Competitions</Text>
      <Text style={s.subtitle}>Answer questions within the timer limit to earn points!</Text>

      {loading && <ActivityIndicator size="large" color="#102942" style={{ marginVertical: 20 }} />}
      {!!error && <Text style={s.error}>{error}</Text>}

      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={s.listContent}
        ListEmptyComponent={
          !loading ? (
            <View style={s.emptyCard}>
              <Text style={s.emptyIcon}>📖</Text>
              <Text style={s.emptyTitle}>No challenges yet</Text>
              <Text style={s.emptySubtitle}>The pastor will publish new timed quiz challenges here soon.</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const result = userResults[item.id];
          const isClosed = item.status === 'closed';

          return (
            <Pressable
              style={s.card}
              onPress={() => router.push({ pathname: '/quiz/[id]', params: { id: item.id } })}
            >
              <View style={s.topBadgeRow}>
                {result ? (
                  <View style={s.completedBadge}>
                    <Text style={s.completedBadgeText}>
                      ✓ Completed: {result.score}/{result.maxScore} ({result.points ?? result.score * 10} pts)
                    </Text>
                  </View>
                ) : isClosed ? (
                  <View style={s.closedBadge}>
                    <Text style={s.closedBadgeText}>Closed</Text>
                  </View>
                ) : (
                  <View style={s.activeBadge}>
                    <Text style={s.activeBadgeText}>🟢 Active Challenge</Text>
                  </View>
                )}

                <Text style={s.pointsTag}>⭐ {(item.questionCount || 0) * 10} pts</Text>
              </View>

              <Text style={s.name}>{item.title}</Text>
              {item.description ? <Text style={s.desc}>{item.description}</Text> : null}

              <View style={s.metaRow}>
                <Text style={s.metaBadge}>⏱ {item.durationMinutes} mins timer</Text>
                <Text style={s.metaBadge}>📝 {item.questionCount || 0} questions</Text>
              </View>

              {item.startAt && (
                <Text style={s.schedule}>
                  Scheduled: {new Date(item.startAt.seconds * 1000).toLocaleString()}
                </Text>
              )}

              <Text style={s.action}>
                {result
                  ? 'View your score & answers →'
                  : isClosed
                  ? 'View competition details →'
                  : 'Start timed challenge →'}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f6f0df',
  },
  headerRow: {
    marginBottom: 8,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignSelf: 'flex-start',
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
    marginTop: 4,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#102942',
    marginTop: 2,
  },
  subtitle: {
    color: '#5c6670',
    fontSize: 14,
    marginBottom: 16,
    marginTop: 4,
  },
  listContent: {
    paddingBottom: 24,
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
  topBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  activeBadge: {
    backgroundColor: '#e7f7ec',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  activeBadgeText: {
    color: '#1b632e',
    fontWeight: '700',
    fontSize: 12,
  },
  closedBadge: {
    backgroundColor: '#ece3ce',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  closedBadgeText: {
    color: '#707e8b',
    fontWeight: '700',
    fontSize: 12,
  },
  completedBadge: {
    backgroundColor: '#e8f0fe',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  completedBadgeText: {
    color: '#1a73e8',
    fontWeight: '700',
    fontSize: 12,
  },
  pointsTag: {
    color: '#8a621d',
    fontWeight: '800',
    fontSize: 13,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: '#102942',
    marginBottom: 6,
  },
  desc: {
    color: '#5c6670',
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 19,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  metaBadge: {
    backgroundColor: '#f1ebd9',
    color: '#495057',
    fontSize: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontWeight: '600',
  },
  schedule: {
    color: '#8a94a0',
    fontSize: 12,
    marginTop: 4,
  },
  action: {
    color: '#8a621d',
    fontWeight: '700',
    marginTop: 14,
    fontSize: 14,
  },
  emptyCard: {
    backgroundColor: '#fffdf7',
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dacba7',
    alignItems: 'center',
    marginTop: 20,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#102942',
    marginBottom: 6,
  },
  emptySubtitle: {
    color: '#5c6670',
    textAlign: 'center',
    fontSize: 14,
  },
  error: {
    color: '#aa2828',
    backgroundColor: '#fde8e8',
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
});
