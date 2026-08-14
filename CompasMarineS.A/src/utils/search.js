export function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function normalizeSearchIdentifier(value) {
  return normalizeSearchText(value).replace(/[^a-z0-9]/g, '');
}

export function splitSearchTokens(value) {
  return normalizeSearchText(value).split(/\s+/).filter(Boolean);
}

export function matchesSearchTokenPrefixes(query, candidateValues) {
  const queryTokens = splitSearchTokens(query);
  if (queryTokens.length === 0) return false;

  const values = Array.isArray(candidateValues) ? candidateValues : [candidateValues];
  const candidateTokens = values.flatMap(splitSearchTokens);
  if (candidateTokens.length === 0) return false;

  return queryTokens.every((queryToken) => (
    candidateTokens.some((candidateToken) => candidateToken.startsWith(queryToken))
  ));
}

export function identifierStartsWith(candidate, query) {
  const normalizedQuery = normalizeSearchIdentifier(query);
  if (!normalizedQuery) return false;
  return normalizeSearchIdentifier(candidate).startsWith(normalizedQuery);
}
