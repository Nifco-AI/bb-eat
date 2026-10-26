import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
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
        <Stack.Screen name="PickIngredient" component={IngredientsScreen} options={{ title: '选择食材' }} />
        <Stack.Screen name="Ingredients" component={IngredientsScreen} options={{ title: '食材库' }} />
        <Stack.Screen name="Recipes" component={RecipesScreen} options={{ title: '食谱' }} />
        <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen as React.ComponentType} options={{ title: '食谱详情' }} />
        <Stack.Screen name="Inventory" component={InventoryScreen} options={{ title: '家里有什么' }} />
        <Stack.Screen name="BabyProfile" component={BabyProfileScreen} options={{ title: '宝宝信息' }} />
        <Stack.Screen name="Backup" component={BackupScreen} options={{ title: '备份与恢复' }} />
        <Stack.Screen name="Sources" component={SourcesScreen} options={{ title: '资料来源' }} />
        <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ title: '隐私与数据' }} />
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
        renderError={(message, retry) => (
          <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 16 }}>
            <Text style={[typography.title, { marginBottom: 12 }]}>无法打开本地数据库</Text>
            <ErrorState detail={message} onRetry={retry} />
          </View>
        )}
      >
        <NavigationContainer theme={navTheme}>
          <Shell />
        </NavigationContainer>
      </AppProvider>
    </SafeAreaProvider>
  );
}
