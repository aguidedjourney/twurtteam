// Who can see what.
//
// Every API route belongs to one "area". A role lists the areas it can use.
// Owners (Twurt + Britney) have full access. Each team member gets a role that
// only includes the areas their dashboard needs.
//
// Areas: finance, shows, merch, goals, users, social, social_approve, messages

export const ROLES = {
  owner: { label: 'Owner — full access', areas: '*' },
  social: { label: 'Social media manager', areas: ['social', 'messages'] },
  // Example for later:
  // publicist: { label: 'Publicist', areas: ['messages'] },
};

export function can(user, area) {
  const role = ROLES[user?.role];
  if (!role) return false;
  return role.areas === '*' || role.areas.includes(area);
}
