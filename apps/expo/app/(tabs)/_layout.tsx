import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from 'react-native';

import { colors } from '@/lib/theme/colors';

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
    name: 'rooms',
    title: 'Rooms',
    icon: 'mic-outline',
    iconFocused: 'mic',
  },
  {
    name: 'messages',
    title: 'Messages',
    icon: 'chatbubble-outline',
    iconFocused: 'chatbubble',
  },
  {
    name: 'guild',
    title: 'Guild',
    icon: 'shield-outline',
    iconFocused: 'shield',
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
 */
export default function TabLayout() {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';

  const tabBarBg = isDark ? colors.neutral[900] : colors.neutral[0];
  const activeTint = colors.brand.blue;
  const inactiveTint = isDark ? colors.neutral[500] : colors.neutral[400];
  const borderColor = isDark ? colors.neutral[800] : colors.neutral[200];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: activeTint,
        tabBarInactiveTintColor: inactiveTint,
        tabBarStyle: {
          backgroundColor: tabBarBg,
          borderTopColor: borderColor,
          borderTopWidth: 1,
          height: 60,
          paddingBottom: 8,
          paddingTop: 4,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}
    >
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
    </Tabs>
  );
}
