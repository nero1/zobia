import { useContext } from 'react';
import { FloatingNotificationContext } from '@/components/providers/FloatingNotificationProvider';

export function useFloatingNotification() {
  return useContext(FloatingNotificationContext);
}
