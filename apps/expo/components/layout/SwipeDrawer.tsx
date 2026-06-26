/**
 * SwipeDrawer
 *
 * Full-height left navigation drawer for the Expo app.
 *
 * - Opens by swiping RIGHT from the LEFT EDGE of the screen (within 40px).
 * - Closes by swiping LEFT on the open drawer or tapping the backdrop.
 * - Uses react-native-gesture-handler v2 + react-native-reanimated 3.
 * - Shares open/close state via DrawerContext so child screens can trigger it.
 *
 * Usage:
 *   Wrap your root layout content with <SwipeDrawer>...</SwipeDrawer>.
 *   Call useDrawer().openDrawer() / useDrawer().closeDrawer() from any child.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useState,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/lib/auth/hooks';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface DrawerContextValue {
  openDrawer: () => void;
  closeDrawer: () => void;
  isOpen: boolean;
}

const DrawerContext = createContext<DrawerContextValue>({
  openDrawer: () => {},
  closeDrawer: () => {},
  isOpen: false,
});

export function useDrawer() {
  return useContext(DrawerContext);
}

// ---------------------------------------------------------------------------
// Nav items
// ---------------------------------------------------------------------------

const DRAWER_WIDTH = 280;
// BUG-M18 FIX: raise to 40px to avoid Android system back-gesture zone (≤30dp).
// On gesture-nav devices the OS reserves the leftmost 30dp for the system back
// gesture; a 24px threshold competed with it. 40px sits safely outside that zone.
const EDGE_THRESHOLD = 40;
const SPRING = { damping: 22, stiffness: 180 };

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Home',          href: '/(tabs)',               icon: 'home-outline' },
  { label: 'Quests',        href: '/(tabs)/quests',        icon: 'checkmark-circle-outline' },
  { label: 'Rooms',         href: '/(tabs)/rooms',         icon: 'grid-outline' },
  { label: 'Messages',      href: '/(tabs)/messages',      icon: 'chatbubble-outline' },
  { label: 'Friends',       href: '/(tabs)/friends',       icon: 'people-outline' },
  { label: 'Gifts',         href: '/(tabs)/gifts',         icon: 'gift-outline' },
  { label: 'Wallet',        href: '/(tabs)/wallet',        icon: 'wallet-outline' },
  { label: 'Notifications', href: '/notifications',        icon: 'notifications-outline' },
  { label: 'Events',        href: '/events',               icon: 'calendar-outline' },
  { label: 'Leaderboards',  href: '/leaderboards',         icon: 'trophy-outline' },
  { label: 'Games',         href: '/games',                icon: 'game-controller-outline' },
  { label: 'Referrals',     href: '/referrals',            icon: 'link-outline' },
  { label: 'Seasons',       href: '/seasons',              icon: 'ribbon-outline' },
];

const SECONDARY_ITEMS: NavItem[] = [
  { label: 'Profile',  href: '/(tabs)/profile',  icon: 'person-outline' },
  { label: 'Settings', href: '/settings',        icon: 'settings-outline' },
];

// ---------------------------------------------------------------------------
// Drawer content
// ---------------------------------------------------------------------------

function DrawerContent({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const { isDark } = useTheme();
  // NOTE (FIX-18): This `isAdmin` flag is UI-only — it gates the admin nav item.
  // Actual security is enforced server-side; a compromised client cannot access real admin data.
  const isAdmin = user?.isAdmin === true;

  const bg = isDark ? colors.neutral[900] : colors.neutral[0];
  const divider = isDark ? colors.neutral[800] : colors.neutral[200];
  const activeBg = isDark ? '#1e3a5f' : '#eff6ff';
  const activeText = colors.brand.blue;
  const inactiveText = isDark ? colors.neutral[400] : colors.neutral[600];

  const navigate = (href: string) => {
    onClose();
    router.push(href as Parameters<typeof router.push>[0]);
  };

  const handleLogout = async () => {
    onClose();
    try {
      await signOut();
    } catch {
      // Navigation to login is handled by auth context on any signOut path
    }
  };

  const displayName = user?.displayName || user?.username || 'User';
  const username = user?.username ?? '';

  return (
    <View style={[styles.drawerContent, { backgroundColor: bg, paddingTop: insets.top + 8 }]}>
      {/* Close button */}
      <Pressable
        onPress={onClose}
        style={styles.closeBtn}
        accessibilityLabel="Close menu"
        hitSlop={8}
      >
        <Ionicons name="close" size={22} color={inactiveText} />
      </Pressable>

      {/* User card */}
      <View style={[styles.userCard, { borderBottomColor: divider }]}>
        <View style={[styles.avatarCircle, { backgroundColor: colors.brand.blue }]}>
          <Text style={styles.avatarEmoji}>{user?.avatarEmoji ?? '👤'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.displayName, { color: isDark ? colors.neutral[50] : colors.neutral[900] }]} numberOfLines={1}>
            {displayName}
          </Text>
          {username ? (
            <Text style={[styles.username, { color: inactiveText }]} numberOfLines={1}>
              @{username}
            </Text>
          ) : null}
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.navList, { paddingBottom: insets.bottom + 16 }]}
        showsVerticalScrollIndicator={false}
        accessibilityRole="menu"
      >
        {/* Admin link */}
        {isAdmin && (
          <Pressable
            onPress={() => navigate('/admin')}
            style={[styles.navItem, { backgroundColor: pathname.startsWith('/admin') ? activeBg : 'transparent' }]}
          >
            <Ionicons name="shield-outline" size={20} color={pathname.startsWith('/admin') ? activeText : inactiveText} />
            <Text style={[styles.navLabel, { color: pathname.startsWith('/admin') ? activeText : inactiveText }]}>
              Admin
            </Text>
          </Pressable>
        )}

        {/* Primary nav */}
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Pressable
              key={item.href}
              onPress={() => navigate(item.href)}
              style={[styles.navItem, { backgroundColor: active ? activeBg : 'transparent' }]}
              accessibilityRole="menuitem"
            >
              <Ionicons name={item.icon} size={20} color={active ? activeText : inactiveText} />
              <Text style={[styles.navLabel, { color: active ? activeText : inactiveText }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}

        {/* Divider */}
        <View style={[styles.divider, { backgroundColor: divider }]} />

        {/* Secondary nav */}
        {SECONDARY_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Pressable
              key={item.href}
              onPress={() => navigate(item.href)}
              style={[styles.navItem, { backgroundColor: active ? activeBg : 'transparent' }]}
              accessibilityRole="menuitem"
            >
              <Ionicons name={item.icon} size={20} color={active ? activeText : inactiveText} />
              <Text style={[styles.navLabel, { color: active ? activeText : inactiveText }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}

        {/* Logout */}
        <Pressable onPress={handleLogout} style={styles.navItem}>
          <Ionicons name="log-out-outline" size={20} color={colors.semantic.error} />
          <Text style={[styles.navLabel, { color: colors.semantic.error }]}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// SwipeDrawer
// ---------------------------------------------------------------------------

interface SwipeDrawerProps {
  children: React.ReactNode;
}

export function SwipeDrawer({ children }: SwipeDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const translateX = useSharedValue(-DRAWER_WIDTH);
  const backdropOpacity = useSharedValue(0);
  const isDrawerOpen = useSharedValue(false);
  const canHandle = useSharedValue(false);

  const openDrawer = useCallback(() => {
    isDrawerOpen.value = true;
    backdropOpacity.value = withSpring(1, SPRING);
    translateX.value = withSpring(0, SPRING, (finished) => {
      if (finished) runOnJS(setIsOpen)(true);
    });
  }, [translateX, backdropOpacity, isDrawerOpen]);

  const closeDrawer = useCallback(() => {
    isDrawerOpen.value = false;
    backdropOpacity.value = withSpring(0, SPRING);
    translateX.value = withSpring(-DRAWER_WIDTH, SPRING, (finished) => {
      if (finished) runOnJS(setIsOpen)(false);
    });
  }, [translateX, backdropOpacity, isDrawerOpen]);

  const pan = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-15, 15])
    .onBegin((e) => {
      // Allow gesture if touching from left edge (to open) OR drawer is open (to close/drag)
      canHandle.value = e.absoluteX <= EDGE_THRESHOLD || isDrawerOpen.value;
    })
    .onUpdate((e) => {
      if (!canHandle.value) return;
      if (isDrawerOpen.value) {
        // Dragging to close: allow leftward movement from open position
        const clamped = Math.min(0, Math.max(-DRAWER_WIDTH, e.translationX));
        translateX.value = clamped;
        backdropOpacity.value = (clamped + DRAWER_WIDTH) / DRAWER_WIDTH;
      } else {
        // Dragging to open: translationX starts at 0 (edge) so offset by -DRAWER_WIDTH
        const clamped = Math.min(0, Math.max(-DRAWER_WIDTH, e.translationX - DRAWER_WIDTH));
        translateX.value = clamped;
        backdropOpacity.value = (clamped + DRAWER_WIDTH) / DRAWER_WIDTH;
      }
    })
    .onEnd((e) => {
      if (!canHandle.value) return;
      canHandle.value = false;

      const progress = (translateX.value + DRAWER_WIDTH) / DRAWER_WIDTH;
      const shouldOpen = isDrawerOpen.value
        ? progress > 0.3 || e.velocityX > -200
        : progress > 0.35 || e.velocityX > 400;

      if (shouldOpen) {
        runOnJS(openDrawer)();
      } else {
        runOnJS(closeDrawer)();
      }
    });

  const drawerAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropAnimStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value * 0.5,
  }));

  return (
    <DrawerContext.Provider value={{ openDrawer, closeDrawer, isOpen }}>
      <GestureDetector gesture={pan}>
        <View style={styles.root}>
          {/* Main content */}
          {children}

          {/* Backdrop — always mounted to avoid flicker; pointer events disabled when closed */}
          <Animated.View
            style={[styles.backdrop, backdropAnimStyle]}
            pointerEvents={isOpen ? 'auto' : 'none'}
          >
            <TouchableWithoutFeedback onPress={closeDrawer}>
              <View style={StyleSheet.absoluteFillObject} />
            </TouchableWithoutFeedback>
          </Animated.View>

          {/* Drawer panel */}
          <Animated.View style={[styles.drawer, drawerAnimStyle]}>
            <DrawerContent onClose={closeDrawer} />
          </Animated.View>
        </View>
      </GestureDetector>
    </DrawerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
    zIndex: 98,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: DRAWER_WIDTH,
    zIndex: 99,
    // Shadow (iOS)
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    // Elevation (Android)
    elevation: 20,
  },
  drawerContent: {
    flex: 1,
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 1,
    padding: 6,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 8,
  },
  avatarCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 20,
    lineHeight: 24,
  },
  displayName: {
    fontSize: 14,
    fontWeight: '600',
  },
  username: {
    fontSize: 12,
    marginTop: 1,
  },
  navList: {
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 2,
  },
  navLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 4,
    marginVertical: 6,
  },
});
