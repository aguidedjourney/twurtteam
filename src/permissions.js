// Who can see what.
//
// Every API route belongs to one "area". A role lists the areas it can use.
// Owners (Twurt + Britney) have full access. When the team members join,
// add their roles here and give them only the areas their interface needs.

export const ROLES = {
  owner: { label: 'Owner — full access', areas: '*' },
  // Examples for later:
  // publicist: { label: 'Publicist', areas: ['goals'] },
  // social:    { label: 'Social manager', areas: ['goals', 'merch'] },
};

export function can(user, area) {
  const role = ROLES[user?.role];
  if (!role) return false;
  return role.areas === '*' || role.areas.includes(area);
}
