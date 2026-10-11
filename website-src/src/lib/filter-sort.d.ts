import type { ApiSkill } from "../../../src/api/types";
export interface FilterState {
  searchQuery: string;
  activeCategories: Set<string>;
  activeRepo: string;
  activeFacets: Record<string, Set<string>>;
  sort: string;
}
export function applyFilters<T extends ApiSkill>(
  skills: T[],
  state: FilterState,
  options?: { scoreById?: Map<string, number> | null },
): T[];
