import { User } from 'firebase/auth';

export interface UserProfile {
  name: string;
  username?: string;
  age: number | null;
  email: string;
  phoneNumber?: string | null;
  churchName?: string | null;
  address?: string | null;
  status: string;
  points?: number;
  authProvider?: string;
}

/** Returns a greeting matching the current local hour of day. */
export function getTimeGreeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning,';
  if (hour < 17) return 'Good afternoon,';
  return 'Good evening,';
}

/** Derives a capitalized display name from the local part of an email address. */
export function deriveNameFromEmail(email?: string | null): string {
  if (!email || !email.includes('@')) return 'Member';
  const localPart = email.split('@')[0];
  const cleaned = localPart
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Member';
  return cleaned
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Resolves the member display name from Firestore profile, Auth profile, or email. */
export function resolveDisplayName(
  profile?: UserProfile | null,
  authUser?: Pick<User, 'displayName' | 'email'> | null
): string {
  const profileName = profile?.name?.trim();
  if (profileName) return profileName;
  const authName = authUser?.displayName?.trim();
  if (authName) return authName;
  return deriveNameFromEmail(profile?.email || authUser?.email);
}

/** Returns up to two uppercase initials for the circular profile avatar. */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'M';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

