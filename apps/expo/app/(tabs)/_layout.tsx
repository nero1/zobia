import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '@/lib/theme/colors';
import { useAuth } from '@/lib/auth/hooks';
import { AnnouncementBanner } from '@/components/announcements/AnnouncementBanner';
import { SwipeDrawer } from '@/components/layout/SwipeDrawer';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface TabConfig {
  name: string;
  title: string;
  icon: IoniconName;
  iconFocused: IoniconName;
}

const TABS: TabConfig[] = [
  {
    name: 'index',
    title: 'Home',
    icon: 'home-outline',
    iconFocused: 'home',
  },
  {
    name: 'quests',
    title: 'Quests',
    icon: 'checkmark-circle-outline',
    iconFocused: 'checkmark-circle',
  },
  {
    name: 'messages',
    title: 'Messages',
    icon: 'chatbubble-outline',
    iconFocused: 'chatbubble',
  },
  {
    name: 'friends',
    title: 'Friends',
    icon: 'people-outline',
    iconFocused: 'people',
  },
  {
    name: 'wallet',
    title: 'Wallet',
    icon: 'wallet-outline',
    iconFocused: 'wallet',
  },
  {
    name: 'profile',
    title: 'Profile',
    icon: 'person-outline',
    iconFocused: 'person',
  },
];

/**
 * Bottom tab navigator for the five main sections of Zobia Social.
 *
 * Design constraints:
 * - No purple, no gradients
 * - Active tint: brand blue (#2563EB)
 * - Inactive tint: neutral gray
 * - Respects system dark/light mode
 *
 * Admin tab is conditionally shown only when user.is_admin === true.
 */
export default function TabLayout() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const { user } = useAuth();
  // NOTE (FIX-18): This `isAdmin` flag is UI-only — it controls tab visibility.
  // Actual security is enforced server-side on every admin API endpoint.
  // A compromised client cannot access real admin data even if this flag is bypassed.
  const isAdmin = user?.isAdmin === true;
  const { bottom } = useSafeAreaInsets();

  const tabBarBg = isDark ? colors.neutral[900] : colors.neutral[0];
  const activeTint = colors.brand.blue;
  const inactiveTint = isDark ? colors.neutral[500] : colors.neutral[400];
  const borderColor = isDark ? colors.neutral[800] : colors.neutral[200];

  return (
    <SwipeDrawer>
    <View style={{ flex: 1 }}>
      <AnnouncementBanner />
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: inactiveTint,
        tabBarStyle: {
          backgroundColor: tabBarBg,
          borderTopColor: borderColor,
          borderTopWidth: 1,
          height: 60 + bottom,
          paddingBottom: bottom + 8,
          paddingTop: 4,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
      {/* Admin tab — shown first (leftmost) when user is admin */}
      <Tabs.Screen
        name="admin"
        options={{
          title: 'Admin',
          href: isAdmin ? undefined : null,
          tabBarIcon: ({ focused, color }) => (
            <Ionicons
              name={focused ? 'shield' : 'shield-outline'}
              size={24}
              color={color}
            />
          ),
        }}
      />

      {TABS.map(({ name, title, icon, iconFocused }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ focused, color }) => (
              <Ionicons
                name={focused ? iconFocused : icon}
                size={24}
                color={color}
              />
            ),
          }}
        />
      ))}

      {/* Rooms, Guild and Gifts accessible but hidden from tab bar */}
      <Tabs.Screen name="rooms" options={{ href: null }} />
      <Tabs.Screen name="guild" options={{ href: null }} />
      <Tabs.Screen name="gifts" options={{ href: null }} />
    </Tabs>
    </View>
    </SwipeDrawer>
  );
}
