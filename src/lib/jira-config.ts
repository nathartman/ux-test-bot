export const JIRA_PROJECT_KEY = "APP";

export const ISSUE_TYPES = {
  Bug: "10084",
  Task: "10082",
  Improvement: "10085",
  Investigation: "10086",
} as const;

export const ISSUE_TYPE_NAMES = ["Bug", "Task", "Improvement", "Investigation"] as const;

export const PRIORITY_OPTIONS = [
  { id: "5", label: "None", shortLabel: "None", color: "bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-400" },
  { id: "4", label: "Low", shortLabel: "Low", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400" },
  { id: "3", label: "Medium", shortLabel: "Med", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400" },
  { id: "2", label: "High", shortLabel: "High", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400" },
] as const;

export function getPriorityColor(priorityId: string): string {
  return PRIORITY_OPTIONS.find((o) => o.id === priorityId)?.color ?? "";
}

export const TEAMS: Record<string, string> = {
  Design: "10371",
  Fleet: "10246",
  Visualization: "10529",
  Data: "10506",
  "Machine Learning": "10507",
  "Computer Vision": "10405",
  Documentation: "10247",
  NetCode: "10505",
};

export const TEAM_NAMES = [
  "Design",
  "Fleet",
  "Visualization",
  "Data",
  "Machine Learning",
  "Computer Vision",
  "Documentation",
  "NetCode",
];
