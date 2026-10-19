import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
export default function Quizzes() {
  const [items, setItems] = useState<any[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  useEffect(() => onSnapshot(query(collection(db, 'quizzes'), where('status', 'in', ['published', 'closed'])), snap => { setItems(snap.docs.map(d => ({ id: d.id, ...d.data() }))); setLoading(false); }, e => { setError(e.message); setLoading(false); }), []);
  return <View style={s.page}><Text style={s.title}>Competitions</Text>{loading && <ActivityIndicator />}{!!error && <Text>{error}</Text>}<FlatList data={items} keyExtractor={item => item.id} ListEmptyComponent={!loading ? <Text>No competitions are available yet.</Text> : null} renderItem={({ item }) => <Pressable style={s.card} onPress={() => router.push({ pathname: '/quiz/[id]', params: { id: item.id } })}><Text style={s.name}>{item.title}</Text><Text>{item.description}</Text><Text style={s.meta}>{new Date(item.startAt?.seconds * 1000).toLocaleString()} · {item.durationMinutes} minutes</Text><Text style={s.action}>{item.status === 'closed' ? 'View details' : 'Open quiz →'}</Text></Pressable>} /></View>;
}
const s = StyleSheet.create({ page: { flex: 1, padding: 20 }, title: { fontSize: 30, fontWeight: '700', color: '#102942', marginBottom: 20 }, card: { backgroundColor: 'white', padding: 20, borderRadius: 14, marginBottom: 14, borderWidth: 1, borderColor: '#dacba7' }, name: { fontSize: 20, fontWeight: '700', color: '#102942', marginBottom: 8 }, meta: { color: '#5c6670', marginTop: 12 }, action: { color: '#8a621d', fontWeight: '700', marginTop: 14 } });
