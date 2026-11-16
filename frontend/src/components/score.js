// Colour bands shared by the dial, meters and history: strong (>= 75) green,
// workable (50-74) cobalt, needs work (< 50) amber.
export const scoreBand = (score) => (score >= 75 ? 'strong' : score >= 50 ? 'fair' : 'weak');
export const bandLabel = { strong: 'Strong match', fair: 'Workable match', weak: 'Needs work' };
