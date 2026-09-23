const TARGETS = {
  airport: { terms: /аэропорт|взл[её]т|airport|runway|terminal/i, waypoint: 'airport', name: 'Runway' },
  bridge: { terms: /мост|bridge/i, waypoint: 'bridge-rain', name: 'Bridge deck' },
  vegetation: { terms: /растительн|лес|дерев|пальм|vegetation|forest|tree|palm/i, waypoint: 'islands-snow', name: 'Forest understory' },
};
const WEATHER = [
  ['rain', /дожд|ливень|rain/i],
  ['snow', /снег|snow/i],
  ['sun', /солн|ясн|sun|clear/i],
];

function planMission(input, routes) {
  const request = typeof input === 'string' ? { goal: input } : input ?? {};
  const goal = String(request.goal ?? '').trim();
  if (!goal || goal.length > 500) throw new Error('Mission goal must contain 1–500 characters');
  const semantic = request.semantic || Object.entries(TARGETS).find(([, item]) => item.terms.test(goal))?.[0];
  const target = TARGETS[semantic];
  if (!target) throw new Error('Mission target must be airport, bridge, or vegetation');
  const route = routes.routes?.['oceania-inspection'];
  const waypoint = route?.waypoints.find(item => item.id === target.waypoint);
  if (!waypoint) throw new Error(`Mission waypoint is missing: ${target.waypoint}`);
  const textWeather = WEATHER.find(([, pattern]) => pattern.test(goal))?.[0];
  const daylightRequested = /дн[её]м|день|day/i.test(goal);
  const weather = request.weather ?? textWeather ?? (daylightRequested ? 'sun' : waypoint.environment.weather);
  if (!['sun', 'rain', 'snow'].includes(weather)) throw new Error('Unsupported mission weather');
  const textHour = /ноч|night/i.test(goal) ? 0.5 : /вечер|закат|sunset/i.test(goal) ? 18.5 : /дн[её]м|день|day/i.test(goal) ? 11 : null;
  const hour = request.hour ?? textHour ?? waypoint.environment.hour;
  if (!Number.isFinite(hour) || hour < 0 || hour >= 24) throw new Error('Mission hour must be between 0 and 24');
  const views = request.views ?? 3;
  if (!Number.isInteger(views) || views < 3 || views > 8) throw new Error('Mission views must be 3–8');
  return {
    goal, semantic, waypoint: waypoint.id, preferredName: target.name,
    selectionReason: `Goal matches ${semantic}; ${waypoint.id} supplies a known view of this area.`,
    environment: { hour, weather, cycle: false, autoWeather: false, immediate: true },
    views, maxExtraViews: 2,
    orbitAnchor: semantic === 'vegetation' ? waypoint.target : null,
    orbitRadius: semantic === 'vegetation' ? 900 : null,
  };
}

module.exports = { planMission };
