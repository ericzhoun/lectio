// Identity for a reader who has not signed in.
//
// The whole daily reading is open to anonymous readers: they walk all six
// steps, write their own words, and receive the model's replies. Those rows
// need an owner, so they are stored under the first-party visitor id that
// middleware already mints for every request, namespaced so it can never
// collide with a real user id (users are UUIDs, guests are `guest:<uuid>`).
//
// Nothing here is a credential: the visitor cookie is not signed and only ever
// grants access to a walk it created itself. The invitation to register comes
// at the end of the walk, and claimGuestWalk moves that day's rows across.

export const GUEST_PREFIX = 'guest:';

/** The row owner for an anonymous reader with visitor id `vid`. */
export function guestReaderId(vid: string): string {
  return `${GUEST_PREFIX}${vid}`;
}

export function isGuestReader(readerId: string): boolean {
  return readerId.startsWith(GUEST_PREFIX);
}
