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
  const [status, setStatus] = useState<'idle' | 'loading' | 'results' | 'error'>('idle');
  const [zobiaContacts, setZobiaContacts] = useState<ZobiaContact[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  /**
   * Request permissions, load device contacts, and cross-reference with Zobia.
   */
  const importContacts = useCallback(async () => {
    setStatus('loading');
    setError(null);

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

      // 4. Cross-reference with Zobia (server caps at 500 numbers per request)
      const response = await apiClient.post<{ contacts: ZobiaContact[] }>(
        '/api/users/contacts/cross-reference',
        { phoneNumbers: phoneNumbers.slice(0, 500) }
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
   * Silently ignores errors — this is a best-effort convenience action.
   */
  const handleInvite = useCallback(async (contact: ZobiaContact) => {
    try {
      await apiClient.post('/api/friends', { targetUserId: contact.userId });
      setInvited(prev => new Set([...prev, contact.userId]));
    } catch {
      // Not critical — user can always add friends from the profile page later
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
      <View style={styles.container}>
        <Text style={styles.title}>Find friends on Zobia</Text>
        <Text style={styles.subtitle}>
          See which of your contacts are already here. Only contacts already on Zobia will be shown.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={importContacts}>
          <Text style={styles.primaryButtonText}>Import Contacts</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipButton} onPress={() => onDone?.(0)}>
          <Text style={styles.skipButtonText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (status === 'loading') {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#000" />
        <Text style={styles.loadingText}>Finding friends...</Text>
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => onDone?.(0)}>
          <Text style={styles.primaryButtonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // status === 'results'
  return (
    <View style={styles.container}>
      <Text style={styles.title}>
        {zobiaContacts.length === 0
          ? 'No contacts on Zobia yet'
          : `${zobiaContacts.length} friend${zobiaContacts.length === 1 ? '' : 's'} on Zobia`}
      </Text>

      {zobiaContacts.length === 0 ? (
        <Text style={styles.subtitle}>
          None of your contacts are on Zobia yet. Invite them!
        </Text>
      ) : (
        <FlatList
          data={zobiaContacts}
          keyExtractor={item => item.userId}
          renderItem={({ item }) => (
            <View style={styles.contactRow}>
              <Text style={styles.avatar}>{item.avatarEmoji}</Text>
              <View style={styles.contactInfo}>
                <Text style={styles.displayName}>{item.displayName}</Text>
                <Text style={styles.username}>@{item.username}</Text>
              </View>
              <TouchableOpacity
                style={invited.has(item.userId) ? styles.addedButton : styles.addButton}
                onPress={() => handleInvite(item)}
                disabled={invited.has(item.userId)}
                accessibilityLabel={
                  invited.has(item.userId)
                    ? `Already added ${item.displayName}`
                    : `Add ${item.displayName} as a friend`
                }
              >
                <Text
                  style={
                    invited.has(item.userId) ? styles.addedButtonText : styles.addButtonText
                  }
                >
                  {invited.has(item.userId) ? 'Added' : 'Add'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
          style={styles.list}
        />
      )}

      <TouchableOpacity style={styles.primaryButton} onPress={handleDone}>
        <Text style={styles.primaryButtonText}>
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
    color: '#555',
    textAlign: 'center',
    marginBottom: 24,
  },
  loadingText: {
    textAlign: 'center',
    marginTop: 12,
    color: '#666',
  },
  errorText: {
    color: '#c00',
    textAlign: 'center',
    marginBottom: 24,
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
    borderBottomColor: '#eee',
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
    color: '#888',
  },
  addButton: {
    backgroundColor: '#000',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  addedButton: {
    backgroundColor: '#eee',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  addedButtonText: {
    color: '#888',
    fontWeight: '600',
    fontSize: 13,
  },
  primaryButton: {
    backgroundColor: '#000',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  skipButton: {
    alignItems: 'center',
    marginTop: 12,
  },
  skipButtonText: {
    color: '#888',
    fontSize: 14,
  },
});
