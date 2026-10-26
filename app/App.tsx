import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { AppProvider } from './src/ui/AppProvider';
import { ErrorState, LoadingState } from './src/ui/components';
import { ErrorBoundary } from './src/ui/ErrorBoundary';
import { colors, MIN_TOUCH, shadow, typography } from './src/ui/theme';
import { TodayScreen } from './src/ui/screens/TodayScreen';
import { RecommendScreen } from './src/ui/screens/RecommendScreen';
import { GrowthScreen } from './src/ui/screens/GrowthScreen';
import { QuickRecordSheet } from './src/ui/screens/QuickRecordSheet';
import {
  IngredientsScreen,
  InventoryScreen,
  RecipeDetailScreen,
  RecipesScreen,
} from './src/ui/screens/LibraryScreens';
import {
  BabyProfileScreen,
  BackupScreen,
  PrivacyScreen,
  SourcesScreen,
} from './src/ui/screens/SettingsScreens';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.bg,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    primary: colors.sage,
  },
};

const TAB_ICONS: Record<string, string> = { 今日: '●', 推荐: '✦', 成长: '▲' };

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.sage,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 62, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarIcon: ({ color }: { color: string }) => (
          <Text style={{ color, fontSize: 16 }}>{TAB_ICONS[route.name] ?? '•'}</Text>
        ),
      })}
    >
      <Tab.Screen name="今日">
        {(p: any) => (
          <ErrorBoundary label="今日">
            <TodayScreen {...p} />
          </ErrorBoundary>
        )}
      </Tab.Screen>
      <Tab.Screen name="推荐">
        {(p: any) => (
          <ErrorBoundary label="推荐">
            <RecommendScreen {...p} />
          </ErrorBoundary>
        )}
      </Tab.Screen>
      <Tab.Screen name="成长">
        {(p: any) => (
          <ErrorBoundary label="成长">
            <GrowthScreen {...p} />
          </ErrorBoundary>
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

/**
 * Wraps a stack screen in an ErrorBoundary. Memoised per screen so the
 * navigator sees a stable component type and does not remount on every render.
 */
const guarded = new Map<string, React.ComponentType>();
function guard<P extends object>(label: string, Component: React.ComponentType<P>): React.ComponentType {
  const cached = guarded.get(label);
  if (cached) return cached;
  const Wrapped = (props: P) => (
    <ErrorBoundary label={label}>
      <Component {...props} />
    </ErrorBoundary>
  );
  Wrapped.displayName = `Guarded(${label})`;
  const asScreen = Wrapped as React.ComponentType;
  guarded.set(label, asScreen);
  return asScreen;
}

/** The quick-record button is global: recording must never be more than one tap away. */
function Shell() {
  const [quick, setQuick] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        {/*
          Every pushed screen is wrapped too, not just the tabs. These screens
          run their own SQL, so a schema drift in any one of them would
          otherwise white-screen the whole app instead of reporting itself.
        */}
        <Stack.Screen name="PickIngredient" component={guard('选择食材', IngredientsScreen)} options={{ title: '选择食材' }} />
        <Stack.Screen name="Ingredients" component={guard('食材库', IngredientsScreen)} options={{ title: '食材库' }} />
        <Stack.Screen name="Recipes" component={guard('食谱', RecipesScreen)} options={{ title: '食谱' }} />
        <Stack.Screen name="RecipeDetail" component={guard('食谱详情', RecipeDetailScreen as React.ComponentType)} options={{ title: '食谱详情' }} />
        <Stack.Screen name="Inventory" component={guard('家里有什么', InventoryScreen)} options={{ title: '家里有什么' }} />
        <Stack.Screen name="BabyProfile" component={guard('宝宝信息', BabyProfileScreen)} options={{ title: '宝宝信息' }} />
        <Stack.Screen name="Backup" component={guard('备份与恢复', BackupScreen)} options={{ title: '备份与恢复' }} />
        <Stack.Screen name="Sources" component={guard('资料来源', SourcesScreen)} options={{ title: '资料来源' }} />
        <Stack.Screen name="Privacy" component={guard('隐私与数据', PrivacyScreen)} options={{ title: '隐私与数据' }} />
      </Stack.Navigator>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="快速记录"
        accessibilityHint="记录奶量、尝到的食物、身体情况或你的怀疑"
        onPress={() => setQuick(true)}
        style={({ pressed }) => [
          {
            position: 'absolute',
            right: 20,
            bottom: 86,
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: colors.terracotta,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
            minWidth: MIN_TOUCH,
            minHeight: MIN_TOUCH,
          },
          shadow,
        ]}
      >
        <Text style={{ color: colors.onAccent, fontSize: 28, lineHeight: 32 }}>＋</Text>
      </Pressable>

      {quick && <QuickRecordSheet onClose={() => setQuick(false)} />}
    </View>
  );
}


/**
 * A failed boot is the one screen a caregiver cannot navigate away from, so a
 * bare "retry" button is not enough: a migration that aborts to protect data
 * (see migrations.ts v2) fails identically on every retry, and the only
 * remaining remedy would be clearing app storage, which destroys exactly the
 * data the abort was protecting. This offers to copy the raw SQLite file out
 * first, so the records survive even when the app cannot open them.
 */
function BootFailure({ message, retry }: { message: string; retry: () => void }) {
  const [status, setStatus] = useState<string | null>(null);

  const rescue = async () => {
    setStatus('正在导出…');
    try {
      const source = new File(Paths.document, 'SQLite', 'bbeat.db');
      if (!source.exists) {
        setStatus('没有找到数据库文件，可能还没有产生任何记录。');
        return;
      }
      const target = new File(Paths.cache, `bbeat-rescue-${Date.now()}.db`);
      source.copy(target);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(target.uri, {
          mimeType: 'application/octet-stream',
          dialogTitle: '导出 BB-Eat 原始数据库',
        });
        setStatus('已导出原始数据库文件。请妥善保存后再考虑清除应用数据。');
      } else {
        setStatus(`已复制到：${target.uri}`);
      }
    } catch (e) {
      setStatus(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 16 }}>
      <Text style={[typography.title, { marginBottom: 12 }]}>无法打开本地数据库</Text>
      <ErrorState detail={message} onRetry={retry} />
      <Text style={[typography.body, { marginTop: 16, color: colors.textMuted }]}>
        如果重试一直失败，先把原始数据库文件导出保存，再联系支持或清除应用数据。清除应用数据会删除全部记录。
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={rescue}
        style={{
          minHeight: MIN_TOUCH,
          justifyContent: 'center',
          alignItems: 'center',
          marginTop: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={typography.body}>导出原始数据库文件</Text>
      </Pressable>
      {status ? (
        <Text style={[typography.caption, { marginTop: 10, color: colors.textMuted }]}>{status}</Text>
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <AppProvider
        renderLoading={() => (
          <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <LoadingState label="正在准备本地数据…" />
          </View>
        )}
        renderError={(message, retry) => <BootFailure message={message} retry={retry} />}
      >
        <NavigationContainer theme={navTheme}>
          <Shell />
        </NavigationContainer>
      </AppProvider>
    </SafeAreaProvider>
  );
}
