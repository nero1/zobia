/**
 * ContactsImporter.tsx
 *
 * Native phonebook contact import component for Zobia onboarding.
 * Uses expo-contacts to read device contacts and cross-references
 * against the platform to show which friends are already on Zobia.
 *
 * PRD §4 Step 4: "Invite contacts from their device phonebook
 * (only those already on Zobia are surfaced)."
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import * as Contacts from 'expo-contacts';
import { apiClient } from '@/lib/api/client';
import { useTheme } from '@/lib/theme';
import { colors } from '@/lib/theme/colors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A Zobia user whose phone number matched a device contact. */
interface ZobiaContact {
  userId: string;
  username: string;
  displayName: string;
  avatarEmoji: string;
  phoneNumber: string;
}

export interface ContactsImporterProps {
  /**
   * Called when the user taps "Continue". Receives the number of contacts
   * that the user chose to follow/add during this session.
   */
  onDone?: (invitedCount: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Multi-step contact importer shown during onboarding.
 *
 * 1. Requests device contacts permission.
 * 2. Reads all phone numbers from the device phonebook.
 * 3. Sends (up to 500) numbers to `/api/users/contacts/cross-reference`.
 * 4. Displays matched Zobia users — unknown contacts are intentionally hidden.
 * 5. Lets the user follow/add matched friends before continuing.
 */
export function ContactsImporter({ onDone }: ContactsImporterProps) {
  const { isDark } = useTheme();
  const [status, setStatus] = useState<'idle' | 'loading' | 'results' | 'error'>('idle');
  const [zobiaContacts, setZobiaContacts] = useState<ZobiaContact[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const [addErrors, setAddErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Theme-derived colors
  const bg = isDark ? colors.neutral[950] : colors.neutral[50];
  const textPrimary = isDark ? colors.neutral[50] : colors.neutral[900];
  const textSecondary = isDark ? colors.neutral[400] : colors.neutral[500];
  const border = isDark ? colors.neutral[800] : colors.neutral[200];
  const addBtnBg = isDark ? colors.neutral[100] : colors.neutral[900];
  const addBtnText = isDark ? colors.neutral[900] : colors.neutral[0];
  const addedBtnBg = isDark ? colors.neutral[800] : colors.neutral[200];
  const addedBtnText = isDark ? colors.neutral[500] : colors.neutral[500];

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Request permissions, load device contacts, and cross-reference with Zobia.
   * Resets all state so re-running import is idempotent.
   */
  const importContacts = useCallback(async () => {
    // BUG-LOGIC-05 FIX: reset all state before each import run
    setStatus('loading');
    setError(null);
    setZobiaContacts([]);
    setInvited(new Set());
    setAddingIds(new Set());
    setAddErrors({});

    try {
      // 1. Request OS permission
      const { status: permStatus } = await Contacts.requestPermissionsAsync();
      if (permStatus !== 'granted') {
        setError('Contact access was denied. You can invite friends manually later.');
        setStatus('error');
        return;
      }

      // 2. Load contacts — only phone numbers and names are needed
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });

      // 3. Extract and normalise phone numbers
      const phoneNumbers: string[] = [];
      for (const contact of data) {
        if (contact.phoneNumbers) {
          for (const phone of contact.phoneNumbers) {
            if (phone.number) {
              // Normalise: strip whitespace, dashes, and parentheses so numbers
              // can be matched against the format stored on the server.
              const normalised = phone.number.replace(/[\s\-()]/g, '');
              phoneNumbers.push(normalised);
            }
          }
        }
      }

      if (phoneNumbers.length === 0) {
        setZobiaContacts([]);
        setStatus('results');
        return;
      }

      // 4. Cross-reference with Zobia (server caps at 500 numbers per request; deduplicate first)
      const uniqueNumbers = [...new Set(phoneNumbers)];
      const response = await apiClient.post<{ contacts: ZobiaContact[] }>(
        '/users/contacts/cross-reference',
        { phoneNumbers: uniqueNumbers.slice(0, 500) }
      );

      setZobiaContacts(response.data?.contacts ?? []);
      setStatus('results');
    } catch (err) {
      console.error('[ContactsImporter]', err);
      setError('Could not import contacts. Please try again.');
      setStatus('error');
    }
  }, []);

  /**
   * Send a friend/follow request for a matched Zobia contact.
   * Shows per-contact loading state and surfaces errors inline.
   */
  const handleInvite = useCallback(async (contact: ZobiaContact) => {
    setAddingIds(prev => new Set([...prev, contact.userId]));
    setAddErrors(prev => { const next = { ...prev }; delete next[contact.userId]; return next; });
    try {
      await apiClient.post('/friends', { targetUserId: contact.userId });
      setInvited(prev => new Set([...prev, contact.userId]));
    } catch {
      // BUG-UX-04 FIX: surface the error inline per-contact instead of silently ignoring
      setAddErrors(prev => ({ ...prev, [contact.userId]: 'Failed to add. Tap to retry.' }));
    } finally {
      setAddingIds(prev => {
        const next = new Set(prev);
        next.delete(contact.userId);
        return next;
      });
    }
  }, []);

  const handleDone = () => {
    onDone?.(invited.size);
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  if (status === 'idle') {
    return (
      <View style={[styles.container, { backgroundColor: bg }]}>
        <Text style={[styles.title, { color: textPrimary }]}>Find friends on Zobia</Text>
        <Text style={[styles.subtitle, { color: textSecondary }]}>
          See which of your contacts are already here. Only contacts already on Zobia will be shown.
        </Text>
        <TouchableOpacity style={[styles.primaryButton, { backgroundColor: addBtnBg }]} onPress={importContacts}>
          <Text style={[styles.primaryButtonText, { color: addBtnText }]}>Import Contacts</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipButton} onPress={() => onDone?.(0)}>
          <Text style={[styles.skipButtonText, { color: textSecondary }]}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'loading') {
    return (
      <View style={[styles.container, { backgroundColor: bg }]}>
        <ActivityIndicator size="large" color={colors.brand.blue} />
        <Text style={[styles.loadingText, { color: textSecondary }]}>Finding friends...</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={[styles.container, { backgroundColor: bg }]}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={[styles.primaryButton, { backgroundColor: addBtnBg }]} onPress={() => onDone?.(0)}>
          <Text style={[styles.primaryButtonText, { color: addBtnText }]}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipButton} onPress={importContacts}>
          <Text style={[styles.skipButtonText, { color: textSecondary }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // status === 'results'
  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <Text style={[styles.title, { color: textPrimary }]}>
        {zobiaContacts.length === 0
          ? 'No contacts on Zobia yet'
          : `${zobiaContacts.length} friend${zobiaContacts.length === 1 ? '' : 's'} on Zobia`}
      </Text>

      {zobiaContacts.length === 0 ? (
        <Text style={[styles.subtitle, { color: textSecondary }]}>
          None of your contacts are on Zobia yet. Invite them!
        </Text>
      ) : (
        <FlatList
          data={zobiaContacts}
          keyExtractor={item => item.userId}
          renderItem={({ item }) => {
            const isAdded = invited.has(item.userId);
            const isAdding = addingIds.has(item.userId);
            const addError = addErrors[item.userId];
            return (
              <View style={[styles.contactRow, { borderBottomColor: border }]}>
                <Text style={styles.avatar}>{item.avatarEmoji}</Text>
                <View style={styles.contactInfo}>
                  <Text style={[styles.displayName, { color: textPrimary }]}>{item.displayName}</Text>
                  <Text style={[styles.username, { color: textSecondary }]}>@{item.username}</Text>
                  {addError ? (
                    <Text style={styles.addErrorText}>{addError}</Text>
                  ) : null}
                </View>
                {/* BUG-UX-03 FIX: show per-contact loading indicator */}
                <TouchableOpacity
                  style={[
                    isAdded ? [styles.addedButton, { backgroundColor: addedBtnBg }] : [styles.addButton, { backgroundColor: addBtnBg }],
                  ]}
                  onPress={() => !isAdded && handleInvite(item)}
                  disabled={isAdded || isAdding}
                  accessibilityLabel={
                    isAdded
                      ? `Already added ${item.displayName}`
                      : `Add ${item.displayName} as a friend`
                  }
                >
                  {isAdding ? (
                    <ActivityIndicator size="small" color={addBtnText} />
                  ) : (
                    <Text style={[isAdded ? styles.addedButtonText : styles.addButtonText, { color: isAdded ? addedBtnText : addBtnText }]}>
                      {isAdded ? 'Added' : addError ? 'Retry' : 'Add'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          }}
          style={styles.list}
        />
      )}

      <TouchableOpacity style={[styles.primaryButton, { backgroundColor: addBtnBg }]} onPress={handleDone}>
        <Text style={[styles.primaryButtonText, { color: addBtnText }]}>
          {invited.size > 0 ? `Continue (${invited.size} added)` : 'Continue'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 24,
  },
  loadingText: {
    textAlign: 'center',
    marginTop: 12,
  },
  errorText: {
    color: colors.semantic.error,
    textAlign: 'center',
    marginBottom: 24,
  },
  addErrorText: {
    color: colors.semantic.error,
    fontSize: 11,
    marginTop: 2,
  },
  list: {
    maxHeight: 320,
    marginBottom: 16,
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  avatar: {
    fontSize: 28,
    marginRight: 12,
  },
  contactInfo: {
    flex: 1,
  },
  displayName: {
    fontSize: 15,
    fontWeight: '600',
  },
  username: {
    fontSize: 13,
  },
  addButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 56,
    alignItems: 'center',
  },
  addButtonText: {
    fontWeight: '600',
    fontSize: 13,
  },
  addedButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 56,
    alignItems: 'center',
  },
  addedButtonText: {
    fontWeight: '600',
    fontSize: 13,
  },
  primaryButton: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
  },
  skipButton: {
    alignItems: 'center',
    marginTop: 12,
  },
  skipButtonText: {
    fontSize: 14,
  },
});
