/**
 * Re-exports recommendation command dispatch for CLI callers.
 */
export { runRecommend } from "./recommend/commands.js";
/**
 * Re-exports recommendation report helpers for programmatic callers.
 */
export {
  buildRecommendationReport,
  writeRecommendationReport,
} from "./recommend/report.js";
