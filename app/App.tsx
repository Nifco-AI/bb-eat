import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as SQLite from 'expo-sqlite';

// Pipeline smoke screen: proves local SQLite persists across restarts. Not product UI.
export default function App() {
  const [launches, setLaunches] = useState<number | null>(null);

  useEffect(() => {
    const db = SQLite.openDatabaseSync('bbeat.db');
    db.execSync('CREATE TABLE IF NOT EXISTS launches (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL)');
    db.runSync('INSERT INTO launches (at) VALUES (?)', new Date().toISOString());
    const row = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM launches');
    setLaunches(row?.n ?? null);
  }, []);

  return (
    <View style={styles.c}>
      <Text style={styles.t}>BB-Eat</Text>
      <Text>内部构建链路验证（合成数据，非医学建议）</Text>
      <Text>本地 SQLite 启动次数：{launches ?? '…'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: '#FBF7EE', alignItems: 'center', justifyContent: 'center', gap: 8 },
  t: { fontSize: 28, fontWeight: '600', color: '#4A4540' },
});
