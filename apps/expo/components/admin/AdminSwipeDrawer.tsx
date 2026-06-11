/**
 * AdminSwipeDrawer
 *
 * Full-height left navigation drawer for the admin section of the Expo app.
 *
 * - Opens by swiping RIGHT from the LEFT EDGE of the screen (within 24px).
 * - Closes by swiping LEFT on the open drawer, tapping the backdrop, or pressing X.
 * - Admin nav items mirror the web AdminLayoutShell.
 * - Shares open/close state via AdminDrawerContext.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
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

interface AdminDrawerContextValue {
  openDrawer: () => void;
  closeDrawer: () => void;
  isOpen: boolean;
}

const AdminDrawerContext = createContext<AdminDrawerContextValue>({
  openDrawer: () => {},
  closeDrawer: () => {},
  isOpen: false,
});

export function useAdminDrawer() {
  return useContext(AdminDrawerContext);
}

// ---------------------------------------------------------------------------
// Admin nav items
// ---------------------------------------------------------------------------

const DRAWER_WIDTH = 280;
const EDGE_THRESHOLD = 24;
const SPRING = { damping: 22, stiffness: 180 };

interface AdminNavItem {
  label: string;
  href: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { label: 'Dashboard',         href: '/admin',                     icon: 'grid-outline' },
  { label: 'Users',             href: '/admin/users',               icon: 'people-outline' },
  { label: 'Moderation',        href: '/admin/moderation',          icon: 'flag-outline' },
  { label: 'Community Notes',   href: '/admin/community-notes',     icon: 'document-text-outline' },
  { label: 'Financial',         href: '/admin/financial',           icon: 'card-outline' },
  { label: 'Payouts',           href: '/admin/payouts',             icon: 'cash-outline' },
  { label: 'Refunds',           href: '/admin/refunds',             icon: 'return-down-back-outline' },
  { label: 'Announcements',     href: '/admin/announcements',       icon: 'megaphone-outline' },
  { label: 'Messages',          href: '/admin/messages',            icon: 'chatbubble-outline' },
  { label: 'Alerts',            href: '/admin/alerts',              icon: 'notifications-outline' },
  { label: 'Config',            href: '/admin/config',              icon: 'settings-outline' },
  { label: 'AI Settings',       href: '/admin/ai-settings',         icon: 'hardware-chip-outline' },
  { label: 'Feature Flags',     href: '/admin/feature-flags',       icon: 'rocket-outline' },
  { label: 'Branded Rooms',     href: '/admin/branded-rooms',       icon: 'home-outline' },
  { label: 'Leaderboards',      href: '/admin/leaderboards',        icon: 'podium-outline' },
  { label: 'Events',            href: '/admin/events',              icon: 'calendar-outline' },
  { label: 'Flash XP',          href: '/admin/flash-xp',            icon: 'flash-outline' },
  { label: 'Gift Drop',         href: '/admin/gift-drop',           icon: 'gift-outline' },
  { label: 'Seasons',           href: '/admin/seasons',             icon: 'ribbon-outline' },
  { label: 'Sponsored Quests',  href: '/admin/sponsored-quests',    icon: 'star-outline' },
  { label: 'Actions Log',       href: '/admin/actions-log',         icon: 'list-outline' },
  { label: 'Creator Spotlight', href: '/admin/creator-spotlight',   icon: 'sparkles-outline' },
];

// ---------------------------------------------------------------------------
// Drawer content
// ---------------------------------------------------------------------------

function AdminDrawerContent({ onClose }: { onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const { isDark } = useTheme();

  const bg = isDark ? colors.neutral[900] : colors.neutral[0];
  const divider = isDark ? colors.neutral[800] : colors.neutral[200];
  const activeBg = isDark ? '#1e3a5f' : '#eff6ff';
  const activeText = colors.brand.blue;
  const inactiveText = isDark ? colors.neutral[400] : colors.neutral[600];
  const headerBg = isDark ? colors.neutral[800] : colors.neutral[100];

  const navigate = (href: string) => {
    onClose();
    setTimeout(() => {
      router.push(href as Parameters<typeof router.push>[0]);
    }, 50);
  };

  return (
    <View style={[styles.drawerContent, { backgroundColor: bg, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: headerBg, borderBottomColor: divider }]}>
        <View style={styles.headerBrand}>
          <Text style={[styles.brandName, { color: isDark ? colors.neutral[50] : colors.neutral[900] }]}>
            Zobia
          </Text>
          <View style={styles.adminBadge}>
            <Text style={styles.adminBadgeText}>ADMIN</Text>
          </View>
        </View>
        <Pressable
          onPress={onClose}
          style={styles.closeBtn}
          accessibilityLabel="Close admin menu"
          hitSlop={8}
        >
          <Ionicons name="close" size={22} color={inactiveText} />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.navList, { paddingBottom: insets.bottom + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back to user area */}
        <Pressable
          onPress={() => navigate('/home')}
          style={styles.backItem}
          accessibilityRole="menuitem"
        >
          <Ionicons name="arrow-back-outline" size={18} color={activeText} />
          <Text style={[styles.backLabel, { color: activeText }]}>User Area</Text>
        </Pressable>

        <View style={[styles.divider, { backgroundColor: divider }]} />

        {/* Admin nav links */}
        {ADMIN_NAV_ITEMS.map((item) => {
          const isActive = item.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(item.href);
          return (
            <Pressable
              key={item.href}
              onPress={() => navigate(item.href)}
              style={[styles.navItem, { backgroundColor: isActive ? activeBg : 'transparent' }]}
              accessibilityRole="menuitem"
            >
              <Ionicons name={item.icon} size={20} color={isActive ? activeText : inactiveText} />
              <Text style={[styles.navLabel, { color: isActive ? activeText : inactiveText }]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// AdminSwipeDrawer
// ---------------------------------------------------------------------------

interface AdminSwipeDrawerProps {
  children: React.ReactNode;
}

export function AdminSwipeDrawer({ children }: AdminSwipeDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const translateX = useSharedValue(-DRAWER_WIDTH);
  const backdropOpacity = useSharedValue(0);
  const isDrawerOpen = useSharedValue(false);
  const canHandle = useSharedValue(false);
  const { isDark } = useTheme();

  const openDrawer = useCallback(() => {
    translateX.value = withSpring(0, SPRING);
    backdropOpacity.value = withSpring(1, SPRING);
    isDrawerOpen.value = true;
    setIsOpen(true);
  }, [translateX, backdropOpacity, isDrawerOpen]);

  const closeDrawer = useCallback(() => {
    translateX.value = withSpring(-DRAWER_WIDTH, SPRING);
    backdropOpacity.value = withSpring(0, SPRING);
    isDrawerOpen.value = false;
    setIsOpen(false);
  }, [translateX, backdropOpacity, isDrawerOpen]);

  const pan = Gesture.Pan()
    .onBegin((e) => {
      canHandle.value = e.absoluteX <= EDGE_THRESHOLD || isDrawerOpen.value;
    })
    .onUpdate((e) => {
      if (!canHandle.value) return;
      if (isDrawerOpen.value) {
        const clamped = Math.min(0, Math.max(-DRAWER_WIDTH, e.translationX));
        translateX.value = clamped;
        backdropOpacity.value = (clamped + DRAWER_WIDTH) / DRAWER_WIDTH;
      } else {
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
    <AdminDrawerContext.Provider value={{ openDrawer, closeDrawer, isOpen }}>
      <GestureDetector gesture={pan}>
        <View style={styles.root}>
          {children}

          {isOpen && (
            <TouchableWithoutFeedback onPress={closeDrawer}>
              <Animated.View
                style={[styles.backdrop, backdropAnimStyle]}
                pointerEvents="auto"
              />
            </TouchableWithoutFeedback>
          )}

          <Animated.View style={[styles.drawer, drawerAnimStyle]}>
            <AdminDrawerContent onClose={closeDrawer} />
          </Animated.View>
        </View>
      </GestureDetector>
    </AdminDrawerContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: { flex: 1 },
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
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 20,
  },
  drawerContent: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandName: {
    fontSize: 16,
    fontWeight: '700',
  },
  adminBadge: {
    backgroundColor: '#f59e0b',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  adminBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
  },
  closeBtn: {
    padding: 6,
  },
  navList: {
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  backItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 2,
  },
  backLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 4,
    marginVertical: 6,
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
});
