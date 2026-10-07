import './env';
import type { Actor, Contact, Gender, SeniorProfile } from '../shared/types';

// Single demo household. Placeholder numbers never reach a real person; set real ones in .env
// to demo the "call" buttons on a phone.
export const profile: SeniorProfile = {
  firstName: 'Halina',
  fullName: 'Halina Kowalska',
  gender: 'f',
  age: 79,
  city: 'Lublin',
  addressAs: 'Pani Halino',
  familyCallsHer: 'Mama',
  familyCallsHerGenitive: 'Mamy',
  familyCallsHerAccusative: 'Mamę',
  familyCallsHerInstrumental: 'Mamą',
  phone: process.env.SENIOR_PHONE ?? '+48 000 000 000',
  assistantName: 'Pola',
};

export const contacts: Contact[] = [
  { id: 'anna', name: 'Anna', relation: 'córka', gender: 'f', phone: process.env.CONTACT_ANNA_PHONE ?? '+48 000 000 001' },
  { id: 'tomek', name: 'Tomek', relation: 'syn', gender: 'm', phone: process.env.CONTACT_TOMEK_PHONE ?? '+48 000 000 002' },
];

/** Where she lives: pickup address for a taxi and coordinates for the weather. */
export const household = {
  address: 'ul. Lipowa 8/3, Lublin',
  lat: Number(process.env.HOUSEHOLD_LAT ?? 51.2465),
  lon: Number(process.env.HOUSEHOLD_LON ?? 22.5684),
};

export const contactIds = contacts.map((c) => c.id) as [string, ...string[]];

/** The Family App is used by the first contact in the POC (no accounts yet). */
export const familyViewer = contacts[0];

export function contactById(id: string | null | undefined): Contact {
  return contacts.find((c) => c.id === id) ?? contacts[0];
}

function actorPerson(actor: Actor): { name: string; gender: Gender } {
  if (actor === 'family') return familyViewer;
  return { name: profile.familyCallsHer, gender: profile.gender };
}

/** "Mama dodała", "Anna dodała", "Tomek dodał" — for family-feed titles. */
export function actorDid(actor: Actor, masculine: string, feminine: string): string {
  const person = actorPerson(actor);
  return `${person.name} ${person.gender === 'f' ? feminine : masculine}`;
}

export function seniorDid(masculine: string, feminine: string): string {
  return `${profile.familyCallsHer} ${profile.gender === 'f' ? feminine : masculine}`;
}
