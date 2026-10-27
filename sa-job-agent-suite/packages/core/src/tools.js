// Server-side tool builders.

export const WEB_SEARCH_TOOL_TYPE = 'web_search_20260318';

/** Anthropic server-side web search, localised to South Africa by default. */
export function webSearchTool({ maxUses, country = 'ZA', timezone = 'Africa/Johannesburg' } = {}) {
  return {
    type: WEB_SEARCH_TOOL_TYPE,
    name: 'web_search',
    ...(maxUses ? { max_uses: maxUses } : {}),
    user_location: { type: 'approximate', country, timezone }
  };
}
